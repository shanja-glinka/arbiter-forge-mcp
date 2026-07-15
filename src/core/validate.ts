import { sha256, uniqueSorted } from "./stable.js";
import type { RiskSignal, ValidateTaskRequest } from "./schemas.js";

export interface PromptValidationResult {
  pass: boolean;
  promptSha256: string;
  unresolvedPlaceholders: string[];
  blockingErrors: string[];
  warnings: string[];
}

export function validateTaskPrompt(
  request: ValidateTaskRequest,
): PromptValidationResult {
  const prompt = request.prompt.replace(/\r\n?/gu, "\n");
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const unresolvedPlaceholders = findUnresolvedPlaceholders(prompt);
  const promptSha256 = sha256(prompt);

  if (!prompt.endsWith("\n")) {
    warnings.push("Prompt does not end with a newline.");
  }
  if (
    request.expectedPromptSha256 &&
    request.expectedPromptSha256 !== promptSha256
  ) {
    blockingErrors.push("Prompt hash differs from expectedPromptSha256.");
  }
  if (unresolvedPlaceholders.length > 0) {
    blockingErrors.push("Prompt contains unresolved template placeholders.");
  }

  const goalOccurrences = prompt.match(/(^|\n)\/goal\s+/gu)?.length ?? 0;
  if (request.goalMode === "plain" && prompt.includes("/goal")) {
    blockingErrors.push("Plain goal mode must not contain /goal.");
  }
  if (request.goalMode === "persistent_requested" && goalOccurrences !== 1) {
    blockingErrors.push(
      "Persistent goal mode requires exactly one leading /goal command.",
    );
  }
  if (
    request.goalMode === "persistent_requested" &&
    !prompt.startsWith("/goal ")
  ) {
    blockingErrors.push("The /goal command must be the first line.");
  }

  requireText(
    prompt,
    "hard arbiter",
    blockingErrors,
    "Root hard-arbiter responsibility is missing.",
  );
  requireText(
    prompt,
    "current integrated snapshot",
    blockingErrors,
    "Fresh snapshot gate is missing.",
  );
  requireText(
    prompt,
    "outside Git",
    blockingErrors,
    "Artifact isolation policy is missing.",
  );
  requireText(
    prompt,
    "CORRECTION_REQUIRED",
    blockingErrors,
    "Correction-loop state is missing.",
  );

  if (
    request.operation === "implementation_task" &&
    request.riskProfile !== "compact"
  ) {
    requireText(
      prompt,
      "testing and acceptance",
      blockingErrors,
      "Standard/Critical task lacks a testing and acceptance audit.",
    );
    requireText(
      prompt,
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
      prompt,
      "physical worktree",
      blockingErrors,
      "Critical task lacks physical-isolation or serialization guidance.",
    );
    requireText(
      prompt,
      "blocking requirement",
      blockingErrors,
      "Critical task lacks blocking-requirement terminal semantics.",
    );
  }

  validateUiAndGraphql(prompt, request.riskSignals, blockingErrors);

  if (request.operation === "documentation_task") {
    for (const token of ["I1", "I2", "Comparator", "Cold reader"]) {
      requireText(
        prompt,
        token,
        blockingErrors,
        `Documentation synthesis is missing ${token}.`,
      );
    }
    requireText(
      prompt,
      "decision_required",
      blockingErrors,
      "Documentation synthesis can silently resolve open decisions.",
    );
  }

  if (
    request.operation === "blind_check_task" ||
    request.strictBlindRequested
  ) {
    validateBlindProtocol(prompt, blockingErrors);
  }

  if (
    /\b(?:SKIPPED|NOT_RUN|PARTIAL|MISSING|UNSUPPORTED)\s*(?:=|is|means)\s*PASS\b/iu.test(
      prompt,
    )
  ) {
    blockingErrors.push("Prompt equates a non-pass state with PASS.");
  }
  if (!/not (?:equal to|a) PASS|are not `?PASS`?|not `?PASS`?/iu.test(prompt)) {
    warnings.push(
      "Non-pass states are not explicitly distinguished from PASS.",
    );
  }

  return {
    pass: blockingErrors.length === 0,
    promptSha256,
    unresolvedPlaceholders,
    blockingErrors: uniqueSorted(blockingErrors),
    warnings: uniqueSorted(warnings),
  };
}

function findUnresolvedPlaceholders(prompt: string): string[] {
  const matches = [
    ...(prompt.match(/\{\{[^{}\n]+\}\}/gu) ?? []),
    ...(prompt.match(/\[\[[^\[\]\n]+\]\]/gu) ?? []),
    ...(prompt.match(/\b(?:TODO|TBD|FIXME):?\b/gu) ?? []),
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
  ]) {
    requireText(prompt, token, errors, `Blind-check task is missing ${token}.`);
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
