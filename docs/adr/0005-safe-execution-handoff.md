# ADR-0005: Safe Goal-first Execution Handoff

- Status: Accepted
- Date: 2026-07-23
- Decision owners: Arbiter Forge maintainers
- Amends: ADR-0002 launch semantics only

## Context

The v1 repository-local handoff correctly separated compiled, materialized, and launched states,
but its shortest printed command started `codex exec`. A creator agent could therefore invoke the
script itself, block its own session on a nested Codex process, and inherit an approval policy for
which the nested process had no usable response channel. The handoff also left operators to ask how
to open the task in Codex App or make the current agent continue.

An executable orchestration task needs more than a sequence of steps. One root must establish a
persistent goal, retain ownership across delegated implementation and audits, recover through
correction loops, and record a terminal outcome. Materialization without that lifecycle makes it
too easy for an agent to stop after creating a plan or dispatch ladder.

## Decision

Package 0.4.1 uses generator 0.3.0, materializer 0.4.0, and
`arbiter-forge-bundle/v2`. Bundle v2 is written under a distinct leaf:

```text
<target-repository>/.arbiter-forge/tasks/<task-id>/<request-fingerprint-prefix>-b2/
```

The `-b2` suffix prevents old v1 bundle bytes from being mistaken for the amended handoff.

### Materialization eligibility

`materialize_task_bundle` accepts only requests containing both:

```json
{
  "outputMode": "resumable_package",
  "goalMode": "persistent_requested"
}
```

`goalMode: "plain"` remains valid only for non-executing `prompt_only` compilation and validation.
The MCP server does not create the goal; it compiles the lifecycle contract for the executing root.

### Creator boundary

After materialization, a creator agent must state that the task was not launched and must present
two host-native execution routes. It must never invoke `run.sh`, `codex exec`, or a nested
interactive Codex session.

1. **Codex App / new task.** Create a user-owned task with the target repository as its working
   directory and supply the exact `task.md` bytes or absolute path. Claim `launched` only after the
   host returns a real task/thread identity.
2. **Same top-level agent.** If the operator requested execution in the current task, read the exact
   `task.md` directly and transition into execution mode. Do not call Forge again and do not start a
   child Codex process merely to replay the prompt.

If the operator asked only for creation, the creator stops after giving both routes and their exact
paths. If the operator explicitly asked this same agent to execute, the handoff is an intermediate
state, not permission to stop.

### Goal-first execution

Both routes use the same root lifecycle:

1. verify `task.md` against the materializer-returned SHA-256;
2. call `get_goal` before any creation attempt;
3. reuse a compatible active goal or create one only when no goal exists or the previous goal is
   `complete`; a `blocked` goal requires user-controlled resume/transition and cannot be replaced;
4. execute the compiled contract, including scoped correction and fresh audits;
5. call terminal `update_goal` only after fresh `PASS`, or after the contract's repeated-blocker
   threshold justifies `BLOCKED`.

A plan, checklist, ladder, child dispatch, or worker-reported success is not a persistent goal or a
terminal result. Only the top-level executing root manages that goal.

### Verify-only script and human fallback

`run.sh` requires the returned script, prompt, and manifest hashes. Its default `verify` mode checks
all three and exits without starting Codex.

Two explicit fallback arguments remain available to a human operator:

- `manual-exec` starts non-interactive Codex with approval policy `never` and workspace-write
  sandboxing;
- `manual-interactive` requires a real TTY and also pins approval policy `never`.

Approval policy `never` makes an operation that needs approval fail instead of waiting forever on a
channel that may not exist. Legacy `exec` and `interactive` modes are rejected. These manual modes
are operator escape hatches, not agent orchestration primitives.

## Consequences

### Positive

- Creation always returns actionable Codex App and same-agent instructions.
- A creator cannot accidentally block itself by treating the bundle script as a nested task API.
- Every materialized task has an explicit root-owned goal and terminal lifecycle.
- The default shell command is safe to use as an integrity check and cannot launch by omission.
- Bundle v1 storage and provenance decisions remain intact while incompatible launch semantics are
  isolated in bundle v2.

### Trade-offs

- Existing automation that used the default v1 launcher must choose a host-native route or an
  explicit human-only manual mode.
- A host without goal tools cannot execute a materialized v2 task under the required contract; it
  must remain prompt-only or report the capability blocker.
- Arbiter Forge still cannot prove a task launch, goal mutation, or runtime PASS. Those receipts
  belong to the host and executing root.
