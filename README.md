# Arbiter Forge

Arbiter Forge is a local MCP server and Codex plugin that turns a normalized objective into a
deterministic orchestration task and can save the validated compiler output as a runnable,
repository-local bundle. It supports three Forge workflows, a cross-cutting routing contract, and
one independent opt-in coordination skill:

- implementation led by a hard root arbiter;
- independent documentation synthesis from intent, code, and governance;
- a strict D1/D2/D3 documentation-versus-code blind check;
- role-oriented model/provider routing with operator overrides and honest fallbacks.
- bounded root-to-root coordination when independent tasks contend for a worktree or runtime.

It deliberately does **not** execute the generated task. Its only write operation is a constrained,
idempotent creation-time materializer for compiler-owned bytes under an ignored
`.arbiter-forge/tasks/` directory. Codex remains responsible for semantic
analysis, subagent launch, actual model selection, goal lifecycle, file changes, Playwright, tests, evidence
review, and the final verdict. This boundary keeps the useful parts of a detailed orchestration
skill without building a second agent scheduler inside MCP.

## Why this shape

The product has three complementary layers:

1. `skills/arbiter-forge` teaches Codex when and how to use the protocols.
2. `skills/workspace-peer-coordination` optionally coordinates independent root tasks only when
   they contend for shared mutable resources.
3. The STDIO MCP server provides typed inputs, deterministic rendering, hashes, bounded workspace
   inspection, validation, and an explicit persistent task handoff.

Use either direct MCP registration or plugin-owned MCP registration in one Codex profile, never
both. Two registrations would expose duplicate tool sets.

## Tools

| Tool                        | Result                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `inspect_workspace`         | Allowlisted Git/rules/harness metadata and source hashes; never source contents.                |
| `forge_implementation_task` | Adaptive Compact/Standard/Critical implementation prompt with applicable independent audits.    |
| `forge_documentation_task`  | Intent/code/governance discovery, arbiter disposition, authoring, and cold-reader verification. |
| `forge_blind_check_task`    | Isolated D1/D2/D3 comparison with forbidden-extra and ownership mismatch detection.             |
| `validate_task`             | Deterministic request recompile, byte identity, ready-state, and structural terminal checks.    |
| `materialize_task_bundle`   | Save validated compiler-owned bytes in an ignored repo-local bundle and return launch commands. |

## Prompts and resources

The three prompts are convenience adapters for concise interactive use. Use the typed `forge_*`
tools when the task needs repositories, source manifests, requirements, capabilities, or other full
protocol inputs.

| Prompt                      | Arguments                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `forge-implementation-task` | `objective`; optional comma-separated `riskSignals`; `persistentGoal` (`no` or `yes`).                                                                 |
| `forge-documentation-task`  | `objective`, `targetState`, explicit `documentationBasis`, `outputPath`; current-aware mode also requires implementation path, real path, and SHA-256. |
| `forge-blind-check-task`    | `objective` plus documentation/implementation locator, canonical real path, and SHA-256 pairs.                                                         |

Five read-only resources expose the packaged long-form policy assets:

| Resource method                  | URI                                              |
| -------------------------------- | ------------------------------------------------ |
| `orchestration-method`           | `arbiter-forge://method/orchestration`           |
| `documentation-synthesis-method` | `arbiter-forge://method/documentation-synthesis` |
| `blind-check-method`             | `arbiter-forge://method/blind-check`             |
| `ui-playwright-method`           | `arbiter-forge://method/ui-playwright`           |
| `model-goal-method`              | `arbiter-forge://method/model-goal`              |

Package 0.4.0 deliberately retains generator 0.2.0's strict v1 forge envelope and deterministic
compiler bytes. It emits `requestFingerprint`, `policyHash`, `routingPlanHash`, a typed
`routingPlan`, and `prompt.sha256`. `status: ready` means compiled, not saved or launched. The new
materializer has its own `materializerVersion: "0.3.0"`; old strict v1 forge consumers therefore do
not receive an unknown response field. The server performs no LLM, network, browser, agent, goal,
or execution action.

`validate_task` accepts the generated prompt, its operation, the original typed forge request, and
the forge result's `prompt.sha256`. It recompiles that request and returns `assurance: "recompiled"`
only when the request is `ready` and prompt bytes are identical. A manually edited prompt is
`structural_only` and cannot pass compiler validation; change the typed request and forge again.
The result's historical lowercase `pass` boolean is not a runtime `PASS` verdict.

## Optional peer coordination

`workspace-peer-coordination` is a separate companion skill. It activates only when independent
root tasks share an exclusive worktree, port, process tree, service, or immutable test window. It
uses a bounded cooperative handshake:

```text
REQUEST -> PARKED_ACK -> CLAIMED -> RELEASED -> RESUMED
```

The skill keeps negotiation visible in both root transcripts, requires fresh evidence before claim
and resume, rejects silent deadline extensions, and provides a deterministic JSONL trace evaluator.
It does not add a message bus, scheduler, lock, ledger, hook, or thread-discovery tool to the MCP
server. Workers never call Forge for coordination.

Validate the packaged evaluator with:

