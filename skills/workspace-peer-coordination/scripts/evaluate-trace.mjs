#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROTOCOL = "workspace-peer-coordination/v1";

const EVENT_TYPES = new Set([
  "REQUEST",
  "PARKED_ACK",
  "CLAIMED",
  "RELEASED",
  "RESUMED",
  "DECLINED",
  "ABORTED",
  "RECOVERY_REQUIRED",
]);
const SUCCESS_TERMINALS = new Set(["RESUMED", "DECLINED", "ABORTED"]);
const RECOVERY_REASONS = new Set([
  "expired",
  "missing_release",
  "missing_resume",
  "stale_event",
  "evidence_conflict",
  "unreachable",
]);
const MAX_TRACE_BYTES = 2 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_EVENTS = 10_000;
const MAX_ARRAY_ITEMS = 256;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStableId(value) {
  return (
    isNonBlank(value) &&
    value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

function parseTime(value) {
  if (!isNonBlank(value)) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString() === value ? parsed : undefined;
}

function hasEvidence(event) {
  return (
    Array.isArray(event.evidence) &&
    event.evidence.length > 0 &&
    event.evidence.length <= MAX_ARRAY_ITEMS &&
    event.evidence.every(isNonBlank)
  );
}

function hasSnapshot(event) {
  return isNonBlank(event.snapshot);
}

function addError(errors, line, event, code, message) {
  errors.push({
    line,
    coordinationId: isNonBlank(event?.coordinationId)
      ? event.coordinationId
      : null,
    code,
    message,
  });
}

function parseResource(value) {
  if (!isNonBlank(value)) return undefined;

  const port = /^port:([1-9][0-9]{0,4})$/u.exec(value);
  if (port) {
    const number = Number(port[1]);
    return number <= 65_535
      ? { key: `port:${number}`, kind: "port", value: String(number) }
      : undefined;
  }

  const pathResource = /^(worktree|path):(\/.*)$/u.exec(value);
  if (pathResource) {
    const [, kind, path] = pathResource;
    if (
      !posix.isAbsolute(path) ||
      posix.normalize(path) !== path ||
      (path.length > 1 && path.endsWith("/")) ||
      /[\u0000-\u001f\u007f]/u.test(path)
    ) {
      return undefined;
    }
    return { key: `${kind}:${path}`, kind, value: path };
  }

  const stable = /^(process-tree|service):([a-z0-9][a-z0-9._-]{0,127})$/u.exec(
    value,
  );
  if (stable) {
    return {
      key: `${stable[1]}:${stable[2]}`,
      kind: stable[1],
      value: stable[2],
    };
  }

  const custom =
    /^custom:([a-z0-9][a-z0-9._-]{0,63}):([a-z0-9][a-z0-9._-]{0,255})$/u.exec(
      value,
    );
  return custom
    ? {
        key: `custom:${custom[1]}:${custom[2]}`,
        kind: `custom:${custom[1]}`,
        value: custom[2],
      }
    : undefined;
}

function isFilesystemResource(resource) {
  return resource.kind === "worktree" || resource.kind === "path";
}

function pathContains(parent, child) {
  return parent === "/" || child === parent || child.startsWith(`${parent}/`);
}

function resourcesConflict(left, right) {
  if (isFilesystemResource(left) && isFilesystemResource(right)) {
    return (
      pathContains(left.value, right.value) ||
      pathContains(right.value, left.value)
    );
  }
  return left.key === right.key;
}

export function parseJsonLines(text, source = "trace") {
  const events = [];
  const errors = [];

  if (Buffer.byteLength(text, "utf8") > MAX_TRACE_BYTES) {
    errors.push({
      line: null,
      coordinationId: null,
      code: "trace_too_large",
      message: `${source}: trace exceeds ${MAX_TRACE_BYTES} bytes`,
    });
    return { events, errors };
  }

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (events.length >= MAX_EVENTS) {
      errors.push({
        line: index + 1,
        coordinationId: null,
        code: "too_many_events",
        message: `${source}: trace exceeds ${MAX_EVENTS} events`,
      });
      break;
    }
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      errors.push({
        line: index + 1,
        coordinationId: null,
        code: "line_too_large",
        message: `${source}: event exceeds ${MAX_LINE_BYTES} bytes`,
      });
      continue;
    }
    try {
      events.push({ line: index + 1, event: JSON.parse(line) });
    } catch (error) {
      errors.push({
        line: index + 1,
        coordinationId: null,
        code: "invalid_json",
        message: `${source}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { events, errors };
}

export function evaluateEvents(entries, initialErrors = []) {
  const errors = [...initialErrors];
  const states = new Map();
  const activeClaims = new Map();
  const usedClaimTokens = new Set();
  let lastGlobalAt;

  if (entries.length === 0) {
    errors.push({
      line: null,
      coordinationId: null,
      code: "empty_trace",
      message: "trace must contain at least one event",
    });
  }

  for (const entry of entries) {
    const { line, event } = entry;
    if (!isRecord(event)) {
      addError(
        errors,
        line,
        event,
        "invalid_event",
        "event must be a JSON object",
      );
      continue;
    }

    const eventErrorStart = errors.length;
    const requiredStrings = [
      "protocol",
      "coordinationId",
      "type",
      "at",
      "sender",
      "recipient",
      "nextAction",
    ];
    for (const field of requiredStrings) {
      if (!isNonBlank(event[field])) {
        addError(
          errors,
          line,
          event,
          "missing_field",
          `${field} must be a non-empty string`,
        );
      }
    }
    if (event.protocol !== PROTOCOL) {
      addError(
        errors,
        line,
        event,
        "protocol_mismatch",
        `protocol must equal ${PROTOCOL}`,
      );
    }
    for (const field of ["coordinationId", "sender", "recipient"]) {
      if (!isStableId(event[field])) {
        addError(
          errors,
          line,
          event,
          "invalid_identifier",
          `${field} must be a stable identifier`,
        );
      }
    }
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      addError(
        errors,
        line,
        event,
        "invalid_sequence",
        "sequence must be a positive integer",
      );
    }
    if (!EVENT_TYPES.has(event.type)) {
      addError(
        errors,
        line,
        event,
        "invalid_type",
        `unsupported event type ${String(event.type)}`,
      );
    }
    if (event.sender === event.recipient) {
      addError(
        errors,
        line,
        event,
        "invalid_participants",
        "sender and recipient must differ",
      );
    }
    const at = parseTime(event.at);
    if (at === undefined) {
      addError(
        errors,
        line,
        event,
        "invalid_time",
        "at must be a canonical UTC ISO-8601 timestamp",
      );
    } else {
      if (lastGlobalAt !== undefined && at < lastGlobalAt) {
        addError(
          errors,
          line,
          event,
          "global_time_regression",
          "event time precedes an earlier JSONL event",
        );
      }
      lastGlobalAt = Math.max(lastGlobalAt ?? at, at);
    }
    if (!hasEvidence(event)) {
      addError(
        errors,
        line,
        event,
        "missing_evidence",
        `evidence must contain 1-${MAX_ARRAY_ITEMS} non-empty items`,
      );
    }

    if (event.type === "REQUEST") {
      if (states.has(event.coordinationId)) {
        addError(
          errors,
          line,
          event,
          "duplicate_request",
          "coordinationId already exists",
        );
        continue;
      }
      if (event.sequence !== 1) {
        addError(
          errors,
          line,
          event,
          "invalid_initial_sequence",
          "REQUEST sequence must be 1",
        );
      }
      const parsedResources = Array.isArray(event.resources)
        ? event.resources.map(parseResource)
        : [];
      if (
        !Array.isArray(event.resources) ||
        event.resources.length === 0 ||
        event.resources.length > MAX_ARRAY_ITEMS ||
        parsedResources.some((resource) => resource === undefined) ||
        new Set(parsedResources.map((resource) => resource?.key)).size !==
          parsedResources.length
      ) {
        addError(
          errors,
          line,
          event,
          "invalid_resources",
          "resources must be a non-empty unique array of canonical typed identifiers",
        );
      }
      if (
        !Array.isArray(event.protectedScopes) ||
        event.protectedScopes.length > MAX_ARRAY_ITEMS ||
        !event.protectedScopes.every(isNonBlank)
      ) {
        addError(
          errors,
          line,
          event,
          "invalid_protected_scopes",
          "protectedScopes must be a bounded string array",
        );
      }
      if (!hasSnapshot(event)) {
        addError(
          errors,
          line,
          event,
          "missing_snapshot",
          "REQUEST requires snapshot",
        );
      }
      if (!isNonBlank(event.criticalSection)) {
        addError(
          errors,
          line,
          event,
          "missing_critical_section",
          "REQUEST requires criticalSection",
        );
      }
      const deadline = parseTime(event.deadline);
      if (deadline === undefined || (at !== undefined && deadline <= at)) {
        addError(
          errors,
          line,
          event,
          "invalid_deadline",
          "deadline must be canonical UTC and after REQUEST.at",
        );
      }

      if (errors.length === eventErrorStart) {
        states.set(event.coordinationId, {
          claimant: event.sender,
          peer: event.recipient,
          resources: parsedResources,
          requestDeadline: deadline,
          deadline,
          phase: "REQUESTED",
          claimToken: undefined,
          releaseSequence: undefined,
          lastSequence: event.sequence,
          lastAt: at,
        });
      }
      continue;
    }

    const state = states.get(event.coordinationId);
    if (!state) {
      addError(
        errors,
        line,
        event,
        "unknown_coordination",
        "first valid event must be REQUEST",
      );
      continue;
    }

    if (event.sequence !== state.lastSequence + 1) {
      addError(
        errors,
        line,
        event,
        "non_contiguous_sequence",
        `expected sequence ${state.lastSequence + 1}`,
      );
    }
    if (at !== undefined && state.lastAt !== undefined && at < state.lastAt) {
      addError(
        errors,
        line,
        event,
        "time_regression",
        "event time precedes the previous coordination event",
      );
    }

    const claimantToPeer =
      event.sender === state.claimant && event.recipient === state.peer;
    const peerToClaimant =
      event.sender === state.peer && event.recipient === state.claimant;
    if (!claimantToPeer && !peerToClaimant) {
      addError(
        errors,
        line,
        event,
        "participant_mismatch",
        "event participants differ from REQUEST",
      );
    }

    const expired =
      at !== undefined && state.deadline !== undefined && at > state.deadline;
    const deadlineSensitive =
      event.type === "PARKED_ACK" ||
      event.type === "CLAIMED" ||
      (state.phase === "CLAIMED" &&
        (event.type === "RELEASED" || event.type === "ABORTED"));
    if (expired && deadlineSensitive) {
      addError(
        errors,
        line,
        event,
        "event_after_deadline",
        "late event requires RECOVERY_REQUIRED",
      );
    }

    const envelopeValid = errors.length === eventErrorStart;
    if (envelopeValid) {
      state.lastSequence = event.sequence;
      state.lastAt = at;
    }

    switch (event.type) {
      case "PARKED_ACK": {
        if (state.phase !== "REQUESTED") {
          addError(
            errors,
            line,
            event,
            "invalid_transition",
            "PARKED_ACK requires REQUESTED",
          );
        }
        if (!peerToClaimant) {
          addError(
            errors,
            line,
            event,
            "invalid_direction",
            "PARKED_ACK must be peer to claimant",
          );
        }
        if (!hasSnapshot(event)) {
          addError(
            errors,
            line,
            event,
            "missing_snapshot",
            "PARKED_ACK requires snapshot",
          );
        }
        if (errors.length === eventErrorStart) state.phase = "PARKED";
        break;
      }
      case "CLAIMED": {
        if (state.phase !== "PARKED") {
          addError(
            errors,
            line,
            event,
            "invalid_transition",
            "CLAIMED requires PARKED",
          );
        }
        if (!claimantToPeer) {
          addError(
            errors,
            line,
            event,
            "invalid_direction",
            "CLAIMED must be claimant to peer",
          );
        }
        if (!hasSnapshot(event)) {
          addError(
            errors,
            line,
            event,
            "missing_snapshot",
            "CLAIMED requires snapshot",
          );
        }
        if (!isStableId(event.claimToken)) {
          addError(
            errors,
            line,
            event,
            "missing_claim_token",
            "CLAIMED requires a stable claimToken",
          );
        }
        if (usedClaimTokens.has(event.claimToken)) {
          addError(
            errors,
            line,
            event,
            "duplicate_claim_token",
            "claimToken must be unique across the trace",
          );
        }
        const claimedDeadline = parseTime(event.deadline);
        if (
          claimedDeadline === undefined ||
          (at !== undefined && claimedDeadline <= at) ||
          (state.requestDeadline !== undefined &&
            claimedDeadline > state.requestDeadline)
        ) {
          addError(
            errors,
            line,
            event,
            "invalid_claim_deadline",
            "CLAIMED deadline must be after CLAIMED.at and cannot extend REQUEST",
          );
        }
        for (const [owner, resources] of activeClaims) {
          if (owner === event.coordinationId) continue;
          for (const resource of state.resources) {
            const overlapping = resources.find((candidate) =>
              resourcesConflict(resource, candidate),
            );
            if (overlapping) {
              addError(
                errors,
                line,
                event,
                "overlapping_active_claim",
                `${resource.key} overlaps ${overlapping.key} claimed by ${owner}`,
              );
            }
          }
        }
        if (errors.length === eventErrorStart) {
          activeClaims.set(event.coordinationId, state.resources);
          usedClaimTokens.add(event.claimToken);
          state.claimToken = event.claimToken;
          state.deadline = claimedDeadline;
          state.phase = "CLAIMED";
        }
        break;
      }
      case "RELEASED": {
        if (state.phase !== "CLAIMED") {
          addError(
            errors,
            line,
            event,
            "invalid_transition",
            "RELEASED requires CLAIMED",
          );
        }
        if (!claimantToPeer) {
          addError(
            errors,
            line,
            event,
            "invalid_direction",
            "RELEASED must be claimant to peer",
          );
        }
        if (!hasSnapshot(event)) {
          addError(
            errors,
            line,
            event,
            "missing_snapshot",
            "RELEASED requires snapshot",
          );
        }
        if (event.claimToken !== state.claimToken) {
          addError(
            errors,
            line,
            event,
            "claim_token_mismatch",
            "RELEASED claimToken is stale or mismatched",
          );
        }
        if (errors.length === eventErrorStart) {
          activeClaims.delete(event.coordinationId);
          state.releaseSequence = event.sequence;
          state.phase = "RELEASED";
        }
        break;
      }
      case "RESUMED": {
        if (state.phase !== "RELEASED" && state.phase !== "ABORT_RELEASED") {
          addError(
            errors,
            line,
            event,
            "invalid_transition",
            "RESUMED requires RELEASED or a claimed ABORTED release",
          );
        }
        if (!peerToClaimant) {
          addError(
            errors,
            line,
            event,
            "invalid_direction",
            "RESUMED must be peer to claimant",
          );
        }
        if (!hasSnapshot(event)) {
          addError(
            errors,
            line,
            event,
            "missing_snapshot",
            "RESUMED requires snapshot",
          );
        }
        if (event.releaseSequence !== state.releaseSequence) {
          addError(
            errors,
            line,
            event,
            "release_sequence_mismatch",
            "RESUMED must reference the release event sequence",
          );
        }
        if (errors.length === eventErrorStart) state.phase = "RESUMED";
        break;
      }
      case "DECLINED": {
        if (state.phase !== "REQUESTED") {
          addError(
            errors,
            line,
            event,
            "invalid_transition",
            "DECLINED requires REQUESTED",
          );
        }
        if (!peerToClaimant) {
          addError(
            errors,
            line,
            event,
            "invalid_direction",
            "DECLINED must be peer to claimant",
          );
        }
        if (errors.length === eventErrorStart) state.phase = "DECLINED";
        break;
      }
      case "ABORTED": {
        if (!claimantToPeer) {
          addError(
            errors,
            line,
            event,
            "invalid_direction",
            "ABORTED must be claimant to peer",
          );
        }
        const abortsClaim = state.phase === "CLAIMED";
        if (abortsClaim) {
          if (event.claimToken !== state.claimToken) {
            addError(
              errors,
              line,
              event,
              "claim_token_mismatch",
              "claimed ABORTED requires the active claimToken",
            );
          }
          if (!hasSnapshot(event)) {
            addError(
              errors,
              line,
              event,
              "missing_snapshot",
              "claimed ABORTED requires a release snapshot",
            );
          }
        } else if (state.phase !== "REQUESTED" && state.phase !== "PARKED") {
          addError(
            errors,
            line,
            event,
            "invalid_transition",
            "ABORTED requires REQUESTED, PARKED, or CLAIMED",
          );
        }
        if (errors.length === eventErrorStart) {
          if (abortsClaim) {
            activeClaims.delete(event.coordinationId);
            state.releaseSequence = event.sequence;
            state.phase = "ABORT_RELEASED";
          } else {
            state.phase = "ABORTED";
          }
        }
        break;
      }
      case "RECOVERY_REQUIRED": {
        if (
          state.phase !== "CLAIMED" &&
          state.phase !== "RELEASED" &&
          state.phase !== "ABORT_RELEASED"
        ) {
          addError(
            errors,
            line,
            event,
            "invalid_transition",
            "RECOVERY_REQUIRED requires a claim awaiting safe resume",
          );
        }
        if (!RECOVERY_REASONS.has(event.reason)) {
          addError(
            errors,
            line,
            event,
            "invalid_recovery_reason",
            "RECOVERY_REQUIRED requires a supported reason",
          );
        }
        if (event.reason === "expired" && !expired) {
          addError(
            errors,
            line,
            event,
            "premature_recovery",
            "expired recovery requires a passed claim deadline",
          );
        }
        if (event.reason === "expired" && state.phase !== "CLAIMED") {
          addError(
            errors,
            line,
            event,
            "invalid_recovery_reason",
            "expired recovery requires an active claim",
          );
        }
        if (event.reason === "missing_release" && state.phase !== "CLAIMED") {
          addError(
            errors,
            line,
            event,
            "invalid_recovery_reason",
            "missing_release recovery requires an active claim",
          );
        }
        if (
          event.reason === "missing_resume" &&
          state.phase !== "RELEASED" &&
          state.phase !== "ABORT_RELEASED"
        ) {
          addError(
            errors,
            line,
            event,
            "invalid_recovery_reason",
            "missing_resume recovery requires a released claim",
          );
        }
        if (event.claimToken !== state.claimToken) {
          addError(
            errors,
            line,
            event,
            "claim_token_mismatch",
            "RECOVERY_REQUIRED must reference the claimToken",
          );
        }
        if (errors.length === eventErrorStart) {
          state.phase = "RECOVERY_REQUIRED";
        }
        break;
      }
      default:
        break;
    }
  }

  const summaries = [];
  for (const [coordinationId, state] of [...states.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!SUCCESS_TERMINALS.has(state.phase)) {
      errors.push({
        line: null,
        coordinationId,
        code: "incomplete_coordination",
        message: `terminal state is ${state.phase}`,
      });
    }
    summaries.push({
      coordinationId,
      claimant: state.claimant,
      peer: state.peer,
      terminalState: state.phase,
      resources: state.resources.map((resource) => resource.key),
    });
  }

  return {
    protocol: PROTOCOL,
    pass: errors.length === 0,
    eventCount: entries.length,
    coordinationCount: states.size,
    errors,
    summaries,
  };
}

export function evaluateText(text, source = "trace") {
  const parsed = parseJsonLines(text, source);
  return evaluateEvents(parsed.events, parsed.errors);
}

function evaluateFile(path) {
  const size = statSync(path).size;
  if (size > MAX_TRACE_BYTES) {
    return {
      source: resolve(path),
      sha256: null,
      ...evaluateEvents(
        [],
        [
          {
            line: null,
            coordinationId: null,
            code: "trace_too_large",
            message: `${path}: trace exceeds ${MAX_TRACE_BYTES} bytes`,
          },
        ],
      ),
    };
  }
  const text = readFileSync(path, "utf8");
  return {
    source: resolve(path),
    sha256: createHash("sha256").update(text).digest("hex"),
    ...evaluateText(text, path),
  };
}

function runSelfTest() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = resolve(scriptDir, "fixtures");
  const manifest = JSON.parse(
    readFileSync(resolve(fixturesDir, "manifest.json"), "utf8"),
  );
  const cases = manifest.map((testCase) => {
    const result = evaluateFile(resolve(fixturesDir, testCase.file));
    const actualCodes = new Set(result.errors.map((error) => error.code));
    const expectedCodes = testCase.expectedErrorCodes ?? [];
    return {
      file: testCase.file,
      expectedPass: testCase.expectedPass,
      actualPass: result.pass,
      expectedErrorCodes: expectedCodes,
      matched:
        result.pass === testCase.expectedPass &&
        expectedCodes.every((code) => actualCodes.has(code)),
      errors: result.errors,
    };
  });
  return { pass: cases.every((testCase) => testCase.matched), cases };
}

function main(argv) {
  if (argv.length !== 1) {
    process.stderr.write(
      "Usage: node evaluate-trace.mjs <events.jsonl>\n       node evaluate-trace.mjs --self-test\n",
    );
    return 64;
  }
  const result =
    argv[0] === "--self-test" ? runSelfTest() : evaluateFile(argv[0]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.pass ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
