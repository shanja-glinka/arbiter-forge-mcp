import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";

import {
  authorizePath,
  isWithin,
  loadAllowedRoots,
  safeFilterConfigOverrides,
} from "./inspect.js";
import {
  compileBlindCheckTask,
  compileDocumentationTask,
  compileImplementationTask,
} from "./render.js";
import { revalidateTaskPrompt } from "./revalidate.js";
import {
  GENERATOR_VERSION,
  MATERIALIZER_VERSION,
  SCHEMA_VERSION,
  type BlindCheckRequest,
  type CompiledForgeResult,
  type DocumentationRequest,
  type ImplementationRequest,
  type MaterializeTaskRequest,
  type MaterializeTaskResult,
} from "./schemas.js";
import { sha256, withSingleTrailingNewline } from "./stable.js";

const BUNDLE_SCHEMA_VERSION = "arbiter-forge-bundle/v1" as const;
const STORAGE_DIRECTORY = ".arbiter-forge";
const IGNORE_FILE_CONTENT = "/.gitignore\n/tasks/\n";
const SAFE_GIT_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
  "-c",
  `core.attributesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
  "-c",
  `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
  "-c",
  "credential.helper=",
] as const;

type BundleFile = MaterializeTaskResult["files"][number] & {
  content: string;
  mode: number;
};

class MaterializationDeniedError extends Error {}
class MaterializationNotIgnoredError extends Error {}
class MaterializationConflictError extends Error {}

