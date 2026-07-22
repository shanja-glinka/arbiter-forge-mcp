import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJson, sha256, uniqueSorted } from "./stable.js";
import { inspectWorkspaceRequestSchema } from "./schemas.js";

interface GitSnapshot {
  root: string;
  branch: string | null;
  head: string;
  dirty: boolean;
  dirtyEntries: number;
  untrackedEntries: number;
  dirtyManifestHash: string;
  contentBound: boolean;
}

interface WorkspaceInspection {
  requestedRoot: string;
  realRoot: string;
  git: GitSnapshot | null;
  rules: string[];
  planning: string[];
  detected: {
    packageManager: string | null;
    monorepo: boolean;
    playwright: boolean;
    graphql: boolean;
  };
  packageScripts: string[];
}

interface SourceInspection {
  requestedPath: string;
  realPath: string;
  size: number;
  sha256: string;
}

export interface InspectWorkspaceResult {
  schemaVersion: "arbiter-forge/v1";
  status: "ready" | "partial" | "denied";
  allowedRoots: string[];
  workspaces: WorkspaceInspection[];
  sources: SourceInspection[];
  warnings: string[];
  errors: string[];
  contextHash: string;
}

const DENIED_BASENAMES = new Set([
  ".env",
  ".envrc",
  ".git-credentials",
  ".gitconfig",
  ".npmrc",
  ".pnpmrc",
  ".pypirc",
  ".terraformrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".netrc",
  "application_default_credentials.json",
  "auth.json",
  "auth.toml",
  "azureauth.json",
  "credentials",
  "credentials.json",
  "credentials.toml",
  "dockerconfigjson",
  "id_dsa",
  "id_ecdsa",
  "id_rsa",
  "id_ed25519",
  "kubeconfig",
  "pip.conf",
  "service-account-key.json",
  "service-account.json",
  "settings.xml",
  "terraform.tfstate",
  "terraform.tfstate.backup",
]);

const DENIED_PATH_SEGMENTS = new Set([
  ".aws",
  ".azure",
  ".docker",
  ".direnv",
  ".git",
  ".gnupg",
  ".kube",
  ".ssh",
  ".terraform",
  "node_modules",
]);

const DENIED_CONFIG_NAMESPACES = new Set(["gcloud", "gh", "glab"]);
const SENSITIVE_DATA_EXTENSIONS = new Set([
  "",
  ".conf",
  ".config",
  ".cred",
  ".credentials",
  ".csv",
  ".env",
  ".ini",
  ".json",
  ".properties",
  ".toml",
  ".tsv",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const SENSITIVE_DATA_NAME =
  /(?:^|[._-])(?:api[._-]?keys?|auth|credentials?|passwords?|private[._-]?keys?|refresh[._-]?tokens?|secrets?|service[._-]?accounts?|tokens?)(?:[._-]|$)/iu;

const GIT_NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
const SAFE_GIT_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  `core.hooksPath=${GIT_NULL_DEVICE}`,
  "-c",
  `core.attributesFile=${GIT_NULL_DEVICE}`,
  "-c",
  `core.excludesFile=${GIT_NULL_DEVICE}`,
  "-c",
  "credential.helper=",
] as const;

const KNOWN_RULE_PATHS = [
  "AGENTS.md",
  "AGENTS.local.md",
  ".claude/CLAUDE.md",
  ".github/copilot-instructions.md",
];

const KNOWN_PLANNING_PATHS = [
  ".planning/STATE.md",
  ".planning/ROADMAP.md",
  "docs/agents/README.md",
  "docs/agents/service-ownership-map.md",
  "docs/agents/convention-coverage-map.md",
];

const PLAYWRIGHT_CONFIGS = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mts",
  "playwright.config.mjs",
];

const GRAPHQL_MARKERS = [
  "graphql.config.ts",
  "graphql.config.js",
  "codegen.ts",
  "codegen.yml",
  "codegen.yaml",
  "supergraph.yaml",
];

