import { z } from "zod/v4";

export const SCHEMA_VERSION = "arbiter-forge/v1" as const;
export const PACKAGE_VERSION = "0.3.0" as const;
export const MATERIALIZER_VERSION = "0.3.0" as const;
// The compiler output remains byte/schema compatible with v0.2.0. The package
// and materializer can evolve without pretending the deterministic generator changed.
export const GENERATOR_VERSION = "0.2.0" as const;

export const forgeOperationSchema = z.enum([
  "implementation_task",
  "documentation_task",
  "blind_check_task",
]);

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

const stableIdSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

const nonBlankStringSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "must not be blank");

const singleLineStringSchema = (max: number) =>
  nonBlankStringSchema(max).refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "must not contain control characters or newlines",
  );

const routeLabelSchema = (max: number) =>
  singleLineStringSchema(max).refine(
    (value) => !/[`|<>]/u.test(value),
    "route labels must not contain Markdown or HTML delimiters",
  );

export const routingRoleSchema = z.enum([
  "root_arbiter",
  "task_discovery",
  "implementation_analyst",
  "implementation_worker",
  "frontend_worker",
  "test_runner",
  "playwright_operator",
  "acceptance_auditor",
  "code_quality_auditor",
  "blind_d1",
  "blind_d2",
  "blind_d3",
  "debugger",
  "documentation_author",
  "cold_reader",
]);

export const reasoningEffortSchema = z.enum([
  "inherit",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

export const routeExecutionSchema = z.enum([
  "root_session",
  "codex_subagent",
  "inherited_subagent",
  "codex_custom_agent",
  "external_adapter",
]);

const roleRouteTargetShape = {
  execution: routeExecutionSchema.default("codex_subagent"),
  agentType: stableIdSchema(120).optional(),
  adapter: stableIdSchema(120).optional(),
  provider: routeLabelSchema(120).optional(),
  model: routeLabelSchema(160).optional(),
  reasoningEffort: reasoningEffortSchema.default("inherit"),
};

export const roleRouteTargetSchema = z
  .strictObject(roleRouteTargetShape)
  .superRefine((value, context) => {
    if (value.execution === "codex_subagent" && !value.model) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: "codex_subagent routes require model",
      });
    }
    if (value.execution === "codex_custom_agent" && !value.agentType) {
      context.addIssue({
        code: "custom",
        path: ["agentType"],
        message: "codex_custom_agent routes require agentType",
      });
    }
    if (value.execution === "external_adapter" && !value.adapter) {
      context.addIssue({
        code: "custom",
        path: ["adapter"],
        message: "external_adapter routes require adapter",
      });
    }
    if (
      (value.execution === "root_session" ||
        value.execution === "codex_subagent") &&
      (value.agentType || value.adapter)
    ) {
      context.addIssue({
        code: "custom",
        message: `${value.execution} routes cannot declare agentType or adapter`,
      });
    }
    if (value.execution === "root_session" && value.provider && !value.model) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: "root_session provider requires an exact model",
      });
    }
    if (value.execution === "inherited_subagent") {
      if (value.agentType || value.adapter || value.provider || value.model) {
        context.addIssue({
          code: "custom",
          message:
            "inherited_subagent routes cannot claim an exact agent, adapter, provider, or model",
        });
      }
      if (value.reasoningEffort !== "inherit") {
        context.addIssue({
          code: "custom",
          path: ["reasoningEffort"],
          message: "inherited_subagent routes must inherit reasoning effort",
        });
      }
    }
    if (
      value.execution === "codex_custom_agent" ||
      value.execution === "external_adapter"
    ) {
      if (
        (value.execution === "codex_custom_agent" && value.adapter) ||
        (value.execution === "external_adapter" && value.agentType)
      ) {
        context.addIssue({
          code: "custom",
          message: `${value.execution} cannot declare the other executor identity field`,
        });
      }
      if (value.provider || value.model) {
        context.addIssue({
          code: "custom",
          message: `${value.execution} identity is attested by its named configuration and cannot also claim an exact provider/model`,
        });
      }
      if (value.reasoningEffort !== "inherit") {
        context.addIssue({
          code: "custom",
          path: ["reasoningEffort"],
          message: `${value.execution} routes must use the reasoning effort pinned by their named configuration`,
        });
      }
    }
  });

export const roleRouteAssignmentSchema = z
  .strictObject({
    role: routingRoleSchema,
    candidates: z.array(roleRouteTargetSchema).min(1).max(6),
    onUnavailable: z.enum(["fallback", "block"]).default("fallback"),
    diversityMode: z.enum(["prefer", "require"]).default("prefer"),
    preferDifferentModelFromRoles: z
      .array(routingRoleSchema)
      .max(16)
      .default([]),
    preferDifferentProviderFromRoles: z
      .array(routingRoleSchema)
      .max(16)
      .default([]),
  })
  .superRefine((value, context) => {
    if (value.onUnavailable === "block" && value.candidates.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message:
          "onUnavailable=block is an exact-route contract and requires one candidate",
      });
    }
  });

export const roleRoutingSchema = z.strictObject({
  assignments: z.array(roleRouteAssignmentSchema).min(1).max(32),
});

export const availableModelSchema = z.strictObject({
  provider: routeLabelSchema(120),
  model: routeLabelSchema(160),
  reasoningEfforts: z.array(reasoningEffortSchema).max(16).optional(),
});

export const currentRootRouteSchema = z.strictObject({
  provider: routeLabelSchema(120),
  model: routeLabelSchema(160),
  reasoningEffort: reasoningEffortSchema,
});

export const repositorySchema = z.strictObject({
  id: stableIdSchema(80),
  root: singleLineStringSchema(4096),
  role: singleLineStringSchema(240).optional(),
  contextHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  rulesPaths: z.array(singleLineStringSchema(4096)).max(32).default([]),
});

export const sourceSchema = z.strictObject({
  id: stableIdSchema(120),
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
  path: singleLineStringSchema(4096).optional(),
  realPath: singleLineStringSchema(4096).optional(),
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
  routeInventoryComplete: z.boolean().optional(),
  currentRootRoute: currentRootRouteSchema.optional(),
  availableModels: z.array(availableModelSchema).max(128).optional(),
  availableAgentTypes: z.array(stableIdSchema(120)).max(128).optional(),
  availableExternalAdapters: z.array(stableIdSchema(120)).max(64).optional(),
});

const commonShape = {
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  taskId: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .max(96)
    .optional(),
  title: singleLineStringSchema(240).optional(),
  objective: nonBlankStringSchema(12_000),
  context: z.string().max(32_000).optional(),
  nonGoals: z.array(nonBlankStringSchema(4000)).max(64).default([]),
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
  roleRouting: roleRoutingSchema.optional(),
  artifactRoot: singleLineStringSchema(4096).optional(),
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
  id: stableIdSchema(120),
  claim: nonBlankStringSchema(8000),
  blocking: z.boolean().default(true),
  owner: singleLineStringSchema(240).optional(),
  proofClasses: z.array(proofClassSchema).max(16).default([]),
  positiveEvidence: z.array(nonBlankStringSchema(2000)).max(32).default([]),
  falsificationChecks: z.array(nonBlankStringSchema(2000)).max(32).default([]),
  staleWhen: z.array(nonBlankStringSchema(2000)).max(32).default([]),
  order: z.number().int().min(0).max(100_000).optional(),
});

const auditModeSchema = z.enum(["auto", "required", "off"]);

export const implementationRequestSchema = z.strictObject({
  ...commonShape,
  implementationSurfaces: z
    .array(z.enum(["backend_or_shared", "frontend"]))
    .min(1)
    .max(2)
    .optional(),
  requirements: z.array(requirementSchema).max(256).default([]),
  ownershipRules: z.array(nonBlankStringSchema(4000)).max(128).default([]),
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
  id: stableIdSchema(120),
  kind: z.enum([
    "architecture_spec",
    "behavior_spec",
    "integration_spec",
    "implementation_task",
    "acceptance_spec",
  ]),
  outputPath: singleLineStringSchema(4096),
  owner: singleLineStringSchema(240).optional(),
});

export const documentationRequestSchema = z.strictObject({
  ...commonShape,
  targetState: z.enum(["as_is", "to_be", "mixed"]),
  documentationBasis: z
    .enum(["current_aware", "greenfield"])
    .default("current_aware"),
  deliverables: z.array(deliverableSchema).min(1).max(32),
  discoveryPartitions: z.strictObject({
    intentSourceIds: z.array(stableIdSchema(120)).max(64).default([]),
    implementationSourceIds: z.array(stableIdSchema(120)).max(64).default([]),
    governanceSourceIds: z.array(stableIdSchema(120)).max(64).default([]),
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
  documentationSourceIds: z.array(stableIdSchema(120)).min(1).max(64),
  implementationSourceIds: z.array(stableIdSchema(120)).min(1).max(64),
  canonicalRequirementIds: z.array(stableIdSchema(120)).max(512).default([]),
  strictIsolation: z.boolean().default(true),
  comparisonDimensions: z.array(comparisonDimensionSchema).min(1).max(12),
});

export const inspectWorkspaceRequestSchema = z.strictObject({
  workspaceRoots: z.array(singleLineStringSchema(4096)).min(1).max(8),
  sourcePaths: z.array(singleLineStringSchema(4096)).max(64).default([]),
  maxSourceBytes: z.number().int().min(1).max(1_048_576).default(131_072),
});

export const validateTaskRequestSchema = z
  .strictObject({
    prompt: z.string().min(1).max(400_000),
    operation: forgeOperationSchema,
    request: z.union([
      implementationRequestSchema,
      documentationRequestSchema,
      blindCheckRequestSchema,
    ]),
    expectedPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .superRefine((value, context) => {
    const actualOperation =
      "requirements" in value.request
        ? "implementation_task"
        : "deliverables" in value.request
          ? "documentation_task"
          : "blind_check_task";
    if (value.operation !== actualOperation) {
      context.addIssue({
        code: "custom",
        path: ["request"],
        message: `request shape belongs to ${actualOperation}, not ${value.operation}`,
      });
    }
  });

export const materializeTaskRequestSchema = z
  .strictObject({
    operation: forgeOperationSchema,
    request: z.union([
      implementationRequestSchema,
      documentationRequestSchema,
      blindCheckRequestSchema,
    ]),
    expectedPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    targetRepositoryId: stableIdSchema(80),
  })
  .superRefine((value, context) => {
    const actualOperation =
      "requirements" in value.request
        ? "implementation_task"
        : "deliverables" in value.request
          ? "documentation_task"
          : "blind_check_task";
    if (value.operation !== actualOperation) {
      context.addIssue({
        code: "custom",
        path: ["request"],
        message: `request shape belongs to ${actualOperation}, not ${value.operation}`,
      });
    }
  });

export const routingStatusSchema = z.enum([
  "selectable",
  "degraded",
  "unknown",
  "omitted",
]);

export const routingPlanEntrySchema = z.strictObject({
  role: routingRoleSchema,
  candidates: z.array(
    roleRouteTargetSchema.safeExtend({
      availability: z.enum(["available", "unavailable", "unknown"]),
    }),
  ),
  onUnavailable: z.enum(["fallback", "block"]),
  diversityMode: z.enum(["prefer", "require"]),
  preferDifferentModelFromRoles: z.array(routingRoleSchema),
  preferDifferentProviderFromRoles: z.array(routingRoleSchema),
});

export const forgeResultSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatorVersion: z.literal(GENERATOR_VERSION),
  operation: z.enum([
    "implementation_task",
    "documentation_task",
    "blind_check_task",
  ]),
  status: z.enum(["ready", "needs_input", "invalid"]),
  taskId: z.string(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decisions: z.strictObject({
    riskProfile: riskProfileSchema,
    reasons: z.array(z.string()),
    requiredAudits: z.array(z.string()),
    goalMode: z.enum(["plain", "persistent_requested"]),
    routingStatus: routingStatusSchema,
    routingPlanHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    routingPlan: z.array(routingPlanEntrySchema).optional(),
    warnings: z.array(z.string()),
  }),
  prompt: z.strictObject({
    mediaType: z.literal("text/markdown"),
    text: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  package: z
    .array(
      z.strictObject({
        relativePath: z.string(),
        mediaType: z.enum(["text/markdown", "application/json"]),
        content: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
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

export const implementationForgeResultSchema = forgeResultSchema.safeExtend({
  operation: z.literal("implementation_task"),
});

export const documentationForgeResultSchema = forgeResultSchema.safeExtend({
  operation: z.literal("documentation_task"),
});

export const blindCheckForgeResultSchema = forgeResultSchema.safeExtend({
  operation: z.literal("blind_check_task"),
});

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const gitSnapshotSchema = z.strictObject({
  root: z.string(),
  branch: z.string().nullable(),
  head: z.string(),
  dirty: z.boolean(),
  dirtyEntries: z.number().int().nonnegative(),
  untrackedEntries: z.number().int().nonnegative(),
  dirtyManifestHash: sha256Schema,
  contentBound: z.boolean(),
});

const workspaceInspectionSchema = z.strictObject({
  requestedRoot: z.string(),
  realRoot: z.string(),
  git: gitSnapshotSchema.nullable(),
  rules: z.array(z.string()),
  planning: z.array(z.string()),
  detected: z.strictObject({
    packageManager: z.string().nullable(),
    monorepo: z.boolean(),
    playwright: z.boolean(),
    graphql: z.boolean(),
  }),
  packageScripts: z.array(z.string()),
});

const sourceInspectionSchema = z.strictObject({
  requestedPath: z.string(),
  realPath: z.string(),
  size: z.number().int().nonnegative(),
  sha256: sha256Schema,
});

export const inspectWorkspaceResultSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: z.enum(["ready", "partial", "denied"]),
  allowedRoots: z.array(z.string()),
  workspaces: z.array(workspaceInspectionSchema),
  sources: z.array(sourceInspectionSchema),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  contextHash: sha256Schema,
});

export const promptValidationResultSchema = z.strictObject({
  pass: z.boolean(),
  assurance: z.enum(["recompiled", "structural_only"]),
  promptSha256: sha256Schema,
  expectedPromptSha256: sha256Schema,
  requestFingerprint: sha256Schema,
  policyHash: sha256Schema,
  forgeStatus: z.enum(["ready", "needs_input", "invalid"]),
  unresolvedPlaceholders: z.array(z.string()),
  blockingErrors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const materializeTaskResultSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatorVersion: z.literal(GENERATOR_VERSION),
  materializerVersion: z.literal(MATERIALIZER_VERSION),
  status: z.enum([
    "written",
    "unchanged",
    "invalid",
    "denied",
    "not_ignored",
    "conflict",
  ]),
  materialized: z.boolean(),
  taskId: z.string(),
  targetRepositoryId: z.string(),
  targetRoot: z.string().nullable(),
  bundleRoot: z.string().nullable(),
  validation: promptValidationResultSchema,
  storage: z.strictObject({
    relativeRoot: z.string().nullable(),
    ignored: z.boolean(),
    ignoreProofCommand: z.string().nullable(),
  }),
  files: z.array(
    z.strictObject({
      relativePath: z.string(),
      absolutePath: z.string(),
      mediaType: z.enum([
        "text/markdown",
        "application/json",
        "text/x-shellscript",
      ]),
      sha256: sha256Schema,
      executable: z.boolean(),
    }),
  ),
  launch: z
    .strictObject({
      workingDirectory: z.string(),
      recommendedCommand: z.string(),
      nonInteractiveCommand: z.string(),
      interactiveCommand: z.string(),
    })
    .nullable(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type RiskSignal = z.infer<typeof riskSignalSchema>;
export type RiskProfile = z.infer<typeof riskProfileSchema>;
export type RepositoryRef = z.infer<typeof repositorySchema>;
export type SourceRef = z.infer<typeof sourceSchema>;
export type CapabilityProbe = z.infer<typeof capabilitySchema>;
export type RoutingRole = z.infer<typeof routingRoleSchema>;
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type RoleRouteTarget = z.infer<typeof roleRouteTargetSchema>;
export type RoleRouteAssignment = z.infer<typeof roleRouteAssignmentSchema>;
export type RoleRouting = z.infer<typeof roleRoutingSchema>;
export type RoutingStatus = z.infer<typeof routingStatusSchema>;
export type RoutingPlanEntry = z.infer<typeof routingPlanEntrySchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type ImplementationRequest = z.infer<typeof implementationRequestSchema>;
export type DocumentationRequest = z.infer<typeof documentationRequestSchema>;
export type BlindCheckRequest = z.infer<typeof blindCheckRequestSchema>;
export type ValidateTaskRequest = z.infer<typeof validateTaskRequestSchema>;
export type MaterializeTaskRequest = z.infer<
  typeof materializeTaskRequestSchema
>;
export type MaterializeTaskResult = z.infer<typeof materializeTaskResultSchema>;
export type ForgeResult = z.infer<typeof forgeResultSchema>;
export type CompiledForgeResult = Omit<ForgeResult, "decisions"> & {
  decisions: ForgeResult["decisions"] & {
    routingPlanHash: string;
    routingPlan: RoutingPlanEntry[];
  };
};
