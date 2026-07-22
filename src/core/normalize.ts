import { sha256, canonicalJson, uniqueSorted } from "./stable.js";
import {
  isAbsolute,
  normalize as normalizePath,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  BlindCheckRequest,
  CapabilityProbe,
  DocumentationRequest,
  ImplementationRequest,
  Requirement,
  RepositoryRef,
  RoleRouting,
  SourceRef,
} from "./schemas.js";

export type ForgeRequest =
  ImplementationRequest | DocumentationRequest | BlindCheckRequest;

export interface NormalizedForgeRequest {
  request: ForgeRequest;
  taskId: string;
  title: string;
  language: "ru" | "en";
  requestFingerprint: string;
  blockingErrors: string[];
  missingMaterialInputs: string[];
  warnings: string[];
}

export function normalizeRequest(
  request: ForgeRequest,
): NormalizedForgeRequest {
  const blockingErrors: string[] = [];
  const missingMaterialInputs: string[] = [];
  const warnings: string[] = [];

  for (const repository of request.repositories) {
    if (!isAbsolute(repository.root.trim())) {
      blockingErrors.push(`repository ${repository.id} root must be absolute`);
    }
  }
  for (const source of request.sources) {
    if (source.path && !isAbsolute(source.path.trim())) {
      blockingErrors.push(`source ${source.id} path must be absolute`);
    }
    if (source.realPath && !isAbsolute(source.realPath.trim())) {
      blockingErrors.push(`source ${source.id} realPath must be absolute`);
    }
    if (source.realPath && !source.path) {
      blockingErrors.push(`source ${source.id} realPath requires path`);
    }
  }
  if (request.artifactRoot) {
    if (!isAbsolute(request.artifactRoot.trim())) {
      blockingErrors.push("artifactRoot must be absolute");
    } else if (!isWithinTmp(request.artifactRoot.trim())) {
      blockingErrors.push(
        "repository-local artifactRoot is unsupported without an ignored-path proof; use /tmp for forge v1",
      );
    }
  }
  if (request.modelRouting === "omit" && request.roleRouting) {
    blockingErrors.push(
      "roleRouting cannot be supplied when modelRouting is omit",
    );
  }
  if (
    request.outputMode === "resumable_package" &&
    request.goalMode !== "persistent_requested"
  ) {
    blockingErrors.push(
      "outputMode=resumable_package requires goalMode=persistent_requested; plain is only valid for a non-executing prompt_only handoff",
    );
  }

  const repositories = [...request.repositories]
    .map((repository) => normalizeRepository(repository))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const sources = [...request.sources]
    .map((source) => normalizeSource(source, blockingErrors))
    .sort(
      (left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) -
          (right.order ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id, "en"),
    );
  const roleRouting = request.roleRouting
    ? normalizeRoleRouting(request.roleRouting, blockingErrors)
    : undefined;
  const capabilities = request.capabilities
    ? normalizeCapabilities(request.capabilities, blockingErrors)
    : undefined;

  validateUniqueIds(repositories, "repository", blockingErrors);
  validateUniqueIds(sources, "source", blockingErrors);

  const base = {
    ...request,
    objective: request.objective.replace(/\r\n?/gu, "\n").trim(),
    ...(request.title ? { title: request.title.trim() } : {}),
    repositories,
    sources,
    ...(roleRouting ? { roleRouting } : {}),
    ...(capabilities ? { capabilities } : {}),
    nonGoals: uniqueSorted(request.nonGoals.map((value) => value.trim())),
    ...(request.context?.trim()
      ? { context: request.context.replace(/\r\n?/gu, "\n").trim() }
      : {}),
    ...(request.artifactRoot
      ? { artifactRoot: normalizePath(request.artifactRoot.trim()) }
      : {}),
    riskSignals: uniqueSorted(
      request.riskSignals,
    ) as typeof request.riskSignals,
  } as ForgeRequest;

  if ("requirements" in base) {
    if (base.implementationSurfaces) {
      base.implementationSurfaces = uniqueSorted(
        base.implementationSurfaces,
      ) as ImplementationRequest["implementationSurfaces"];
    }
    base.requirements = normalizeRequirements(base.requirements);
    validateUniqueIds(base.requirements, "requirement", blockingErrors);
    base.ownershipRules = uniqueSorted(
      base.ownershipRules.map((value) => value.trim()),
    );
  }

  if ("deliverables" in base) {
    base.deliverables = base.deliverables
      .map((deliverable) => ({
        ...deliverable,
        id: normalizeId(deliverable.id),
        outputPath: deliverable.outputPath.trim(),
        ...(deliverable.owner ? { owner: deliverable.owner.trim() } : {}),
      }))
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    validateUniqueIds(base.deliverables, "deliverable", blockingErrors);
    base.discoveryPartitions = {
      intentSourceIds: normalizeIdList(
        base.discoveryPartitions.intentSourceIds,
        "intent partition source",
        blockingErrors,
      ),
      implementationSourceIds: normalizeIdList(
        base.discoveryPartitions.implementationSourceIds,
        "implementation partition source",
        blockingErrors,
      ),
      governanceSourceIds: normalizeIdList(
        base.discoveryPartitions.governanceSourceIds,
        "governance partition source",
        blockingErrors,
      ),
    };
    validatePartitionIds(base, blockingErrors, missingMaterialInputs);
  }

  if ("documentationSourceIds" in base) {
    base.documentationSourceIds = normalizeIdList(
      base.documentationSourceIds,
      "D1 source",
      blockingErrors,
    );
    base.implementationSourceIds = normalizeIdList(
      base.implementationSourceIds,
      "D2 source",
      blockingErrors,
    );
    base.canonicalRequirementIds = normalizeIdList(
      base.canonicalRequirementIds,
      "canonical requirement",
      blockingErrors,
    );
    base.comparisonDimensions = uniqueSorted(
      base.comparisonDimensions,
    ) as typeof base.comparisonDimensions;
    validateBlindSourceIds(base, blockingErrors, missingMaterialInputs);
  }

  const totalInlineBytes = sources.reduce(
    (total, source) => total + Buffer.byteLength(source.content ?? "", "utf8"),
    0,
  );
  if (totalInlineBytes > 131_072) {
    blockingErrors.push(
      "Inline source content exceeds the 131072-byte aggregate limit.",
    );
  }

  const seedFingerprint = sha256(canonicalJson({ ...base, taskId: undefined }));
  const taskId = request.taskId ?? `task-${seedFingerprint.slice(0, 12)}`;
  const title = base.title || base.objective.split("\n")[0]!.slice(0, 160);
  const language =
    request.language === "auto"
      ? detectLanguage(request.objective)
      : request.language;
  const normalizedRequest = {
    ...base,
    taskId,
    title,
    language,
  } as ForgeRequest;
  const requestFingerprint = sha256(canonicalJson(normalizedRequest));

  for (const source of sources) {
    if (!source.path && source.content === undefined) {
      missingMaterialInputs.push(
        `source ${source.id} has neither path nor content`,
      );
    }
  }

  return {
    request: normalizedRequest,
    taskId,
    title,
    language,
    requestFingerprint,
    blockingErrors: uniqueSorted(blockingErrors),
    missingMaterialInputs: uniqueSorted(missingMaterialInputs),
    warnings: uniqueSorted(warnings),
  };
}

