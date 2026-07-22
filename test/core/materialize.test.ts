import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter as pathDelimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { materializeTaskBundle } from "../../src/core/materialize.js";
import { compileImplementationTask } from "../../src/core/render.js";
import { implementationRequestSchema } from "../../src/core/schemas.js";
import { sha256 } from "../../src/core/stable.js";

const originalAllowedRoots = process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON;

afterEach(() => {
  if (originalAllowedRoots === undefined) {
    delete process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON;
  } else {
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = originalAllowedRoots;
  }
});

describe("task bundle materialization", { timeout: 15_000 }, () => {
  it("writes an ignored persistent bundle and reuses exact bytes idempotently", () => {
    const root = createGitFixture("arbiter-forge-materialize-");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);
    const beforeStatus = git(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]).stdout;

    const first = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(first.status).toBe("written");
    expect(first.materialized).toBe(true);
    expect(first.storage).toMatchObject({ ignored: true });
    expect(first.bundleRoot).toContain(
      ".arbiter-forge/tasks/persistent-handoff/",
    );
    expect(first.bundleRoot).toMatch(/-b2$/u);
    expect(first.launch?.recommendedCommand).toContain("run.sh");
    expect(first.launch?.recommendedCommand).not.toContain("manual-exec");
    expect(first.launch?.nonInteractiveCommand).toContain(
      first.files.find((file) => file.relativePath === "run.sh")!.sha256,
    );
    expect(first.launch?.nonInteractiveCommand).toContain("manual-exec");
    expect(first.launch?.interactiveCommand).toContain("manual-interactive");
    expect(first.launch?.nonInteractiveCommand).toContain(
      first.files.find((file) => file.relativePath === "manifest.json")!.sha256,
    );
    const taskPath = join(first.bundleRoot!, "task.md");
    const manifestPath = join(first.bundleRoot!, "manifest.json");
    const readmePath = join(first.bundleRoot!, "README.md");
    const runPath = join(first.bundleRoot!, "run.sh");
    expect(readFileSync(taskPath, "utf8")).toBe(compiled.prompt.text);
    expect(sha256(readFileSync(taskPath))).toBe(compiled.prompt.sha256);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toMatchObject({
      bundleSchemaVersion: "arbiter-forge-bundle/v2",
      promptSha256: compiled.prompt.sha256,
      goalMode: "persistent_requested",
      targetRepositoryId: "target",
      launch: {
        defaultMode: "verify_only",
        creatorAgentExecution: "forbidden",
        approvalPolicy: "never",
      },
      lifecycle: {
        compilation: "validated",
        materialization: "materialized",
        execution: "not_started",
      },
    });
    expect(lstatSync(runPath).mode & 0o111).not.toBe(0);
    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toContain("Materialization selected and launched no route");
    expect(readme).toContain("create/save-only requests");
    expect(readme).toContain("directly compute/compare the SHA-256");
    expect(readme).toContain(
      "Manual CLI cannot replace a missing goal mechanism",
    );
    expect(spawnSync("sh", ["-n", runPath]).status).toBe(0);
    expect(first.files).toHaveLength(4);
    for (const file of first.files) {
      expect(sha256(readFileSync(file.absolutePath))).toBe(file.sha256);
    }
    expect(
      git(root, ["check-ignore", "-q", "--no-index", "--", taskPath]).status,
    ).toBe(0);
    expect(
      git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout,
    ).toBe(beforeStatus);
    const taskMtime = statSync(taskPath).mtimeMs;

    const second = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(second.status).toBe("unchanged");
    expect(second.materialized).toBe(true);
    expect(statSync(taskPath).mtimeMs).toBe(taskMtime);
    expect(readFileSync(taskPath, "utf8")).toBe(compiled.prompt.text);
  }, 15_000);

  it.each([
    {
      label: "plain goal",
      outputMode: "resumable_package" as const,
      goalMode: "plain" as const,
      expected: "goalMode=persistent_requested",
    },
    {
      label: "prompt-only output",
      outputMode: "prompt_only" as const,
      goalMode: "persistent_requested" as const,
      expected: "outputMode=resumable_package",
    },
  ])(
    "rejects $label before creating materialization storage",
    ({ outputMode, goalMode, expected }) => {
      const root = createGitFixture("arbiter-forge-ineligible-");
      const request = implementationRequestSchema.parse({
        taskId: "ineligible-handoff",
        objective: "Compile but do not materialize an ineligible handoff.",
        repositories: [{ id: "target", root }],
        outputMode,
        goalMode,
      });
      const compiled = compileImplementationTask(request);
      process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

      const result = materializeTaskBundle({
        operation: "implementation_task",
        request,
        expectedPromptSha256: compiled.prompt.sha256,
        targetRepositoryId: "target",
      });

      expect(result.status).toBe("invalid");
      expect(result.materialized).toBe(false);
      expect(result.errors.join("\n")).toContain(expected);
      expect(existsSync(join(root, ".arbiter-forge"))).toBe(false);
    },
  );

  it("preserves visible pre-existing storage state and rolls back any denied scaffold", () => {
    const root = createGitFixture("arbiter-forge-visible-storage-");
    const storageRoot = join(root, ".arbiter-forge");
    const existingPath = join(storageRoot, "existing.txt");
    mkdirSync(storageRoot);
    writeFileSync(existingPath, "operator-owned visible state\n");
    const beforeStatus = git(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]).stdout;
    expect(beforeStatus).toContain(".arbiter-forge/existing.txt");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    const afterStatus = git(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]).stdout;
    expect(afterStatus).toBe(beforeStatus);
    expect(readFileSync(existingPath, "utf8")).toBe(
      "operator-owned visible state\n",
    );
    expect(
      git(root, [
        "check-ignore",
        "-q",
        "--no-index",
        "--",
        ".arbiter-forge/existing.txt",
      ]).status,
    ).not.toBe(0);

    if (!result.materialized) {
      expect(existsSync(join(storageRoot, ".gitignore"))).toBe(false);
      expect(existsSync(join(storageRoot, "tasks"))).toBe(false);
    } else {
      expect(["written", "unchanged"]).toContain(result.status);
      expect(result.storage.ignored).toBe(true);
    }
  });

  it("does not create storage when deterministic validation fails", () => {
    const root = createGitFixture("arbiter-forge-invalid-");
    const request = taskRequest(root);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: "0".repeat(64),
      targetRepositoryId: "target",
    });

    expect(result.status).toBe("invalid");
    expect(result.materialized).toBe(false);
    expect(existsSync(join(root, ".arbiter-forge"))).toBe(false);
  });

  it("refuses to overwrite a modified existing bundle", () => {
    const root = createGitFixture("arbiter-forge-conflict-");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);
    const input = {
      operation: "implementation_task" as const,
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    };
    const first = materializeTaskBundle(input);
    const taskPath = join(first.bundleRoot!, "task.md");
    writeFileSync(taskPath, "tampered\n");

    const second = materializeTaskBundle(input);

    expect(second.status).toBe("conflict");
    expect(second.materialized).toBe(false);
    expect(readFileSync(taskPath, "utf8")).toBe("tampered\n");
  }, 15_000);

  it("fails closed when the storage root is a symlink escape", () => {
    const root = createGitFixture("arbiter-forge-symlink-");
    const outside = mkdtempSync(join(tmpdir(), "arbiter-forge-outside-"));
    symlinkSync(outside, join(root, ".arbiter-forge"));
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(result.status).toBe("denied");
    expect(result.materialized).toBe(false);
    expect(existsSync(join(outside, "tasks"))).toBe(false);
  });

  it("refuses an existing ignore policy that does not ignore task files", () => {
    const root = createGitFixture("arbiter-forge-not-ignored-");
    mkdirSync(join(root, ".arbiter-forge"));
    writeFileSync(join(root, ".arbiter-forge", ".gitignore"), "!*\n");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(result.status).toBe("not_ignored");
    expect(result.materialized).toBe(false);
    expect(result.files).toEqual([]);
  });

  it("denies roots outside the configured allowlist and unknown repository ids", () => {
    const root = createGitFixture("arbiter-forge-denied-");
    const allowed = mkdtempSync(join(tmpdir(), "arbiter-forge-other-"));
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([allowed]);

    const outside = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });
    const unknown = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "missing",
    });

    expect(outside.status).toBe("denied");
    expect(unknown.status).toBe("invalid");
    expect(existsSync(join(root, ".arbiter-forge"))).toBe(false);
  });

  it("does not inspect or write through a parent Git root outside a nested allowlist", () => {
    const gitRoot = createGitFixture("arbiter-forge-parent-boundary-");
    const allowedChild = join(gitRoot, "allowed-child");
    mkdirSync(allowedChild);
    const request = taskRequest(allowedChild);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([
      allowedChild,
    ]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(result.status).toBe("denied");
    expect(result.errors.join("\n")).toContain(
      "canonical Git root is outside configured allowed roots",
    );
    expect(existsSync(join(allowedChild, ".arbiter-forge"))).toBe(false);
  });

  it("shell-quotes launch paths containing spaces and apostrophes", () => {
    const root = createGitFixture("arbiter forge's repo ");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(result.status).toBe("written");
    expect(result.launch?.nonInteractiveCommand).toContain(`'"'"'`);
    expect(
      spawnSync("sh", ["-n", join(result.bundleRoot!, "run.sh")]).status,
    ).toBe(0);
  }, 15_000);

  it("verifies by default without invoking codex", () => {
    const root = createGitFixture("arbiter-forge-launch-");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);
    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });
    const binRoot = join(root, "stub-bin");
    const invocationMarker = join(root, "codex-invoked");
    mkdirSync(binRoot);
    const stubPath = join(binRoot, "codex");
    writeFileSync(
      stubPath,
      `#!/bin/sh\ntouch ${JSON.stringify(invocationMarker)}\nexit 0\n`,
    );
    chmodSync(stubPath, 0o700);

    const launched = spawnSync(
      "sh",
      [
        join(result.bundleRoot!, "run.sh"),
        ...launcherIntegrityArgs(result, compiled.prompt.sha256),
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binRoot}${pathDelimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(launched.status).toBe(0);
    expect(launched.stdout).toContain(
      "Arbiter Forge bundle verified; Codex was not started.",
    );
    expect(existsSync(invocationMarker)).toBe(false);
  }, 15_000);

  it("uses approval-never and exact task bytes only in explicit manual-exec mode", () => {
    const root = createGitFixture("arbiter-forge-manual-launch-");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);
    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });
    const binRoot = join(root, "stub-bin");
    const argsPath = join(root, "codex-args.txt");
    const stdinPath = join(root, "codex-stdin.txt");
    mkdirSync(binRoot);
    const stubPath = join(binRoot, "codex");
    writeFileSync(
      stubPath,
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGS"\ncat > "$CAPTURE_STDIN"\n',
    );
    chmodSync(stubPath, 0o700);

    const launched = spawnSync(
      "sh",
      [
        join(result.bundleRoot!, "run.sh"),
        ...launcherIntegrityArgs(result, compiled.prompt.sha256),
        "manual-exec",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binRoot}${pathDelimiter}${process.env.PATH ?? ""}`,
          CAPTURE_ARGS: argsPath,
          CAPTURE_STDIN: stdinPath,
        },
      },
    );

    expect(launched.status).toBe(0);
    expect(readFileSync(argsPath, "utf8").split("\n").filter(Boolean)).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "workspace-write",
      "-C",
      root,
      "-",
    ]);
    expect(readFileSync(stdinPath, "utf8")).toBe(compiled.prompt.text);
  }, 15_000);

  it.each([
    { mode: "exec", expectedStatus: 64, expected: "legacy automatic launch" },
    {
      mode: "interactive",
      expectedStatus: 64,
      expected: "legacy automatic launch",
    },
    {
      mode: "manual-interactive",
      expectedStatus: 69,
      expected: "human-controlled TTY",
    },
  ])(
    "fails closed for non-operator $mode mode",
    ({ mode, expectedStatus, expected }) => {
      const root = createGitFixture("arbiter-forge-refused-launch-");
      const request = taskRequest(root);
      const compiled = compileImplementationTask(request);
      process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);
      const result = materializeTaskBundle({
        operation: "implementation_task",
        request,
        expectedPromptSha256: compiled.prompt.sha256,
        targetRepositoryId: "target",
      });
      const binRoot = join(root, "stub-bin");
      const invocationMarker = join(root, "codex-invoked");
      mkdirSync(binRoot);
      const stubPath = join(binRoot, "codex");
      writeFileSync(
        stubPath,
        `#!/bin/sh\ntouch ${JSON.stringify(invocationMarker)}\nexit 0\n`,
      );
      chmodSync(stubPath, 0o700);

      const launched = spawnSync(
        "sh",
        [
          join(result.bundleRoot!, "run.sh"),
          ...launcherIntegrityArgs(result, compiled.prompt.sha256),
          mode,
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${binRoot}${pathDelimiter}${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(launched.status).toBe(expectedStatus);
      expect(launched.stderr).toContain(expected);
      expect(existsSync(invocationMarker)).toBe(false);
    },
  );

  it("rejects a tampered task before invoking codex", () => {
    const root = createGitFixture("arbiter-forge-tampered-launch-");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);
    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });
    const binRoot = join(root, "stub-bin");
    const invocationMarker = join(root, "codex-invoked");
    mkdirSync(binRoot);
    const stubPath = join(binRoot, "codex");
    writeFileSync(
      stubPath,
      `#!/bin/sh\ntouch ${JSON.stringify(invocationMarker)}\nexit 0\n`,
    );
    chmodSync(stubPath, 0o700);
    writeFileSync(join(result.bundleRoot!, "task.md"), "tampered\n");

    const launched = spawnSync(
      "sh",
      [
        join(result.bundleRoot!, "run.sh"),
        ...launcherIntegrityArgs(result, compiled.prompt.sha256),
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binRoot}${pathDelimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(launched.status).toBe(3);
    expect(launched.stderr).toContain(
      "task.md SHA-256 does not match the materializer handoff",
    );
    expect(existsSync(invocationMarker)).toBe(false);
  });

  it.each([
    {
      relativePath: "manifest.json",
      expectedError:
        "manifest.json SHA-256 does not match the materializer handoff",
      tamper: (content: string) =>
        content.replace('"execution": "not_started"', '"execution": "passed"'),
    },
    {
      relativePath: "run.sh",
      expectedError: "run.sh SHA-256 does not match the materializer handoff",
      tamper: (content: string) => `${content}\n# changed\n`,
    },
  ])(
    "rejects a tampered $relativePath before invoking codex",
    ({ relativePath, expectedError, tamper }) => {
      const root = createGitFixture("arbiter-forge-integrity-launch-");
      const request = taskRequest(root);
      const compiled = compileImplementationTask(request);
      process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);
      const result = materializeTaskBundle({
        operation: "implementation_task",
        request,
        expectedPromptSha256: compiled.prompt.sha256,
        targetRepositoryId: "target",
      });
      const binRoot = join(root, "stub-bin");
      const invocationMarker = join(root, "codex-invoked");
      mkdirSync(binRoot);
      const stubPath = join(binRoot, "codex");
      writeFileSync(
        stubPath,
        `#!/bin/sh\ntouch ${JSON.stringify(invocationMarker)}\nexit 0\n`,
      );
      chmodSync(stubPath, 0o700);
      const tamperedPath = join(result.bundleRoot!, relativePath);
      writeFileSync(tamperedPath, tamper(readFileSync(tamperedPath, "utf8")));

      const launched = spawnSync(
        "sh",
        [
          join(result.bundleRoot!, "run.sh"),
          ...launcherIntegrityArgs(result, compiled.prompt.sha256),
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${binRoot}${pathDelimiter}${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(launched.status).toBe(3);
      expect(launched.stderr).toContain(expectedError);
      expect(existsSync(invocationMarker)).toBe(false);
    },
  );

  it("neutralizes local clean/process filters and ignores nested submodule state", () => {
    const root = createGitFixture("arbiter-forge-hostile-git-");
    const rootMarker = join(root, "root-filter-executed");
    installTrackedFilterFixture(root, rootMarker);

    const submoduleSource = createGitFixture("arbiter-forge-submodule-source-");
    const submoduleMarker = join(root, "submodule-filter-executed");
    installTrackedFilterFixture(submoduleSource, submoduleMarker);
    git(root, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      submoduleSource,
      "nested",
    ]);
    git(root, ["add", ".gitmodules", "nested"]);
    git(root, ["commit", "-q", "-m", "add nested submodule"]);

    configureHostileFilter(root, rootMarker);
    configureHostileFilter(join(root, "nested"), submoduleMarker);
    writeFileSync(join(root, "filtered.txt"), "root changed\n");
    writeFileSync(join(root, "nested", "filtered.txt"), "nested changed\n");
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(result.status).toBe("written");
    expect(result.materialized).toBe(true);
    expect(existsSync(rootMarker)).toBe(false);
    expect(existsSync(submoduleMarker)).toBe(false);
  }, 20_000);

  it("denies a worktree whose absolute Git directory is outside the allowlist", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "arbiter-forge-external-gitdir-"),
    );
    const root = join(fixtureRoot, "worktree");
    const gitDirectory = join(fixtureRoot, "outside.git");
    mkdirSync(root);
    const initialized = spawnSync(
      "git",
      ["init", "-q", "--separate-git-dir", gitDirectory, root],
      { encoding: "utf8", shell: false },
    );
    if (initialized.status !== 0) {
      throw new Error(initialized.stderr || initialized.stdout);
    }
    writeFileSync(join(root, "tracked.txt"), "base\n");
    git(root, ["config", "user.email", "audit@example.invalid"]);
    git(root, ["config", "user.name", "Audit"]);
    git(root, ["add", "tracked.txt"]);
    git(root, ["commit", "-q", "-m", "base"]);
    const canonicalRoot = realpathSync(root);
    const request = taskRequest(canonicalRoot);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([
      canonicalRoot,
    ]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(result.status).toBe("denied");
    expect(result.materialized).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Git.*directory.*allowed roots/iu);
    expect(existsSync(join(root, ".arbiter-forge"))).toBe(false);
  });

  it("denies a worktree whose Git common directory is outside the allowlist", () => {
    const { root, commonDirectory } = createExternalCommonDirectoryFixture(
      "arbiter-forge-materialize-common-dir-",
    );
    const request = taskRequest(root);
    const compiled = compileImplementationTask(request);
    process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON = JSON.stringify([root]);

    const result = materializeTaskBundle({
      operation: "implementation_task",
      request,
      expectedPromptSha256: compiled.prompt.sha256,
      targetRepositoryId: "target",
    });

    expect(
      spawnSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: root, encoding: "utf8", shell: false },
      ).stdout.trim(),
    ).toBe(realpathSync(commonDirectory));
    expect(result.status).toBe("denied");
    expect(result.materialized).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "canonical Git common directory is outside configured allowed roots",
    );
    expect(existsSync(join(root, ".arbiter-forge"))).toBe(false);
  });
});

