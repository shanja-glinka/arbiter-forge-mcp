# Model Routing and Goal Lifecycle

Forge compiles preferred and fallback routes; the host launches agents and attests the actual
route. Never claim a provider, model, reasoning level, or custom agent was selected until the host
observes it. Model diversity complements fresh-context and input isolation; it never replaces them.

## Preferred routes

The built-in optimized profile renders only roles applicable to the current workflow:

| Role                                        | Preferred route                                                                   | Purpose                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `root_arbiter`                              | existing root session; recommend starting it on GPT-5.6 Sol high                  | requirements, boundaries, fan-in, disputed findings, final verdict |
| `task_discovery` / `implementation_analyst` | GPT-5.6 Terra high                                                                | pre-Forge framing; documentation synthesis also uses these roles   |
| `implementation_worker`                     | Terra low / medium / high for Compact / Standard / Critical                       | implementation and bounded corrections                             |
| `frontend_worker`                           | observed `arbiter-forge-ui-claude` custom agent, then Terra high, then Sol medium | frontend implementation without assuming Claude exists             |
| `test_runner`                               | Luna low, then Terra low                                                          | deterministic commands and evidence collection                     |
| `playwright_operator`                       | Luna medium, then Terra medium                                                    | browser execution and trace capture                                |
| `acceptance_auditor`                        | Sol medium; Critical uses high                                                    | behavior, negative cases, and evidence judgment                    |
| `code_quality_auditor`                      | Sol high                                                                          | correctness, security, ownership, and conventions                  |
| `blind_d1` / `blind_d2`                     | separate Terra high contexts                                                      | expected and observed inventories                                  |
| `blind_d3`                                  | Sol high in another fresh context                                                 | full-outer comparison and discrepancy classification               |
| on-demand debugger                          | Sol high, then Terra xhigh                                                        | escalation only; never an unconditional Critical lane              |

`light` is a composer label, not a routing-schema effort. Express lightweight work as `low`. Use
`xhigh`, `max`, or `ultra` only after measured complexity justifies it. A fast runner may execute
tests, but it must not be the only final judge for Standard or Critical work.

## Operator overrides

Keep `modelRouting: "adaptive"` and pass `roleRouting.assignments` to replace only named applicable
roles. Each assignment supplies ordered `candidates`, `onUnavailable: fallback | block`, and
optional model/provider diversity preferences. Provider and model IDs are opaque operator data so
future OpenAI tiers, a Responses-compatible gateway, local models, or external executors do not
require a protocol-major change.

Set `diversityMode: prefer` for best effort. Set `diversityMode: require` when dispatch must stop
unless the actual route ledger proves a different model/provider from every named comparison role.
Candidate order is the tiebreaker after diversity, not before it.

Route execution kinds have distinct semantics:

- `codex_subagent`: direct model/reasoning override; requires an exact model ID;
- `inherited_subagent`: fresh child using the parent route when selection is unavailable;
- `codex_custom_agent`: a preconfigured Codex agent type that may pin model, provider, tools, and
  instructions; the candidate names only that agent type because configuration attests its route;
- `external_adapter`: a non-native executor with separate timeout, worktree, artifact, and
  attestation requirements; the candidate names only the adapter;
- `root_session`: the already-running top-level arbiter, never a spawned duplicate.

When overriding model or agent type, use `fork_turns="none"` or a bounded positive turn count.
`fork_turns="all"` inherits the root agent type/model/reasoning and therefore cannot be used to
claim a different route.

Claude is conditional. Current Codex custom providers require a compatible Codex wire API; a native
Anthropic Messages endpoint is not itself a Codex subagent provider. Use Claude only through an
observed custom agent backed by a compatible gateway, or an explicitly configured Claude
CLI/MCP adapter. Otherwise take the declared fallback and record that Claude did not run. Forge
never writes provider credentials or global provider configuration.

## Task-framing economy

Do not spend Sol tokens on mechanical discovery. For Standard and Critical implementation-task
creation, use a bounded Terra-high analyst to reconstruct requirements and another read-only analyst
when code ownership must be recovered. The Sol root receives their distilled typed reports,
resolves only material ambiguity, constructs the Forge request, validates the compiled prompt, and
later owns fan-in. Compact implementation tasks normally skip separate framing agents.

Documentation and blind-check creation do not perform that semantic framing. They validate source
partitions and hashes only; the compiled I1/I2 or D1/D2 execution roles perform the independent
reading once.

## Capability probe and fallback

Inspect and pass the actual root route, model registry, custom-agent files, provider/adapter
inventory, spawn schema,
reasoning levels, concurrency limit, nesting limit, browser/image tools, and project agent mappings
before promising a route. A complete capability inventory may prove a candidate available or
unavailable; an absent inventory leaves it unknown.

If selection is unavailable, record a truthful fallback:

```yaml
role: implementation_worker
requestedRoute: openai/gpt-5.6-terra/medium
actualRoute: inherited-subagent
routingStatus: degraded
reason: worker API has no model selector
```

Preserve quality with narrower scopes, explicit acceptance, and stronger independent review.
`onUnavailable=fallback` allows an ordered degraded chain. `onUnavailable=block` is an exact-route
contract with one candidate and fails closed when that candidate cannot be selected. A fallback
chain that is proven fully unavailable is also a
blocking configuration error because a required lane cannot execute. Do not rewrite global model
configuration for a single task.

## Compilation boundary

Arbiter Forge is used once to create and validate the execution prompt. It is not an instruction
service for running agents. Start execution in a clean task when token economy matters; do not give
workers the Forge transcript. During execution, the root routes work and corrections directly from
the compiled contract. Only an operator-approved change to the typed source request justifies a new
Forge run.

Escalate capability rather than repeating an unchanged prompt: correct deterministic input once;
send interpretation to a stronger analyst; let Sol resolve cross-boundary design or auditor
conflict; then return a narrowed correction to a builder. Every report records `requestedRoute`,
`actualRoute`, `routingStatus`, `fallbackReason`, isolation mode, tools, and snapshot. Record
decisions and evidence, not hidden reasoning.

## Goal ownership

Generated task prompts do not pre-emit `/goal`, because that would mutate goal state before
inspection. Perform goal preflight before calling `create_goal`:

1. Confirm that the user explicitly requested persistent goal execution and that a goal tool or host
   goal launch mechanism actually exists.
2. Inspect current goal state. If no goal exists, call `create_goal` once with the measurable
   outcome.
3. If a compatible active goal exists, reuse it and do not create a duplicate.
4. If an incompatible unfinished goal exists, do not replace it. Report the conflict and request the
   user-controlled transition needed to proceed.
5. If the task was already launched through a host goal command, treat that goal as active and do
   not create another one.

Without an explicit persistent-goal request, render a normal goal heading. If state inspection is
unavailable, record the limitation and do not claim that duplicate/conflict preflight succeeded.

Only the top-level user-facing root orchestrator owns goal lifecycle:

1. Keep the objective outcome-oriented; keep the orchestration manual in the prompt body.
2. Inspect goal state at every major fan-in, after material correction waves, and before a terminal
   decision when the tool exists.
3. Reconcile the active goal with the task snapshot and finding ledger; never let a stale or different
   goal inherit this task's PASS.
4. Mark complete only after the integrated snapshot has fresh required audits, every blocking gate
   passes, and no required work remains.
5. Mark blocked only when the goal tool's repeated external-blocker threshold is satisfied and no
   meaningful in-scope progress remains.

Workers and auditors never create or update competing goals. Red tests, worker failure, partial work,
audit corrections, pauses, and budget pressure are not terminal goal blockers. Do not set a token
budget unless the user explicitly requests one.
