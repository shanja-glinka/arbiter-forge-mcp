import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectWorkspace } from "../../src/core/inspect.js";

const originalAllowedRoots = process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON;

afterEach(() => {
  if (originalAllowedRoots === undefined) {
    delete process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON;
  } else {
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = originalAllowedRoots;
  }
});

describe("workspace inspection boundary", () => {
  it("fails closed until an allowlist is configured", () => {
    delete process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON;
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-no-allowlist-"));

    const result = inspectWorkspace({ workspaceRoots: [root] });

    expect(result.status).toBe("denied");
    expect(result.errors[0]).toContain("ARBITER_FORGE_ALLOWED_ROOTS_JSON");
  });

  it("returns metadata and hashes without returning source contents", () => {
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-inspect-"));
    const rules = join(root, "AGENTS.md");
    writeFileSync(rules, "private project rule text\n");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.18.3",
        scripts: { test: "vitest", e2e: "playwright test" },
      }),
    );
    writeFileSync(join(root, "playwright.config.ts"), "export default {};\n");
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({
      workspaceRoots: [root],
      sourcePaths: [rules],
    });
    const serialized = JSON.stringify(result);

    expect(result.status).toBe("ready");
    expect(result.workspaces[0]?.rules).toContain("AGENTS.md");
    expect(result.workspaces[0]?.detected.playwright).toBe(true);
    expect(result.sources[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(serialized).not.toContain("private project rule text");
  });

  it("denies sensitive files and symlink traversal outside the allowlist", () => {
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-allowed-"));
    const outside = mkdtempSync(join(tmpdir(), "arbiter-forge-outside-"));
    const envPath = join(root, ".env");
    const outsidePath = join(outside, "outside.md");
    const linkedPath = join(root, "linked.md");
    writeFileSync(envPath, "SECRET=value\n");
    writeFileSync(outsidePath, "outside\n");
    symlinkSync(outsidePath, linkedPath);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({
      workspaceRoots: [root],
      sourcePaths: [envPath, linkedPath],
    });

    expect(result.status).toBe("partial");
    expect(result.sources).toEqual([]);
    expect(result.errors.join("\n")).toContain(
      "sensitive or dependency metadata path is denied",
    );
    expect(result.errors.join("\n")).toContain(
      "outside configured allowed roots",
    );
  });

  it("detects a monorepo marker without recursive code scanning", () => {
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-monorepo-"));
    mkdirSync(join(root, "packages"));
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    );
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({ workspaceRoots: [root] });

    expect(result.status).toBe("ready");
    expect(result.workspaces[0]?.detected.monorepo).toBe(true);
  });
});