```bash
node skills/workspace-peer-coordination/scripts/evaluate-trace.mjs --self-test
```

The live evaluation plan intentionally remains outside normal task generation. Promote peer
coordination into a future optional Forge input only after repeated host-level trials prove safe
handoffs, expiry recovery, compaction recovery, and third-root behavior.

`materialize_task_bundle` accepts the same typed request, operation, expected prompt hash, and an
explicit target repository ID. It recompiles instead of trusting caller-provided package bytes,
then saves `task.md`, `manifest.json`, `README.md`, and `run.sh` under:

```text
<target-repository>/.arbiter-forge/tasks/<task-id>/<request-fingerprint-prefix>/
```

It creates narrow nested ignore rules for only its own `.gitignore` and `tasks/`, proves each path
ignored, requires the Git root, per-worktree metadata, and common metadata directories to remain
allowlisted, neutralizes Git
filters, refuses tracked files, symlink escapes, and hash conflicts, rolls back new scaffolding on
failure, and preserves the pre-existing Git status. `written` and `unchanged` are the only
successful materialization states.

## Requirements

- Node.js 20 or later;
- pnpm 10;
- Codex with local STDIO MCP support.

## Build and verify

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm build` creates a self-contained `dist/index.js`; runtime does not depend on a plugin cache
installing `node_modules`. Long-form policies remain versioned Markdown assets beside the bundle.

## Direct Codex registration

Direct registration is the recommended local-development mode. Adjust both paths and the inspection
allowlist for the machine:

```toml
[mcp_servers.arbiter-forge]
command = "node"
args = ["/absolute/path/to/arbiter-forge-mcp/dist/index.js"]
cwd = "/absolute/path/to/arbiter-forge-mcp"
enabled = true
required = false
startup_timeout_sec = 10.0
tool_timeout_sec = 60.0
default_tools_approval_mode = "auto"

[mcp_servers.arbiter-forge.env]
ARBITER_FORGE_ALLOWED_ROOTS_JSON = '["/absolute/path/to/workspaces"]'
```

Start a new Codex task after changing `config.toml`. Verify registration with:

```bash
codex mcp get arbiter-forge --json
codex mcp list
```

Workspace inspection and task materialization fail closed when
`ARBITER_FORGE_ALLOWED_ROOTS_JSON` is absent or invalid. The three forge tools and `validate_task`
still work because they do not read or write project files.
Direct mode receives the allowlist from its explicit `config.toml` `env` table; it does not require
the variable to be exported in the environment that launches Codex.

## Plugin mode

The repository is also a valid plugin:

- `.codex-plugin/plugin.json` registers the skill metadata;
- `.mcp.json` starts the bundled server relative to the plugin root;
- `skills/arbiter-forge/SKILL.md` routes Codex to the correct workflow.
- `skills/workspace-peer-coordination/SKILL.md` supplies opt-in root-to-root contention handling.

Plugin-owned `.mcp.json` stays portable: it contains no machine path and passes
`ARBITER_FORGE_ALLOWED_ROOTS_JSON` through from the environment that launches Codex. Set the value
before starting or restarting Codex, using absolute roots for that machine:

```bash
export ARBITER_FORGE_ALLOWED_ROOTS_JSON='["/absolute/path/to/workspaces"]'
```

The `env_vars` declaration passes through an existing value; it does not create a default. If the
launching environment omits the variable or supplies invalid JSON, workspace inspection and
materialization return fail-closed denials while the three forge tools and `validate_task` remain
available. Restart Codex after changing the launch environment.

Use exactly one MCP registration route in a Codex profile:

- for plugin mode, remove or disable the direct `[mcp_servers.arbiter-forge]` entry before installing
  or activating the plugin;
- for direct mode, keep the `config.toml` entry and do not activate the plugin-owned `.mcp.json`.

The Arbiter Forge skill may remain available with direct registration only when its plugin-owned MCP
server is not also active.

## Typical use

Ask Codex to use Arbiter Forge, or call the MCP sequence explicitly:

1. `inspect_workspace` with absolute workspace and selected source paths when preflight is useful.
2. For Standard/Critical implementation-task creation, use bounded read-only task/code analysts and
   let the root arbiter normalize their distilled findings. Documentation/blind-check creation only
   validates partitions and hashes; its compiled agents perform the semantic reads once.
3. Exactly one `forge_*` tool with the objective, source manifest, typed risk signals, actual host
   capabilities, and optional per-role routing overrides.
4. For prompt-only output, call `validate_task` with the original typed request and generated hash.
   Human edits are diagnostics only; re-forge to obtain a compiler-valid prompt.
5. When the operator asked to create/save the task, call `materialize_task_bundle` **instead of a
   separate validation call**. It performs the deterministic recompile itself. Only `written` or
   `unchanged` means the bundle exists.
6. Run the returned `recommendedCommand`, or hand `task.md` to a clean execution task. The executing
   root records requested and actual routes but does not call Arbiter Forge again.

Arbiter Forge is a creation-time compiler, not a runtime instruction service. Workers and auditors
never query it. The creator pays once for inspection/compilation output; the execution task receives
only the final prompt, and each subagent receives a smaller scope packet from the root. Re-forge only
after an operator-approved change to the typed source request.

The skill recognizes the invariant manifest in an already compiled prompt and switches directly to
execution mode. It does not recursively call Forge or revalidate the task inside its correction loop.

## Persistent task handoff

Arbiter Forge uses four distinct lifecycle words:

- **compiled**: Forge returned a deterministic prompt; no file existence is implied;
- **validated**: `validate_task` proved a byte-identical recompile; files still may not exist;
- **materialized**: `materialize_task_bundle` returned `written` or `unchanged` and verified files;
- **launched**: the host actually started a Codex task/thread.

After materialization the response includes absolute file paths, hashes, working directory, and
three launch forms. The shortest is:

```bash
bash '<absolute-bundle-path>/run.sh' \
  '<run-sha256>' '<prompt-sha256>' '<manifest-sha256>'
