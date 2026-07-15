import { readFileSync, realpathSync, statSync } from "node:fs";
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
  ".ini",
  ".json",
  ".properties",
  ".toml",
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
  const allowedRoots = loadAllowedRoots(errors);

  if (allowedRoots.length === 0) {
    return finalize("denied", [], [], [], warnings, errors);
  }

  const workspaces: WorkspaceInspection[] = [];
  for (const requestedRoot of [...input.workspaceRoots].sort()) {
    try {
      const realRoot = authorizePath(requestedRoot, allowedRoots, true);
      workspaces.push(inspectOneWorkspace(requestedRoot, realRoot, warnings));
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
    errors.length === 0
      ? "ready"
      : workspaces.length > 0 || sources.length > 0
        ? "partial"
        : "denied";
  return finalize(status, allowedRoots, workspaces, sources, warnings, errors);
}

function inspectOneWorkspace(
  requestedRoot: string,
  realRoot: string,
  warnings: string[],
): WorkspaceInspection {
  const packageJsonPath = join(realRoot, "package.json");
  const packageJson = readJson(packageJsonPath, warnings);
  const packageScripts =
    packageJson &&
    typeof packageJson.scripts === "object" &&
    packageJson.scripts
      ? Object.keys(packageJson.scripts as Record<string, unknown>).sort()
      : [];
  const packageManager =
    packageJson && typeof packageJson.packageManager === "string"
      ? packageJson.packageManager
      : detectPackageManager(realRoot);

  return {
    requestedRoot,
    realRoot,
    git: inspectGit(realRoot, warnings),
    rules: existingPaths(realRoot, KNOWN_RULE_PATHS),
    planning: existingPaths(realRoot, KNOWN_PLANNING_PATHS),
    detected: {
      packageManager,
      monorepo:
        exists(join(realRoot, "pnpm-workspace.yaml")) ||
        exists(join(realRoot, "lerna.json")) ||
        Boolean(
          packageJson &&
          ("workspaces" in packageJson || "packages" in packageJson),
        ),
      playwright:
        PLAYWRIGHT_CONFIGS.some((path) => exists(join(realRoot, path))) ||
        packageScripts.some((script) =>
          script.toLowerCase().includes("playwright"),
        ),
      graphql:
        GRAPHQL_MARKERS.some((path) => exists(join(realRoot, path))) ||
        packageScripts.some((script) =>
          /graphql|codegen|supergraph/iu.test(script),
        ),
    },
    packageScripts,
  };
}

function inspectGit(root: string, warnings: string[]): GitSnapshot | null {
  const gitRoot = runGit(root, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot.ok) {
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
    ["status", "--porcelain=v1", "--untracked-files=all"],
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
    ["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"],
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

function safeFilterConfigOverrides(root: string): {
  ok: boolean;
  args: string[];
} {
  const configuredFilters = runGitRaw(root, [
    "config",
    "--local",
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

function loadAllowedRoots(errors: string[]): string[] {
  const raw = process.env.ARBITER_FORGE_ALLOWED_ROOTS_JSON;
  if (!raw) {
    errors.push(
      "Workspace inspection is disabled until ARBITER_FORGE_ALLOWED_ROOTS_JSON is configured. Pure forge and validation tools remain available.",
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

function authorizePath(
  requestedPath: string,
  allowedRoots: string[],
  requireDirectory: boolean,
): string {
  if (!isAbsolute(requestedPath)) {
    throw new Error("path must be absolute");
  }
  const realPath = realpathSync(resolve(requestedPath));
  const authorized = allowedRoots.some((root) => isWithin(realPath, root));
  if (!authorized) {
    throw new Error("path is outside configured allowed roots");
  }
  const stat = statSync(realPath);
  if (requireDirectory && !stat.isDirectory()) {
    throw new Error("path is not a directory");
  }
  return realPath;
}

function isWithin(candidate: string, root: string): boolean {
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
    name.startsWith(".env.") ||
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
): string[] {
  return relativePaths.filter((path) => exists(join(root, path)));
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function readJson(
  path: string,
  warnings: string[],
): Record<string, unknown> | null {
  if (!exists(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    warnings.push(`Unable to parse metadata JSON: ${path}`);
    return null;
  }
}

function detectPackageManager(root: string): string | null {
  if (exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(join(root, "yarn.lock"))) return "yarn";
  if (exists(join(root, "package-lock.json"))) return "npm";
  if (exists(join(root, "bun.lock")) || exists(join(root, "bun.lockb")))
    return "bun";
  return null;
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