export function inspectWorkspace(rawInput: unknown): InspectWorkspaceResult {
  const input = inspectWorkspaceRequestSchema.parse(rawInput);
  const warnings: string[] = [];
  const errors: string[] = [];
  const allowedRoots = loadAllowedRoots(errors, "Workspace inspection");

  if (allowedRoots.length === 0) {
    return finalize("denied", [], [], [], warnings, errors);
  }

  const workspaces: WorkspaceInspection[] = [];
  for (const requestedRoot of [...input.workspaceRoots].sort()) {
    try {
      const realRoot = authorizePath(requestedRoot, allowedRoots, true);
      workspaces.push(
        inspectOneWorkspace(requestedRoot, realRoot, allowedRoots, warnings),
      );
    } catch (error) {
      errors.push(formatError(`workspace root ${requestedRoot}`, error));
    }
  }

  const sources: SourceInspection[] = [];
  for (const requestedPath of [...input.sourcePaths].sort()) {
    try {
      const realPath = authorizePath(requestedPath, allowedRoots, false);
      assertSafeSource(realPath);
      const stat = statSync(realPath);
      if (!stat.isFile()) {
        throw new Error("source path is not a regular file");
      }
      if (stat.size > input.maxSourceBytes) {
        throw new Error(
          `source exceeds maxSourceBytes (${stat.size} > ${input.maxSourceBytes})`,
        );
      }
      sources.push({
        requestedPath,
        realPath,
        size: stat.size,
        sha256: sha256(readFileSync(realPath)),
      });
    } catch (error) {
      errors.push(formatError(`source ${requestedPath}`, error));
    }
  }

  const status =
    errors.length === 0 && warnings.length === 0
      ? "ready"
      : workspaces.length > 0 || sources.length > 0
        ? "partial"
        : "denied";
  return finalize(status, allowedRoots, workspaces, sources, warnings, errors);
}

function inspectOneWorkspace(
  requestedRoot: string,
  realRoot: string,
  allowedRoots: string[],
  warnings: string[],
): WorkspaceInspection {
  const packageJsonPath = join(realRoot, "package.json");
  const packageJson = readJson(packageJsonPath, allowedRoots, warnings);
  const packageScripts =
    packageJson &&
    typeof packageJson.scripts === "object" &&
    packageJson.scripts
      ? Object.keys(packageJson.scripts as Record<string, unknown>).sort()
      : [];
  const packageManager =
    packageJson && typeof packageJson.packageManager === "string"
      ? packageJson.packageManager
      : detectPackageManager(realRoot, allowedRoots, warnings);

  return {
    requestedRoot,
    realRoot,
    git: inspectGit(realRoot, allowedRoots, warnings),
    rules: existingPaths(realRoot, KNOWN_RULE_PATHS, allowedRoots, warnings),
    planning: existingPaths(
      realRoot,
      KNOWN_PLANNING_PATHS,
      allowedRoots,
      warnings,
    ),
    detected: {
      packageManager,
      monorepo:
        hasMetadataFile(
          join(realRoot, "pnpm-workspace.yaml"),
          allowedRoots,
          warnings,
        ) ||
        hasMetadataFile(join(realRoot, "lerna.json"), allowedRoots, warnings) ||
        Boolean(
          packageJson &&
          ("workspaces" in packageJson || "packages" in packageJson),
        ),
      playwright:
        PLAYWRIGHT_CONFIGS.some((path) =>
          hasMetadataFile(join(realRoot, path), allowedRoots, warnings),
        ) ||
        packageScripts.some((script) =>
          script.toLowerCase().includes("playwright"),
        ),
      graphql:
        GRAPHQL_MARKERS.some((path) =>
          hasMetadataFile(join(realRoot, path), allowedRoots, warnings),
        ) ||
        packageScripts.some((script) =>
          /graphql|codegen|supergraph/iu.test(script),
        ),
    },
    packageScripts,
  };
}

