# Implementation Orchestration

Use this policy when Forge creates an implementation arbiter prompt.

## Input contract

Require a measurable objective, repository roots, source-of-truth paths, known ownership rules, and
explicit non-goals when available. Preserve canonical requirement IDs. Create stable task-local IDs
only for requirements that have none.

Use `inspect_workspace` to capture, per repository:

- root, branch, worktree, and base commit;
- a content-bound dirty-state identity covering staged, unstaged, deleted, and nonignored untracked
  contents;
- discovered root/scoped rule and planning paths;
- package manager, monorepo, package-script, Playwright, and GraphQL signals;
- hashes for explicitly allowlisted source files.

The inspection API does not infer the task objective, read source contents, or probe worker,
concurrency, model-selection, goal, physical-worktree, browser-runtime, or external-service
capabilities. Determine those separately when the generated task needs them. Attach the returned
`contextHash` to the applicable `repositories[].contextHash` forge entries; do not invent one when
inspection is unavailable.

Do not switch, clean, reset, or overwrite a dirty shared worktree. A branch name is not physical
isolation. Give overlapping writers separate worktrees and branches, or serialize them.

## Requirement map

For every effective requirement record:

- observable claim and blocking status;
- authoritative source and owner;
- allowed write scope and forbidden boundaries;
- positive evidence and a falsification check;
- minimum proof class;
- files, schemas, or runtime state that make evidence stale.

The effective requirement inventory and mapped ID set must match exactly. Canonical IDs must be a
unique subset. If a material behavior or acceptance outcome cannot be inferred, emit a decision
question instead of inventing it.

## Adaptive topology

### Compact

Use one writer or root implementation plus one independent verifier. Do not add a blind check,
browser lane, or resumable package without an applicable requirement.

### Standard

Use one to three non-overlapping coding scopes. Add:

1. a testing and acceptance auditor;
2. a conventions, ownership, and code-quality auditor;
3. a blind check only when canonical documentation materially defines acceptance.

### Critical

Partition writers by authoritative owner. Use physical worktrees for concurrent writers or serialize
overlap. Run all applicable audits, including a true D1/D2/D3 blind check for documentation-heavy
work. Add a specialist security, data, performance, accessibility, or observability audit only when
the risk cannot fit safely inside the existing audits.

Respect the actual concurrency limit. Batch lanes instead of creating uncontrolled nested fan-out.

## Hard arbiter

The root arbiter must:

- treat worker and auditor reports as claims until evidence is inspected;
- own integration and a single finding ledger without erasing disagreement;
- keep auditors read-only and route fixes to coding workers;
- allow a narrow root integration fix only when independently rechecked;
- invalidate affected evidence after every material correction;
- run targeted delta checks during correction and the complete required set on the stable final
  snapshot;
- decide disagreements from source authority and observed behavior, never by majority vote;
- continue after an individual worker failure when useful work can be preserved or reassigned.

## Evidence and artifacts

Each audit report must identify its exact repository snapshot and include commands, exit codes, tool
versions, findings with exact references, required evidence status, retained artifact hashes, and a
verdict. Mark evidence `present`, `not_applicable` with a reason, or `missing`.

Prefer `/tmp/arbiter-forge/<task-id>/<run-id>/`. Use a repository-local root only after proving it is
ignored. Never commit reports, logs, screenshots, traces, videos, auth state, or raw payloads. Redact
credentials, cookies, tokens, auth headers, secrets, and unnecessary personal data.

## Terminal gates

`PASS` requires all of the following on one current integrated snapshot:

- every blocking requirement is exactly `pass`;
- every required audit, command, runtime, and browser gate is exactly `pass`;
- every required evidence reference resolves to the current snapshot;
- no unexplained `missing`, `partial`, `skipped`, `not_run`, `unsupported`, or flaky-only result;
- no open blocking finding or unowned material change;
- artifact isolation and redaction are verified;
- pre-existing dirty contents were preserved or deliberately integrated.

Red tests, worker failures, weak evidence, harness defects, and convention findings are correction
work, not objective blockers. Deployment or production mutation requires the authority defined by
the target project; prompt generation never grants it.
