import { z } from "zod/v4";

export const SCHEMA_VERSION = "arbiter-forge/v1" as const;
export const GENERATOR_VERSION = "0.1.0" as const;

export const riskSignalSchema = z.enum([
  "browser_ui",
  "graphql_client",
  "api_contract",
  "persistence",
  "migration",
  "multi_repository",
  "cross_service_flow",
  "security",
  "tenant_isolation",
  "money_or_pricing",
  "destructive_change",
  "kafka_or_realtime",
  "production_mutation",
  "strict_visual_parity",
  "canonical_docs_material",
]);

export const riskProfileSchema = z.enum(["compact", "standard", "critical"]);

export const repositorySchema = z.strictObject({
  id: z.string().min(1).max(80),
  root: z.string().min(1).max(4096),
  role: z.string().min(1).max(240).optional(),
  contextHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  rulesPaths: z.array(z.string().min(1).max(4096)).max(32).default([]),
});

export const sourceSchema = z.strictObject({
  id: z.string().min(1).max(120),
  kind: z.enum([
    "task",
    "canonical_documentation",
    "governance",
    "ownership",
    "implementation",
    "schema",
    "migration",
    "test",
    "runtime_evidence",
  ]),
  path: z.string().min(1).max(4096).optional(),
  content: z.string().max(65_536).optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  authority: z.enum(["canonical", "context", "untrusted"]).default("context"),
  required: z.boolean().default(true),
  order: z.number().int().min(0).max(100_000).optional(),
});

export const capabilitySchema = z.strictObject({
  agentIsolation: z
    .enum(["supported", "unsupported", "unknown"])
    .default("unknown"),
  modelSelection: z
    .enum(["supported", "unsupported", "unknown"])
    .default("unknown"),
  physicalWorktrees: z
    .enum(["supported", "unsupported", "unknown"])
    .default("unknown"),
  goalTool: z.enum(["supported", "unsupported", "unknown"]).default("unknown"),
  playwrightHarness: z
    .enum([
      "available",
      "missing_authorized_to_add",
      "missing_not_authorized",
      "not_checked",
    ])
    .default("not_checked"),
});

const commonShape = {
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  taskId: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .max(96)
    .optional(),
  title: z.string().min(1).max(240).optional(),
  objective: z.string().min(1).max(12_000),
  context: z.string().max(32_000).optional(),
  nonGoals: z.array(z.string().min(1).max(4000)).max(64).default([]),
  language: z.enum(["auto", "ru", "en"]).default("auto"),
  repositories: z.array(repositorySchema).max(8).default([]),
  sources: z.array(sourceSchema).max(64).default([]),
  riskSignals: z.array(riskSignalSchema).max(15).default([]),
  minimumProfile: riskProfileSchema.default("compact"),
  outputMode: z
    .enum(["prompt_only", "resumable_package"])
    .default("prompt_only"),
  goalMode: z.enum(["plain", "persistent_requested"]).default("plain"),
  modelRouting: z.enum(["adaptive", "omit"]).default("adaptive"),
  artifactRoot: z.string().min(1).max(4096).optional(),
  capabilities: capabilitySchema.optional(),
};

export const proofClassSchema = z.enum([
  "static",
  "unit",
  "integration",
  "migration",
  "api",
  "graphql",
  "playwright",
  "persistence",
  "event_flow",
  "runtime",
  "observability",
  "blind_check",
]);

export const requirementSchema = z.strictObject({
  id: z.string().min(1).max(120),
  claim: z.string().min(1).max(8000),
  blocking: z.boolean().default(true),
  owner: z.string().min(1).max(240).optional(),
  proofClasses: z.array(proofClassSchema).max(16).default([]),
  positiveEvidence: z.array(z.string().min(1).max(2000)).max(32).default([]),
  falsificationChecks: z.array(z.string().min(1).max(2000)).max(32).default([]),
  staleWhen: z.array(z.string().min(1).max(2000)).max(32).default([]),
  order: z.number().int().min(0).max(100_000).optional(),
});

const auditModeSchema = z.enum(["auto", "required", "off"]);

export const implementationRequestSchema = z.strictObject({
  ...commonShape,
  requirements: z.array(requirementSchema).max(256).default([]),
  ownershipRules: z.array(z.string().min(1).max(4000)).max(128).default([]),
  audits: z
    .strictObject({
      testingAcceptance: auditModeSchema.default("auto"),
      conventionsCode: auditModeSchema.default("auto"),
      documentationBlind: auditModeSchema.default("auto"),
    })
    .default({
      testingAcceptance: "auto",
      conventionsCode: "auto",
      documentationBlind: "auto",
    }),
});