/** Recompile, validate, and persist compiler-owned task bytes in an ignored repository-local bundle. */
export function materializeTaskBundle(
  input: MaterializeTaskRequest,
): MaterializeTaskResult {
  const compiled = compileRequest(input);
  const validation = revalidateTaskPrompt({
    prompt: compiled.prompt.text,
    operation: input.operation,
    request: input.request,
    expectedPromptSha256: input.expectedPromptSha256,
  });
  const base = baseResult(input, compiled, validation);

  if (!validation.pass || validation.assurance !== "recompiled") {
    return {
      ...base,
      status: "invalid",
      errors: validation.blockingErrors,
    };
  }

  const repository = input.request.repositories.find(
    (candidate) => candidate.id === input.targetRepositoryId,
  );
  if (!repository) {
    return {
      ...base,
      status: "invalid",
      errors: [
        `targetRepositoryId ${input.targetRepositoryId} is not present in the compiled request`,
      ],
    };
  }

  const authorizationErrors: string[] = [];
  const allowedRoots = loadAllowedRoots(
    authorizationErrors,
    "Task bundle materialization",
  );
  if (allowedRoots.length === 0) {
    return {
      ...base,
      status: "denied",
      errors: authorizationErrors,
    };
  }

  let targetRoot: string;
  try {
    targetRoot = authorizePath(repository.root.trim(), allowedRoots, true);
  } catch (error) {
    return {
      ...base,
      status: "denied",
      errors: [formatError("target repository", error)],
    };
  }

  const relativeRoot = toPosix(
    join(
      STORAGE_DIRECTORY,
      "tasks",
      compiled.taskId,
      compiled.requestFingerprint.slice(0, 16),
    ),
  );
  const bundleRoot = join(targetRoot, ...relativeRoot.split("/"));
  const ignoreProofCommand = `git -C ${shellQuote(targetRoot)} check-ignore -v --no-index -- ${shellQuote(`${relativeRoot}/task.md`)}`;
  const withTarget = {
    ...base,
    targetRoot,
    bundleRoot,
    storage: {
      relativeRoot,
      ignored: false,
      ignoreProofCommand,
    },
  } satisfies MaterializeTaskResult;

  const gitRoot = runGit(targetRoot, ["rev-parse", "--show-toplevel"]);
  const gitDirectory = runGit(targetRoot, ["rev-parse", "--absolute-git-dir"]);
  const gitCommonDirectory = runGit(targetRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!gitRoot.ok || !gitDirectory.ok || !gitCommonDirectory.ok) {
    return {
      ...withTarget,
      status: "denied",
      errors: [
        "target repository is not inside a readable, allowlisted Git worktree",
      ],
    };
  }
  try {
    const canonicalGitRoot = realpathSync(gitRoot.stdout.trim());
    const canonicalGitDirectory = realpathSync(gitDirectory.stdout.trim());
    const canonicalGitCommonDirectory = realpathSync(
      gitCommonDirectory.stdout.trim(),
    );
    if (!isWithin(targetRoot, canonicalGitRoot)) {
      throw new Error("declared target root is outside its canonical Git root");
    }
    if (
      !allowedRoots.some((allowedRoot) =>
        isWithin(canonicalGitRoot, allowedRoot),
      )
    ) {
      throw new Error("canonical Git root is outside configured allowed roots");
    }
    if (
      !allowedRoots.some((allowedRoot) =>
        isWithin(canonicalGitDirectory, allowedRoot),
      )
    ) {
      throw new Error(
        "canonical Git metadata directory is outside configured allowed roots",
      );
    }
    if (
      !allowedRoots.some((allowedRoot) =>
        isWithin(canonicalGitCommonDirectory, allowedRoot),
      )
    ) {
      throw new Error(
        "canonical Git common directory is outside configured allowed roots",
      );
    }
  } catch (error) {
    return {
      ...withTarget,
      status: "denied",
      errors: [formatError("Git root", error)],
    };
  }

  const filterOverrides = safeFilterConfigOverrides(targetRoot);
  if (!filterOverrides.ok) {
    return {
      ...withTarget,
      status: "denied",
      errors: [
        "Git filter configuration could not be safely neutralized before materialization",
      ],
    };
  }

  const statusBefore = gitStatus(targetRoot, filterOverrides.args);
  if (!statusBefore.ok) {
    return {
      ...withTarget,
      status: "denied",
      errors: ["unable to capture Git status before materialization"],
    };
  }

  let createdBundle = false;
  let ignoreFileCreated = false;
  const createdDirectories: string[] = [];
  let files: BundleFile[] = [];
  try {
    const storageRoot = join(targetRoot, STORAGE_DIRECTORY);
    ensureSafeDirectory(storageRoot, targetRoot, createdDirectories);
    ignoreFileCreated = ensureIgnoreFile(storageRoot, targetRoot);

    const prospectiveTask = `${relativeRoot}/task.md`;
    const ignoreProof = proveIgnored(targetRoot, prospectiveTask);
    if (!ignoreProof.ok) {
      throw new MaterializationNotIgnoredError(
        `prospective task path is not ignored by Git: ${prospectiveTask}`,
      );
    }
    if (isTracked(targetRoot, prospectiveTask)) {
      throw new MaterializationConflictError(
        `task path is already tracked by Git: ${prospectiveTask}`,
      );
    }

    files = buildBundleFiles(compiled, input, relativeRoot);
    const taskParent = join(
      targetRoot,
      STORAGE_DIRECTORY,
      "tasks",
      compiled.taskId,
    );
    ensureSafeDirectory(taskParent, targetRoot, createdDirectories);

    if (existsSync(bundleRoot)) {
      assertSafeExistingDirectory(bundleRoot, targetRoot);
      assertExistingBundleMatches(bundleRoot, files);
    } else {
      const temporaryRoot = mkdtempSync(
        join(taskParent, `.${compiled.requestFingerprint.slice(0, 16)}.tmp-`),
      );
      try {
        writeBundle(temporaryRoot, files);
        verifyBundle(temporaryRoot, files);
        assertSafeExistingDirectory(taskParent, targetRoot);
        renameSync(temporaryRoot, bundleRoot);
        createdBundle = true;
      } catch (error) {
        removeOwnedBundle(temporaryRoot, files, targetRoot);
        throw error;
      }
    }

    verifyBundle(bundleRoot, files);
    for (const file of files) {
      const persistedRelativePath = `${relativeRoot}/${file.relativePath}`;
      if (isTracked(targetRoot, persistedRelativePath)) {
        throw new MaterializationConflictError(
          `materialized file is tracked by Git: ${persistedRelativePath}`,
        );
      }
      if (!proveIgnored(targetRoot, persistedRelativePath).ok) {
        throw new MaterializationNotIgnoredError(
          `materialized file is not ignored by Git: ${persistedRelativePath}`,
        );
      }
    }

    const statusAfter = gitStatus(targetRoot, filterOverrides.args);
    if (!statusAfter.ok || statusAfter.stdout !== statusBefore.stdout) {
      throw new MaterializationDeniedError(
        "Git status changed during materialization; the new bundle was rolled back",
      );
    }

    const persistedFiles = files.map(
      ({ content: _content, mode: _mode, ...file }) => ({
        ...file,
        absolutePath: join(bundleRoot, file.relativePath),
      }),
    );
    const runPath = join(bundleRoot, "run.sh");
    const runScriptHash = files.find(
      (file) => file.relativePath === "run.sh",
    )!.sha256;
    const manifestHash = files.find(
      (file) => file.relativePath === "manifest.json",
    )!.sha256;
    const launcherPrefix = `bash ${shellQuote(runPath)} ${shellQuote(runScriptHash)} ${shellQuote(compiled.prompt.sha256)} ${shellQuote(manifestHash)}`;
    const nonInteractiveCommand = launcherPrefix;
    const interactiveCommand = `${launcherPrefix} interactive`;

    return {
      ...withTarget,
      materializerVersion: MATERIALIZER_VERSION,
      status: createdBundle ? "written" : "unchanged",
      materialized: true,
      storage: {
        ...withTarget.storage,
        ignored: true,
      },
      files: persistedFiles,
      launch: {
        workingDirectory: targetRoot,
        recommendedCommand: nonInteractiveCommand,
        nonInteractiveCommand,
        interactiveCommand,
      },
      warnings: [
        "The repository-local ignored bundle survives reboot but can be removed by manual cleanup or git clean -fdx; it is not a committed archive.",
      ],
    };
  } catch (error) {
    rollbackMaterialization({
      bundleRoot,
      createdBundle,
      createdDirectories,
      files,
      ignoreFileCreated,
      targetRoot,
    });
    const restoredStatus = gitStatus(targetRoot, filterOverrides.args);
    const rollbackErrors =
      restoredStatus.ok && restoredStatus.stdout === statusBefore.stdout
        ? []
        : ["rollback could not prove restoration of the original Git status"];
    return {
      ...withTarget,
      materializerVersion: MATERIALIZER_VERSION,
      status:
        error instanceof MaterializationConflictError
          ? "conflict"
          : error instanceof MaterializationNotIgnoredError
            ? "not_ignored"
            : "denied",
      errors: [formatError("materialization", error), ...rollbackErrors],
    };
  }
}

