import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const distEntry = join(projectRoot, "dist", "index.js");

describe("bundled stdio MCP server", () => {
  it("initializes and exposes the exact deterministic surface", async () => {
    const materializeRoot = createGitFixture("arbiter forge #?` integration ");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distEntry],
      cwd: projectRoot,
      stderr: "pipe",
      env: {
        ...stringEnvironment(process.env),
        ARBITER_FORGE_ALLOWED_ROOTS_JSON: JSON.stringify([
          projectRoot,
          materializeRoot,
        ]),
      },
    });
    const client = new Client({
      name: "arbiter-forge-integration-test",
      version: "1.0.0",
    });

    try {
      await client.connect(transport);
      await client.ping();

      expect(client.getServerVersion()).toEqual({
        name: "arbiter-forge",
        version: "0.3.0",
      });
      expect(client.getInstructions()).toContain("never executes tasks");
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "forge_blind_check_task",
        "forge_documentation_task",
        "forge_implementation_task",
        "inspect_workspace",
        "materialize_task_bundle",
        "validate_task",
      ]);
      for (const tool of tools) {
        expect(tool.inputSchema).toMatchObject({
          type: "object",
          additionalProperties: false,
        });
        expect(tool.outputSchema).toMatchObject({
          type: "object",
          additionalProperties: false,
        });
      }
      expect(
        tools.find((tool) => tool.name === "forge_implementation_task")
          ?.outputSchema,
      ).toMatchObject({
        properties: { operation: { const: "implementation_task" } },
      });
      expect(
        tools.find((tool) => tool.name === "forge_documentation_task")
          ?.outputSchema,
      ).toMatchObject({
        properties: { operation: { const: "documentation_task" } },
      });
      expect(
        tools.find((tool) => tool.name === "forge_blind_check_task")
          ?.outputSchema,
      ).toMatchObject({
        properties: { operation: { const: "blind_check_task" } },
      });
      expect(
        tools.find((tool) => tool.name === "materialize_task_bundle")
          ?.annotations,
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });

      const prompts = (await client.listPrompts()).prompts;
      expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
        "forge-blind-check-task",
        "forge-documentation-task",
        "forge-implementation-task",
      ]);
      const implementationPrompt = prompts.find(
        (prompt) => prompt.name === "forge-implementation-task",
      );
      expect(
        implementationPrompt?.arguments?.find(
          (argument) => argument.name === "persistentGoal",
        ),
      ).toMatchObject({ required: false });
      expect(
        implementationPrompt?.arguments?.find(
          (argument) => argument.name === "objective",
        )?.description,
      ).toBeTruthy();
      expect(
        (await client.listResources()).resources
          .map((resource) => resource.uri)
          .sort(),
      ).toEqual([
        "arbiter-forge://method/blind-check",
        "arbiter-forge://method/documentation-synthesis",
        "arbiter-forge://method/model-goal",
        "arbiter-forge://method/orchestration",
        "arbiter-forge://method/ui-playwright",
      ]);

      const inspection = await client.callTool({
        name: "inspect_workspace",
        arguments: {
          workspaceRoots: [projectRoot],
          sourcePaths: [join(projectRoot, "README.md")],
        },
      });
      expect(inspection.isError).not.toBe(true);
      expect(inspection.structuredContent).toMatchObject({
        status: "ready",
        workspaces: [{ realRoot: projectRoot }],
        sources: [{ realPath: join(projectRoot, "README.md") }],
      });

      const implementationInput = {
        objective: "Add a tenant-scoped admin page with a GraphQL client.",
        riskSignals: ["browser_ui", "graphql_client", "tenant_isolation"],
      };
      const result = await client.callTool({
        name: "forge_implementation_task",
        arguments: implementationInput,
      });
      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as {
        status: string;
        decisions: { riskProfile: string };
        prompt: { text: string; sha256: string };
      };
      const resultContent = result.content as Array<{
        type: string;
        text?: string;
      }>;
      expect(resultContent).toEqual([
        { type: "text", text: structured.prompt.text },
      ]);
      expect(structured.status).toBe("ready");
      expect(structured.decisions.riskProfile).toBe("critical");
      expect(structured.prompt.text).toContain("Playwright");
      expect(structured.prompt.sha256).toMatch(/^[a-f0-9]{64}$/u);

      const compatibility = await client.callTool({
        name: "forge_implementation_task",
        arguments: {
          taskId: "compat-probe",
          objective: "Compile a bounded compatibility probe.",
          riskSignals: ["graphql_client"],
        },
      });
      expect(compatibility.isError).not.toBe(true);
      expect(
        compatibility.structuredContent as {
          generatorVersion: string;
          prompt: { sha256: string };
        },
      ).toMatchObject({
        generatorVersion: "0.2.0",
        prompt: {
          sha256:
            "e96a19a10cb8455894a965daacdbd13a964e05b04f8800b8ce88a6e82dd8bf78",
        },
      });

      const routedInput = {
        objective: "Build and independently verify a browser pricing editor.",
        riskSignals: ["browser_ui", "money_or_pricing"],
        capabilities: {
          agentIsolation: "supported",
          modelSelection: "supported",
          physicalWorktrees: "supported",
          goalTool: "supported",
          playwrightHarness: "available",
          routeInventoryComplete: true,
          availableAgentTypes: ["arbiter-forge-ui-claude"],
          availableModels: [
            {
              provider: "openai",
              model: "gpt-5.6-sol",
              reasoningEfforts: ["low", "medium", "high"],
            },
            {
              provider: "openai",
              model: "gpt-5.6-terra",
              reasoningEfforts: ["low", "medium", "high", "xhigh"],
            },
            {
              provider: "openai",
              model: "gpt-5.6-luna",
              reasoningEfforts: ["low", "medium"],
            },
          ],
        },
      };
      const routed = await client.callTool({
        name: "forge_implementation_task",
        arguments: routedInput,
      });
      expect(routed.isError).not.toBe(true);
      const routedStructured = routed.structuredContent as {
        status: string;
        decisions: {
          routingStatus: string;
          routingPlanHash: string;
          routingPlan: Array<{
            role: string;
            candidates: Array<{
              agentType?: string;
              availability: string;
            }>;
          }>;
        };
        prompt: { text: string; sha256: string };
      };
      expect(routedStructured.status).toBe("ready");
      expect(routedStructured.decisions.routingStatus).toBe("selectable");
      expect(routedStructured.decisions.routingPlanHash).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      expect(
        routedStructured.decisions.routingPlan.find(
          (entry) => entry.role === "frontend_worker",
        )?.candidates[0],
      ).toMatchObject({
        agentType: "arbiter-forge-ui-claude",
        availability: "available",
      });

      const routedValidation = await client.callTool({
        name: "validate_task",
        arguments: {
          prompt: routedStructured.prompt.text,
          operation: "implementation_task",
          request: routedInput,
          expectedPromptSha256: routedStructured.prompt.sha256,
        },
      });
      expect(routedValidation.structuredContent).toMatchObject({
        pass: true,
        assurance: "recompiled",
      });

      const materializeInput = {
        taskId: "integration-handoff",
        objective: "Create a persistent runnable task bundle.",
        repositories: [{ id: "target", root: materializeRoot }],
        outputMode: "resumable_package",
      };
      const materializedForge = await client.callTool({
        name: "forge_implementation_task",
        arguments: materializeInput,
      });
      const materializedCompiled = materializedForge.structuredContent as {
        status: string;
        prompt: { text: string; sha256: string };
      };
      expect(materializedCompiled.status).toBe("ready");
      expect(materializedCompiled).not.toHaveProperty("handoff");
      const materialized = await client.callTool({
        name: "materialize_task_bundle",
        arguments: {
          operation: "implementation_task",
          request: materializeInput,
          expectedPromptSha256: materializedCompiled.prompt.sha256,
          targetRepositoryId: "target",
        },
      });
      expect(materialized.isError).not.toBe(true);
      const materializedResult = materialized.structuredContent as {
        status: string;
        materialized: boolean;
        bundleRoot: string;
        launch: { recommendedCommand: string };
        files: Array<{ relativePath: string; absolutePath: string }>;
      };
      expect(materializedResult).toMatchObject({
        status: "written",
        materialized: true,
      });
      expect(
        readFileSync(join(materializedResult.bundleRoot, "task.md"), "utf8"),
      ).toBe(materializedCompiled.prompt.text);
      expect(materializedResult.launch.recommendedCommand).toContain("run.sh");
      const handoffText = (
        materialized.content as Array<{
          type: string;
          text?: string;
        }>
      )
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      expect(handoffText).toContain(
        "Task bundle materialized, but not launched",
      );
      for (const file of ["task.md", "manifest.json", "README.md", "run.sh"]) {
        expect(handoffText).toContain(`[${file}]`);
      }
      for (const file of materializedResult.files) {
        const encodedPath = encodeURI(file.absolutePath)
          .replaceAll("#", "%23")
          .replaceAll("?", "%3F");
        expect(handoffText).toContain(`(<${encodedPath}>)`);
      }
      expect(handoffText).not.toContain("- Recommended: `");
      expect(handoffText).toContain("Recommended:");
      expect(handoffText).toContain("Non-interactive:");
      expect(handoffText).toContain("Interactive:");
      expect(handoffText).toContain("Retention:");

      const invalidForge = await client.callTool({
        name: "forge_implementation_task",
        arguments: {
          objective: "Use an invalid relative repository root.",
          repositories: [{ id: "app", root: "relative/app" }],
        },
      });
      expect(invalidForge.isError).not.toBe(true);
      expect(invalidForge.structuredContent).toMatchObject({
        status: "invalid",
      });

      const deniedInspection = await client.callTool({
        name: "inspect_workspace",
        arguments: { workspaceRoots: [resolve(projectRoot, "../../outside")] },
      });
      expect(deniedInspection.isError).not.toBe(true);
      expect(deniedInspection.structuredContent).toMatchObject({
        status: "denied",
      });

      const validation = await client.callTool({
        name: "validate_task",
        arguments: {
          prompt: `${structured.prompt.text}edited\n`,
          operation: "implementation_task",
          request: implementationInput,
          expectedPromptSha256: structured.prompt.sha256,
        },
      });
      expect(validation.isError).not.toBe(true);
      expect(validation.structuredContent).toMatchObject({
        pass: false,
        assurance: "structural_only",
      });

      const prompt = await client.getPrompt({
        name: "forge-implementation-task",
        arguments: { objective: "Rename one helper." },
      });
      expect(prompt.messages[0]?.content.type).toBe("text");

      const greenfieldPrompt = await client.getPrompt({
        name: "forge-documentation-task",
        arguments: {
          objective: "Design a new contract.",
          targetState: "to_be",
          documentationBasis: "greenfield",
          outputPath: "docs/spec.md",
        },
      });
      expect(greenfieldPrompt.messages[0]?.content.type).toBe("text");
      await expect(
        client.getPrompt({
          name: "forge-documentation-task",
          arguments: {
            objective: "Document current behavior.",
            targetState: "as_is",
            documentationBasis: "current_aware",
            outputPath: "docs/spec.md",
          },
        }),
      ).rejects.toThrow(/implementationPath/iu);

      const blindPrompt = await client.getPrompt({
        name: "forge-blind-check-task",
        arguments: {
          objective: "Compare docs and code.",
          documentationPath: "/tmp/docs.md",
          documentationRealPath: "/tmp/docs.md",
          documentationSha256: "1".repeat(64),
          implementationPath: "/tmp/src",
          implementationRealPath: "/tmp/src",
          implementationSha256: "2".repeat(64),
        },
      });
      expect(blindPrompt.messages[0]?.content.type).toBe("text");
      await expect(
        client.getPrompt({
          name: "forge-blind-check-task",
          arguments: {
            objective: "Compare docs and code.",
            documentationPath: "relative/docs.md",
            documentationRealPath: "/tmp/docs.md",
            documentationSha256: "1".repeat(64),
            implementationPath: "/tmp/src",
            implementationRealPath: "/tmp/src",
            implementationSha256: "2".repeat(64),
          },
        }),
      ).rejects.toThrow();

      const unknownFieldCalls = [
        {
          name: "inspect_workspace",
          arguments: { workspaceRoots: [projectRoot], typo: true },
        },
        {
          name: "forge_implementation_task",
          arguments: { objective: "Test strict input.", typoRiskSignals: [] },
        },
        {
          name: "forge_documentation_task",
          arguments: {
            objective: "Test strict input.",
            targetState: "to_be",
            documentationBasis: "greenfield",
            sources: [
              {
                id: "intent",
                kind: "task",
                content: "intent",
                authority: "canonical",
              },
            ],
            deliverables: [
              { id: "spec", kind: "behavior_spec", outputPath: "docs/spec.md" },
            ],
            discoveryPartitions: {
              intentSourceIds: ["intent"],
              implementationSourceIds: [],
              governanceSourceIds: [],
            },
            typo: true,
          },
        },
        {
          name: "forge_blind_check_task",
          arguments: {
            objective: "Test strict input.",
            sources: [
              {
                id: "docs",
                kind: "canonical_documentation",
                content: "docs",
                authority: "canonical",
              },
              {
                id: "code",
                kind: "implementation",
                content: "code",
                authority: "context",
              },
            ],
            documentationSourceIds: ["docs"],
            implementationSourceIds: ["code"],
            comparisonDimensions: ["behavior"],
            typo: true,
          },
        },
        {
          name: "validate_task",
          arguments: {
            prompt: structured.prompt.text,
            operation: "implementation_task",
            request: implementationInput,
            expectedPromptSha256: structured.prompt.sha256,
            typo: true,
          },
        },
        {
          name: "materialize_task_bundle",
          arguments: {
            operation: "implementation_task",
            request: materializeInput,
            expectedPromptSha256: materializedCompiled.prompt.sha256,
            targetRepositoryId: "target",
            typo: true,
          },
        },
      ];
      for (const call of unknownFieldCalls) {
        const rejected = await client.callTool(call);
        expect(rejected.isError).toBe(true);
      }

      const resource = await client.readResource({
        uri: "arbiter-forge://method/blind-check",
      });
      expect(resource.contents[0]).toMatchObject({ mimeType: "text/markdown" });
      expect(
        "text" in resource.contents[0]! ? resource.contents[0].text : "",
      ).toContain("extra_or_forbidden_behavior");
    } finally {
      await client.close();
    }
  }, 20_000);
});

function stringEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function createGitFixture(prefix = "arbiter-forge-mcp-integration-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, "tracked.txt"), "base\n");
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "audit@example.invalid"],
    ["config", "user.name", "Audit"],
    ["add", "tracked.txt"],
    ["commit", "-q", "-m", "base"],
  ]) {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout);
    }
  }
  return root;
}
