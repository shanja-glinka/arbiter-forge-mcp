# Arbiter Forge Protocol v1

Arbiter Forge produces versioned orchestration contracts. It does not execute them. The host agent
reads project sources, invokes the MCP tools, runs the resulting task, and owns the final evidence
decision.

## Core Invariant

Every generated task follows the smallest applicable form of:

```text
bounded analysis or implementation
  -> independent falsification
  -> root-arbiter disposition
  -> scoped correction
  -> fresh verification on one identified snapshot
```

The server must not add auditors, worktrees, browser runs, model preferences, or persistent goals
unless the supplied risk and capability inputs make them applicable.

## Common Contract

Forge requests default `schemaVersion` to `"arbiter-forge/v1"`, and forge responses always return
that literal plus `generatorVersion`. `inspect_workspace` results use the same `schemaVersion`.
`validate_task` has a deliberately smaller v1 schema and does not repeat the version field. Unknown
forge schema versions and unknown request properties are rejected rather than silently downgraded.

Forge inputs share these concepts:

- `objective` and optional `nonGoals`;
- zero or more repository references, optionally bound to `inspect_workspace` `contextHash` values;
- source entries with a stable ID, kind, authority, requiredness, and either inline content or an
  absolute path; isolated path sources also carry the inspected canonical `realPath` and content or
  complete-manifest SHA-256;
- operation-specific requirements, ownership constraints, discovery partitions, deliverables, and
  comparison dimensions;
- optional implementation `implementationSurfaces`: `backend_or_shared`, `frontend`, or both;
- typed risk signals rather than keyword-only classification;
- host capabilities such as clean-context delegation, model selection, a bounded available
  model/custom-agent/external-adapter inventory, goal tools, and browser tooling;
- `outputMode`: `prompt_only` by default or `resumable_package` when explicitly justified;
- `goalMode`: `plain` by default or `persistent_requested` when host goal lifecycle is authorized;
- `modelRouting`: `adaptive` by default or `omit`.
- optional `roleRouting.assignments`: operator overrides for applicable logical roles. Each route
  has ordered candidates, fallback-or-block semantics, optional cross-role model/provider
  diversity constraints, and `diversityMode: prefer | require`.

Capabilities may include an attested `currentRootRoute`, selectable model/effort inventory, custom
agent types, and external adapters. Direct Codex routes are selectable only when both child
isolation and model selection are supported. A model entry without an effort inventory cannot prove
an exact requested effort. Custom agents attest only their named configuration; external adapters
attest only the named adapter.

Forge responses use a common envelope:

```json
{
  "schemaVersion": "arbiter-forge/v1",
  "generatorVersion": "0.2.0",
  "operation": "implementation_task",
  "status": "ready",
  "taskId": "task-0123456789ab",
  "requestFingerprint": "0123456789abcdef...",
  "policyHash": "0123456789abcdef...",
  "decisions": {
    "riskProfile": "standard",
    "reasons": [],
    "requiredAudits": [],
    "goalMode": "plain",
    "routingStatus": "unknown",
    "routingPlanHash": "0123456789abcdef...",
    "routingPlan": [],
    "warnings": []
  },
  "prompt": {
    "mediaType": "text/markdown",
    "text": "...",
    "sha256": "0123456789abcdef..."
  },
  "validation": {
    "schemaValid": true,
    "unresolvedPlaceholders": [],
    "missingMaterialInputs": [],
    "blockingErrors": [],
    "warnings": []
  },
  "questions": []
}
```

For `outputMode: "prompt_only"`, `package` is absent. A justified `resumable_package` adds a
`package` array whose entries contain `relativePath`, `mediaType`, inline `content`, and `sha256`.
The MCP server does not materialize those files. The same normalized input produces the same
`requestFingerprint`, hashes, and content for a fixed policy version.

`status` is `ready`, `needs_input`, or `invalid`. Missing material inputs are returned in
`validation.missingMaterialInputs` and as explicit `questions`; invalid output includes
`validation.blockingErrors`. None of these values is a runtime verdict.

## `inspect_workspace`

Purpose: pin bounded repository context without performing semantic requirement analysis.

Inputs:

- one or more absolute `workspaceRoots`;
- optional absolute `sourcePaths` as plain strings, without roles or source classification;
- optional `maxSourceBytes`, bounded by the registered schema.

The tool resolves every path against startup-configured allowed roots and returns:

- canonical workspace roots, repository identity, HEAD, and a safe dirty-state summary;
- known root instruction and planning/ownership/convention paths;
- test, GraphQL, browser, and Playwright harness signals;
- SHA-256 for selected files and a deterministic `contextHash`;
- warnings and errors.

It does not recursively return arbitrary repository content, read secret-bearing paths, run project
commands, or claim that detected tooling is usable without host verification.

