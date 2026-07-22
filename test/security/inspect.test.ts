import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

  it("denies representative secret, cloud, SSH, and package-auth paths", () => {
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-sensitive-"));
    const relativePaths = [
      "secrets.json",
      ".envrc",
      "secrets.env",
      "auth.csv",
      "TOKENS.CSV",
      "tokens.yaml",
      ".aws/credentials",
      ".config/gcloud/application_default_credentials.json",
      ".docker/config.json",
      ".ssh/id_ecdsa",
      ".git-credentials",
      ".npmrc",
      ".pypirc",
      "terraform.tfstate",
    ];
    const sensitivePaths = relativePaths.map((relativePath) => {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "low-entropy-secret\n");
      return path;
    });
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({
      workspaceRoots: [root],
      sourcePaths: sensitivePaths,
    });

    expect(result.status).toBe("partial");
    expect(result.sources).toEqual([]);
    expect(result.errors).toHaveLength(sensitivePaths.length);
    expect(
      result.errors.every((error) =>
        error.includes("sensitive or dependency metadata path is denied"),
      ),
    ).toBe(true);
  });

  it("allows a non-secret documentation filename with an auth prefix", () => {
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-safe-auth-doc-"));
    const source = join(root, "auth-flow.md");
    writeFileSync(source, "Public authentication architecture.\n");
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({
      workspaceRoots: [root],
      sourcePaths: [source],
    });

    expect(result.status).toBe("ready");
    expect(result.sources).toHaveLength(1);
  });

  it("does not inspect a parent Git repository outside a nested allowlist", () => {
    const outer = mkdtempSync(join(tmpdir(), "arbiter-forge-parent-git-"));
    const allowedChild = join(outer, "allowed-child");
    mkdirSync(allowedChild);
    writeFileSync(join(allowedChild, "tracked.txt"), "tracked\n");
    runFixtureGit(outer, ["init", "-q"]);
    runFixtureGit(outer, ["config", "user.email", "audit@example.invalid"]);
    runFixtureGit(outer, ["config", "user.name", "Audit"]);
    runFixtureGit(outer, ["add", "allowed-child/tracked.txt"]);
    runFixtureGit(outer, ["commit", "-q", "-m", "base"]);
    writeFileSync(join(outer, "outside-untracked.txt"), "outside\n");
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([
      allowedChild,
    ]);

    const result = inspectWorkspace({ workspaceRoots: [allowedChild] });

    expect(result.status).toBe("partial");
    expect(result.workspaces[0]?.git).toBeNull();
    expect(result.warnings.join("\n")).toContain(
      "boundary escapes configured allowed roots",
    );
    expect(result.allowedRoots).toEqual([realpathSync(allowedChild)]);
  });

  it("does not inspect a worktree whose Git common directory escapes the allowlist", () => {
    const { root, commonDirectory } = createExternalCommonDirectoryFixture(
      "arbiter-forge-inspect-common-dir-",
    );
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({ workspaceRoots: [root] });

    expect(
      spawnSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: root, encoding: "utf8", shell: false },
      ).stdout.trim(),
    ).toBe(realpathSync(commonDirectory));
    expect(result.status).toBe("partial");
    expect(result.workspaces[0]?.git).toBeNull();
    expect(result.warnings.join("\n")).toContain(
      "common-directory boundary escapes configured allowed roots",
    );
  });

  it("does not follow workspace metadata symlinks outside the allowlist", () => {
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-metadata-root-"));
    const outside = mkdtempSync(
      join(tmpdir(), "arbiter-forge-metadata-outside-"),
    );
    const outsidePackage = join(outside, "package.json");
    const outsidePlaywright = join(outside, "playwright.config.ts");
    writeFileSync(
      outsidePackage,
      JSON.stringify({
        packageManager: "OUTSIDE_SENTINEL@9",
        scripts: { OUTSIDE_SCRIPT_SENTINEL: "true" },
      }),
    );
    writeFileSync(outsidePlaywright, "export default {};\n");
    symlinkSync(outsidePackage, join(root, "package.json"));
    symlinkSync(outsidePlaywright, join(root, "playwright.config.ts"));
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({ workspaceRoots: [root] });

    expect(result.status).toBe("partial");
    expect(result.workspaces[0]?.packageScripts).toEqual([]);
    expect(result.workspaces[0]?.detected.packageManager).toBeNull();
    expect(result.workspaces[0]?.detected.playwright).toBe(false);
    expect(result.warnings.join("\n")).toContain(
      "resolved outside configured allowed roots",
    );
    expect(JSON.stringify(result)).not.toContain("OUTSIDE_SENTINEL");
  });

  it("neutralizes Git helpers and filters while retaining a content-bound snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "arbiter-forge-safe-git-"));
    const marker = join(root, "git-helper-executed");
    const helper = join(root, "git-helper.cjs");
    const hooks = join(root, "hooks");
    const tracked = join(root, "tracked.txt");
    mkdirSync(hooks);
    writeFileSync(
      helper,
      `#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(marker)}, "executed\\n");\nprocess.stdin.pipe(process.stdout);\n`,
    );
    chmodSync(helper, 0o755);
    writeFileSync(
      join(root, ".gitattributes"),
      "*.txt diff=evil filter=evil\n",
    );
    writeFileSync(tracked, "base\n");
    runFixtureGit(root, ["init", "-q"]);
    runFixtureGit(root, ["config", "user.email", "audit@example.invalid"]);
    runFixtureGit(root, ["config", "user.name", "Audit"]);
    runFixtureGit(root, ["add", ".gitattributes", "tracked.txt"]);
    runFixtureGit(root, ["commit", "-q", "-m", "base"]);
    runFixtureGit(root, ["config", "core.fsmonitor", helper]);
    runFixtureGit(root, ["config", "core.hooksPath", hooks]);
    runFixtureGit(root, ["config", "diff.evil.command", helper]);
    runFixtureGit(root, ["config", "diff.evil.textconv", helper]);
    runFixtureGit(root, ["config", "filter.evil.clean", helper]);
    runFixtureGit(root, ["config", "filter.evil.process", helper]);
    runFixtureGit(root, ["config", "filter.evil.required", "true"]);
    writeFileSync(
      join(hooks, "post-index-change"),
      `#!/bin/sh\ntouch "${marker}"\n`,
    );
    chmodSync(join(hooks, "post-index-change"), 0o755);
    writeFileSync(tracked, "first changed value\n");
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const first = inspectWorkspace({ workspaceRoots: [root] });
    const firstSnapshot = first.workspaces[0]?.git;
    expect(first.status, JSON.stringify(first)).toBe("ready");
    expect(firstSnapshot).toMatchObject({ dirty: true, contentBound: true });
    expect(existsSync(marker)).toBe(false);

    writeFileSync(tracked, "second changed value\n");
    const second = inspectWorkspace({ workspaceRoots: [root] });
    const secondSnapshot = second.workspaces[0]?.git;
    expect(secondSnapshot).toMatchObject({ dirty: true, contentBound: true });
    expect(secondSnapshot?.dirtyManifestHash).not.toBe(
      firstSnapshot?.dirtyManifestHash,
    );
    expect(existsSync(marker)).toBe(false);
  }, 15_000);

  it("does not execute clean/process filters from nested submodules", () => {
    const root = createGitFixture("arbiter-forge-inspect-superproject-");
    const submoduleSource = createGitFixture(
      "arbiter-forge-inspect-submodule-source-",
    );
    writeFileSync(
      join(submoduleSource, ".gitattributes"),
      "filtered.txt filter=evil\n",
    );
    writeFileSync(join(submoduleSource, "filtered.txt"), "base\n");
    runFixtureGit(submoduleSource, ["add", ".gitattributes", "filtered.txt"]);
    runFixtureGit(submoduleSource, ["commit", "-q", "-m", "filter fixture"]);
    runFixtureGit(root, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      submoduleSource,
      "nested",
    ]);
    runFixtureGit(root, ["add", ".gitmodules", "nested"]);
    runFixtureGit(root, ["commit", "-q", "-m", "add nested submodule"]);

    const marker = join(root, "nested-filter-executed");
    const helper = join(root, "nested", "evil-filter.sh");
    writeFileSync(
      helper,
      `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`,
    );
    chmodSync(helper, 0o700);
    runFixtureGit(join(root, "nested"), [
      "config",
      "filter.evil.clean",
      helper,
    ]);
    runFixtureGit(join(root, "nested"), [
      "config",
      "filter.evil.process",
      helper,
    ]);
    runFixtureGit(join(root, "nested"), [
      "config",
      "filter.evil.required",
      "true",
    ]);
    writeFileSync(join(root, "nested", "filtered.txt"), "changed\n");
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = inspectWorkspace({ workspaceRoots: [root] });

    expect(result.status).toBe("ready");
    expect(result.workspaces[0]?.git).toMatchObject({ contentBound: true });
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it("hashes an untracked symlink itself without following its outside target", () => {
    const root = createGitFixture("arbiter-forge-untracked-symlink-");
    const outside = mkdtempSync(
      join(tmpdir(), "arbiter-forge-untracked-symlink-outside-"),
    );
    const outsideFile = join(outside, "outside.txt");
    writeFileSync(outsideFile, "first outside value\n");
    symlinkSync(outsideFile, join(root, "outside-link"));
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const first = inspectWorkspace({ workspaceRoots: [root] });
    writeFileSync(outsideFile, "different outside value\n");
    const second = inspectWorkspace({ workspaceRoots: [root] });

    expect(first.status, JSON.stringify(first)).toBe("ready");
    expect(first.workspaces[0]?.git).toMatchObject({
      dirty: true,
      untrackedEntries: 1,
      contentBound: true,
    });
    expect(second.workspaces[0]?.git?.dirtyManifestHash).toBe(
      first.workspaces[0]?.git?.dirtyManifestHash,
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

function runFixtureGit(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
}

function createGitFixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, "tracked.txt"), "base\n");
  runFixtureGit(root, ["init", "-q"]);
  runFixtureGit(root, ["config", "user.email", "audit@example.invalid"]);
  runFixtureGit(root, ["config", "user.name", "Audit"]);
  runFixtureGit(root, ["add", "tracked.txt"]);
  runFixtureGit(root, ["commit", "-q", "-m", "base"]);
  return realpathSync(root);
}

function createExternalCommonDirectoryFixture(prefix: string): {
  root: string;
  commonDirectory: string;
} {
  const fixtureRoot = mkdtempSync(join(tmpdir(), prefix));
  const root = join(fixtureRoot, "allowed");
  mkdirSync(root);
  writeFileSync(join(root, "tracked.txt"), "base\n");
  runFixtureGit(root, ["init", "-q"]);
  runFixtureGit(root, ["config", "user.email", "audit@example.invalid"]);
  runFixtureGit(root, ["config", "user.name", "Audit"]);
  runFixtureGit(root, ["add", "tracked.txt"]);
  runFixtureGit(root, ["commit", "-q", "-m", "base"]);

  const commonDirectory = join(fixtureRoot, "outside.git");
  renameSync(join(root, ".git"), commonDirectory);
  mkdirSync(join(root, ".git"));
  renameSync(join(commonDirectory, "HEAD"), join(root, ".git", "HEAD"));
  renameSync(join(commonDirectory, "index"), join(root, ".git", "index"));
  writeFileSync(join(root, ".git", "commondir"), `${commonDirectory}\n`);
  writeFileSync(join(root, ".git", "gitdir"), `${join(root, ".git")}\n`);

  return {
    root: realpathSync(root),
    commonDirectory: realpathSync(commonDirectory),
  };
}