function compileRequest(input: MaterializeTaskRequest): CompiledForgeResult {
  return input.operation === "implementation_task"
    ? compileImplementationTask(input.request as ImplementationRequest)
    : input.operation === "documentation_task"
      ? compileDocumentationTask(input.request as DocumentationRequest)
      : compileBlindCheckTask(input.request as BlindCheckRequest);
}

function baseResult(
  input: MaterializeTaskRequest,
  compiled: CompiledForgeResult,
  validation: MaterializeTaskResult["validation"],
): MaterializeTaskResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    materializerVersion: MATERIALIZER_VERSION,
    status: "invalid",
    materialized: false,
    taskId: compiled.taskId,
    targetRepositoryId: input.targetRepositoryId,
    targetRoot: null,
    bundleRoot: null,
    validation,
    storage: {
      relativeRoot: null,
      ignored: false,
      ignoreProofCommand: null,
    },
    files: [],
    launch: null,
    errors: [],
    warnings: [],
  };
}

function buildBundleFiles(
  compiled: CompiledForgeResult,
  input: MaterializeTaskRequest,
  relativeRoot: string,
): BundleFile[] {
  const runScript = renderRunScript();
  const runScriptSha256 = sha256(runScript);
  const manifest = withSingleTrailingNewline(
    JSON.stringify(
      {
        bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
        schemaVersion: SCHEMA_VERSION,
        generatorVersion: GENERATOR_VERSION,
        materializerVersion: MATERIALIZER_VERSION,
        operation: input.operation,
        taskId: compiled.taskId,
        requestFingerprint: compiled.requestFingerprint,
        policyHash: compiled.policyHash,
        routingPlanHash: compiled.decisions.routingPlanHash,
        promptSha256: compiled.prompt.sha256,
        targetRepositoryId: input.targetRepositoryId,
        lifecycle: {
          compilation: "validated",
          materialization: "materialized",
          execution: "not_started",
        },
        storage: {
          class: "repo_local_ignored",
          relativeRoot,
          ignoreVerified: true,
        },
        entrypoint: "task.md",
        launch: {
          script: "run.sh",
          workingDirectory: "repository_root",
          defaultMode: "non_interactive",
          interactiveArgument: "interactive",
          integrityArguments: ["run_sha256", "task_sha256", "manifest_sha256"],
        },
        files: [
          {
            relativePath: "task.md",
            sha256: compiled.prompt.sha256,
          },
          { relativePath: "run.sh", sha256: runScriptSha256 },
        ],
        informationalFiles: ["README.md"],
      },
      null,
      2,
    ),
  );
  const manifestSha256 = sha256(manifest);
  const readme = renderBundleReadme(
    compiled,
    relativeRoot,
    runScriptSha256,
    manifestSha256,
  );
  return [
    bundleFile("task.md", "text/markdown", compiled.prompt.text, false),
    bundleFile("manifest.json", "application/json", manifest, false),
    bundleFile("README.md", "text/markdown", readme, false),
    bundleFile("run.sh", "text/x-shellscript", runScript, true),
  ];
}

