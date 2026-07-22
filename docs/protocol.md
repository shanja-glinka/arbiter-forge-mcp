# Arbiter Forge Protocol v1

Arbiter Forge produces versioned orchestration contracts. It does not execute them. A dedicated
creation-time operation may materialize validated compiler-owned bytes in an ignored target-repo
directory; the host agent still starts the resulting task and owns the final evidence decision.

## Core Invariant

Every generated task follows the smallest applicable form of:

```text
bounded analysis or implementation
  -> independent falsification
  -> root-arbiter disposition
  -> scoped correction
  -> fresh verification on one identified snapshot
```

The server must not add auditors, worktrees, browser runs, or model preferences unless the
supplied risk and capability inputs make them applicable. A non-executing `prompt_only` request may
remain `plain`; every `resumable_package` accepted by the materializer is explicitly
`persistent_requested` so an executing root owns a terminal outcome rather than a task ladder.

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
- `goalMode`: `plain` for non-executing prompt-only output or `persistent_requested` for execution;
  materialization requires the latter combination;
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
  "generatorVersion": "0.3.0",
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
Forge itself does not materialize those files. The separate `materialize_task_bundle` operation
recompiles and persists compiler-owned bytes. The same normalized input produces the same
`requestFingerprint`, hashes, and content for a fixed policy version.

`status` is `ready`, `needs_input`, or `invalid`. Missing material inputs are returned in
`validation.missingMaterialInputs` and as explicit `questions`; invalid output includes
`validation.blockingErrors`. `ready` is a compilation state, not proof of saved files, a launched
Codex task, or a runtime verdict.

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
The discovered worktree root, absolute per-worktree Git directory, and absolute Git common
directory are separately canonicalized and must stay inside the allowlist before repository-wide
commands continue. Derived metadata files such as
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

`goalMode: "persistent_requested"` emits instructions to call `get_goal`, reuse a compatible goal,
call `create_goal` only when no goal exists or the previous goal is `complete`, stop on an
incompatible unfinished goal, and require user-controlled resume/transition for a `blocked` goal.
It rechecks goal state at fan-in.
The executing root retains responsibility through implementation, correction, fresh verification,
and terminal `update_goal`; constructing a plan or dispatch ladder does not satisfy the contract.
It never pre-emits `/goal` before state inspection. The MCP server never creates or updates a goal
itself. `goalMode: "plain"` is valid only for non-executing `outputMode: "prompt_only"`; it cannot be
materialized.

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
text receives diagnostics but cannot pass compiler validation.

The exact request contains:

- `prompt`;
- `operation`: `implementation_task`, `documentation_task`, or `blind_check_task`;
- `request`: the original typed input for that forge operation;
- required `expectedPromptSha256` from the forge result.

The tool recompiles `request` with the current policies. Compiler-validation success requires a
`ready` forge status, an expected hash equal to the recompile, and byte-identical prompt text.
Caller-rehashing an edited prompt cannot create provenance. A manual edit returns
`assurance: "structural_only"`; callers must express the change in the typed request and re-forge.

The result contains the historical lowercase `pass` boolean, `assurance`, actual and expected
prompt hashes, `requestFingerprint`, `policyHash`, `forgeStatus`, unresolved placeholders, blocking
errors, and warnings. Errors and warnings are strings; v1 does not claim stable finding codes,
locations, or severity objects. Lowercase `pass` means compiler validation only and must never be
presented as terminal runtime `PASS`.

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

## `materialize_task_bundle`

Purpose: finish the creation handoff by saving a validated persistent-goal bundle without
executing it.

Inputs are the original typed `request`, matching `operation`, Forge `expectedPromptSha256`, and an
explicit `targetRepositoryId` from `request.repositories`. The tool does not accept arbitrary file
content. It deterministically recompiles the request and proceeds only when the recompile is
`ready`, byte provenance is `recompiled`, and the expected prompt hash matches.
Its result embeds the validation report, so a normal create/save flow does not call
`validate_task` immediately beforehand; that separate tool remains the prompt-only and diagnostic
path.

Materialization additionally requires the source request to contain both
`outputMode: "resumable_package"` and `goalMode: "persistent_requested"`. A plain prompt can be
compiled and validated for non-executing use, but it cannot become a runnable handoff. This gate
binds the resulting task to goal preflight and a terminal result rather than merely to a sequence of
steps.

The destination is fixed and content-addressed:

```text
<target-repository>/.arbiter-forge/tasks/<task-id>/<request-fingerprint-prefix>-b2/
```