function taskRequest(root: string) {
  return implementationRequestSchema.parse({
    taskId: "persistent-handoff",
    objective: "Implement and independently verify the accepted behavior.",
    repositories: [{ id: "target", root }],
    outputMode: "resumable_package",
    goalMode: "persistent_requested",
  });
}

function launcherIntegrityArgs(
  result: ReturnType<typeof materializeTaskBundle>,
  promptSha256: string,
): string[] {
  return [
    result.files.find((file) => file.relativePath === "run.sh")!.sha256,
    promptSha256,
    result.files.find((file) => file.relativePath === "manifest.json")!.sha256,
  ];
}

function createGitFixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, "tracked.txt"), "base\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "audit@example.invalid"]);
  git(root, ["config", "user.name", "Audit"]);
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-q", "-m", "base"]);
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
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "audit@example.invalid"]);
  git(root, ["config", "user.name", "Audit"]);
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-q", "-m", "base"]);

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

function installTrackedFilterFixture(root: string, marker: string): void {
  writeFileSync(join(root, ".gitattributes"), "filtered.txt filter=evil\n");
  writeFileSync(join(root, "filtered.txt"), "base\n");
  git(root, ["add", ".gitattributes", "filtered.txt"]);
  git(root, ["commit", "-q", "-m", "add filter fixture"]);
  writeFileSync(
    join(root, "evil-filter.sh"),
    `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`,
  );
  chmodSync(join(root, "evil-filter.sh"), 0o700);
}

function configureHostileFilter(root: string, marker: string): void {
  const helper = join(root, "evil-filter.sh");
  if (!existsSync(helper)) {
    writeFileSync(
      helper,
      `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`,
    );
    chmodSync(helper, 0o700);
  }
  git(root, ["config", "filter.evil.clean", helper]);
  git(root, ["config", "filter.evil.process", helper]);
  git(root, ["config", "filter.evil.required", "true"]);
}

function git(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 && !args.includes("check-ignore")) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