function bundleFile(
  relativePath: string,
  mediaType: BundleFile["mediaType"],
  content: string,
  executable: boolean,
): BundleFile {
  return {
    relativePath,
    absolutePath: "",
    mediaType,
    content,
    sha256: sha256(content),
    executable,
    mode: executable ? 0o700 : 0o600,
  };
}

function renderBundleReadme(
  compiled: CompiledForgeResult,
  relativeRoot: string,
  runScriptSha256: string,
  manifestSha256: string,
): string {
  return withSingleTrailingNewline(`# ${compiled.taskId}

This Arbiter Forge task bundle is materialized and validated, but **not launched**.

- Prompt SHA-256: \`${compiled.prompt.sha256}\`
- Local ignored path: \`${relativeRoot}\`
- Execution-time Arbiter Forge MCP calls: forbidden

## Launch

Run non-interactively from this bundle:

\`\`\`bash
./run.sh '${runScriptSha256}' '${compiled.prompt.sha256}' '${manifestSha256}'
\`\`\`

Open an interactive Codex CLI task instead:

\`\`\`bash
./run.sh '${runScriptSha256}' '${compiled.prompt.sha256}' '${manifestSha256}' interactive
\`\`\`

The three hashes are an out-of-band integrity anchor returned by the materializer. The launcher verifies itself, \`task.md\`, and the complete \`manifest.json\` bytes before starting Codex. \`README.md\` is informational and its hash is returned by the materializer, but the launcher does not trust it as provenance. The bundle survives an OS reboot, but manual cleanup or \`git clean -fdx\` can remove it; it is not a committed archive.
`);
}

function renderRunScript(): string {
  return `#!/bin/sh
set -eu

BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TARGET_ROOT=$(CDPATH= cd -- "$BUNDLE_DIR/../../../.." && pwd -P)
TASK_FILE="$BUNDLE_DIR/task.md"
MANIFEST_FILE="$BUNDLE_DIR/manifest.json"

command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 127; }
command -v codex >/dev/null 2>&1 || { echo "codex is required" >&2; exit 127; }
git -C "$TARGET_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "target is not a Git worktree" >&2; exit 2; }

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <expected-run-sha256> <expected-task-sha256> <expected-manifest-sha256> [exec|interactive]" >&2
  exit 64
fi
EXPECTED_RUN_HASH=$1
EXPECTED_TASK_HASH=$2
EXPECTED_MANIFEST_HASH=$3
MODE=\${4:-exec}

ACTUAL_RUN_HASH=$(node -e 'const fs=require("node:fs");const crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$0")
ACTUAL_TASK_HASH=$(node -e 'const fs=require("node:fs");const crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$TASK_FILE")
ACTUAL_MANIFEST_HASH=$(node -e 'const fs=require("node:fs");const crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$MANIFEST_FILE")

[ "$ACTUAL_RUN_HASH" = "$EXPECTED_RUN_HASH" ] || { echo "run.sh SHA-256 does not match the materializer handoff" >&2; exit 3; }
[ "$ACTUAL_TASK_HASH" = "$EXPECTED_TASK_HASH" ] || { echo "task.md SHA-256 does not match the materializer handoff" >&2; exit 3; }
[ "$ACTUAL_MANIFEST_HASH" = "$EXPECTED_MANIFEST_HASH" ] || { echo "manifest.json SHA-256 does not match the materializer handoff" >&2; exit 3; }

MANIFEST_HASHES=$(node -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const run=value.files.find((entry)=>entry.relativePath==="run.sh");process.stdout.write(value.promptSha256+"\\n"+(run?.sha256??""));' "$MANIFEST_FILE")
MANIFEST_TASK_HASH=$(printf '%s\n' "$MANIFEST_HASHES" | sed -n '1p')
MANIFEST_RUN_HASH=$(printf '%s\n' "$MANIFEST_HASHES" | sed -n '2p')

[ "$MANIFEST_RUN_HASH" = "$EXPECTED_RUN_HASH" ] || { echo "manifest.json run.sh SHA-256 does not match the materializer handoff" >&2; exit 3; }
[ "$MANIFEST_TASK_HASH" = "$EXPECTED_TASK_HASH" ] || { echo "manifest.json task.md SHA-256 does not match the materializer handoff" >&2; exit 3; }

case "$MODE" in
  exec)
    exec codex exec --sandbox workspace-write -C "$TARGET_ROOT" - < "$TASK_FILE"
    ;;
  interactive)
    exec codex -C "$TARGET_ROOT" "Execute the compiled Arbiter Forge task at $TASK_FILE. Verify task.md against manifest.json before work. Do not call Arbiter Forge MCP during execution."
    ;;
  *)
    echo "usage: $0 <expected-run-sha256> <expected-task-sha256> <expected-manifest-sha256> [exec|interactive]" >&2
    exit 64
    ;;
esac
`;
}

