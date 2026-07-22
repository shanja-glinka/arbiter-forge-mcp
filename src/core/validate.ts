import { sha256, uniqueSorted } from "./stable.js";
import type { RiskProfile, RiskSignal } from "./schemas.js";

export interface PromptValidationInput {
  prompt: string;
  operation: "implementation_task" | "documentation_task" | "blind_check_task";
  riskProfile: RiskProfile;
  riskSignals: readonly RiskSignal[];
  goalMode: "plain" | "persistent_requested";
  modelRouting: "adaptive" | "omit";
  routingPlanHash: string;
  requiredAudits: readonly string[];
  documentationBasis?: "current_aware" | "greenfield";
  strictBlindRequested: boolean;
  expectedPromptSha256?: string;
}

export interface PromptValidationResult {
  pass: boolean;
  assurance: "hash_bound" | "structural_only";
  promptSha256: string;
  unresolvedPlaceholders: string[];
  blockingErrors: string[];
  warnings: string[];
}

export function validateTaskPrompt(
  request: PromptValidationInput,
): PromptValidationResult {
  const prompt = request.prompt.replace(/\r\n?/gu, "\n");
  const normativePrompt = stripInlineSourceData(prompt);
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const unresolvedPlaceholders = findUnresolvedPlaceholders(normativePrompt);
  const promptSha256 = sha256(prompt);
  const hashBound = request.expectedPromptSha256 === promptSha256;
  const assurance = hashBound ? "hash_bound" : "structural_only";

  if (!prompt.endsWith("\n")) {
    warnings.push("Prompt does not end with a newline.");
  }
  if (!request.expectedPromptSha256) {
    blockingErrors.push(
      "expectedPromptSha256 is required for compiler-validation success; unbound edited text receives structural findings only and must be re-forged.",
    );
  } else if (!hashBound) {
    blockingErrors.push("Prompt hash differs from expectedPromptSha256.");
  }
  if (unresolvedPlaceholders.length > 0) {
    blockingErrors.push("Prompt contains unresolved template placeholders.");
  }

  validateInvariantManifest(prompt, request, blockingErrors);
  validateGoal(normativePrompt, request, blockingErrors);
  validateRouting(normativePrompt, request, blockingErrors);

  requireText(
    normativePrompt,
    "hard arbiter and orchestrator",
    blockingErrors,
    "Root hard-arbiter responsibility is missing.",
  );
  requireText(
    normativePrompt,
    "current integrated snapshot",
    blockingErrors,
    "Fresh snapshot gate is missing.",
  );
  requireText(
    normativePrompt,
    "outside Git",
    blockingErrors,
    "Artifact isolation policy is missing.",
  );
  requireText(
    normativePrompt,
    "CORRECTION_REQUIRED",
    blockingErrors,
    "Correction-loop state is missing.",
  );
  requireText(
    normativePrompt,
    "Do not call Arbiter Forge MCP during execution",
    blockingErrors,
    "Runtime-to-compiler isolation is missing.",
  );

  if (
    request.operation === "implementation_task" &&
    request.riskProfile !== "compact"
  ) {
    requireText(
      normativePrompt,
      "testing and acceptance",
      blockingErrors,
      "Standard/Critical task lacks a testing and acceptance audit.",
    );
    requireText(
      normativePrompt,
      "conventions",
      blockingErrors,
      "Standard/Critical task lacks a conventions/ownership audit.",
    );
  }

  if (
    request.operation === "implementation_task" &&
    request.riskProfile === "critical"
  ) {
    requireText(
      normativePrompt,
      "physical worktree",
      blockingErrors,
      "Critical task lacks physical-isolation or serialization guidance.",
    );
    requireText(
      normativePrompt,
      "blocking requirement",
      blockingErrors,
      "Critical task lacks blocking-requirement terminal semantics.",
    );
  }

  validateUiAndGraphql(normativePrompt, request.riskSignals, blockingErrors);
  validateDocumentation(normativePrompt, request, blockingErrors);

  if (
    request.operation === "blind_check_task" ||
    request.strictBlindRequested
  ) {
    validateBlindProtocol(normativePrompt, blockingErrors);
  }

  if (
    /\b(?:SKIPPED|NOT_RUN|PARTIAL|MISSING|UNSUPPORTED)\s*(?:=|is|means|counts as)\s*PASS\b/iu.test(
      normativePrompt,
    )
  ) {
    blockingErrors.push("Prompt equates a non-pass state with PASS.");
  }
  if (
    !/not (?:equal to|a) PASS|are not `?PASS`?|not `?PASS`?/iu.test(
      normativePrompt,
    )
  ) {
    warnings.push(
      "Non-pass states are not explicitly distinguished from PASS.",
    );
  }

  const uniqueErrors = uniqueSorted(blockingErrors);
  return {
    pass: uniqueErrors.length === 0 && hashBound,
    assurance,
    promptSha256,
    unresolvedPlaceholders,
    blockingErrors: uniqueErrors,
    warnings: uniqueSorted(warnings),
  };
}

