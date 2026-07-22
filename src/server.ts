import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { isAbsolute } from "node:path";
import { z } from "zod/v4";

import { inspectWorkspace } from "./core/inspect.js";
import { materializeTaskBundle } from "./core/materialize.js";
import { readPolicy } from "./core/policy.js";
import {
  compileBlindCheckTask,
  compileDocumentationTask,
  compileImplementationTask,
} from "./core/render.js";
import { revalidateTaskPrompt } from "./core/revalidate.js";
import {
  blindCheckForgeResultSchema,
  blindCheckRequestSchema,
  documentationForgeResultSchema,
  documentationRequestSchema,
  implementationForgeResultSchema,
  implementationRequestSchema,
  inspectWorkspaceRequestSchema,
  inspectWorkspaceResultSchema,
  PACKAGE_VERSION,
  materializeTaskRequestSchema,
  materializeTaskResultSchema,
  promptValidationResultSchema,
  validateTaskRequestSchema,
} from "./core/schemas.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const MATERIALIZE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "arbiter-forge", version: PACKAGE_VERSION },
    {
      instructions:
        "Arbiter Forge compiles and validates orchestration task specifications, then can materialize compiler-owned bytes as a persistent ignored bundle inside an allowlisted target repository. forge status=ready means compiled, not created. When the operator asks to create a task, call materialize_task_bundle with outputMode=resumable_package and goalMode=persistent_requested; claim saved/created only for status=written or unchanged. After creation, explicitly offer a host-native Codex App task or same-agent execution. A creator agent must never invoke run.sh, codex exec, or a nested Codex session. Materialization is creation-time only: the server never executes tasks, launches agents, observes actual routes, manages goals, or claims audit PASS, and execution agents must not call it. Use forge_implementation_task for coding work, forge_documentation_task for independent documentation synthesis, and forge_blind_check_task for strict docs-versus-code comparison.",
    },
  );

  server.registerTool(
    "inspect_workspace",
    {
      title: "Inspect workspace for task forging",
      description:
        "Read-only, allowlisted preflight that returns Git snapshot metadata, project rules, harness signals, source hashes, and a context fingerprint. It never returns source contents.",
      inputSchema: inspectWorkspaceRequestSchema,
      outputSchema: inspectWorkspaceResultSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const result = inspectWorkspace(input);
      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "forge_implementation_task",
    {
      title: "Forge implementation arbiter task",
      description:
        "Compile a deterministic, self-contained implementation prompt with adaptive risk, per-role model/provider preferences and fallbacks, ownership, independent audits, UI/GraphQL proof when applicable, correction loops, and hard terminal gates. Compilation does not create files or launch a task.",
      inputSchema: implementationRequestSchema,
      outputSchema: implementationForgeResultSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      forgeToolResult(
        compileImplementationTask(implementationRequestSchema.parse(input)),
      ),
  );

  server.registerTool(
    "forge_documentation_task",
    {
      title: "Forge documentation synthesis task",
      description:
        "Compile an independent intent/code/governance discovery workflow that creates as-is, to-be, or mixed documentation plus optional implementation task deliverables. Compilation does not create files or launch a task.",
      inputSchema: documentationRequestSchema,
      outputSchema: documentationForgeResultSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      forgeToolResult(
        compileDocumentationTask(documentationRequestSchema.parse(input)),
      ),
  );

  server.registerTool(
    "forge_blind_check_task",
    {
      title: "Forge strict documentation blind check",
      description:
        "Compile an isolated D1/D2/D3 documentation-versus-code audit with allowlists, manifests, normalized comparison, forbidden-extra detection, and honest degradation when isolation cannot be proven. Compilation does not create files or launch a task.",
      inputSchema: blindCheckRequestSchema,
      outputSchema: blindCheckForgeResultSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      forgeToolResult(
        compileBlindCheckTask(blindCheckRequestSchema.parse(input)),
      ),
  );

  server.registerTool(
    "validate_task",
    {
      title: "Validate an Arbiter Forge task prompt",
      description:
        "Recompile the original typed forge request and report compiler-validation success only for a ready, byte-identical generated prompt. Edited text receives structural-only diagnostics; this is never a runtime PASS verdict.",
      inputSchema: validateTaskRequestSchema,
      outputSchema: promptValidationResultSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const result = revalidateTaskPrompt(
        validateTaskRequestSchema.parse(input),
      );
      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "materialize_task_bundle",
    {
      title: "Materialize a validated Arbiter Forge task bundle",
      description:
        "Recompile and validate a persistent-goal resumable request, then atomically save only compiler-produced task bytes under <target-repository>/.arbiter-forge/tasks/. Proves Git-ignore, refuses conflicts and symlink escapes, and returns Codex App, same-agent, verify-only, and operator-only manual handoff instructions without starting Codex.",
      inputSchema: materializeTaskRequestSchema,
      outputSchema: materializeTaskResultSchema,
      annotations: MATERIALIZE_ANNOTATIONS,
    },
    async (input) => {
      const result = materializeTaskBundle(
        materializeTaskRequestSchema.parse(input),
      );
      const summary = formatMaterializationHandoff(result);
      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text", text: summary }],
      };
    },
  );

  registerPrompts(server);
  registerResources(server);
  return server;
}

function formatMaterializationHandoff(
  result: ReturnType<typeof materializeTaskBundle>,
): string {
  if (!result.materialized || !result.launch || !result.bundleRoot) {
    return `Task bundle was not materialized (${result.status}). It was not launched. Errors: ${result.errors.join("; ")}`;
  }
  const fileLines = result.files.map(
    (file) =>
      `- [${file.relativePath}](<${escapeMarkdownLinkTarget(file.absolutePath)}>) — SHA-256 \`${file.sha256}\``,
  );
  const taskPath = result.files.find(
    (file) => file.relativePath === "task.md",
  )!.absolutePath;
  return `Task bundle materialized, but not launched.

- Status: \`${result.status}\`
- Bundle root: ${markdownCodeSpan(result.bundleRoot)}
- Target working directory: ${markdownCodeSpan(result.launch.workingDirectory)}
- Prompt SHA-256: \`${result.validation.promptSha256}\`
- Git-ignore proof: ${markdownCodeSpan(result.storage.ignoreProofCommand ?? "")}

Files:
${fileLines.join("\n")}

Execution options: materialization selected and launched no route. If the operator asked only to
create/save, present both options below and stop. If execution was explicit, follow only the
matching route. The creator agent must not invoke \`run.sh\`, \`codex exec\`, or a nested Codex
session.

Codex App / new task:

- Create a new Codex App task with working directory ${markdownCodeSpan(result.launch.workingDirectory)}.
- Paste/attach ${markdownCodeSpan(taskPath)}, or tell the new task to read that exact absolute path.
- The new root must verify SHA-256 \`${result.validation.promptSha256}\`, call \`get_goal\`, reuse
  a compatible active goal or create one only when none exists/the previous goal is \`complete\`.
  A \`blocked\` goal requires user-controlled resume/transition. Continue until fresh terminal
  \`PASS\` or justified
  \`BLOCKED\`. A plan or dispatch ladder is not a goal.
- Claim \`launched\` only after the host returns a real task/thread identity.

Continue with this same agent:

- If the operator explicitly requested execution here, do not stop at this handoff. Verify and read
  ${markdownCodeSpan(taskPath)} directly with host file/hash tools (not even verify-only \`run.sh\`),
  enter compiled execution mode without another Forge call,
  establish/reuse the persistent goal, execute corrections and fresh audits, then update the goal
  only at the terminal outcome. Never start a nested Codex process.

Manual terminal fallback (human operator only; creator agents must not run these):

Verify only; this exits without starting Codex:

${markdownShellBlock(result.launch.recommendedCommand)}

Fail-closed non-interactive launch (approval requests return failure instead of waiting):
${markdownShellBlock(result.launch.nonInteractiveCommand)}

Human-controlled interactive launch:
${markdownShellBlock(result.launch.interactiveCommand)}
These manual modes cannot replace a missing goal mechanism; without goal preflight and updates,
execution must fail closed before implementation.

Retention: ${result.warnings.join(" ")}`;
}

function escapeMarkdownLinkTarget(path: string): string {
  return encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F");
}

function markdownCodeSpan(value: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${value}${fence}`;
}

function markdownShellBlock(command: string): string {
  const longestRun = Math.max(
    2,
    ...Array.from(command.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}bash\n${command}\n${fence}`;
}

function forgeToolResult(result: ReturnType<typeof compileImplementationTask>) {
  return {
    structuredContent: result,
    // Preserve the v0.2 content contract: existing consumers read content[0]
    // as the exact task prompt. Lifecycle guidance lives in server/tool instructions.
    content: [{ type: "text" as const, text: result.prompt.text }],
  };
}

const absolutePathPromptArgument = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value.trim()), "must be an absolute path");

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "forge-implementation-task",
    {
      title: "Forge an implementation task",
      description:
        "Create a ready hard-arbiter implementation prompt from a concise objective.",
      argsSchema: {
        objective: z.string().min(1).describe("Outcome to implement."),
        riskSignals: z
          .string()
          .optional()
          .describe("Optional comma-separated typed risk signals."),
        persistentGoal: z
          .enum(["no", "yes"])
          .optional()
          .describe(
            "Request host goal lifecycle; executable prompt defaults to yes.",
          ),
      },
    },
    ({ objective, riskSignals, persistentGoal }) => {
      const result = compileImplementationTask(
        implementationRequestSchema.parse({
          objective,
          riskSignals: parseCommaSeparated(riskSignals),
          goalMode: persistentGoal === "no" ? "plain" : "persistent_requested",
        }),
      );
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: requireReadyPrompt(result) },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "forge-documentation-task",
    {
      title: "Forge a documentation synthesis task",
      description:
        "Create an independent documentation discovery and authoring prompt.",
      argsSchema: {
        objective: z.string().min(1).describe("Documentation outcome."),
        targetState: z
          .enum(["as_is", "to_be", "mixed"])
          .describe(
            "Relationship of the requested document to target behavior.",
          ),
        documentationBasis: z
          .enum(["current_aware", "greenfield"])
          .describe("Explicit current-aware or greenfield discovery basis."),
        outputPath: z.string().min(1).describe("Target documentation path."),
        implementationPath: absolutePathPromptArgument
          .optional()
          .describe("Current implementation locator for current-aware work."),
        implementationRealPath: absolutePathPromptArgument
          .optional()
          .describe("Canonical real path from inspection or manifest."),
        implementationSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional()
          .describe("Content or complete manifest SHA-256."),
      },
    },
    ({
      objective,
      targetState,
      documentationBasis,
      outputPath,
      implementationPath,
      implementationRealPath,
      implementationSha256,
    }) => {
      if (documentationBasis === "greenfield" && targetState !== "to_be") {
        throw new Error(
          "greenfield documentationBasis is valid only for targetState=to_be",
        );
      }
      if (
        documentationBasis === "current_aware" &&
        (!implementationPath ||
          !implementationRealPath ||
          !implementationSha256)
      ) {
        throw new Error(
          "implementationPath, implementationRealPath, and implementationSha256 are required for current_aware documentation prompts; use the typed tool for a richer source manifest",
        );
      }
      const implementationSources = implementationPath
        ? [
            {
              id: "implementation",
              kind: "implementation" as const,
              path: implementationPath,
              realPath: implementationRealPath,
              sha256: implementationSha256,
              authority: "context" as const,
              required: true,
            },
          ]
        : [];
      const result = compileDocumentationTask(
        documentationRequestSchema.parse({
          objective,
          goalMode: "persistent_requested",
          targetState,
          documentationBasis,
          sources: [
            {
              id: "user-intent",
              kind: "task",
              content: objective,
              authority: "canonical",
              required: true,
            },
            ...implementationSources,
          ],
          deliverables: [
            { id: "documentation", kind: "behavior_spec", outputPath },
          ],
          discoveryPartitions: {
            intentSourceIds: ["user-intent"],
            implementationSourceIds: implementationSources.map(
              (source) => source.id,
            ),
            governanceSourceIds: [],
          },
        }),
      );
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: requireReadyPrompt(result) },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "forge-blind-check-task",
    {
      title: "Forge a documentation-versus-code blind check",
      description:
        "Create a strict D1/D2/D3 comparison prompt from explicit source paths.",
      argsSchema: {
        objective: z.string().min(1).describe("Comparison objective."),
        documentationPath: absolutePathPromptArgument.describe(
          "Documentation locator.",
        ),
        documentationRealPath: absolutePathPromptArgument.describe(
          "Canonical documentation real path.",
        ),
        documentationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        implementationPath: absolutePathPromptArgument.describe(
          "Implementation locator.",
        ),
        implementationRealPath: absolutePathPromptArgument.describe(
          "Canonical implementation real path.",
        ),
        implementationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      },
    },
    ({
      objective,
      documentationPath,
      documentationRealPath,
      documentationSha256,
      implementationPath,
      implementationRealPath,
      implementationSha256,
    }) => {
      const result = compileBlindCheckTask(
        blindCheckRequestSchema.parse({
          objective,
          goalMode: "persistent_requested",
          sources: [
            {
              id: "documentation",
              kind: "canonical_documentation",
              path: documentationPath,
              realPath: documentationRealPath,
              sha256: documentationSha256,
              authority: "canonical",
              required: true,
            },
            {
              id: "implementation",
              kind: "implementation",
              path: implementationPath,
              realPath: implementationRealPath,
              sha256: implementationSha256,
              authority: "context",
              required: true,
            },
          ],
          documentationSourceIds: ["documentation"],
          implementationSourceIds: ["implementation"],
          comparisonDimensions: ["behavior", "ownership", "errors"],
        }),
      );
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: requireReadyPrompt(result) },
          },
        ],
      };
    },
  );
}