function inspectGit(
  root: string,
  allowedRoots: string[],
  warnings: string[],
): GitSnapshot | null {
  const gitRoot = runGit(root, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot.ok) {
    return null;
  }
  const gitDirectory = runGit(root, ["rev-parse", "--absolute-git-dir"]);
  const gitCommonDirectory = runGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  let realGitRoot: string;
  try {
    realGitRoot = realpathSync(gitRoot.stdout);
    const realGitDirectory = gitDirectory.ok
      ? realpathSync(gitDirectory.stdout)
      : null;
    const realGitCommonDirectory = gitCommonDirectory.ok
      ? realpathSync(gitCommonDirectory.stdout)
      : null;
    if (
      !isAuthorized(realGitRoot, allowedRoots) ||
      !realGitDirectory ||
      !isAuthorized(realGitDirectory, allowedRoots) ||
      !realGitCommonDirectory ||
      !isAuthorized(realGitCommonDirectory, allowedRoots)
    ) {
      warnings.push(
        `Git worktree, metadata, or common-directory boundary escapes configured allowed roots for ${root}; snapshot inspection was skipped.`,
      );
      return null;
    }
    gitRoot.stdout = realGitRoot;
  } catch {
    warnings.push(
      `Git root identity could not be canonicalized for ${root}; snapshot inspection was skipped.`,
    );
    return null;
  }

  const filterOverrides = safeFilterConfigOverrides(root);
  if (!filterOverrides.ok) {
    warnings.push(
      `Git filter configuration could not be safely neutralized for ${root}; snapshot inspection was skipped.`,
    );
    return null;
  }

  const head = runGit(root, ["rev-parse", "HEAD"]);
  const branch = runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const status = runGit(
    root,
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=all",
    ],
    filterOverrides.args,
  );
  if (!head.ok || !status.ok) {
    warnings.push(`Git snapshot incomplete for ${root}.`);
    return null;
  }
  const statusLines = status.stdout
    ? status.stdout.split("\n").filter(Boolean)
    : [];
  const trackedDiff = runGitRaw(
    root,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=all",
      "--binary",
      "HEAD",
      "--",
    ],
    filterOverrides.args,
  );
  const untracked = runGitRaw(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    filterOverrides.args,
  );
  const untrackedEntries = untracked.ok
    ? untracked.stdout.split("\0").filter(Boolean)
    : [];
  const untrackedHashes: string[] = [];
  let contentBound = trackedDiff.ok && untracked.ok;
  if (untrackedEntries.length > 2000) {
    warnings.push(
      `Git snapshot has more than 2000 untracked files for ${root}; content identity is incomplete.`,
    );
    contentBound = false;
  } else {
    for (const path of untrackedEntries) {
      const absolutePath = join(realGitRoot, path);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(absolutePath);
      } catch {
        contentBound = false;
        break;
      }
      if (stat.isSymbolicLink()) {
        // Bind the link itself without following it across the allowlist boundary.
        untrackedHashes.push(
          `${path}\0symlink:${sha256(readlinkSync(absolutePath, "buffer"))}`,
        );
        continue;
      }
      if (!stat.isFile()) {
        contentBound = false;
        break;
      }
      try {
        const canonicalPath = realpathSync(absolutePath);
        if (
          !isWithin(canonicalPath, realGitRoot) ||
          !isAuthorized(canonicalPath, allowedRoots)
        ) {
          throw new Error(
            "untracked path resolves outside authorized Git root",
          );
        }
        assertSafeSource(canonicalPath);
      } catch {
        contentBound = false;
        break;
      }
      const hash = runGit(
        root,
        ["hash-object", "--no-filters", "--", path],
        filterOverrides.args,
      );
      if (!hash.ok) {
        contentBound = false;
        break;
      }
      untrackedHashes.push(`${path}\0${hash.stdout}`);
    }
  }
  if (!contentBound) {
    warnings.push(
      `Dirty-state content hash is incomplete for ${root}; final PASS needs a complete snapshot identity.`,
    );
  }
  const dirtyManifest = [
    `status\0${sha256(status.stdout)}`,
    `tracked\0${trackedDiff.ok ? sha256(trackedDiff.stdout) : "INCOMPLETE"}`,
    `untracked\0${untracked.ok ? sha256(untrackedHashes.sort().join("\n")) : "INCOMPLETE"}`,
  ].join("\n");
  return {
    root: gitRoot.stdout,
    branch: branch.ok ? branch.stdout : null,
    head: head.stdout,
    dirty: statusLines.length > 0,
    dirtyEntries: statusLines.length,
    untrackedEntries: statusLines.filter((line) => line.startsWith("??"))
      .length,
    dirtyManifestHash: sha256(dirtyManifest),
    contentBound,
  };
}