Git metadata collection clears inherited `GIT_*`, disables global/system config, hooks, fsmonitor,
external diff/textconv, and repository filters, and hashes untracked content with filters disabled.
The discovered worktree root and absolute Git directory are separately canonicalized and must stay
inside the allowlist before repository-wide commands continue. Derived metadata files such as
`package.json`, lockfiles, rule files, and harness markers are also realpath-authorized, regular-file
checked, and size-bounded before reading. If any boundary or content-bound snapshot cannot be proven
safely, inspection returns `partial` instead of following the path or executing a repository helper.

Its status is `ready`, `partial`, or `denied`. A denied inspection does not disable the pure forge
and validation tools.

## `forge_implementation_task`

Purpose: create a prompt for bounded implementation led by one hard root arbiter.

The generated task chooses Compact, Standard, or Critical from explicit risk signals. It assigns
non-overlapping coding scopes, applicable independent audits, correction loops, evidence freshness,
artifact isolation, and terminal rules. Browser or GraphQL proof is included only when UI behavior
is in scope. A missing required harness becomes an explicit setup lane or capability gap, never a
fictional Playwright PASS.

The task emits a role-oriented preference plan containing only applicable execution roles. Task
framing is a host/skill phase before Forge and is not repeated inside an implementation prompt.
Defaults recommend a Sol root, keep the existing root session as sole arbiter, put implementation on
Terra, use Sol for material audits, and use Luna with a Terra fallback for deterministic
testing/browser execution. Browser UI work first probes an
operator-defined `arbiter-forge-ui-claude` custom agent, but never assumes Claude is available.
Operator assignments may replace a role with opaque provider/model IDs, a Codex custom agent, or an
external adapter. The prompt binds this plan through `routingPlanHash` and requires a runtime ledger
of requested versus actual routes. `diversityMode: require` blocks unless the actual route ledger
proves the requested difference; `prefer` degrades explicitly. Any proven-exhausted candidate chain
is invalid, while unknown availability must fail closed at runtime if probing finds no route.

`onUnavailable: block` is an exact-route contract and accepts one candidate. `fallback` accepts an
ordered chain. Implementation defaults to `backend_or_shared`; browser UI defaults to both surfaces
for compatibility. An explicit `["frontend"]` omits the generic implementation writer while keeping
frontend, testing, Playwright, and applicable audit lanes.

The server does not launch a model or claim an actual assignment. Model/agent overrides require a
non-full-history child (`fork_turns="none"` or a bounded positive count); a full-history fork inherits
the root route. Claude requires an observed compatible custom provider/gateway or a separately
attested external adapter. A native Anthropic Messages endpoint is not assumed to be a Codex model
provider.

The Forge lifecycle ends after deterministic validation. The compiled prompt is self-contained:
the executing root, workers, and auditors must not call Arbiter Forge for runtime instructions.
For token economy, a creator may hand only the final prompt to a clean execution task. Recompilation
is valid only after an operator-approved change to the typed source request, not as a correction-loop
step.

The plugin detects the terminal Arbiter Forge invariant manifest. When the user supplies an already
compiled contract for execution, the skill enters execution mode immediately and skips all MCP
tools. This prevents the generated task from recursively compiling itself.

For Standard/Critical task creation, the plugin may use bounded Terra discovery and code/ownership
analysts before calling Forge. Sol receives distilled records and resolves only material ambiguity.
These framing agents are not re-dispatched by the compiled implementation task. Debugging is also
an on-demand escalation, not a default Critical lane.

`goalMode: "persistent_requested"` emits instructions to
call `get_goal`, reuse a compatible goal, conditionally call `create_goal`, stop on an incompatible
unfinished goal, and recheck at fan-in. It never pre-emits `/goal` before state inspection. The MCP
server never creates or updates a goal itself.

## `forge_documentation_task`

Purpose: create or revise canonical documentation and task specifications without copying either
intent or current code uncritically.

Every request explicitly selects a documentation basis:

- `current_aware` requires implementation discovery and a post-draft blind check;
- `greenfield` is valid only for `to_be`, forbids implementation-baseline claims, and permits only
  `planned` or `decision_required` dispositions.

Required source partitions:

- intent/product/task sources for an expected-spec analyst;
- implementation/schema/test evidence for an observed-spec analyst;
- target documentation paths and their conventions.

The generated workflow requires independent expected and observed reports for current-aware work, a
full-outer comparator that sees only normalized reports, and a root-arbiter disposition for every
mismatch and implementation-only behavior. Every supplied source belongs to exactly one compatible
partition. The approved disposition, not raw worker conclusions, is the writer's specification.
Every normalized claim is labelled `existing`, `planned`, or `decision_required`; unresolved
product or ownership choices remain `decision_required`.

