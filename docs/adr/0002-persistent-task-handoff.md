# ADR-0002: Persistent Repository-local Task Handoff

- Status: Accepted; launch semantics amended by ADR-0005
- Date: 2026-07-22
- Decision owners: Arbiter Forge maintainers

## Context

Generator 0.2.0 could compile and validate a task and optionally return `task.md` and
`manifest.json` inline. Nothing required the host agent to save those bytes, report a path, or
provide a launch command. Consequently, `status: ready` could be misreported as “task created” even
though no file or Codex task existed. Using operating-system `/tmp` as an improvised handoff also
made task packages vulnerable to reboot cleanup and confused them with runtime evidence.

## Decision

Add one explicit creation-time MCP operation, `materialize_task_bundle`.

The operation accepts the original typed request, matching operation, expected prompt SHA-256, and
an explicit target repository ID. It recompiles under current policy and writes only
compiler-produced bytes when the result is `ready` and provenance is byte-identical. It never
accepts caller-defined file content and never starts Codex.

The fixed destination is:

```text
<target-repository>/.arbiter-forge/tasks/<task-id>/<request-fingerprint-prefix>/
```

`.arbiter-forge` is used instead of generic `tmp/` so ownership and retention are unambiguous. It is
a persistent local ignored handoff, not an archive: it normally survives reboot, but manual cleanup
or `git clean -fdx` may remove it.

Every bundle contains exact `task.md`, deterministic `manifest.json`, a local `README.md`, and a
hash-checking `run.sh`. The manifest has its own `arbiter-forge-bundle/v1` schema and distinguishes
validated compilation, successful materialization, and execution-not-started.

## Lifecycle terminology

- `compiled`: Forge returned deterministic bytes; no file existence is implied.
- `validated`: recompile and prompt bytes match; files still may not exist.
- `materialized`: the bundle is present, hash-verified, ignored, and returned as `written` or
  `unchanged`.
- `launched`: an external host actually started a Codex task/thread.
- `PASS`: the executing arbiter completed the runtime evidence contract.

Only materialization may be called “saved” or “created”, and the handoff must still state that the
task has not been launched.

## Security and atomicity

The materializer:

- authorizes the canonical target root, Git root, absolute per-worktree Git directory, and Git common
  directory through `ARBITER_FORGE_ALLOWED_ROOTS_JSON`;
- requires the selected ID to exist in the compiled repository manifest;
- fixes the relative destination from validated task ID and request fingerprint;
- rejects symlink path components, target escapes, non-Git roots, and tracked collisions;
- neutralizes configured Git clean/process filters and ignores nested submodule status;
- establishes narrow nested ignore rules for only `.gitignore` and `tasks/` without modifying
  tracked project files;
- proves prospective and persisted files with `git check-ignore --no-index`;
- constructs a new bundle in an ignored sibling directory and atomically renames it;
- reuses exact existing bytes as `unchanged` and refuses partial or changed bundles as `conflict`;
- verifies post-write hashes and requires Git status to equal the pre-write status;
- rolls back its bundle, ignore file, and empty scaffolding on failure without deleting a path whose
  type or bytes changed concurrently.

The tool is annotated non-read-only, non-destructive, idempotent, and closed-world. It performs no
network call, Git ref/index mutation, arbitrary command execution, task execution, or runtime state
management.

## Launch contract

> **Amendment:** [ADR-0005](0005-safe-execution-handoff.md) supersedes this section's automatic
> launcher semantics only. The repository-local storage, provenance, atomicity, lifecycle
> terminology, and retention decisions in this ADR remain accepted.

This ADR originally made the hash-verifying script an automatic CLI launcher:

```bash
codex exec --sandbox workspace-write -C "$TARGET_ROOT" - < "$TASK_FILE"
```

That form is retained here as historical context, not as current operator guidance. In bundle v2,
`run.sh` defaults to verification only, creator agents cannot invoke its human-only manual launch
modes, and execution moves through a Codex App/new-task handoff or direct same-agent continuation.

## Consequences

### Positive

- “Created” now has filesystem evidence instead of meaning “compiled in chat”.
- Every saved task has stable links, hashes, retention semantics, and an integrity-checked handoff;
  current execution routes are defined by ADR-0005.
- The task survives ordinary reboots without entering Git.
- Execution remains independent of Arbiter Forge MCP and does not pay repeated instruction tokens.

### Trade-offs

- The MCP server now has one tightly bounded write tool and therefore needs an explicit workspace
  allowlist.
- Bundles are machine-local and intentionally absent from clones.
- `git clean -fdx` may remove ignored bundles; durable archival remains a separate operator action.
- A malicious same-account process that swaps repository directories concurrently is outside the
  trust boundary; use an isolated worktree. No-follow file opens and post-write checks narrow this
  race and detected mutation fails closed.
