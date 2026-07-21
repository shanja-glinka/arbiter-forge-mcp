import {
  roleRouteAssignmentSchema,
  type BlindCheckRequest,
  type CapabilityProbe,
  type DocumentationRequest,
  type ForgeResult,
  type ImplementationRequest,
  type ReasoningEffort,
  type RiskProfile,
  type RoleRouteAssignment,
  type RoleRouteTarget,
  type RoutingPlanEntry,
  type RoutingRole,
  type RoutingStatus,
} from "./schemas.js";
import { canonicalJson, sha256, uniqueSorted } from "./stable.js";

type Operation = ForgeResult["operation"];
type ForgeRequest =
  ImplementationRequest | DocumentationRequest | BlindCheckRequest;
export interface RoutingDecision {
  plan: RoutingPlanEntry[];
  planHash: string;
  status: RoutingStatus;
  warnings: string[];
  errors: string[];
}

const ROLE_ORDER: RoutingRole[] = [
  "root_arbiter",
  "task_discovery",
  "implementation_analyst",
  "implementation_worker",
  "frontend_worker",
  "debugger",
  "test_runner",
  "playwright_operator",
  "acceptance_auditor",
  "code_quality_auditor",
  "blind_d1",
  "blind_d2",
  "blind_d3",
  "documentation_author",
  "cold_reader",
];

/** Build preferred routes only. The host still owns real agent launch and attestation. */
export function decideRoleRouting(
  operation: Operation,
  request: ForgeRequest,
  riskProfile: RiskProfile,
  requiredAudits: readonly string[],
): RoutingDecision {
  if (request.modelRouting === "omit") {
    const plan: RoutingPlanEntry[] = [];
    return {
      plan,
      planHash: sha256(canonicalJson(plan)),
      status: "omitted",
      warnings: [],
      errors: [],
    };
  }

  const defaults = defaultAssignments(
    operation,
    request,
    riskProfile,
    requiredAudits,
  );
  const applicableRoles = new Set(defaults.map((entry) => entry.role));
  const overrides = new Map(
    (request.roleRouting?.assignments ?? []).map((entry) => [
      entry.role,
      entry,
    ]),
  );
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const role of overrides.keys()) {
    if (!applicableRoles.has(role)) {
      errors.push(
        `Role route override ${role} is not applicable to this workflow and risk profile.`,
      );
    }
  }

  const assignments = defaults.map(
    (entry) => overrides.get(entry.role) ?? entry,
  );
  const plan = assignments.map((entry) => ({
    ...entry,
    candidates: entry.candidates.map((candidate) => ({
      ...candidate,
      availability: routeAvailability(candidate, request.capabilities),
    })),
  }));

  for (const entry of plan) {
    for (const comparedRole of [
      ...entry.preferDifferentModelFromRoles,
      ...entry.preferDifferentProviderFromRoles,
    ]) {
      if (!applicableRoles.has(comparedRole)) {
        errors.push(
          `Role route ${entry.role} references non-applicable diversity role ${comparedRole}.`,
        );
      }
    }
  }

  for (const entry of plan) {
    const availability = entry.candidates.map(
      (candidate) => candidate.availability,
    );
    const primary = availability[0];
    const firstAvailable = availability.indexOf("available");
    const allUnavailable = availability.every(
      (value) => value === "unavailable",
    );

    if (entry.onUnavailable === "block" && primary === "unavailable") {
      errors.push(
        `Required exact route for ${entry.role} is unavailable in the host route inventory.`,
      );
    } else if (entry.onUnavailable === "block" && primary === "unknown") {
      warnings.push(
        `Required exact route for ${entry.role} is not yet proven available; execution must fail closed if the runtime probe cannot select it.`,
      );
    } else if (allUnavailable) {
      errors.push(
        `No executable route for required role ${entry.role} is available in the complete host route inventory.`,
      );
    } else if (primary !== "available" && firstAvailable > 0) {
      warnings.push(
        `Preferred route for ${entry.role} is ${primary}; candidate ${firstAvailable + 1} is the first proven fallback.`,
      );
    } else if (firstAvailable < 0 && availability.includes("unknown")) {
      warnings.push(
        `No route for ${entry.role} is yet proven available; runtime capability probing is required before dispatch.`,
      );
    }
  }

  const workerPlan = plan.filter((entry) => entry.role !== "root_arbiter");
  const status = routingStatus(workerPlan, request.capabilities);
  return {
    plan,
    planHash: sha256(canonicalJson(plan)),
    status,
    warnings: uniqueSorted(warnings),
    errors: uniqueSorted(errors),
  };
}