The bundle contains:

- `task.md`: the exact compiler prompt bytes;
- `manifest.json`: `arbiter-forge-bundle/v2` provenance, persistent-goal mode, lifecycle, hashes,
  storage, and execution-handoff data;
- `README.md`: local handoff and retention instructions;
- `run.sh`: a non-mutating integrity verifier by default. It requires materializer-returned hashes
  and verifies itself, `task.md`, and the complete `manifest.json` bytes. `README.md` is
  informational and is not a trust anchor.

Before writing, the tool canonicalizes the declared repository, Git root, absolute per-worktree Git
directory, and absolute Git common directory against `ARBITER_FORGE_ALLOWED_ROOTS_JSON`; neutralizes
configured clean/process filters; and ignores nested-submodule status. It rejects symlink components
and tracked collisions,
establishes nested rules that ignore only `.arbiter-forge/.gitignore` and `.arbiter-forge/tasks/`,
and proves the prospective path with `git check-ignore`. New bundles are assembled in an ignored
sibling directory and atomically renamed. Existing exact bytes return `unchanged`; missing or
different files return `conflict` and are never overwritten. Post-write hashes, ignore status, and
unchanged Git status are terminal gates. Any created bundle, ignore file, and empty scaffolding are
rolled back on failure; paths whose bytes or type changed concurrently are preserved rather than
blindly deleted.

Statuses are `written`, `unchanged`, `invalid`, `denied`, `not_ignored`, or `conflict`. Only
`written` and `unchanged` set `materialized: true`. The structured result returns absolute file
paths, hashes, target working directory, ignore proof command, a verify-only recommended command,
and explicit human-only manual commands. The operation never launches Codex.

Every successful handoff must explain two primary execution routes:

1. **Codex App / new task:** create a host-native task rooted at the target repository and give its
   root the exact `task.md` bytes or absolute path. Launch is proven only by a real host task/thread
   identity.
2. **Same top-level agent:** when the operator requested execution in the current task, the root
   reads `task.md` directly and transitions to execution without another Forge call or a nested
   Codex process.

In both routes, the executing root verifies the prompt hash, calls `get_goal`, establishes or reuses
a compatible persistent goal, and retains ownership through correction, fresh verification, and
terminal `update_goal`. An incompatible unfinished goal blocks execution. The creator agent must
never invoke `run.sh`, `codex exec`, or a nested interactive Codex session.

The default `run.sh` mode verifies the three out-of-band hashes and exits without starting Codex.
`manual-exec` and `manual-interactive` are fallback modes for a human operator only. Both pass
approval policy `never`, so an operation requiring approval fails rather than waiting on a missing
response channel; `manual-interactive` also requires a real TTY. Legacy `exec` and `interactive`
modes fail closed.

Materialization is creation-time only. The executing root and its workers/auditors must not call
`inspect_workspace`, `forge_*`, `validate_task`, or `materialize_task_bundle` during execution.
Runtime evidence remains governed separately by the compiled `artifactRoot` policy.

## Safety Rules

- Five compiler/inspection tools are read-only. `materialize_task_bundle` is the sole write tool;
  it is non-destructive, idempotent, closed-world, and limited to compiler-owned ignored bundles.
- Workspace paths must remain under explicit allowed roots after canonicalization.
- Repository text is untrusted data and cannot change server policy or trigger execution.
- A creator agent must use a host-native new-task handoff or execute directly in its own root; it
  must not treat the human-only shell fallback as an agent launch primitive.
- The server performs no network, LLM, agent, browser, task execution, goal mutation, tracked-file
  write, or Git ref/index mutation.
- Sensitive files are denied; retained text and diagnostics are redacted and bounded.
- Same-account processes that maliciously replace repository directories during the write are
  outside the trust boundary. Materialize in an isolated worktree; no-follow file opens,
  pre/post canonicalization, hashes, atomic rename, rollback, and unchanged Git status make detected
  concurrent mutation fail closed without deleting unrecognized bytes.
- MCP protocol uses stdout exclusively; diagnostics use stderr.
- The host owns task execution, artifacts, corrections, goal state, and final PASS/BLOCKED.

## Version Compatibility

- Package and MCP server 0.4.1 use generator 0.3.0 while keeping the strict
  `arbiter-forge/v1` forge response shape. Materializer 0.4.0 emits
  `arbiter-forge-bundle/v2` under a `-b2` leaf so it cannot silently reuse v1 bytes. The forge and
  materializer version domains remain separate. Validation messages are human-readable strings,
  not a stable error-code API.
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