function normalizeRoleRouting(
  roleRouting: RoleRouting,
  blockingErrors: string[],
): RoleRouting {
  const seenRoles = new Set<string>();
  const assignments = roleRouting.assignments
    .map((assignment) => {
      if (seenRoles.has(assignment.role)) {
        blockingErrors.push(
          `roleRouting contains duplicate assignment for ${assignment.role}`,
        );
      }
      seenRoles.add(assignment.role);

      const seenCandidates = new Set<string>();
      const candidates = assignment.candidates.map((candidate) => {
        const normalized = {
          ...candidate,
          ...(candidate.provider
            ? { provider: candidate.provider.trim() }
            : {}),
          ...(candidate.model ? { model: candidate.model.trim() } : {}),
        };
        const identity = canonicalJson(normalized);
        if (seenCandidates.has(identity)) {
          blockingErrors.push(
            `roleRouting ${assignment.role} contains a duplicate route candidate`,
          );
        }
        seenCandidates.add(identity);
        return normalized;
      });
      const preferDifferentModelFromRoles = uniqueSorted(
        assignment.preferDifferentModelFromRoles,
      ) as typeof assignment.preferDifferentModelFromRoles;
      const preferDifferentProviderFromRoles = uniqueSorted(
        assignment.preferDifferentProviderFromRoles,
      ) as typeof assignment.preferDifferentProviderFromRoles;
      if (
        assignment.role === "root_arbiter" &&
        candidates.some((candidate) => candidate.execution !== "root_session")
      ) {
        blockingErrors.push(
          "roleRouting root_arbiter may describe only the existing root_session",
        );
      }
      if (
        preferDifferentModelFromRoles.includes(assignment.role) ||
        preferDifferentProviderFromRoles.includes(assignment.role)
      ) {
        blockingErrors.push(
          `roleRouting ${assignment.role} cannot require diversity from itself`,
        );
      }
      if (
        assignment.diversityMode === "require" &&
        preferDifferentModelFromRoles.length === 0 &&
        preferDifferentProviderFromRoles.length === 0
      ) {
        blockingErrors.push(
          `roleRouting ${assignment.role} requires diversity but names no comparison role`,
        );
      }
      return {
        ...assignment,
        candidates,
        preferDifferentModelFromRoles,
        preferDifferentProviderFromRoles,
      };
    })
    .sort((left, right) => left.role.localeCompare(right.role, "en"));
  return { assignments };
}