export function safeFilterConfigOverrides(root: string): {
  ok: boolean;
  args: string[];
} {
  const configuredFilters = runGitRaw(root, [
    "config",
    "--includes",
    "--name-only",
    "--null",
    "--get-regexp",
    "^filter\\.",
  ]);
  if (configuredFilters.status === 1) {
    return { ok: true, args: [] };
  }
  if (!configuredFilters.ok) {
    return { ok: false, args: [] };
  }

  const drivers = new Set<string>();
  for (const key of configuredFilters.stdout.split("\0").filter(Boolean)) {
    const match = /^filter\.(.+)\.(?:clean|process|required|smudge)$/iu.exec(
      key,
    );
    if (!match) {
      continue;
    }
    const driver = match[1]!;
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(driver)) {
      return { ok: false, args: [] };
    }
    drivers.add(driver);
  }

  return {
    ok: true,
    args: [...drivers]
      .sort((left, right) => left.localeCompare(right, "en"))
      .flatMap((driver) => [
        "-c",
        `filter.${driver}.clean=`,
        "-c",
        `filter.${driver}.smudge=`,
        "-c",
        `filter.${driver}.process=`,
        "-c",
        `filter.${driver}.required=false`,
      ]),
  };
}

function runGit(
  cwd: string,
  args: string[],
  configOverrides: readonly string[] = [],
): { ok: boolean; stdout: string } {
  const result = runGitRaw(cwd, args, configOverrides);
  return { ok: result.ok, stdout: result.stdout.trim() };
}

function runGitRaw(
  cwd: string,
  args: string[],
  configOverrides: readonly string[] = [],
): { ok: boolean; status: number | null; stdout: string } {
  const result = spawnSync(
    "git",
    ["--no-pager", ...SAFE_GIT_CONFIG_ARGS, ...configOverrides, ...args],
    {
      cwd,
      encoding: "utf8",
      env: safeGitEnvironment(),
      shell: false,
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
  };
}

function safeGitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("GIT_")) {
      delete environment[key];
    }
  }
  return {
    ...environment,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: GIT_NULL_DEVICE,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: GIT_NULL_DEVICE,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

export function loadAllowedRoots(
  errors: string[],
  capability = "Workspace access",
): string[] {
  const raw = process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON;
  if (!raw) {
    errors.push(
      `${capability} is disabled until ARBITER_FORGE_ALLOWED_ROOTS_JSON is configured. Pure forge and validation tools remain available.`,
    );
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every((entry) => typeof entry === "string")
    ) {
      throw new Error("expected a JSON array of absolute paths");
    }
    return uniqueSorted(
      parsed.map((entry) => {
        if (!isAbsolute(entry)) {
          throw new Error(`allowed root is not absolute: ${entry}`);
        }
        return realpathSync(entry);
      }),
    );
  } catch (error) {
    errors.push(formatError("ARBITER_FORGE_ALLOWED_ROOTS_JSON", error));
    return [];
  }
}

export function authorizePath(
  requestedPath: string,
  allowedRoots: string[],
  requireDirectory: boolean,
): string {
  if (!isAbsolute(requestedPath)) {
    throw new Error("path must be absolute");
  }
  const realPath = realpathSync(resolve(requestedPath));
  if (!isAuthorized(realPath, allowedRoots)) {
    throw new Error("path is outside configured allowed roots");
  }
  const stat = statSync(realPath);
  if (requireDirectory && !stat.isDirectory()) {
    throw new Error("path is not a directory");
  }
  return realPath;
}

function isAuthorized(candidate: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => isWithin(candidate, root));
}

export function isWithin(candidate: string, root: string): boolean {
  const child = relative(root, candidate);
  return (
    child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
  );
}

