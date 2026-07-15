import {
  compileBlindCheckTask,
  compileDocumentationTask,
  compileImplementationTask,
} from "./render.js";
import {
  type BlindCheckRequest,
  type DocumentationRequest,
  type ImplementationRequest,
  type ValidateTaskRequest,
} from "./schemas.js";
import { sha256, uniqueSorted } from "./stable.js";
import { validateTaskPrompt } from "./validate.js";

export interface RevalidationResult {
  pass: boolean;
  assurance: "recompiled" | "structural_only";
  promptSha256: string;
  expectedPromptSha256: string;
  requestFingerprint: string;
  policyHash: string;
  forgeStatus: "ready" | "needs_input" | "invalid";
  unresolvedPlaceholders: string[];
  blockingErrors: string[];
  warnings: string[];
}

/** Recompile the typed source request and require byte identity before PASS. */
export function revalidateTaskPrompt(
  request: ValidateTaskRequest,
): RevalidationResult {
  const expected =
    request.operation === "implementation_task"
      ? compileImplementationTask(request.request as ImplementationRequest)
      : request.operation === "documentation_task"
        ? compileDocumentationTask(request.request as DocumentationRequest)
        : compileBlindCheckTask(request.request as BlindCheckRequest);
  const sourceRequest = request.request;
  const strictBlindRequested =
    request.operation === "blind_check_task"
      ? (sourceRequest as BlindCheckRequest).strictIsolation
      : expected.decisions.requiredAudits.includes("documentation_blind_check");
  const structural = validateTaskPrompt({
    prompt: request.prompt,
    operation: request.operation,
    riskProfile: expected.decisions.riskProfile,
    riskSignals: sourceRequest.riskSignals,
    goalMode: sourceRequest.goalMode,
    requiredAudits: expected.decisions.requiredAudits,
    ...(request.operation === "documentation_task"
      ? {
          documentationBasis: (sourceRequest as DocumentationRequest)
            .documentationBasis,
        }
      : {}),
    strictBlindRequested,
    expectedPromptSha256: expected.prompt.sha256,
  });
  const blockingErrors = [...structural.blockingErrors];

  if (request.expectedPromptSha256 !== expected.prompt.sha256) {
    blockingErrors.push(
      "expectedPromptSha256 does not match the deterministic recompile.",
    );
  }
  if (request.prompt !== expected.prompt.text) {
    blockingErrors.push(
      "Prompt bytes differ from the deterministic recompile; edited prompts cannot receive PASS. Re-forge the typed request.",
    );
  }
  if (expected.status !== "ready") {
    blockingErrors.push(
      `Typed source request recompiles to ${expected.status}, not ready.`,
    );
    blockingErrors.push(...expected.validation.blockingErrors);
    blockingErrors.push(...expected.validation.missingMaterialInputs);
  }

  const uniqueErrors = uniqueSorted(blockingErrors);
  const recompiled =
    request.prompt === expected.prompt.text &&
    request.expectedPromptSha256 === expected.prompt.sha256 &&
    expected.status === "ready";
  return {
    pass: recompiled && uniqueErrors.length === 0,
    assurance: recompiled ? "recompiled" : "structural_only",
    promptSha256: sha256(request.prompt),
    expectedPromptSha256: expected.prompt.sha256,
    requestFingerprint: expected.requestFingerprint,
    policyHash: expected.policyHash,
    forgeStatus: expected.status,
    unresolvedPlaceholders: structural.unresolvedPlaceholders,
    blockingErrors: uniqueErrors,
    warnings: uniqueSorted([
      ...expected.validation.warnings,
      ...structural.warnings,
    ]),
  };
}
