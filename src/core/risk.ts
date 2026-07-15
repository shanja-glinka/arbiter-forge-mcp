import type { CapabilityProbe, RiskProfile, RiskSignal } from "./schemas.js";

const CRITICAL_SIGNALS = new Set<RiskSignal>([
  "cross_service_flow",
  "security",
  "tenant_isolation",
  "money_or_pricing",
  "destructive_change",
  "kafka_or_realtime",
  "production_mutation",
  "strict_visual_parity",
]);

const STANDARD_SIGNALS = new Set<RiskSignal>([
  "browser_ui",
  "graphql_client",
  "api_contract",
  "persistence",
  "migration",
  "multi_repository",
  "canonical_docs_material",
]);

const PROFILE_RANK: Record<RiskProfile, number> = {
  compact: 0,
  standard: 1,
  critical: 2,
};

export interface RiskDecision {
  profile: RiskProfile;
  reasons: string[];
}

export function classifyRisk(
  signals: readonly RiskSignal[],
  minimumProfile: RiskProfile,
): RiskDecision {
  const uniqueSignals = [...new Set(signals)].sort();
  let inferred: RiskProfile = "compact";

  if (uniqueSignals.some((signal) => CRITICAL_SIGNALS.has(signal))) {
    inferred = "critical";
  } else if (uniqueSignals.some((signal) => STANDARD_SIGNALS.has(signal))) {
    inferred = "standard";
  }

  const profile =
    PROFILE_RANK[minimumProfile] > PROFILE_RANK[inferred]
      ? minimumProfile
      : inferred;
  const reasons = uniqueSignals.map((signal) => `risk signal: ${signal}`);

  if (PROFILE_RANK[minimumProfile] > PROFILE_RANK[inferred]) {
    reasons.push(`minimum profile elevated ${inferred} to ${minimumProfile}`);
  }

  if (reasons.length === 0) {
    reasons.push(
      "no material risk signal requires more than a compact topology",
    );
  }

  return { profile, reasons };
}

export function routingStatus(
  modelRouting: "adaptive" | "omit",
  capabilities: CapabilityProbe | undefined,
): "selectable" | "degraded" | "unknown" | "omitted" {
  if (modelRouting === "omit") {
    return "omitted";
  }

  if (!capabilities || capabilities.modelSelection === "unknown") {
    return "unknown";
  }

  return capabilities.modelSelection === "supported"
    ? "selectable"
    : "degraded";
}