function validateInvariantManifest(
  prompt: string,
  request: PromptValidationInput,
  errors: string[],
): void {
  const marker = "\n<!-- arbiter-forge:v1\n";
  const markerIndex = prompt.lastIndexOf(marker);
  const candidate =
    markerIndex >= 0 ? prompt.slice(markerIndex + 1).trimEnd() : "";
  const match = /^<!-- arbiter-forge:v1\n([\s\S]*?)\n-->$/u.exec(candidate);
  if (!match) {
    errors.push(
      "Prompt lacks the terminal arbiter-forge:v1 invariant manifest.",
    );
    return;
  }
  const values = new Map<string, string>();
  for (const line of match[1]!.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      errors.push(`Malformed invariant manifest line: ${line}`);
      continue;
    }
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }

  requireManifestValue(values, "operation", request.operation, errors);
  requireManifestValue(values, "risk_profile", request.riskProfile, errors);
  requireManifestValue(values, "goal_mode", request.goalMode, errors);
  requireManifestValue(values, "model_routing", request.modelRouting, errors);
  requireManifestValue(
    values,
    "documentation_basis",
    request.operation === "documentation_task"
      ? (request.documentationBasis ?? "missing")
      : "not_applicable",
    errors,
  );
  requireManifestValue(values, "hard_arbiter", "required", errors);
  requireManifestValue(
    values,
    "auditor_production_writes",
    "forbidden",
    errors,
  );
  requireManifestValue(values, "fresh_final_snapshot", "required", errors);
  requireManifestValue(
    values,
    "non_pass_states_equal_pass",
    "forbidden",
    errors,
  );
  requireManifestValue(
    values,
    "required_audits",
    uniqueSorted(request.requiredAudits).join(","),
    errors,
  );
  requireManifestValue(
    values,
    "strict_blind",
    request.strictBlindRequested ? "required" : "not_required",
    errors,
  );
  requireManifestValue(
    values,
    "blind_reverse_d2_coverage",
    request.strictBlindRequested ? "required" : "not_required",
    errors,
  );

  for (const hashKey of [
    "request_fingerprint",
    "policy_hash",
    "routing_plan_hash",
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(values.get(hashKey) ?? "")) {
      errors.push(`Invariant manifest ${hashKey} must be a SHA-256 value.`);
    }
  }
  requireManifestValue(
    values,
    "routing_plan_hash",
    request.routingPlanHash,
    errors,
  );
}

function validateRouting(
  prompt: string,
  request: PromptValidationInput,
  errors: string[],
): void {
  if (request.modelRouting === "omit") {
    if (prompt.includes("## Model routing contract")) {
      errors.push(
        "Model routing contract must be absent when routing is omitted.",
      );
    }
    return;
  }

  for (const token of [
    "## Model routing contract",
    "requestedRoute",
    "actualRoute",
    "fallbackReason",
    'fork_turns="none"',
    'fork_turns="all"',
    "not proof that a model was launched",
  ]) {
    requireText(
      prompt,
      token,
      errors,
      `Model routing contract is missing ${token}.`,
    );
  }
}

