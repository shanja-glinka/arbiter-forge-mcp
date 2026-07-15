import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { inspectWorkspace } from "./core/inspect.js";
import { readPolicy } from "./core/policy.js";
import {
  compileBlindCheckTask,
  compileDocumentationTask,
  compileImplementationTask,
} from "./core/render.js";
import {
  blindCheckRequestSchema,
  documentationRequestSchema,
  forgeResultSchema,
  GENERATOR_VERSION,
  implementationRequestSchema,
  inspectWorkspaceRequestSchema,
  validateTaskRequestSchema,
} from "./core/schemas.js";
import { validateTaskPrompt } from "./core/validate.js";

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
      inputSchema: inspectWorkspaceRequestSchema.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const result = inspectWorkspace(input);
      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: result.status === "denied",
      };
    },
  );

  server.registerTool(
    "forge_implementation_task",
    {
      title: "Forge implementation arbiter task",
      description:
        "Compile a deterministic, self-contained implementation prompt with adaptive risk, ownership, independent audits, UI/GraphQL proof when applicable, correction loops, and hard terminal gates.",
      inputSchema: implementationRequestSchema.shape,
      outputSchema: forgeResultSchema.shape,
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
      inputSchema: documentationRequestSchema.shape,
      outputSchema: forgeResultSchema.shape,
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
      inputSchema: blindCheckRequestSchema.shape,
      outputSchema: forgeResultSchema.shape,
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
        "Validate generated or human-edited task text for goal semantics, unresolved placeholders, applicable audit topology, UI/GraphQL proof, strict blind-check isolation, artifact policy, and terminal PASS honesty.",
      inputSchema: validateTaskRequestSchema.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const result = validateTaskPrompt(validateTaskRequestSchema.parse(input));
      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.pass,
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
    isError: result.status === "invalid",
  };
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "forge-implementation-task",
    {
      title: "Forge an implementation task",
      description:
        "Create a ready hard-arbiter implementation prompt from a concise objective.",
      argsSchema: {
        objective: z.string().min(1),
        riskSignals: z.string().optional(),
        persistentGoal: z.enum(["no", "yes"]).default("no"),
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
          { role: "user", content: { type: "text", text: result.prompt.text } },
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
        objective: z.string().min(1),
        targetState: z.enum(["as_is", "to_be", "mixed"]),
        outputPath: z.string().min(1),
      },
    },
    ({ objective, targetState, outputPath }) => {
      const result = compileDocumentationTask(
        documentationRequestSchema.parse({
          objective,
          targetState,
          sources: [
            {
              id: "user-intent",
              kind: "task",
              content: objective,
              authority: "canonical",
              required: true,
            },
          ],
          deliverables: [
            { id: "documentation", kind: "behavior_spec", outputPath },
          ],
          discoveryPartitions: {
            intentSourceIds: ["user-intent"],
            implementationSourceIds: [],
            governanceSourceIds: [],
          },
        }),
      );
      return {
        messages: [
          { role: "user", content: { type: "text", text: result.prompt.text } },
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
        objective: z.string().min(1),
        documentationPath: z.string().min(1),
        implementationPath: z.string().min(1),
      },
    },
    ({ objective, documentationPath, implementationPath }) => {
      const result = compileBlindCheckTask(
        blindCheckRequestSchema.parse({
          objective,
          sources: [
            {
              id: "documentation",
              kind: "canonical_documentation",
              path: documentationPath,
              authority: "canonical",
              required: true,
            },
            {
              id: "implementation",
              kind: "implementation",
              path: implementationPath,
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
          { role: "user", content: { type: "text", text: result.prompt.text } },
        ],
      };
    },
  );
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
