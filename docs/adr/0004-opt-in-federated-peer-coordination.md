# ADR-0004: Opt-in Federated Peer Coordination

- Status: Accepted
- Date: 2026-07-22
- Decision owners: Arbiter Forge maintainers

## Context

Two independent Codex root tasks can discover that they share a worktree, ports, process trees, or
an immutable test environment. In an observed Catalog/CL-005 run, one root sent an attributed
cross-task request after two failed acceptance attempts. The peer stopped its process tree, proved
nine ports free, froze writes, preserved a read-only next action, and waited while the claimant ran
its gate. Both roots correctly distinguished an intermediate test PASS from resource release.

This emergent behavior is useful but incomplete. It achieved cooperative safety without proving
liveness: the observed trace had no final release, the requested 10-20 minute window expanded, and
the parked peer could have waited indefinitely. Natural-language messages alone provide no lease,
fencing token, atomic claim, crash recovery, stale-message rejection, or third-root exclusion.

The Forge MCP server is a deterministic creation-time compiler and materializer. Runtime thread
discovery, delivery, scheduling, locking, and recovery would violate that boundary and make normal
task generation depend on mutable host state.

## Decision

Ship `workspace-peer-coordination` as an independent opt-in plugin skill. Do not change any Forge
request schema, rendered prompt, request fingerprint, policy hash, materialization format, or MCP
tool.

The companion protocol is root-brokered:

```text
REQUEST -> PARKED_ACK -> CLAIMED -> RELEASED -> RESUMED
```

Workers and auditors report conflicts to their own root. Only roots send cross-task messages, so
the sender action and attributed incoming message remain visible to the arbiters. Each root verifies
the shared environment independently; peer statements are requests, not authority.

Every claim has an explicit resource set, snapshot, bounded deadline, protected scopes, next action,
evidence, and claim token. Version 1 permits no silent or in-place extension. A claimant that needs
more time releases and creates a new coordination ID. Missing, late, stale, or conflicting events
enter fail-closed recovery.

A bundled deterministic evaluator validates JSONL event order, participants, deadlines, tokens,
terminal receipts, and overlapping active resources. It validates protocol structure, not the truth
of shell, Git, browser, or process evidence.

## Runtime boundary

The following remain outside Arbiter Forge MCP:

- peer thread discovery and message delivery;
- process termination, port checks, and workspace verification;
- durable ledgers, leases, heartbeats, fencing enforcement, and wake-up;
- crash recovery and global scheduling;
- semantic resolution of disputed ownership or product requirements.

If repeated evaluation demonstrates that advisory coordination is insufficient, implement those
mechanics in a separate host coordinator around supported Codex thread primitives. Use Sol for
semantic arbitration and exception handling; deterministic host code should own delivery and
lifecycle mechanics.

## Promotion gate

Do not add a `coordinationProfile` or similar Forge input until controlled Sol-to-Sol and
Sol-to-Terra trials show:

- zero overlapping exclusive resource claims;
- attributed delivery or explicit failure for every event;
- verified release and resume for every successful claim;
- fail-closed expiry, stale token, duplicate, compaction, crash, and third-root behavior;
- unchanged legacy Forge bytes and fingerprints.

Any later Forge integration must be optional with no default and preserve the current compiler
output unless explicitly selected.

## Consequences

The plugin can capture useful model cooperation now without making every generated task pay for a
runtime coordinator. The protocol remains portable and reversible, but safety is cooperative rather
than adversarial. Hard multi-client guarantees still require a host component.