```

Adding `interactive` after the three hashes opens an interactive Codex CLI task. The hashes returned
in the MCP handoff are an out-of-band integrity anchor: the launcher verifies itself, `task.md`, and
the complete `manifest.json` bytes, then runs
`codex exec --sandbox workspace-write -C <target> - < task.md`. `README.md` is informational; its
hash is returned at materialization but it is not a launcher trust anchor. Execution never calls
Arbiter Forge MCP. The ignored bundle survives an OS reboot, but manual cleanup or `git clean -fdx`
can remove it; it is a persistent local handoff, not a committed archive.

Example implementation input:

```json
{
  "objective": "Implement a tenant-scoped admin pricing editor backed by GraphQL.",
  "repositories": [
    {
      "id": "app",
      "root": "/absolute/path/to/app",
      "contextHash": "<sha256 returned by inspect_workspace>"
    }
  ],
  "riskSignals": [
    "browser_ui",
    "graphql_client",
    "tenant_isolation",
    "money_or_pricing"
  ],
  "implementationSurfaces": ["backend_or_shared", "frontend"],
  "goalMode": "plain",
  "modelRouting": "adaptive"
}
```

Model routes are preferences. The generated task records the actual route and degrades honestly if
the host cannot select Sol, Terra, Luna, an operator custom agent, or an external adapter. The
optimized default recommends starting the root on Sol and keeps that already-running root on
arbitration; Forge never changes or fabricates its model. Terra handles bounded pre-Forge discovery
and coding, Luna has a Terra fallback for test execution, and fresh Sol contexts handle material
audits. A configured
`arbiter-forge-ui-claude` custom agent is preferred for browser UI work, with Terra/Sol fallbacks;
Forge never assumes that agent or provider exists. `goalMode: "persistent_requested"` emits a `get_goal` →
conditional `create_goal` lifecycle, but never pre-emits `/goal` before state inspection.

`diversityMode: "prefer"` is best effort. `diversityMode: "require"` is a runtime gate: the host must
prove that the auditor's actual model/provider differs from the named worker role or refuse to
dispatch that lane. Compact prompts use a concise contract and do not replay the full Standard or
Critical orchestration appendix.

Set `implementationSurfaces: ["frontend"]` for frontend-only work. Browser UI otherwise defaults to
both frontend and backend/shared surfaces for backward compatibility. `onUnavailable: "block"`
accepts exactly one required candidate; use `fallback` for an ordered candidate chain.

For a complete walkthrough—including the split task-framing phase, Claude capability probe,
typed `roleRouting`, validation, execution ledger, and single-model fallback—see
[Multimodel task-creation scenario](docs/multimodel-task-scenario.md).

## Blind-check semantics

D1 reads only canonical documentation and reconstructs expected behavior. D2 reads only code,
schema, migrations, tests, and explicitly allowed runtime evidence. Every supplied source belongs
to exactly one allowlist; path sources carry an inspected `realPath` and content or complete-manifest
SHA-256 so aliases cannot masquerade as isolation. D3 receives only normalized D1/D2 reports and
performs a full-outer comparison, including every D2-only behavior as
`extra_or_forbidden_behavior`. The root arbiter then verifies material findings against primary
sources.

If fresh-context isolation and actual-read manifests cannot be demonstrated, the procedure is
labelled `independent_documentation_review`; it cannot claim strict blind-check PASS. This is the
mechanism that prevents an implementation-only concept from silently re-entering canonical
documentation.

## Extending Arbiter Forge

See [docs/adding-workflow.md](docs/adding-workflow.md). New workflows should add a discriminated
schema, one compiler strategy, a thin MCP adapter, policy assets, invariant/golden tests, and a
protocol-version decision. Do not add an LLM call, task executor, scheduler, or mutable findings
database to the MCP core.

Architecture and protocol details live in:

- [ADR-0001](docs/adr/0001-hybrid-plugin-mcp.md)
- [ADR-0002](docs/adr/0002-persistent-task-handoff.md)
- [ADR-0003 (proposed durable multi-lane execution)](docs/adr/0003-durable-multi-lane-execution.md)
- [Protocol v1](docs/protocol.md)

## License

Public source repository without an open-source license yet. `UNLICENSED`.
