import { sha256, canonicalJson, uniqueSorted } from "./stable.js";
import { isAbsolute, normalize, sep } from "node:path";
import type {
  BlindCheckRequest,
  DocumentationRequest,
  ImplementationRequest,
  Requirement,
  RepositoryRef,
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

  validateUniqueIds(request.repositories, "repository", blockingErrors);
  validateUniqueIds(request.sources, "source", blockingErrors);

  for (const repository of request.repositories) {
    if (!isAbsolute(repository.root)) {
      blockingErrors.push(`repository ${repository.id} root must be absolute`);
    }
  }
  for (const source of request.sources) {
    if (source.path && !isAbsolute(source.path)) {
      blockingErrors.push(`source ${source.id} path must be absolute`);
    }
  }
  if (request.artifactRoot) {
    if (!isAbsolute(request.artifactRoot)) {
      blockingErrors.push("artifactRoot must be absolute");
    } else if (!isWithinTmp(request.artifactRoot)) {
      blockingErrors.push(
        "repository-local artifactRoot is unsupported without an ignored-path proof; use /tmp for forge v1",
      );
    }
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

  const base = {
    ...request,
    repositories,
    sources,
    nonGoals: uniqueSorted(request.nonGoals.map((value) => value.trim())),
    riskSignals: uniqueSorted(
      request.riskSignals,
    ) as typeof request.riskSignals,
  } as ForgeRequest;

  if ("requirements" in base) {
    validateUniqueIds(base.requirements, "requirement", blockingErrors);
    base.requirements = normalizeRequirements(base.requirements);
    base.ownershipRules = uniqueSorted(
      base.ownershipRules.map((value) => value.trim()),
    );
  }

  if ("deliverables" in base) {
    validateUniqueIds(base.deliverables, "deliverable", blockingErrors);
    base.deliverables = [...base.deliverables].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    );
    validatePartitionIds(base, blockingErrors, missingMaterialInputs);
  }

  if ("documentationSourceIds" in base) {
    base.documentationSourceIds = uniqueSorted(base.documentationSourceIds);
    base.implementationSourceIds = uniqueSorted(base.implementationSourceIds);
    base.canonicalRequirementIds = uniqueSorted(base.canonicalRequirementIds);
    base.comparisonDimensions = uniqueSorted(
      base.comparisonDimensions,
    ) as typeof base.comparisonDimensions;
    validateBlindSourceIds(base, blockingErrors);
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
  const title =
    request.title?.trim() ||
    request.objective.trim().split(/\r?\n/u)[0]!.slice(0, 160);
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
    if (source.required && !source.path && source.content === undefined) {
      missingMaterialInputs.push(
        `required source ${source.id} has neither path nor content`,
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

function normalizeRepository(repository: RepositoryRef): RepositoryRef {
  return {
    ...repository,
    id: repository.id.trim(),
    root: repository.root.trim(),
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
    id: source.id.trim(),
    ...(source.path ? { path: source.path.trim() } : {}),
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
      id: requirement.id.trim(),
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
  const sourceIds = new Set(request.sources.map((source) => source.id));
  const partitions = [
    ["intent", request.discoveryPartitions.intentSourceIds],
    ["implementation", request.discoveryPartitions.implementationSourceIds],
    ["governance", request.discoveryPartitions.governanceSourceIds],
  ] as const;

  for (const [name, ids] of partitions) {
    for (const id of ids) {
      if (!sourceIds.has(id)) {
        errors.push(
          `${name} discovery partition references unknown source: ${id}`,
        );
      }
    }
  }

  if (
    request.targetState !== "to_be" &&
    request.discoveryPartitions.implementationSourceIds.length === 0
  ) {
    missing.push(
      "as-is or mixed documentation requires implementation discovery sources",
    );
  }
  if (request.discoveryPartitions.intentSourceIds.length === 0) {
    missing.push("documentation synthesis requires at least one intent source");
  }
}

function validateBlindSourceIds(
  request: BlindCheckRequest,
  errors: string[],
): void {
  const sourceIds = new Set(request.sources.map((source) => source.id));
  const documentationIds = new Set(request.documentationSourceIds);
  for (const id of [
    ...request.documentationSourceIds,
    ...request.implementationSourceIds,
  ]) {
    if (!sourceIds.has(id)) {
      errors.push(`blind-check allowlist references unknown source: ${id}`);
    }
  }
  for (const id of request.implementationSourceIds) {
    if (documentationIds.has(id)) {
      errors.push(
        `blind-check source ${id} appears in both D1 and D2 allowlists`,
      );
    }
  }
}

function detectLanguage(value: string): "ru" | "en" {
  return /[А-Яа-яЁё]/u.test(value) ? "ru" : "en";
}

function isWithinTmp(path: string): boolean {
  const normalized = normalize(path);
  return normalized === "/tmp" || normalized.startsWith(`/tmp${sep}`);
}
