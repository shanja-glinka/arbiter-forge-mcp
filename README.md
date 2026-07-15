# Arbiter Forge

Arbiter Forge is a local, read-only MCP server and Codex plugin that turns a normalized objective
into a deterministic orchestration task. It supports three workflows:

- implementation led by a hard root arbiter;
- independent documentation synthesis from intent, code, and governance;
- a strict D1/D2/D3 documentation-versus-code blind check.

It deliberately does **not** execute the generated task. Codex remains responsible for semantic
analysis, subagents, model selection, goal lifecycle, file changes, Playwright, tests, evidence
review, and the final verdict. This boundary keeps the useful parts of a detailed orchestration
skill without building a second agent scheduler inside MCP.

## Why this shape

The product has two complementary layers:

1. `skills/arbiter-forge` teaches Codex when and how to use the protocols.
2. The STDIO MCP server provides typed inputs, deterministic rendering, hashes, bounded workspace
   inspection, and validation.

Use either direct MCP registration or plugin-owned MCP registration in one Codex profile, never
both. Two registrations would expose duplicate tool sets.

## Tools

| Tool                        | Result                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `inspect_workspace`         | Allowlisted Git/rules/harness metadata and source hashes; never source contents.                |
| `forge_implementation_task` | Adaptive Compact/Standard/Critical implementation prompt with applicable independent audits.    |
| `forge_documentation_task`  | Intent/code/governance discovery, arbiter disposition, authoring, and cold-reader verification. |
| `forge_blind_check_task`    | Isolated D1/D2/D3 comparison with forbidden-extra and ownership mismatch detection.             |
| `validate_task`             | Goal, audit, Playwright/GraphQL, blind-isolation, artifact, and terminal-gate checks.           |

Every forge result contains `requestFingerprint`, `policyHash`, and `prompt.sha256`. Identical
normalized v1 inputs produce identical output. The server performs no LLM, network, browser, Git
mutation, goal mutation, or target-project write.

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

Workspace inspection fails closed when `ARBITER_FORGE_ALLOWED_ROOTS_JSON` is absent or invalid.
The three forge tools and `validate_task` still work because they do not read project files.

## Plugin mode

The repository is also a valid plugin:

- `.codex-plugin/plugin.json` registers the skill metadata;
- `.mcp.json` starts the bundled server relative to the plugin root;
- `skills/arbiter-forge/SKILL.md` routes Codex to the correct workflow.

When installing the plugin, remove or disable the direct `[mcp_servers.arbiter-forge]` entry first.
Conversely, do not activate plugin-owned `.mcp.json` while the direct entry is enabled.

## Typical use

Ask Codex to use Arbiter Forge, or call the MCP sequence explicitly:

1. `inspect_workspace` with absolute workspace and selected source paths when preflight is useful.
2. Exactly one `forge_*` tool with the objective, source manifest, typed risk signals, and actual
   host capabilities.
3. `validate_task` after any human edit to the generated prompt.
4. Execute the validated prompt only when execution was requested.

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
  "goalMode": "plain",
  "modelRouting": "adaptive"
}
```

Model routes are preferences. The generated task records the actual route and degrades honestly if
the host cannot select Sol, Terra, or Luna. A persistent goal launch line appears only when
`goalMode` is `persistent_requested`.

## Blind-check semantics

D1 reads only canonical documentation and reconstructs expected behavior. D2 reads only code,
schema, migrations, tests, and explicitly allowed runtime evidence. D3 receives only normalized
D1/D2 reports and classifies each mapping, including `extra_or_forbidden_behavior`. The root arbiter
then verifies material findings against primary sources.

If fresh-context isolation and actual-read manifests cannot be demonstrated, the procedure is
labelled `independent_documentation_review`; it cannot claim strict blind-check PASS. This is the
mechanism that prevents an implementation-only concept from silently re-entering canonical
documentation.

## Extending Arbiter Forge

See [docs/adding-workflow.md](docs/adding-workflow.md). New workflows should add a discriminated
schema, one compiler strategy, a thin MCP adapter, policy assets, invariant/golden tests, and a
protocol-version decision. Do not add an LLM call, command runner, scheduler, or mutable findings
database to the MCP core.

Architecture and protocol details live in:

- [ADR-0001](docs/adr/0001-hybrid-plugin-mcp.md)
- [Protocol v1](docs/protocol.md)

## License

Private software. `UNLICENSED`.
