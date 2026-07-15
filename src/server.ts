import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { isAbsolute } from "node:path";
import { z } from "zod/v4";

import { inspectWorkspace } from "./core/inspect.js";
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
  GENERATOR_VERSION,
  implementationForgeResultSchema,
  implementationRequestSchema,
  inspectWorkspaceRequestSchema,
  inspectWorkspaceResultSchema,
  promptValidationResultSchema,
  validateTaskRequestSchema,
} from "./core/schemas.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "arbiter-forge", version: GENERATOR_VERSION },
    {
      instructions:
        "Arbiter Forge generates and validates orchestration task specifications only. It does not execute tasks, modify projects, choose Codex worker models, manage goals, or claim audit PASS. Use forge_implementation_task for coding work, forge_documentation_task for independent documentation synthesis, and forge_blind_check_task for strict docs-versus-code comparison. Model routes are preferences; terminal PASS requires fresh independent evidence.",
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
        "Compile a deterministic, self-contained implementation prompt with adaptive risk, ownership, independent audits, UI/GraphQL proof when applicable, correction loops, and hard terminal gates.",
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
        "Compile an independent intent/code/governance discovery workflow that creates as-is, to-be, or mixed documentation plus optional implementation task deliverables.",
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
        "Compile an isolated D1/D2/D3 documentation-versus-code audit with allowlists, manifests, normalized comparison, forbidden-extra detection, and honest degradation when isolation cannot be proven.",
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
        "Recompile the original typed forge request and grant PASS only to a ready, byte-identical generated prompt. Edited text receives structural-only diagnostics.",
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

  registerPrompts(server);
  registerResources(server);
  return server;
}

function forgeToolResult(result: ReturnType<typeof compileImplementationTask>) {
  return {
    structuredContent: result,
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
          .describe("Request host goal lifecycle; defaults to no."),
      },
    },
    ({ objective, riskSignals, persistentGoal }) => {
      const result = compileImplementationTask(
        implementationRequestSchema.parse({
          objective,
          riskSignals: parseCommaSeparated(riskSignals),
          goalMode: persistentGoal === "yes" ? "persistent_requested" : "plain",
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