function normalizeCapabilities(
  capabilities: CapabilityProbe,
  blockingErrors: string[],
): CapabilityProbe {
  const seenModels = new Set<string>();
  const availableModels = capabilities.availableModels
    ?.map((model) => {
      const normalized = {
        ...model,
        provider: model.provider.trim(),
        model: model.model.trim(),
        ...(model.reasoningEfforts
          ? {
              reasoningEfforts: uniqueSorted(
                model.reasoningEfforts,
              ) as typeof model.reasoningEfforts,
            }
          : {}),
      };
      const identity = `${normalized.provider}\u0000${normalized.model}`;
      if (seenModels.has(identity)) {
        blockingErrors.push(
          `capabilities contains duplicate model route: ${normalized.provider}/${normalized.model}`,
        );
      }
      seenModels.add(identity);
      return normalized;
    })
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider, "en") ||
        left.model.localeCompare(right.model, "en"),
    );

  return {
    ...capabilities,
    ...(capabilities.currentRootRoute
      ? {
          currentRootRoute: {
            ...capabilities.currentRootRoute,
            provider: capabilities.currentRootRoute.provider.trim(),
            model: capabilities.currentRootRoute.model.trim(),
          },
        }
      : {}),
    ...(availableModels ? { availableModels } : {}),
    ...(capabilities.availableAgentTypes
      ? {
          availableAgentTypes: uniqueSorted(capabilities.availableAgentTypes),
        }
      : {}),
    ...(capabilities.availableExternalAdapters
      ? {
          availableExternalAdapters: uniqueSorted(
            capabilities.availableExternalAdapters,
          ),
        }
      : {}),
  };
}

function normalizeRepository(repository: RepositoryRef): RepositoryRef {
  return {
    ...repository,
    id: normalizeId(repository.id),
    root: normalizePath(repository.root.trim()),
    ...(repository.role ? { role: repository.role.trim() } : {}),
    rulesPaths: uniqueSorted(
      repository.rulesPaths.map((value) => value.trim()),
    ),
  };
}

function normalizeSource(
  source: SourceRef,
  blockingErrors: string[],
): SourceRef {
  if (source.path && source.content !== undefined) {
    blockingErrors.push(
      `source ${source.id} must use path or content, not both`,
    );
  }

  const normalizedContent = source.content?.replace(/\r\n?/gu, "\n");
  const contentHash =
    normalizedContent === undefined ? undefined : sha256(normalizedContent);
  if (source.sha256 && contentHash && source.sha256 !== contentHash) {
    blockingErrors.push(
      `source ${source.id} sha256 does not match inline content`,
    );
  }

  return {
    ...source,
    id: normalizeId(source.id),
    ...(source.path ? { path: normalizePath(source.path.trim()) } : {}),
    ...(source.realPath
      ? { realPath: normalizePath(source.realPath.trim()) }
      : {}),
    ...(normalizedContent !== undefined ? { content: normalizedContent } : {}),
    ...(contentHash
      ? { sha256: contentHash }
      : source.sha256
        ? { sha256: source.sha256 }
        : {}),
  };
}

function normalizeRequirements(requirements: Requirement[]): Requirement[] {
  return [...requirements]
    .map((requirement) => ({
      ...requirement,
      id: normalizeId(requirement.id),
      claim: requirement.claim.trim(),
      ...(requirement.owner ? { owner: requirement.owner.trim() } : {}),
      proofClasses: uniqueSorted(
        requirement.proofClasses,
      ) as Requirement["proofClasses"],
      positiveEvidence: uniqueSorted(
        requirement.positiveEvidence.map((value) => value.trim()),
      ),
      falsificationChecks: uniqueSorted(
        requirement.falsificationChecks.map((value) => value.trim()),
      ),
      staleWhen: uniqueSorted(
        requirement.staleWhen.map((value) => value.trim()),
      ),
    }))
    .sort(
      (left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) -
          (right.order ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id, "en"),
    );
}