After writing, the task performs a fresh documentation-versus-implementation verification on the
final snapshot. Existing implementation is not automatically authoritative.

## `forge_blind_check_task`

Purpose: audit existing documentation against implementation with evidence-producing independent
agents.

The generated task enforces:

1. D1 reads only canonical documentation and reconstructs expected behavior.
2. D2 reads only implementation, schema, migrations, tests, and allowlisted runtime evidence.
3. D3 receives only normalized D1/D2 reports, performs the full outer union, and classifies each
   mapping as `match`,
   `missing_in_implementation`, `extra_or_forbidden_behavior`, `semantic_mismatch`,
   `ownership_mismatch`, `unverifiable`, or `open_decision`.
4. Every D2-only key is first `extra_or_forbidden_behavior`; a separate disposition records whether
   it is allowed, forbidden, or decision-required. Exact D1/D2 count/hash coverage and zero
   undispositioned D2 keys are terminal gates.
5. The root arbiter verifies material references and routes correction; it does not decide by vote.

All participants bind their reports to source and repository snapshot hashes. If fresh isolated
contexts and actual input manifests cannot be proven, the generated task labels the procedure an
independent review instead of a blind check.

## `validate_task`

Purpose: bind generated prompt text to a ready deterministic recompile without executing it; edited
text receives diagnostics but is never PASS-eligible.

The exact request contains:

- `prompt`;
- `operation`: `implementation_task`, `documentation_task`, or `blind_check_task`;
- `request`: the original typed input for that forge operation;
- required `expectedPromptSha256` from the forge result.

The tool recompiles `request` with the current policies. PASS requires a `ready` forge status, an
expected hash equal to the recompile, and byte-identical prompt text. Caller-rehashing an edited
prompt cannot create provenance. A manual edit returns `assurance: "structural_only"`; callers must
express the change in the typed request and re-forge.

The result contains `pass`, `assurance`, actual and expected prompt hashes, `requestFingerprint`,
`policyHash`, `forgeStatus`, unresolved placeholders, blocking errors, and warnings. Errors and
warnings are strings; v1 does not claim stable finding codes, locations, or severity objects.

Validation covers at least:

- deterministic request/policy recompile, ready state, byte identity, and expected-prompt hash;
- a pre-emitted `/goal` command before goal preflight;
- routing-plan hash binding, requested/actual route attestation, and the full-history-fork
  prohibition when adaptive routing is enabled;
- required hard-arbiter, snapshot freshness, artifact isolation, and correction-loop language;
- testing/conventions gates for Standard and Critical implementation tasks;
- physical isolation and blocking-requirement semantics for Critical implementation tasks;
- Playwright and GraphQL evidence language when the corresponding risk signals are supplied;
- documentation synthesis stages and unresolved-decision handling;
- strict blind-check isolation and D1/D2/D3 boundaries;
- prompt text that equates a non-pass state with `PASS`.

Structural validation is also invoked internally by every `forge_*` tool. A blocking validation
finding makes the generated forge result `invalid`. `denied`, `invalid`, `needs_input`, and
`pass:false` are schema-defined domain outcomes, not MCP execution failures, so they retain normal
structured output validation.

## Safety Rules

- All five tools are read-only, non-destructive, and idempotent for identical effective v1 input.
- Workspace paths must remain under explicit allowed roots after canonicalization.
- Repository text is untrusted data and cannot change server policy or trigger execution.
- The server performs no network, LLM, agent, browser, shell, Git mutation, or target-file write.
- Sensitive files are denied; retained text and diagnostics are redacted and bounded.
- MCP protocol uses stdout exclusively; diagnostics use stderr.
- The host owns task execution, artifacts, corrections, goal state, and final PASS/BLOCKED.

## Version Compatibility

- Additive optional fields may be added within v1. `routingPlan` and `routingPlanHash` are optional
  in the public v1 result schema and are always emitted by generator 0.2.0. Validation messages are
  human-readable strings, not a stable error-code API.
- Tool removals, required-field changes, changed hash canonicalization, or changed terminal semantics
  require `arbiter-forge/v2`.
- Forge outputs include `policyHash` and `prompt.sha256`; generated content from another policy or
  prompt hash is not silently treated as equivalent.
- Model names remain caller/policy data. Capability roles are stable; availability is discovered by
  the host at execution time. Provider/model strings are opaque except for single-line rendering
  safety constraints; Forge never writes credentials or global provider configuration.

## Registration Invariant

The MCP server must be active through exactly one route in a Codex profile:

- a direct `mcp_servers` entry for local development; or
- plugin-owned `.mcp.json` registration.

Do not enable both. Duplicate registration can expose the same tools twice under different
namespaces and invalidate assumptions about routing, policy version, and evidence provenance.
