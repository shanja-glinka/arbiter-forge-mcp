import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skill = readFileSync(
  resolve(projectRoot, "skills/arbiter-forge/SKILL.md"),
  "utf8",
);

describe("creation handoff skill contract", () => {
  it("separates compilation, materialization, launch, and execution", () => {
    expect(skill).toContain(
      "Compiled and validated, but not saved and not launched",
    );
    expect(skill).toContain("Task bundle materialized, but not launched");
    expect(skill).toContain("materialize_task_bundle");
    expect(skill).toContain("must never be described");
    expect(skill).toContain(
      "Do not say that a Codex task/thread was launched unless the host actually started one",
    );
  });

  it("forbids every creation-time Forge operation during compiled execution", () => {
    const executionMode = skill.slice(
      skill.indexOf("## Detect creation versus execution"),
      skill.indexOf("## Core flow"),
    );
    expect(executionMode).toContain("inspect_workspace");
    expect(executionMode).toContain("forge_*");
    expect(executionMode).toContain("validate_task");
    expect(executionMode).toContain("materialize_task_bundle");
  });
});