function ensureSafeDirectory(
  path: string,
  targetRoot: string,
  createdDirectories: string[],
): void {
  const child = relative(targetRoot, path);
  if (
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    child.split(sep).includes("..")
  ) {
    throw new MaterializationDeniedError(
      "materialization directory escapes target root",
    );
  }
  let current = targetRoot;
  for (const segment of child.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new MaterializationDeniedError(
          `unsafe existing path component: ${current}`,
        );
      }
    } else {
      mkdirSync(current, { mode: 0o700 });
      createdDirectories.push(current);
    }
    const canonical = realpathSync(current);
    if (!isWithin(canonical, targetRoot)) {
      throw new MaterializationDeniedError(
        `materialization directory resolves outside target root: ${current}`,
      );
    }
  }
}

function assertSafeExistingDirectory(path: string, targetRoot: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new MaterializationConflictError(
      `bundle destination is not a safe directory: ${path}`,
    );
  }
  if (!isWithin(realpathSync(path), targetRoot)) {
    throw new MaterializationDeniedError(
      "bundle destination resolves outside target root",
    );
  }
}

function ensureIgnoreFile(storageRoot: string, targetRoot: string): boolean {
  const ignorePath = join(storageRoot, ".gitignore");
  if (existsSync(ignorePath)) {
    const persisted = readRegularFileNoFollow(ignorePath);
    if (!isWithin(realpathSync(ignorePath), targetRoot)) {
      throw new MaterializationDeniedError(
        ".arbiter-forge/.gitignore resolves outside target root",
      );
    }
    if (persisted.content.length > 64 * 1024) {
      throw new MaterializationDeniedError(
        ".arbiter-forge/.gitignore is unexpectedly large",
      );
    }
    return false;
  }
  writeFileNoFollow(ignorePath, IGNORE_FILE_CONTENT, 0o600);
  return true;
}

function writeBundle(root: string, files: BundleFile[]): void {
  for (const file of files) {
    const path = join(root, file.relativePath);
    writeFileNoFollow(path, file.content, file.mode);
  }
}

function verifyBundle(root: string, files: BundleFile[]): void {
  for (const file of files) {
    const path = join(root, file.relativePath);
    const persisted = readRegularFileNoFollow(path);
    if (sha256(persisted.content) !== file.sha256) {
      throw new MaterializationConflictError(
        `bundle file hash mismatch: ${file.relativePath}`,
      );
    }
    if (file.executable && (persisted.mode & 0o100) === 0) {
      throw new MaterializationConflictError(
        `bundle launcher is not owner-executable: ${file.relativePath}`,
      );
    }
  }
}

function assertExistingBundleMatches(root: string, files: BundleFile[]): void {
  for (const file of files) {
    const path = join(root, file.relativePath);
    if (!existsSync(path)) {
      throw new MaterializationConflictError(
        `existing bundle is incomplete: ${file.relativePath}`,
      );
    }
    const persisted = readRegularFileNoFollow(path);
    if (sha256(persisted.content) !== file.sha256) {
      throw new MaterializationConflictError(
        `existing bundle differs: ${file.relativePath}`,
      );
    }
    if (file.executable && (persisted.mode & 0o100) === 0) {
      throw new MaterializationConflictError(
        `existing bundle launcher is not owner-executable: ${file.relativePath}`,
      );
    }
  }
}

