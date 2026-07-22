import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skillRoot = resolve(projectRoot, "skills/workspace-peer-coordination");
const evaluatorUrl = pathToFileURL(
  resolve(skillRoot, "scripts/evaluate-trace.mjs"),
).href;

type Evaluation = {
  pass: boolean;
  errors: Array<{ code: string }>;
};

describe("workspace peer coordination companion", () => {
  it("keeps runtime scheduling outside Arbiter Forge", () => {
    const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");
    expect(skill).toContain("not an MCP scheduler or lock");
    expect(skill).toContain("service.");
    expect(skill).toContain(
      "REQUEST -> PARKED_ACK -> CLAIMED -> RELEASED -> RESUMED",
    );
    expect(skill).toContain("A test `PASS` is not a release");
    expect(skill).toContain("RECOVERY_REQUIRED");
  });

  it("accepts a complete handshake and rejects an incomplete claim", async () => {
    const { evaluateText } = (await import(evaluatorUrl)) as {
      evaluateText: (text: string) => Evaluation;
    };
    const fixtures = resolve(skillRoot, "scripts/fixtures");
    const happy = evaluateText(
      readFileSync(resolve(fixtures, "happy-path.jsonl"), "utf8"),
    );
    const missingRelease = evaluateText(
      readFileSync(resolve(fixtures, "missing-release.jsonl"), "utf8"),
    );

    expect(happy.pass).toBe(true);
    expect(missingRelease.pass).toBe(false);
    expect(missingRelease.errors.map((error) => error.code)).toContain(
      "incomplete_coordination",
    );
    expect(evaluateText("").errors.map((error) => error.code)).toContain(
      "empty_trace",
    );
  });

  it("rejects stale release tokens and overlapping active claims", async () => {
    const { evaluateText } = (await import(evaluatorUrl)) as {
      evaluateText: (text: string) => Evaluation;
    };
    const fixtures = resolve(skillRoot, "scripts/fixtures");
    const stale = evaluateText(
      readFileSync(resolve(fixtures, "stale-release.jsonl"), "utf8"),
    );
    const overlap = evaluateText(
      readFileSync(resolve(fixtures, "overlapping-claims.jsonl"), "utf8"),
    );

    expect(stale.errors.map((error) => error.code)).toContain(
      "claim_token_mismatch",
    );
    expect(overlap.errors.map((error) => error.code)).toContain(
      "overlapping_active_claim",
    );
  });

  it("requires peer resume after a claimed abort and honors the effective deadline", async () => {
    const { evaluateText } = (await import(evaluatorUrl)) as {
      evaluateText: (text: string) => Evaluation;
    };
    const fixtures = resolve(skillRoot, "scripts/fixtures");
    const openAbort = evaluateText(
      readFileSync(
        resolve(fixtures, "claimed-abort-without-resume.jsonl"),
        "utf8",
      ),
    );
    const resumedAbort = evaluateText(
      readFileSync(resolve(fixtures, "claimed-abort-resumed.jsonl"), "utf8"),
    );
    const shortened = evaluateText(
      readFileSync(resolve(fixtures, "shortened-deadline.jsonl"), "utf8"),
    );

    expect(openAbort.pass).toBe(false);
    expect(resumedAbort.pass).toBe(true);
    expect(shortened.errors.map((error) => error.code)).toContain(
      "event_after_deadline",
    );
  });

  it("rejects aliased resources, reordered traces, and oversized input", async () => {
    const { evaluateText } = (await import(evaluatorUrl)) as {
      evaluateText: (text: string) => Evaluation;
    };
    const fixtures = resolve(skillRoot, "scripts/fixtures");
    const alias = evaluateText(
      readFileSync(resolve(fixtures, "noncanonical-resource.jsonl"), "utf8"),
    );
    const reordered = evaluateText(
      readFileSync(resolve(fixtures, "reordered-overlap.jsonl"), "utf8"),
    );
    const oversized = evaluateText("x".repeat(2 * 1024 * 1024 + 1));

    expect(alias.errors.map((error) => error.code)).toContain(
      "invalid_resources",
    );
    expect(reordered.errors.map((error) => error.code)).toContain(
      "global_time_regression",
    );
    expect(oversized.errors.map((error) => error.code)).toContain(
      "trace_too_large",
    );
  });

  it("detects hierarchical scopes, unique tokens, and safe late resume", async () => {
    const { evaluateText } = (await import(evaluatorUrl)) as {
      evaluateText: (text: string) => Evaluation;
    };
    const fixtures = resolve(skillRoot, "scripts/fixtures");
    const hierarchy = evaluateText(
      readFileSync(resolve(fixtures, "hierarchical-overlap.jsonl"), "utf8"),
    );
    const duplicateToken = evaluateText(
      readFileSync(resolve(fixtures, "duplicate-claim-token.jsonl"), "utf8"),
    );
    const lateResume = evaluateText(
      readFileSync(resolve(fixtures, "post-deadline-resume.jsonl"), "utf8"),
    );
    const claimantRecovery = evaluateText(
      readFileSync(resolve(fixtures, "claimant-recovery.jsonl"), "utf8"),
    );

    expect(hierarchy.errors.map((error) => error.code)).toContain(
      "overlapping_active_claim",
    );
    expect(duplicateToken.errors.map((error) => error.code)).toContain(
      "duplicate_claim_token",
    );
    expect(lateResume.pass).toBe(true);
    expect(claimantRecovery.errors.map((error) => error.code)).toEqual([
      "incomplete_coordination",
    ]);
  });
});
