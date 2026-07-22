# ADR-0003: Durable Multi-lane Execution Profile

- Status: Proposed
- Date: 2026-07-22
- Decision owners: Arbiter Forge maintainers

## Context

GPT-5.6 Sol can coordinate several independent workstreams, but prompt memory is not a task
scheduler. Compaction can preserve the important meaning of a session without proving that every
parked lane, lease, dependency, or terminal receipt survived. A lane can therefore remain visible in
the transcript and still starve when the arbiter keeps selecting newer ready work.

OpenAI's current multi-agent guidance recommends bounded, cleanly independent tasks and a default
maximum of three concurrent subagents. Ordered chains, tightly shared mutable state, and fixed
deterministic graphs are poor fits for prompt-only delegation. Codex worktrees provide the required
isolation for parallel writers, while hooks can checkpoint and reconcile state at compaction,
resume, subagent, and stop boundaries.

The existing Arbiter Forge MCP is intentionally a creation-time compiler and materializer. Turning
that server into a long-running agent scheduler would mix deterministic task construction with
mutable execution state and would make every worker pay for repeated MCP instruction lookups.

## Proposal

Add a future opt-in `durable_multi_lane` execution profile, implemented by a host-side runner or
Codex integration rather than by the MCP compiler process. Forge may compile the profile's
invariants into `task.md`, but execution agents still receive instructions from the root arbiter and
never query Forge during a run.

The first supported envelope is:

- at most three concurrently active lanes;
- one writer in a shared worktree;
- multiple writers only in separate worktrees with declared, non-overlapping write sets;
- read-only discovery, testing, and audit lanes may overlap a writer;
- four or more tightly coupled write lanes are unsupported until the runner proves equivalent
  isolation and recovery semantics.

## Durable control state

The runner owns an ignored, repository-local control directory:

```text
<repository>/.arbiter-forge/runs/<run-id>/
├── state.json
├── events.jsonl
└── receipts/
```

Runtime logs, screenshots, traces, videos, and raw payloads remain in the compiled evidence
`artifactRoot`; the control directory stores only bounded scheduling state and hashes. It is not a
Git artifact or a substitute for evidence.

Each lane record contains at least:

- lane ID, parent requirement IDs, dependencies, and blocking status;
- `pending -> ready -> leased -> running -> produced -> auditing -> accepted` lifecycle;
- explicit `parked`, `recovery_required`, `blocked`, and `failed` exceptional states;
- requested and actual model/provider route;
- owner, worktree, base snapshot, and write set;
- attempt number, idempotency key, lease expiry, heartbeat, and fencing token;
- exact `nextAction` plus `resumeAt` or `resumeWhen` for every parked lane;
- produced commit/diff and artifact hashes;
- independent audit receipts and their audited snapshot.

`events.jsonl` is append-only. `state.json` is an atomically replaced materialized view. Receipts
are immutable and content-addressed so a resumed arbiter can distinguish fresh proof from stale
claims.

## Scheduling invariants

1. `parked` without `resumeAt` or `resumeWhen` is invalid.
2. After every terminal lane transition, the arbiter scans resumable parked lanes before selecting
   new work.
3. A child slice marked `accepted` never closes its parent requirement by implication.
4. A dependency is satisfied only by `accepted`, not by worker-reported `passed` or `produced`.
5. The final join gate requires every blocking requirement to be accepted and every required audit
   to pass on one current integrated snapshot.
6. A missing heartbeat or terminal receipt advances the lane to `recovery_required`; it cannot
   silently disappear from the frontier.
7. Recovery creates a fresh bounded context from the lane manifest and last valid receipt. A
   repeatedly inconsistent context is quarantined instead of being trusted because it is old.
8. Auditors receive clean contexts. Strict blind-check D1, D2, and D3 retain their existing physical
   source separation.

## Resume and compaction protocol

On startup, resume, or post-compaction, the root reconciles the persistent goal, task prompt hash,
lane ledger, live agents, worktrees, commits, leases, and receipts before dispatching new work. A
short frontier digest may be injected into the context, but the files remain authoritative.

Recommended Codex hook responsibilities:

- `PreCompact`: atomically checkpoint the ledger; reject compaction if the checkpoint fails;
- `SessionStart` after resume or compaction: inject the current frontier and blockers;
- `SubagentStart`: supply only the lane manifest, route, write set, base snapshot, and report schema;
- `SubagentStop`: require a terminal receipt, commands, exit codes, and hashes;
- `Stop`: reject root completion while the global join gate is open.

Hooks are enforcement points, not the source of truth. A missed hook is detected during the next
reconciliation.

## Model routing

The existing Arbiter Forge role routes remain applicable:

- Sol high/xhigh for root arbitration, architecture, and hard debugging;
- Terra low/medium/high/xhigh for bounded implementation according to complexity;
- Luna or Terra for deterministic test execution and quick log triage;
- a fresh Sol or independently configured high-capability route for material code/security audits;
- an operator-provided Claude custom agent or external adapter for frontend work when actually
  available.

The Responses API multi-agent tool shares the request's model and tools across its subagent tree.
True cross-model routing therefore requires Codex custom-agent configurations or an external host
adapter, with the actual route recorded in each lane receipt.

## Consequences

### Positive

- Session compaction no longer decides whether a parked requirement survives.
- The root spends tokens on arbitration and exception handling instead of repeatedly replaying raw
  worker logs.
- Crash recovery, fairness, parent/child closure, and stale evidence become machine-checkable.
- Two or three independent lanes can run concurrently without claiming unsafe general-purpose
  parallelism.

### Trade-offs

- This needs a stateful host runner and lifecycle tests; a stricter prompt alone is insufficient.
- Repository-local control state must be ignored, access-controlled, bounded, and reconciled with
  real process and Git state.
- Leases and hashes reduce accidental corruption but do not defend against a malicious same-account
  process.
- The profile remains proposed. Arbiter Forge 0.4.1 does not create run ledgers, install hooks, or
  schedule agents. Its separate peer-coordination skill is an advisory root-to-root protocol, not
  an implementation of this runner.

## References

- [GPT-5.6 model guide](https://developers.openai.com/api/docs/guides/latest-model)
- [Responses API multi-agent guide](https://developers.openai.com/api/docs/guides/responses-multi-agent)
- [Responses API compaction guide](https://developers.openai.com/api/docs/guides/compaction)
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex long-running work](https://learn.chatgpt.com/docs/long-running-work)
