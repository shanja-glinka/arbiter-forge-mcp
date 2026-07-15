import { describe, expect, it } from "vitest";

import {
  compileBlindCheckTask,
  compileDocumentationTask,
  compileImplementationTask,
} from "../../src/core/render.js";
import {
  blindCheckRequestSchema,
  documentationRequestSchema,
  implementationRequestSchema,
} from "../../src/core/schemas.js";

describe("task compilers", () => {
  it("forges the smallest compact implementation topology by default", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Rename one internal helper safely.",
      }),
    );

    expect({
      status: result.status,
      profile: result.decisions.riskProfile,
      audits: result.decisions.requiredAudits,
      goal: result.decisions.goalMode,
    }).toEqual({
      status: "ready",
      profile: "compact",
      audits: ["independent_targeted_verifier"],
      goal: "plain",
    });
    expect(result.prompt.text).toContain("hard arbiter and orchestrator");
    expect(result.prompt.text).not.toContain("/goal");
    expect(result.validation.blockingErrors).toEqual([]);
  });

  it("escalates tenant/pricing UI work and renders Playwright plus GraphQL proof", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Add a tenant-scoped pricing editor backed by GraphQL.",
        riskSignals: [
          "browser_ui",
          "graphql_client",
          "tenant_isolation",
          "money_or_pricing",
        ],
        capabilities: {
          agentIsolation: "supported",
          modelSelection: "supported",
          physicalWorktrees: "supported",
          goalTool: "supported",
          playwrightHarness: "available",
        },
      }),
    );

    expect(result.status).toBe("ready");
    expect(result.decisions.riskProfile).toBe("critical");
    expect(result.decisions.requiredAudits).toEqual([
      "conventions_and_code_quality",
      "testing_and_acceptance",
    ]);
    expect(result.prompt.text).toContain("Playwright");
    expect(result.prompt.text).toContain("GraphQL `errors`");
    expect(result.prompt.text).toContain("authoritative readback");
    expect(result.prompt.text).toContain("no-retry");
  });

  it("adds strict blind-check audit only when canonical documentation is material", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective:
          "Implement a cross-service contract from canonical documentation.",
        riskSignals: ["cross_service_flow", "canonical_docs_material"],
      }),
    );

    expect(result.decisions.riskProfile).toBe("critical");
    expect(result.decisions.requiredAudits).toContain(
      "documentation_blind_check",
    );
    expect(result.prompt.text).toContain("extra_or_forbidden_behavior");
  });

  it("uses exactly one leading goal command only when explicitly requested", () => {
    const result = compileImplementationTask(
      implementationRequestSchema.parse({
        objective: "Implement the accepted contract.",
        goalMode: "persistent_requested",
      }),
    );

    expect(
      result.prompt.text.startsWith("/goal Implement the accepted contract."),
    ).toBe(true);
    expect(result.prompt.text.match(/(^|\n)\/goal\s+/gu)).toHaveLength(1);
    expect(result.status).toBe("ready");
  });

  it("is byte-deterministic after semantic array normalization", () => {
    const first = implementationRequestSchema.parse({
      objective: "Implement two deterministic requirements.",
      riskSignals: ["persistence", "api_contract"],
      nonGoals: ["No deploy", "No UI"],
      sources: [
        {
          id: "b",
          kind: "canonical_documentation",
          content: "B",
          authority: "canonical",
        },
        { id: "a", kind: "task", content: "A", authority: "canonical" },
      ],
      requirements: [
        { id: "REQ-B", claim: "Second", order: 2 },
        { id: "REQ-A", claim: "First", order: 1 },
      ],
    });
    const second = implementationRequestSchema.parse({
      objective: "Implement two deterministic requirements.",
      riskSignals: ["api_contract", "persistence"],
      nonGoals: ["No UI", "No deploy"],
      sources: [
        { id: "a", kind: "task", content: "A", authority: "canonical" },
        {
          id: "b",
          kind: "canonical_documentation",
          content: "B",
          authority: "canonical",
        },
      ],
      requirements: [
        { id: "REQ-A", claim: "First", order: 1 },
        { id: "REQ-B", claim: "Second", order: 2 },
      ],
    });

    const firstResult = compileImplementationTask(first);
    const secondResult = compileImplementationTask(second);
    expect(firstResult.requestFingerprint).toBe(
      secondResult.requestFingerprint,
    );
    expect(firstResult.prompt.sha256).toBe(secondResult.prompt.sha256);
    expect(firstResult.prompt.text).toBe(secondResult.prompt.text);
  });

  it("creates a mixed documentation synthesis with independent discovery and post-draft blind check", () => {
    const result = compileDocumentationTask(
      documentationRequestSchema.parse({
        objective: "Document current behavior and a planned replacement.",
        targetState: "mixed",
        riskSignals: ["canonical_docs_material", "cross_service_flow"],
        sources: [
          {
            id: "intent",
            kind: "task",
            content: "Desired behavior",
            authority: "canonical",
          },
          {
            id: "code",
            kind: "implementation",
            path: "/tmp/project/src/service.ts",
            authority: "context",
          },
          {
            id: "rules",
            kind: "governance",
            path: "/tmp/project/AGENTS.md",
            authority: "canonical",
          },
        ],
        deliverables: [
          { id: "spec", kind: "architecture_spec", outputPath: "docs/spec.md" },
          {
            id: "task",
            kind: "implementation_task",
            outputPath: "docs/task.md",
          },
        ],
        discoveryPartitions: {
          intentSourceIds: ["intent"],
          implementationSourceIds: ["code"],
          governanceSourceIds: ["rules"],
        },
      }),
    );

    expect(result.status).toBe("ready");
    expect(result.decisions.requiredAudits).toEqual([
      "cold_reader",
      "documentation_blind_check",
      "feasibility_and_ownership",
      "source_fidelity",
    ]);
    expect(result.prompt.text).toContain("I1 intent analyst");
    expect(result.prompt.text).toContain("I2 implementation archaeologist");
    expect(result.prompt.text).toContain("decision_required");
    expect(result.prompt.text).toContain("extra_or_forbidden_behavior");
  });

  it("keeps a to-be documentation gap explicit without requiring current-code parity", () => {
    const result = compileDocumentationTask(
      documentationRequestSchema.parse({
        objective: "Design a new event contract.",
        targetState: "to_be",
        sources: [
          {
            id: "intent",
            kind: "task",
            content: "New contract",
            authority: "canonical",
          },
        ],
        deliverables: [
          { id: "spec", kind: "integration_spec", outputPath: "docs/spec.md" },
        ],
        discoveryPartitions: {
          intentSourceIds: ["intent"],
          implementationSourceIds: [],
          governanceSourceIds: [],
        },
      }),
    );

    expect(result.status).toBe("ready");
    expect(result.decisions.requiredAudits).not.toContain(
      "documentation_blind_check",
    );
    expect(result.validation.missingMaterialInputs).toEqual([]);
  });

  it("forges strict D1/D2/D3 isolation and forbidden-extra classification", () => {
    const result = compileBlindCheckTask(
      blindCheckRequestSchema.parse({
        objective:
          "Detect drift between the canonical service spec and implementation.",
        sources: [
          {
            id: "docs",
            kind: "canonical_documentation",
            path: "/tmp/project/docs/spec.md",
            authority: "canonical",
          },
          {
            id: "code",
            kind: "implementation",
            path: "/tmp/project/src",
            authority: "context",
          },
        ],
        documentationSourceIds: ["docs"],
        implementationSourceIds: ["code"],
        canonicalRequirementIds: ["REQ-1"],
        comparisonDimensions: ["behavior", "ownership", "analytics"],
      }),
    );

    expect(result.status).toBe("ready");
    expect(result.prompt.text).toContain("D1");
    expect(result.prompt.text).toContain("D2");
    expect(result.prompt.text).toContain("D3");
    expect(result.prompt.text).toContain("extra_or_forbidden_behavior");
    expect(result.prompt.text).toContain("independent_documentation_review");
  });
});