function requireReadyPrompt(
  result: ReturnType<typeof compileImplementationTask>,
): string {
  if (result.status !== "ready") {
    const details = [
      ...result.validation.blockingErrors,
      ...result.validation.missingMaterialInputs,
      ...result.questions.map((question) => question.question),
    ];
    throw new McpError(
      ErrorCode.InvalidParams,
      `Arbiter Forge prompt is ${result.status}: ${details.join("; ")}`,
    );
  }
  return result.prompt.text;
}

function registerResources(server: McpServer): void {
  const resources = [
    [
      "orchestration-method",
      "arbiter-forge://method/orchestration",
      "orchestration",
    ],
    [
      "documentation-synthesis-method",
      "arbiter-forge://method/documentation-synthesis",
      "documentation-synthesis",
    ],
    ["blind-check-method", "arbiter-forge://method/blind-check", "blind-check"],
    [
      "ui-playwright-method",
      "arbiter-forge://method/ui-playwright",
      "ui-playwright",
    ],
    ["model-goal-method", "arbiter-forge://method/model-goal", "model-goal"],
  ] as const;

  for (const [name, uri, policy] of resources) {
    server.registerResource(
      name,
      uri,
      { title: name, mimeType: "text/markdown" },
      async () => ({
        contents: [
          { uri, mimeType: "text/markdown", text: readPolicy(policy) },
        ],
      }),
    );
  }
}

function parseCommaSeparated(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}
