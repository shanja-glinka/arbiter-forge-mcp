# Model Routing and Goal Lifecycle

Use capability classes first and model names as preferences. Never claim a route was assigned when
the worker API cannot select it.

## Preferred routes

| Capability               | Preferred route                       | Work                                                                      |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------- |
| `deep_reasoner`          | GPT-5.6 Sol medium/high               | root arbitration, architecture, complex debugging, security, D1/D3        |
| `builder`                | GPT-5.6 Terra medium                  | ordinary implementation, refactors, clear migrations                      |
| `cross_boundary_builder` | GPT-5.6 Sol medium/high               | security, concurrency, money, difficult cross-service fixes               |
| `fast_runner`            | GPT-5.6 Luna low/medium               | deterministic commands, test execution, log collection, mechanical checks |
| `browser_operator`       | GPT-5.6 Luna medium, then escalate    | Playwright execution and evidence capture                                 |
| `ui_or_flake_analyst`    | GPT-5.6 Terra high or Sol medium/high | visual judgment, test design, flaky cross-layer diagnosis                 |

Use extreme reasoning only after complexity or contradictory evidence justifies it. A fast runner may
execute tests, but it must not be the only final judge for Critical work.

## Capability probe and fallback

Inspect the actual model registry, spawn schema, concurrency limit, nesting limit, browser/image
tools, and project agent mappings before promising a route.

If selection is unavailable, record a truthful fallback:

```yaml
requestedCapability: builder
preferredRoute: gpt-5.6-terra/medium
actualRoute: inherited-session-model
routingStatus: degraded
reason: worker API has no model selector
```

Preserve quality with narrower scopes, explicit acceptance, and stronger independent review. An
unavailable preferred model is not a blocker unless the user explicitly required that exact model.
Do not rewrite global model configuration for a single generated task.

Escalate capability rather than repeating an unchanged prompt: correct a deterministic input once;
send interpretation to a stronger analyst; let Sol resolve cross-boundary design or auditor conflict;
then return a narrowed correction to a builder. Record decisions and evidence, not hidden reasoning.

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