function defaultAssignments(
  operation: Operation,
  request: ForgeRequest,
  riskProfile: RiskProfile,
  requiredAudits: readonly string[],
): RoleRouteAssignment[] {
  const assignments: RoleRouteAssignment[] = [
    route("root_arbiter", [
      root("openai", "gpt-5.6-sol", "high"),
      { execution: "root_session", reasoningEffort: "inherit" },
    ]),
  ];

  if (operation === "implementation_task") {
    const implementation = request as ImplementationRequest;
    const surfaces = new Set(
      implementation.implementationSurfaces ??
        (implementation.riskSignals.includes("browser_ui")
          ? ["backend_or_shared", "frontend"]
          : ["backend_or_shared"]),
    );
    const writerRoles: RoutingRole[] = [];

    if (surfaces.has("backend_or_shared")) {
      assignments.push(
        route("implementation_worker", [
          codex("gpt-5.6-terra", builderEffort(riskProfile)),
          codex("gpt-5.6-sol", riskProfile === "critical" ? "medium" : "low"),
          inherited(),
        ]),
      );
      writerRoles.push("implementation_worker");
    }

    if (surfaces.has("frontend")) {
      assignments.push(
        route("frontend_worker", [
          {
            execution: "codex_custom_agent",
            agentType: "arbiter-forge-ui-claude",
            reasoningEffort: "inherit",
          },
          codex("gpt-5.6-terra", "high"),
          codex("gpt-5.6-sol", "medium"),
          inherited(),
        ]),
      );
      writerRoles.push("frontend_worker");
    }

    assignments.push(
      route("test_runner", [
        codex("gpt-5.6-luna", "low"),
        codex("gpt-5.6-terra", "low"),
        inherited(),
      ]),
    );

    if (request.riskSignals.includes("browser_ui")) {
      assignments.push(
        route("playwright_operator", [
          codex("gpt-5.6-luna", "medium"),
          codex("gpt-5.6-terra", "medium"),
          inherited(),
        ]),
      );
    }

    if (requiredAudits.includes("testing_and_acceptance")) {
      assignments.push(
        route(
          "acceptance_auditor",
          [
            codex(
              "gpt-5.6-sol",
              riskProfile === "critical" ? "high" : "medium",
            ),
            codex("gpt-5.6-terra", "high"),
            inherited(),
          ],
          {
            preferDifferentModelFromRoles: writerRoles,
          },
        ),
      );
    }

    if (requiredAudits.includes("conventions_and_code_quality")) {
      assignments.push(
        route(
          "code_quality_auditor",
          [
            codex("gpt-5.6-sol", "high"),
            codex("gpt-5.6-terra", "high"),
            inherited(),
          ],
          { preferDifferentModelFromRoles: writerRoles },
        ),
      );
    }
  }

  if (operation === "documentation_task") {
    assignments.push(
      route("task_discovery", [
        codex("gpt-5.6-terra", "high"),
        codex("gpt-5.6-sol", "medium"),
        inherited(),
      ]),
    );
    if (
      (request as DocumentationRequest).documentationBasis === "current_aware"
    ) {
      assignments.push(
        route("implementation_analyst", [
          codex("gpt-5.6-terra", "high"),
          codex("gpt-5.6-sol", "medium"),
          inherited(),
        ]),
      );
    }
    assignments.push(
      route("documentation_author", [
        codex("gpt-5.6-terra", riskProfile === "critical" ? "high" : "medium"),
        codex("gpt-5.6-sol", "medium"),
        inherited(),
      ]),
    );
    if (requiredAudits.includes("cold_reader")) {
      assignments.push(
        route(
          "cold_reader",
          [
            codex("gpt-5.6-sol", "medium"),
            codex("gpt-5.6-terra", "high"),
            inherited(),
          ],
          { preferDifferentModelFromRoles: ["documentation_author"] },
        ),
      );
    }
  }

  if (
    operation === "blind_check_task" ||
    requiredAudits.includes("documentation_blind_check")
  ) {
    assignments.push(
      route("blind_d1", [
        codex("gpt-5.6-terra", "high"),
        codex("gpt-5.6-sol", "medium"),
        inherited(),
      ]),
      route("blind_d2", [
        codex("gpt-5.6-terra", "high"),
        codex("gpt-5.6-sol", "medium"),
        inherited(),
      ]),
      route(
        "blind_d3",
        [
          codex("gpt-5.6-sol", "high"),
          codex("gpt-5.6-terra", "high"),
          inherited(),
        ],
        { preferDifferentModelFromRoles: ["blind_d2"] },
      ),
    );
  }

  return assignments.sort(
    (left, right) =>
      ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role),
  );
}