function validateUniqueIds(
  entries: readonly { id: string }[],
  label: string,
  errors: string[],
): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      errors.push(`duplicate ${label} id: ${entry.id}`);
    }
    ids.add(entry.id);
  }
}

function validatePartitionIds(
  request: DocumentationRequest,
  errors: string[],
  missing: string[],
): void {
  const sourceById = new Map(
    request.sources.map((source) => [source.id, source]),
  );
  const partitions = [
    [
      "intent",
      request.discoveryPartitions.intentSourceIds,
      new Set<SourceRef["kind"]>(["task", "canonical_documentation"]),
    ],
    [
      "implementation",
      request.discoveryPartitions.implementationSourceIds,
      new Set<SourceRef["kind"]>([
        "implementation",
        "schema",
        "migration",
        "test",
        "runtime_evidence",
      ]),
    ],
    [
      "governance",
      request.discoveryPartitions.governanceSourceIds,
      new Set<SourceRef["kind"]>(["governance", "ownership"]),
    ],
  ] as const;

  const memberships = new Map<string, string>();

  for (const [name, ids, allowedKinds] of partitions) {
    for (const id of ids) {
      const source = sourceById.get(id);
      if (!source) {
        errors.push(
          `${name} discovery partition references unknown source: ${id}`,
        );
        continue;
      }
      const priorMembership = memberships.get(id);
      if (priorMembership) {
        errors.push(
          `documentation source ${id} appears in both ${priorMembership} and ${name} partitions`,
        );
      } else {
        memberships.set(id, name);
      }
      if (!allowedKinds.has(source.kind)) {
        errors.push(
          `${name} discovery source ${id} has forbidden kind: ${source.kind}`,
        );
      }
      if (
        (name === "intent" || name === "governance") &&
        source.authority !== "canonical"
      ) {
        errors.push(
          `${name} discovery source ${id} must have canonical authority`,
        );
      }
    }
  }

  validateCrossPartitionIdentity(
    partitions.map(([name, ids]) => [name, ids] as const),
    sourceById,
    errors,
    "documentation discovery",
  );

  for (const source of request.sources) {
    if (!memberships.has(source.id)) {
      errors.push(
        `documentation source ${source.id} is not assigned to a discovery partition`,
      );
    }
    if (source.path && (!source.realPath || !source.sha256)) {
      missing.push(
        `documentation source ${source.id} path identity requires realPath and sha256`,
      );
    }
  }

  if (
    request.documentationBasis === "greenfield" &&
    request.targetState !== "to_be"
  ) {
    errors.push(
      "greenfield documentationBasis is valid only for targetState to_be",
    );
  }
  if (
    request.documentationBasis === "greenfield" &&
    request.discoveryPartitions.implementationSourceIds.length > 0
  ) {
    errors.push(
      "greenfield documentation must not claim an implementation baseline; use current_aware",
    );
  }
  if (
    request.documentationBasis === "current_aware" &&
    request.discoveryPartitions.implementationSourceIds.length === 0
  ) {
    missing.push(
      "current-aware documentation requires implementation discovery sources",
    );
  }
  if (request.discoveryPartitions.intentSourceIds.length === 0) {
    missing.push("documentation synthesis requires at least one intent source");
  }
  if (
    request.documentationBasis === "current_aware" &&
    request.requirePostDraftBlindCheck === "off"
  ) {
    errors.push(
      "current-aware documentation cannot disable the post-draft blind check",
    );
  }
  if (
    request.documentationBasis === "greenfield" &&
    request.requirePostDraftBlindCheck === "required"
  ) {
    errors.push(
      "greenfield documentation has no implementation baseline for a strict blind check",
    );
  }
}

