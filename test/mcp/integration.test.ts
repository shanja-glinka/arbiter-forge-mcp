import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const distEntry = join(projectRoot, "dist", "index.js");

describe("bundled stdio MCP server", () => {
  it("initializes and exposes the exact deterministic surface", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distEntry],
      cwd: projectRoot,
      stderr: "pipe",
      env: {
        ...stringEnvironment(process.env),
        ARBITER_FORGE_ALLOWED_ROOTS_JSON: JSON.stringify([projectRoot]),
      },
    });
    const client = new Client({
      name: "arbiter-forge-integration-test",
      version: "1.0.0",
    });

    try {
      await client.connect(transport);
      await client.ping();

      expect(client.getInstructions()).toContain("does not execute tasks");
      expect(
        (await client.listTools()).tools.map((tool) => tool.name).sort(),
      ).toEqual([
        "forge_blind_check_task",
        "forge_documentation_task",
        "forge_implementation_task",
        "inspect_workspace",
        "validate_task",
      ]);
      expect(
        (await client.listPrompts()).prompts
          .map((prompt) => prompt.name)
          .sort(),
      ).toEqual([
        "forge-blind-check-task",
        "forge-documentation-task",
        "forge-implementation-task",
      ]);
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

      const result = await client.callTool({
        name: "forge_implementation_task",
        arguments: {
          objective: "Add a tenant-scoped admin page with a GraphQL client.",
          riskSignals: ["browser_ui", "graphql_client", "tenant_isolation"],
        },
      });
      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as {
        status: string;
        decisions: { riskProfile: string };
        prompt: { text: string; sha256: string };
      };
      expect(structured.status).toBe("ready");
      expect(structured.decisions.riskProfile).toBe("critical");
      expect(structured.prompt.text).toContain("Playwright");
      expect(structured.prompt.sha256).toMatch(/^[a-f0-9]{64}$/u);

      const prompt = await client.getPrompt({
        name: "forge-implementation-task",
        arguments: { objective: "Rename one helper." },
      });
      expect(prompt.messages[0]?.content.type).toBe("text");

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
  });
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