function route(
  role: RoutingRole,
  candidates: RoleRouteTarget[],
  options: Partial<
    Pick<
      RoleRouteAssignment,
      | "onUnavailable"
      | "diversityMode"
      | "preferDifferentModelFromRoles"
      | "preferDifferentProviderFromRoles"
    >
  > = {},
): RoleRouteAssignment {
  return roleRouteAssignmentSchema.parse({ role, candidates, ...options });
}

function codex(
  model: string,
  reasoningEffort: ReasoningEffort,
): RoleRouteTarget {
  return {
    execution: "codex_subagent",
    provider: "openai",
    model,
    reasoningEffort,
  };
}

function root(
  provider: string,
  model: string,
  reasoningEffort: ReasoningEffort,
): RoleRouteTarget {
  return {
    execution: "root_session",
    provider,
    model,
    reasoningEffort,
  };
}

function inherited(): RoleRouteTarget {
  return {
    execution: "inherited_subagent",
    reasoningEffort: "inherit",
  };
}

function builderEffort(profile: RiskProfile): ReasoningEffort {
  return profile === "compact"
    ? "low"
    : profile === "standard"
      ? "medium"
      : "high";
}

function routeAvailability(
  target: RoleRouteTarget,
  capabilities: CapabilityProbe | undefined,
): "available" | "unavailable" | "unknown" {
  if (target.execution === "root_session") {
    if (
      !target.provider &&
      !target.model &&
      target.reasoningEffort === "inherit"
    ) {
      return "available";
    }
    if (!capabilities?.currentRootRoute) return "unknown";
    const current = capabilities.currentRootRoute;
    return (target.provider === undefined ||
      target.provider === current.provider) &&
      (target.model === undefined || target.model === current.model) &&
      (target.reasoningEffort === "inherit" ||
        target.reasoningEffort === current.reasoningEffort)
      ? "available"
      : "unavailable";
  }
  if (!capabilities) return "unknown";

  if (target.execution === "inherited_subagent") {
    return capabilities.agentIsolation === "supported"
      ? "available"
      : capabilities.agentIsolation === "unsupported"
        ? "unavailable"
        : "unknown";
  }

  if (target.execution === "codex_custom_agent") {
    if (capabilities.agentIsolation === "unsupported") return "unavailable";
    if (capabilities.agentIsolation === "unknown") return "unknown";
    if (capabilities.availableAgentTypes?.includes(target.agentType!)) {
      return "available";
    }
    return capabilities.routeInventoryComplete ? "unavailable" : "unknown";
  }

  if (target.execution === "external_adapter") {
    if (capabilities.availableExternalAdapters?.includes(target.adapter!)) {
      return "available";
    }
    return capabilities.routeInventoryComplete ? "unavailable" : "unknown";
  }

  if (capabilities.agentIsolation === "unsupported") return "unavailable";
  if (capabilities.modelSelection === "unsupported") return "unavailable";
  if (
    capabilities.agentIsolation !== "supported" ||
    capabilities.modelSelection !== "supported"
  ) {
    return "unknown";
  }

  const match = capabilities.availableModels?.find(
    (candidate) =>
      candidate.model === target.model &&
      (target.provider === undefined || candidate.provider === target.provider),
  );
  if (match) {
    if (target.reasoningEffort === "inherit") {
      return "available";
    }
    if (!match.reasoningEfforts) return "unknown";
    if (match.reasoningEfforts.includes(target.reasoningEffort)) {
      return "available";
    }
    return "unavailable";
  }
  return capabilities.routeInventoryComplete ? "unavailable" : "unknown";
}

function routingStatus(
  plan: RoutingPlanEntry[],
  capabilities: CapabilityProbe | undefined,
): RoutingStatus {
  if (plan.length === 0) return "unknown";
  if (!capabilities) return "unknown";

  let degraded = false;
  for (const entry of plan) {
    const availability = entry.candidates.map(
      (candidate) => candidate.availability,
    );
    if (availability[0] === "available") continue;
    if (availability.indexOf("available") > 0) {
      degraded = true;
      continue;
    }
    if (availability.includes("unknown")) return "unknown";
    degraded = true;
  }
  return degraded ? "degraded" : "selectable";
}