function validateGoal(
  prompt: string,
  request: PromptValidationInput,
  errors: string[],
): void {
  if (/(^|\n)\/goal\s+/u.test(prompt)) {
    errors.push(
      "Generated task prompts must not pre-emit /goal before get_goal preflight.",
    );
  }
  if (request.goalMode === "persistent_requested") {
    for (const token of [
      "get_goal",
      "create_goal",
      "update_goal",
      "Before any `create_goal` operation",
      "compatible active goal",
      "incompatible unfinished or `blocked` goal",
      "plan, checklist, or dispatch ladder",
      "previous goal is `complete`",
      "`blocked` goal",
      "continue implementation, correction, and fresh verification",
      "every major fan-in",
    ]) {
      requireText(
        prompt,
        token,
        errors,
        `Persistent goal lifecycle is missing ${token}.`,
      );
    }
  }
}

function stripInlineSourceData(prompt: string): string {
  return prompt.replace(
    /^  > Inline source data begins;[^\n]*\n[\s\S]*?^  > Inline source data ends\.$/gmu,
    "  > [inline source data omitted for semantic validation]",
  );
}

function validateDocumentation(
  prompt: string,
  request: PromptValidationInput,
  errors: string[],
): void {
  if (request.operation !== "documentation_task") return;

  for (const token of ["I1", "Comparator", "decision_required"]) {
    requireText(
      prompt,
      token,
      errors,
      `Documentation synthesis is missing ${token}.`,
    );
  }
  if (request.documentationBasis === "current_aware") {
    requireText(
      prompt,
      "I2 implementation archaeologist",
      errors,
      "Current-aware documentation is missing I2 implementation discovery.",
    );
    requireText(
      prompt,
      "full outer union",
      errors,
      "Current-aware documentation lacks full-outer current/intent comparison.",
    );
  }
  if (request.documentationBasis === "greenfield") {
    requireText(
      prompt,
      "explicit greenfield authoring",
      errors,
      "Greenfield documentation does not forbid current-state claims.",
    );
  }
  if (request.requiredAudits.includes("cold_reader")) {
    requireText(
      prompt,
      "Cold reader",
      errors,
      "Required cold-reader audit is missing.",
    );
  }
}

function findUnresolvedPlaceholders(prompt: string): string[] {
  const matches = [
    ...(prompt.match(/\{\{ARB_FORGE_[A-Z0-9_]+\}\}/gu) ?? []),
    ...(prompt.match(/\[\[ARB_FORGE_[A-Z0-9_]+\]\]/gu) ?? []),
  ];
  return uniqueSorted(matches);
}

function validateUiAndGraphql(
  prompt: string,
  signals: readonly RiskSignal[],
  errors: string[],
): void {
  if (signals.includes("browser_ui")) {
    for (const token of [
      "Playwright",
      "separate browser contexts",
      "no-retry",
      "console errors",
    ]) {
      requireText(
        prompt,
        token,
        errors,
        `Browser UI task is missing ${token} proof.`,
      );
    }
    requireText(
      prompt,
      "mocked owner",
      errors,
      "Browser UI task does not reject mocked owner-backed final proof.",
    );
  }

  if (signals.includes("graphql_client")) {
    for (const token of [
      "GraphQL `errors`",
      "HTTP 200",
      "authoritative readback",
      "APQ",
    ]) {
      requireText(
        prompt,
        token,
        errors,
        `GraphQL client task is missing ${token} proof.`,
      );
    }
  }
}

function validateBlindProtocol(prompt: string, errors: string[]): void {
  for (const token of [
    "D1",
    "D2",
    "D3",
    "allowed-input manifest",
    "actual resources read",
    "extra_or_forbidden_behavior",
    "independent_documentation_review",
    "full outer union",
    "reverse coverage of every D2 claim",
    "zero undispositioned D2 keys",
  ]) {
    requireText(prompt, token, errors, `Blind-check task is missing ${token}.`);
  }
}

function requireManifestValue(
  values: Map<string, string>,
  key: string,
  expected: string,
  errors: string[],
): void {
  if (values.get(key) !== expected) {
    errors.push(`Invariant manifest ${key} must equal ${expected}.`);
  }
}

function requireText(
  prompt: string,
  token: string,
  errors: string[],
  message: string,
): void {
  if (!prompt.toLocaleLowerCase("en").includes(token.toLocaleLowerCase("en"))) {
    errors.push(message);
  }
}