function assertSafeSource(path: string): void {
  const name = basename(path).toLowerCase();
  const segments = path.split(sep).map((segment) => segment.toLowerCase());
  const extension = /(?:\.[^.]+)$/u.exec(name)?.[0] ?? "";
  const hasDeniedConfigNamespace = segments.some(
    (segment, index) =>
      segment === ".config" &&
      DENIED_CONFIG_NAMESPACES.has(segments[index + 1] ?? ""),
  );
  if (
    DENIED_BASENAMES.has(name) ||
    name.startsWith(".envrc") ||
    name.startsWith(".env.") ||
    name.endsWith(".env") ||
    name.endsWith(".envrc") ||
    /\.(?:der|jks|key|keystore|p12|pfx|pem|pkcs12)$/iu.test(name) ||
    /^id_(?:dsa|ecdsa|ed25519|rsa)(?:\.pub)?$/iu.test(name) ||
    (SENSITIVE_DATA_EXTENSIONS.has(extension) &&
      SENSITIVE_DATA_NAME.test(name)) ||
    segments.some((segment) => DENIED_PATH_SEGMENTS.has(segment)) ||
    hasDeniedConfigNamespace
  ) {
    throw new Error("sensitive or dependency metadata path is denied");
  }
}

function existingPaths(
  root: string,
  relativePaths: readonly string[],
  allowedRoots: string[],
  warnings: string[],
): string[] {
  return relativePaths.filter((path) =>
    hasMetadataFile(join(root, path), allowedRoots, warnings),
  );
}

function hasMetadataFile(
  path: string,
  allowedRoots: string[],
  warnings: string[],
): boolean {
  return authorizeMetadataFile(path, allowedRoots, warnings) !== null;
}

function authorizeMetadataFile(
  path: string,
  allowedRoots: string[],
  warnings: string[],
): string | null {
  try {
    const realPath = realpathSync(path);
    if (!isAuthorized(realPath, allowedRoots)) {
      throw new Error("resolved outside configured allowed roots");
    }
    const stat = statSync(realPath);
    if (!stat.isFile()) {
      throw new Error("is not a regular file");
    }
    if (stat.size > 1_048_576) {
      throw new Error("exceeds the 1048576-byte metadata limit");
    }
    return realPath;
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    warnings.push(formatError(`metadata ${path}`, error));
    return null;
  }
}

function readJson(
  path: string,
  allowedRoots: string[],
  warnings: string[],
): Record<string, unknown> | null {
  const realPath = authorizeMetadataFile(path, allowedRoots, warnings);
  if (!realPath) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(realPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    warnings.push(`Unable to parse metadata JSON: ${path}`);
    return null;
  }
}

function detectPackageManager(
  root: string,
  allowedRoots: string[],
  warnings: string[],
): string | null {
  if (hasMetadataFile(join(root, "pnpm-lock.yaml"), allowedRoots, warnings))
    return "pnpm";
  if (hasMetadataFile(join(root, "yarn.lock"), allowedRoots, warnings))
    return "yarn";
  if (hasMetadataFile(join(root, "package-lock.json"), allowedRoots, warnings))
    return "npm";
  if (
    hasMetadataFile(join(root, "bun.lock"), allowedRoots, warnings) ||
    hasMetadataFile(join(root, "bun.lockb"), allowedRoots, warnings)
  )
    return "bun";
  return null;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function finalize(
  status: InspectWorkspaceResult["status"],
  allowedRoots: string[],
  workspaces: WorkspaceInspection[],
  sources: SourceInspection[],
  warnings: string[],
  errors: string[],
): InspectWorkspaceResult {
  const resultWithoutHash = {
    schemaVersion: "arbiter-forge/v1" as const,
    status,
    allowedRoots,
    workspaces,
    sources,
    warnings: uniqueSorted(warnings),
    errors: uniqueSorted(errors),
  };
  return {
    ...resultWithoutHash,
    contextHash: sha256(canonicalJson(resultWithoutHash)),
  };
}

function formatError(subject: string, error: unknown): string {
  return `${subject}: ${error instanceof Error ? error.message : String(error)}`;
}