function writeFileNoFollow(path: string, content: string, mode: number): void {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    mode,
  );
  try {
    writeFileSync(descriptor, content, { encoding: "utf8" });
  } finally {
    closeSync(descriptor);
  }
}

function readRegularFileNoFollow(path: string): {
  content: Buffer;
  mode: number;
} {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    throw new MaterializationConflictError(
      `bundle path is not a readable no-follow file: ${formatError(path, error)}`,
    );
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new MaterializationConflictError(
        `bundle path is not a regular file: ${path}`,
      );
    }
    return { content: readFileSync(descriptor), mode: stat.mode };
  } finally {
    closeSync(descriptor);
  }
}

function rollbackMaterialization(input: {
  bundleRoot: string;
  createdBundle: boolean;
  createdDirectories: string[];
  files: BundleFile[];
  ignoreFileCreated: boolean;
  targetRoot: string;
}): void {
  if (input.createdBundle) {
    removeOwnedBundle(input.bundleRoot, input.files, input.targetRoot);
  }
  if (input.ignoreFileCreated) {
    removeOwnedIgnoreFile(
      join(input.targetRoot, STORAGE_DIRECTORY, ".gitignore"),
      input.targetRoot,
    );
  }
  for (const directory of [...input.createdDirectories].reverse()) {
    removeEmptyOwnedDirectory(directory, input.targetRoot);
  }
}

function removeOwnedBundle(
  root: string,
  files: BundleFile[],
  targetRoot: string,
): void {
  if (!existsSync(root)) return;
  try {
    assertSafeExistingDirectory(root, targetRoot);
  } catch {
    return;
  }
  for (const file of files) {
    const path = join(root, file.relativePath);
    if (!existsSync(path)) continue;
    try {
      const persisted = readRegularFileNoFollow(path);
      if (sha256(persisted.content) === file.sha256) unlinkSync(path);
    } catch {
      // Never delete a path that no longer matches the bytes created by Forge.
    }
  }
  removeEmptyOwnedDirectory(root, targetRoot);
}

function removeOwnedIgnoreFile(path: string, targetRoot: string): void {
  if (!existsSync(path)) return;
  try {
    const persisted = readRegularFileNoFollow(path);
    if (
      isWithin(realpathSync(path), targetRoot) &&
      persisted.content.equals(Buffer.from(IGNORE_FILE_CONTENT))
    ) {
      unlinkSync(path);
    }
  } catch {
    // Preserve an unexpectedly changed path rather than deleting user data.
  }
}

function removeEmptyOwnedDirectory(path: string, targetRoot: string): void {
  if (!existsSync(path)) return;
  try {
    const stat = lstatSync(path);
    if (
      !stat.isSymbolicLink() &&
      stat.isDirectory() &&
      isWithin(realpathSync(path), targetRoot)
    ) {
      rmdirSync(path);
    }
  } catch {
    // Non-empty, moved, or replaced directories are intentionally preserved.
  }
}

function proveIgnored(
  targetRoot: string,
  relativePath: string,
): { ok: boolean; proof: string } {
  const check = runGit(targetRoot, [
    "check-ignore",
    "-q",
    "--no-index",
    "--",
    relativePath,
  ]);
  const verbose = runGit(targetRoot, [
    "check-ignore",
    "-v",
    "--no-index",
    "--",
    relativePath,
  ]);
  return { ok: check.ok, proof: verbose.stdout.trim() };
}

function isTracked(targetRoot: string, relativePath: string): boolean {
  return runGit(targetRoot, ["ls-files", "--error-unmatch", "--", relativePath])
    .ok;
}

function gitStatus(
  targetRoot: string,
  filterOverrides: readonly string[],
): { ok: boolean; stdout: string } {
  return runGit(
    targetRoot,
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=all",
    ],
    filterOverrides,
  );
}

function runGit(
  cwd: string,
  args: string[],
  configOverrides: readonly string[] = [],
): { ok: boolean; status: number | null; stdout: string } {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("GIT_")) delete environment[key];
  }
  const result = spawnSync(
    "git",
    ["--no-pager", ...SAFE_GIT_CONFIG_ARGS, ...configOverrides, ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...environment,
        GIT_ATTR_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
      shell: false,
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function formatError(subject: string, error: unknown): string {
  return `${subject}: ${error instanceof Error ? error.message : String(error)}`;
}
