# Evaluation plan

Evaluate the protocol separately from Arbiter Forge prompt compilation. Forge remains unchanged;
the host supplies independent root tasks and any cross-task transport.

## Baseline

Record before enabling the skill:

- conflicting writes or process collisions;
- failed/restarted gates and wasted runtime minutes;
- time a peer remains parked;
- cross-task messages and approximate added context;
- whether release and resume are explicit;
- operator interventions.

Do not compare only final task success. A successful task may still have starved or overwritten its
peer.

## Controlled scenarios

Run each scenario with fresh task identities and artifacts:

1. Two roots need the same ports and immutable worktree gate.
2. Roots share a repository but have disjoint write sets and should avoid unnecessary parking.
3. The claimant stops after `CLAIMED` without sending `RELEASED`.
4. A duplicate or stale-token `RELEASED` arrives.
5. The peer compacts or restarts while parked.
6. A third root requests an overlapping resource.
7. Cross-task tools are unavailable or identify more than one possible peer.
8. A claimed window expires before the critical section finishes.

Use Sol-to-Sol and Sol-to-Terra pairs when those routes are actually available. Record requested and
actual models; do not fabricate diversity.

## Metrics

- unsafe overlapping exclusive use;
- confirmed delivery and acknowledgement rate;
- time from conflict detection to `CLAIMED`;
- time from `RELEASED` to verified `RESUMED`;
- false-positive parking and total parked duration;
- recovery time after expiry, crash, or compaction;
- stale/duplicate event rejection;
- cross-task edits outside declared scopes;
- coordination context added to each root;
- fairness: longest wait and repeated wins by one task.

## Promotion gate

Run 10-20 repetitions before compiling any coordination option into Forge. Promote only when:

- exclusive resources never overlap;
- every sent event is visible as an outgoing action and an attributed incoming receipt or explicit
  delivery failure;
- every successful claim ends in verified `RELEASED` (or claimed `ABORTED`) and `RESUMED`;
- expiry, stale tokens, and duplicate sequences fail closed;
- compaction/restart preserves the exact next action;
- absence of cross-task tools degrades to safe serialization;
- ordinary Forge prompt bytes and request fingerprints remain unchanged.

If semantic negotiation succeeds but delivery, wake-up, or crash recovery remains unreliable, add a
separate host-side coordinator around Codex thread primitives. Keep discovery, delivery, leases,
heartbeats, locks, and recovery outside the Forge MCP server.

## Artifacts

Keep live run evidence under the task's existing ignored artifact root. Suggested contents:

```text
<artifact-root>/peer-coordination/<run-id>/
├── events.jsonl
├── environment.json
├── result.json
└── evidence/
```

Record commands, exit codes, timestamps, thread/task IDs, actual routes, relevant hashes, and a
verdict. Never add raw traces, screenshots, process dumps, or coordination ledgers to Git.

The bundled evaluator checks bounded input, canonical resources, global event ordering, direction,
deadlines, tokens, terminal receipts, and overlapping active resource claims:

```bash
node scripts/evaluate-trace.mjs --self-test
node scripts/evaluate-trace.mjs /absolute/path/to/events.jsonl
```

It validates protocol structure only. It cannot prove that a process stopped, a screenshot is
authentic, or a workspace remained immutable.
