import { describe, expect, it } from "vitest";

import { compileImplementationTask } from "../../src/core/render.js";
import {
  type CapabilityProbe,
  implementationRequestSchema,
} from "../../src/core/schemas.js";

describe("role-oriented model routing", () => {
  it("keeps Compact routing small and cost-oriented", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Rename one internal helper safely.",
      }),
    );

    expect(result.decisions.routingPlan.map((entry) => entry.role)).toEqual([
      "root_arbiter",
      "implementation_worker",
      "test_runner",
    ]);
    expect(result.decisions.routingPlan[1]!.candidates[0]).toMatchObject({
      execution: "codex_subagent",
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    });
    expect(result.prompt.text).not.toContain("| task_discovery |");
    expect(result.prompt.text).toContain('fork_turns="none"');
    expect(result.prompt.text).toContain(
      `routing_plan_hash=${result.decisions.routingPlanHash}`,
    );
  });

  it("routes UI implementation, testing, and audits to separate optimized lanes", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a tenant-scoped visual pricing editor.",
        riskSignals: ["browser_ui", "tenant_isolation", "money_or_pricing"],
      }),
    );
    const byRole = new Map(
      result.decisions.routingPlan.map((entry) => [entry.role, entry]),
    );

    expect(result.decisions.riskProfile).toBe("critical");
    expect(byRole.has("task_discovery")).toBe(false);
    expect(byRole.has("implementation_analyst")).toBe(false);
    expect(byRole.has("debugger")).toBe(false);
    expect(byRole.get("implementation_worker")?.candidates[0]).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
    expect(byRole.get("frontend_worker")?.candidates.slice(0, 2)).toEqual([
      expect.objectContaining({
        execution: "codex_custom_agent",
        agentType: "arbiter-forge-ui-claude",
      }),
      expect.objectContaining({
        execution: "codex_subagent",
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
      }),
    ]);
    expect(byRole.get("test_runner")?.candidates[0]).toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    expect(byRole.get("acceptance_auditor")?.candidates[0]).toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    expect(
      byRole.get("acceptance_auditor")?.preferDifferentModelFromRoles,
    ).toEqual(["implementation_worker", "frontend_worker"]);
  });

  it("omits the generic writer for an explicit frontend-only implementation", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective:
          "Refine an existing responsive editor without backend changes.",
        riskSignals: ["browser_ui"],
        implementationSurfaces: ["frontend"],
      }),
    );
    const roles = result.decisions.routingPlan.map((entry) => entry.role);

    expect(roles).not.toContain("implementation_worker");
    expect(roles).toContain("frontend_worker");
    expect(roles).toContain("playwright_operator");
  });

  it("accepts an operator Claude adapter and reports it as selectable only when observed", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a responsive account dashboard.",
        riskSignals: ["browser_ui", "api_contract"],
        capabilities: completeCapabilities({
          availableExternalAdapters: ["claude-code"],
        }),
        roleRouting: {
          assignments: [
            {
              role: "frontend_worker",
              candidates: [
                {
                  execution: "external_adapter",
                  adapter: "claude-code",
                  reasoningEffort: "inherit",
                },
                {
                  provider: "openai",
                  model: "gpt-5.6-terra",
                  reasoningEffort: "high",
                },
              ],
              onUnavailable: "fallback",
            },
          ],
        },
      }),
    );
    const frontend = result.decisions.routingPlan.find(
      (entry) => entry.role === "frontend_worker",
    );

    expect(result.status).toBe("ready");
    expect(result.decisions.routingStatus).toBe("selectable");
    expect(frontend?.candidates[0]).toMatchObject({
      execution: "external_adapter",
      adapter: "claude-code",
      availability: "available",
    });
    expect(result.prompt.text).toContain(
      "external executor with its own timeout, worktree, artifact, and attestation contract",
    );
  });

  it("falls back honestly when the preferred Claude adapter is absent", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a responsive account dashboard.",
        riskSignals: ["browser_ui", "api_contract"],
        capabilities: completeCapabilities(),
        roleRouting: {
          assignments: [
            {
              role: "frontend_worker",
              candidates: [
                {
                  execution: "external_adapter",
                  adapter: "claude-code",
                  reasoningEffort: "inherit",
                },
                {
                  provider: "openai",
                  model: "gpt-5.6-terra",
                  reasoningEffort: "high",
                },
              ],
            },
          ],
        },
      }),
    );
    const frontend = result.decisions.routingPlan.find(
      (entry) => entry.role === "frontend_worker",
    );

    expect(result.status).toBe("ready");
    expect(result.decisions.routingStatus).toBe("degraded");
    expect(
      frontend?.candidates.map((candidate) => candidate.availability),
    ).toEqual(["unavailable", "available"]);
    expect(result.decisions.warnings).toContain(
      "Preferred route for frontend_worker is unavailable; candidate 2 is the first proven fallback.",
    );
  });

  it("uses a proven fallback when the preferred route inventory is incomplete", () => {
    const capabilities = completeCapabilities();
    capabilities.routeInventoryComplete = false;
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a responsive account dashboard.",
        riskSignals: ["browser_ui", "api_contract"],
        capabilities,
      }),
    );

    expect(result.decisions.routingStatus).toBe("degraded");
    expect(result.decisions.warnings).toContain(
      "Preferred route for frontend_worker is unknown; candidate 2 is the first proven fallback.",
    );
  });

  it("does not claim a direct model route when model selection is unsupported", () => {
    const capabilities = completeCapabilities();
    capabilities.modelSelection = "unsupported";
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a small internal change.",
        capabilities,
      }),
    );
    const worker = result.decisions.routingPlan.find(
      (entry) => entry.role === "implementation_worker",
    );

    expect(result.status).toBe("ready");
    expect(result.decisions.routingStatus).toBe("degraded");
    expect(
      worker?.candidates.map((candidate) => candidate.availability),
    ).toEqual(["unavailable", "unavailable", "available"]);
  });

  it("does not claim a configured custom agent when child isolation is unsupported", () => {
    const capabilities = completeCapabilities();
    capabilities.agentIsolation = "unsupported";
    capabilities.availableAgentTypes = ["arbiter-forge-ui-claude"];
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a responsive account dashboard.",
        riskSignals: ["browser_ui", "api_contract"],
        capabilities,
      }),
    );
    const frontend = result.decisions.routingPlan.find(
      (entry) => entry.role === "frontend_worker",
    );

    expect(result.status).toBe("invalid");
    expect(frontend?.candidates[0]?.availability).toBe("unavailable");
    expect(result.validation.blockingErrors).toContain(
      "No executable route for required role frontend_worker is available in the complete host route inventory.",
    );
  });

  it("fails closed when an operator-required route is proven unavailable", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a provider-pinned internal change.",
        capabilities: completeCapabilities(),
        roleRouting: {
          assignments: [
            {
              role: "implementation_worker",
              candidates: [
                {
                  execution: "external_adapter",
                  adapter: "required-builder",
                  reasoningEffort: "inherit",
                },
              ],
              onUnavailable: "block",
            },
          ],
        },
      }),
    );

    expect(result.status).toBe("invalid");
    expect(result.validation.blockingErrors).toContain(
      "Required exact route for implementation_worker is unavailable in the host route inventory.",
    );
  });

  it("rejects fallback candidates on an exact blocking route", () => {
    expect(() =>
      implementationRequestSchema.parse({
        objective: "Use exactly one required implementation route.",
        roleRouting: {
          assignments: [
            {
              role: "implementation_worker",
              onUnavailable: "block",
              candidates: [
                {
                  provider: "openai",
                  model: "required-model",
                  reasoningEffort: "medium",
                },
                {
                  provider: "openai",
                  model: "fallback-model",
                  reasoningEffort: "medium",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/exact-route contract/u);
  });

  it("rejects contradictory omitted routing with explicit role assignments", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Make a small change without model routing.",
        modelRouting: "omit",
        roleRouting: {
          assignments: [
            {
              role: "implementation_worker",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-terra",
                  reasoningEffort: "low",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(result.status).toBe("invalid");
    expect(result.validation.blockingErrors).toContain(
      "roleRouting cannot be supplied when modelRouting is omit",
    );
    expect(result.prompt.text).not.toContain("## Model routing contract");
  });

  it("keeps the root arbiter in the existing root session", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a small internal change.",
        roleRouting: {
          assignments: [
            {
              role: "root_arbiter",
              candidates: [
                {
                  execution: "codex_subagent",
                  provider: "openai",
                  model: "gpt-5.6-terra",
                  reasoningEffort: "low",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(result.status).toBe("invalid");
    expect(result.validation.blockingErrors).toContain(
      "roleRouting root_arbiter may describe only the existing root_session",
    );
  });

  it("rejects overrides for roles outside the compiled workflow", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Rename one helper.",
        roleRouting: {
          assignments: [
            {
              role: "code_quality_auditor",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-sol",
                  reasoningEffort: "high",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(result.status).toBe("invalid");
    expect(result.validation.blockingErrors).toContain(
      "Role route override code_quality_auditor is not applicable to this workflow and risk profile.",
    );
  });

  it("renders operator-required model diversity as a runtime blocking gate", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement and independently audit an API contract.",
        riskSignals: ["api_contract"],
        roleRouting: {
          assignments: [
            {
              role: "code_quality_auditor",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-sol",
                  reasoningEffort: "high",
                },
              ],
              diversityMode: "require",
              preferDifferentModelFromRoles: ["implementation_worker"],
            },
          ],
        },
      }),
    );

    expect(result.status).toBe("ready");
    expect(result.prompt.text).toContain(
      "require: prefer model != implementation_worker",
    );
    expect(result.prompt.text).toContain(
      "a `require` diversity rule blocks when no distinct route can be proven",
    );
  });

  it("rejects diversity comparisons against roles outside the workflow", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Rename one helper with an independent verifier.",
        roleRouting: {
          assignments: [
            {
              role: "implementation_worker",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-terra",
                  reasoningEffort: "low",
                },
              ],
              diversityMode: "require",
              preferDifferentModelFromRoles: ["frontend_worker"],
            },
          ],
        },
      }),
    );

    expect(result.status).toBe("invalid");
    expect(result.validation.blockingErrors).toContain(
      "Role route implementation_worker references non-applicable diversity role frontend_worker.",
    );
  });

  it("normalizes assignment, inventory, and diversity order deterministically", () => {
    const base = {
      objective: "Implement and verify a browser workflow.",
      riskSignals: ["browser_ui", "api_contract"] as const,
    };
    const first = compileImplementationTask(
      implementationRequestSchema.parse({
        ...base,
        capabilities: completeCapabilities({
          availableExternalAdapters: ["z-adapter", "a-adapter"],
        }),
        roleRouting: {
          assignments: [
            {
              role: "acceptance_auditor",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-sol",
                  reasoningEffort: "medium",
                },
              ],
              preferDifferentModelFromRoles: [
                "frontend_worker",
                "implementation_worker",
              ],
            },
            {
              role: "frontend_worker",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-terra",
                  reasoningEffort: "high",
                },
              ],
            },
          ],
        },
      }),
    );
    const secondCapabilities = completeCapabilities({
      availableExternalAdapters: ["a-adapter", "z-adapter"],
    });
    secondCapabilities.availableModels.reverse();
    const second = compileImplementationTask(
      implementationRequestSchema.parse({
        ...base,
        capabilities: secondCapabilities,
        roleRouting: {
          assignments: [
            {
              role: "frontend_worker",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-terra",
                  reasoningEffort: "high",
                },
              ],
            },
            {
              role: "acceptance_auditor",
              candidates: [
                {
                  provider: "openai",
                  model: "gpt-5.6-sol",
                  reasoningEffort: "medium",
                },
              ],
              preferDifferentModelFromRoles: [
                "implementation_worker",
                "frontend_worker",
              ],
            },
          ],
        },
      }),
    );

    expect(first.requestFingerprint).toBe(second.requestFingerprint);
    expect(first.decisions.routingPlanHash).toBe(
      second.decisions.routingPlanHash,
    );
    expect(first.prompt.sha256).toBe(second.prompt.sha256);
  });

  it("rejects duplicate model identities in a capability inventory", () => {
    const capabilities = completeCapabilities();
    capabilities.availableModels.push({ ...capabilities.availableModels[1]! });
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement a small internal change.",
        capabilities,
      }),
    );

    expect(result.status).toBe("invalid");
    expect(result.validation.blockingErrors).toContain(
      "capabilities contains duplicate model route: openai/gpt-5.6-terra",
    );
  });
});

function completeCapabilities(
  overrides: Partial<{
    availableExternalAdapters: string[];
  }> = {},
): CapabilityProbe & {
  routeInventoryComplete: boolean;
  availableModels: NonNullable<CapabilityProbe["availableModels"]>;
  availableAgentTypes: string[];
  availableExternalAdapters: string[];
} {
  return {
    agentIsolation: "supported" as const,
    modelSelection: "supported" as const,
    physicalWorktrees: "supported" as const,
    goalTool: "supported" as const,
    playwrightHarness: "available" as const,
    routeInventoryComplete: true,
    availableModels: [
      {
        provider: "openai",
        model: "gpt-5.6-sol",
        reasoningEfforts: ["low", "medium", "high"] as const,
      },
      {
        provider: "openai",
        model: "gpt-5.6-terra",
        reasoningEfforts: ["low", "medium", "high", "xhigh"] as const,
      },
      {
        provider: "openai",
        model: "gpt-5.6-luna",
        reasoningEfforts: ["low", "medium"] as const,
      },
    ],
    availableAgentTypes: [],
    availableExternalAdapters: overrides.availableExternalAdapters ?? [],
  };
}
