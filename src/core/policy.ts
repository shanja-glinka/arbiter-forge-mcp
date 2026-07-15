import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, withSingleTrailingNewline } from "./stable.js";

export type PolicyName =
  | "orchestration"
  | "documentation-synthesis"
  | "blind-check"
  | "ui-playwright"
  | "model-goal";

const POLICY_NAMES: readonly PolicyName[] = [
  "orchestration",
  "documentation-synthesis",
  "blind-check",
  "ui-playwright",
  "model-goal",
];

let projectRootCache: string | undefined;
const policyCache = new Map<PolicyName, string>();

export function projectRoot(): string {
  if (projectRootCache) {
    return projectRootCache;
  }

  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const packageJson = JSON.parse(
        readFileSync(join(current, "package.json"), "utf8"),
      ) as {
        name?: string;
      };
      if (packageJson.name === "arbiter-forge-mcp") {
        projectRootCache = current;
        return current;
      }
    } catch {
      // Keep walking toward the package root.
    }
    current = dirname(current);
  }

  throw new Error("Unable to locate the arbiter-forge-mcp package root.");
}

export function readPolicy(name: PolicyName): string {
  const cached = policyCache.get(name);
  if (cached) {
    return cached;
  }

  const path = join(
    projectRoot(),
    "skills",
    "arbiter-forge",
    "references",
    `${name}.md`,
  );
  const content = withSingleTrailingNewline(readFileSync(path, "utf8"));
  policyCache.set(name, content);
  return content;
}

export function combinedPolicyHash(names: readonly PolicyName[]): string {
  const selected = [...new Set(names)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  return sha256(
    selected.map((name) => `${name}\n${readPolicy(name)}`).join("\n"),
  );
}

export function allPolicyNames(): readonly PolicyName[] {
  return POLICY_NAMES;
}