export const deliverableSchema = z.strictObject({
  id: z.string().min(1).max(120),
  kind: z.enum([
    "architecture_spec",
    "behavior_spec",
    "integration_spec",
    "implementation_task",
    "acceptance_spec",
  ]),
  outputPath: z.string().min(1).max(4096),
  owner: z.string().min(1).max(240).optional(),
});

export const documentationRequestSchema = z.strictObject({
  ...commonShape,
  targetState: z.enum(["as_is", "to_be", "mixed"]),
  deliverables: z.array(deliverableSchema).min(1).max(32),
  discoveryPartitions: z.strictObject({
    intentSourceIds: z.array(z.string().min(1).max(120)).max(64).default([]),
    implementationSourceIds: z
      .array(z.string().min(1).max(120))
      .max(64)
      .default([]),
    governanceSourceIds: z
      .array(z.string().min(1).max(120))
      .max(64)
      .default([]),
  }),
  requireColdReaderAudit: z.boolean().default(true),
  requirePostDraftBlindCheck: auditModeSchema.default("auto"),
});

export const comparisonDimensionSchema = z.enum([
  "behavior",
  "ownership",
  "transport",
  "persistence",
  "security_scope",
  "ordering",
  "errors",
  "pricing",
  "snapshots",
  "search",
  "media",
  "analytics",
]);

export const blindCheckRequestSchema = z.strictObject({
  ...commonShape,
  documentationSourceIds: z.array(z.string().min(1).max(120)).min(1).max(64),
  implementationSourceIds: z.array(z.string().min(1).max(120)).min(1).max(64),
  canonicalRequirementIds: z
    .array(z.string().min(1).max(120))
    .max(512)
    .default([]),
  strictIsolation: z.boolean().default(true),
  comparisonDimensions: z.array(comparisonDimensionSchema).min(1).max(12),
});

export const inspectWorkspaceRequestSchema = z.strictObject({
  workspaceRoots: z.array(z.string().min(1).max(4096)).min(1).max(8),
  sourcePaths: z.array(z.string().min(1).max(4096)).max(64).default([]),
  maxSourceBytes: z.number().int().min(1).max(1_048_576).default(131_072),
});

export const validateTaskRequestSchema = z.strictObject({
  prompt: z.string().min(1).max(400_000),
  operation: z.enum([
    "implementation_task",
    "documentation_task",
    "blind_check_task",
  ]),
  riskProfile: riskProfileSchema,
  riskSignals: z.array(riskSignalSchema).max(15).default([]),
  goalMode: z.enum(["plain", "persistent_requested"]).default("plain"),
  strictBlindRequested: z.boolean().default(false),
  expectedPromptSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});

export const forgeResultSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatorVersion: z.string(),
  operation: z.enum([
    "implementation_task",
    "documentation_task",
    "blind_check_task",
  ]),
  status: z.enum(["ready", "needs_input", "invalid"]),
  taskId: z.string(),
  requestFingerprint: z.string(),
  policyHash: z.string(),
  decisions: z.strictObject({
    riskProfile: riskProfileSchema,
    reasons: z.array(z.string()),
    requiredAudits: z.array(z.string()),
    goalMode: z.enum(["plain", "persistent_requested"]),
    routingStatus: z.enum(["selectable", "degraded", "unknown", "omitted"]),
    warnings: z.array(z.string()),
  }),
  prompt: z.strictObject({
    mediaType: z.literal("text/markdown"),
    text: z.string(),
    sha256: z.string(),
  }),
  package: z
    .array(
      z.strictObject({
        relativePath: z.string(),
        mediaType: z.enum(["text/markdown", "application/json"]),
        content: z.string(),
        sha256: z.string(),
      }),
    )
    .optional(),
  validation: z.strictObject({
    schemaValid: z.boolean(),
    unresolvedPlaceholders: z.array(z.string()),
    missingMaterialInputs: z.array(z.string()),
    blockingErrors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  questions: z.array(
    z.strictObject({
      id: z.string(),
      question: z.string(),
      materialImpact: z.string(),
    }),
  ),
});

export type RiskSignal = z.infer<typeof riskSignalSchema>;
export type RiskProfile = z.infer<typeof riskProfileSchema>;
export type RepositoryRef = z.infer<typeof repositorySchema>;
export type SourceRef = z.infer<typeof sourceSchema>;
export type CapabilityProbe = z.infer<typeof capabilitySchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type ImplementationRequest = z.infer<typeof implementationRequestSchema>;
export type DocumentationRequest = z.infer<typeof documentationRequestSchema>;
export type BlindCheckRequest = z.infer<typeof blindCheckRequestSchema>;
export type ValidateTaskRequest = z.infer<typeof validateTaskRequestSchema>;
export type ForgeResult = z.infer<typeof forgeResultSchema>;