function validateBlindSourceIds(
  request: BlindCheckRequest,
  errors: string[],
  missing: string[],
): void {
  const sourceById = new Map(
    request.sources.map((source) => [source.id, source]),
  );
  const documentationIds = new Set(request.documentationSourceIds);
  const documentationKinds = new Set<SourceRef["kind"]>([
    "task",
    "canonical_documentation",
    "governance",
    "ownership",
  ]);
  const implementationKinds = new Set<SourceRef["kind"]>([
    "implementation",
    "schema",
    "migration",
    "test",
    "runtime_evidence",
  ]);

  for (const id of request.documentationSourceIds) {
    const source = sourceById.get(id);
    if (!source) {
      errors.push(`blind-check allowlist references unknown source: ${id}`);
      continue;
    }
    if (
      !documentationKinds.has(source.kind) ||
      source.authority !== "canonical"
    ) {
      errors.push(
        `D1 source ${id} must be canonical documentation/governance, not ${source.kind}/${source.authority}`,
      );
    }
    if (
      request.strictIsolation &&
      (!source.sha256 || (source.path && !source.realPath))
    ) {
      missing.push(
        `strict D1 source ${id} requires sha256 and realPath for path inputs`,
      );
    }
  }

  for (const id of request.implementationSourceIds) {
    if (documentationIds.has(id)) {
      errors.push(
        `blind-check source ${id} appears in both D1 and D2 allowlists`,
      );
    }
    const source = sourceById.get(id);
    if (!source) {
      errors.push(`blind-check allowlist references unknown source: ${id}`);
      continue;
    }
    if (!implementationKinds.has(source.kind)) {
      errors.push(`D2 source ${id} has forbidden kind: ${source.kind}`);
    }
    if (
      request.strictIsolation &&
      (!source.sha256 || (source.path && !source.realPath))
    ) {
      missing.push(
        `strict D2 source ${id} requires sha256 and realPath for path inputs`,
      );
    }
  }

  const assignedIds = new Set([
    ...request.documentationSourceIds,
    ...request.implementationSourceIds,
  ]);
  for (const source of request.sources) {
    if (!assignedIds.has(source.id)) {
      errors.push(
        `blind-check source ${source.id} is not assigned to D1 or D2`,
      );
    }
  }

  validateCrossPartitionIdentity(
    [
      ["D1", request.documentationSourceIds],
      ["D2", request.implementationSourceIds],
    ],
    sourceById,
    errors,
    "blind-check",
  );

  if (
    request.strictIsolation &&
    request.capabilities?.agentIsolation === "unsupported"
  ) {
    errors.push(
      "strict blind-check isolation is unavailable in the reported host capabilities",
    );
  }
}

function detectLanguage(value: string): "ru" | "en" {
  return /[А-Яа-яЁё]/u.test(value) ? "ru" : "en";
}

function isWithinTmp(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/tmp" || normalized.startsWith(`/tmp${sep}`);
}

function normalizeId(value: string): string {
  return value.trim().normalize("NFC");
}

function normalizeIdList(
  values: readonly string[],
  label: string,
  errors: string[],
): string[] {
  const normalized = values
    .map(normalizeId)
    .sort((left, right) => left.localeCompare(right, "en"));
  validateUniqueValues(normalized, label, errors);
  return normalized;
}

function validateUniqueValues(
  values: readonly string[],
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`duplicate ${label} id: ${value}`);
    }
    seen.add(value);
  }
}

function validateCrossPartitionIdentity(
  partitions: readonly (readonly [string, readonly string[]])[],
  sourceById: Map<string, SourceRef>,
  errors: string[],
  label: string,
): void {
  for (let leftIndex = 0; leftIndex < partitions.length; leftIndex += 1) {
    const left = partitions[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < partitions.length;
      rightIndex += 1
    ) {
      const right = partitions[rightIndex]!;
      for (const leftId of left[1]) {
        const leftSource = sourceById.get(leftId);
        if (!leftSource) continue;
        for (const rightId of right[1]) {
          const rightSource = sourceById.get(rightId);
          if (!rightSource) continue;
          if (sourcesOverlap(leftSource, rightSource)) {
            errors.push(
              `${label} sources ${leftId} (${left[0]}) and ${rightId} (${right[0]}) share a physical/content identity`,
            );
          }
        }
      }
    }
  }
}

function sourcesOverlap(left: SourceRef, right: SourceRef): boolean {
  if (left.sha256 && right.sha256 && left.sha256 === right.sha256) {
    return true;
  }
  const leftIdentityPath = left.realPath ?? left.path;
  const rightIdentityPath = right.realPath ?? right.path;
  if (!leftIdentityPath || !rightIdentityPath) {
    return false;
  }
  const leftPath = resolve(leftIdentityPath);
  const rightPath = resolve(rightIdentityPath);
  return (
    isSameOrAncestor(leftPath, rightPath) ||
    isSameOrAncestor(rightPath, leftPath)
  );
}

function isSameOrAncestor(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return (
    childRelative === "" ||
    (!childRelative.startsWith(`..${sep}`) &&
      childRelative !== ".." &&
      !isAbsolute(childRelative))
  );
}
