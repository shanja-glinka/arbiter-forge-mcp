# ADR-0001: Hybrid Codex Plugin and Local MCP

- Status: Accepted
- Date: 2026-07-15
- Decision owners: Arbiter Forge maintainers

## Context

Arbiter Forge must create reliable, project-specific orchestration tasks for any repository. It
also needs to grow beyond implementation prompts into documentation authoring and independent
documentation-to-code blind checks.

A skill alone is easy to discover but cannot provide a stable, typed API or deterministic
validation. An MCP server alone can render and validate data, but it should not replace the host
model's semantic analysis, agent orchestration, goal lifecycle, or runtime tools. Making the MCP
server an autonomous orchestrator would reproduce the process overhead that Arbiter Forge is
intended to remove.

## Decision

Arbiter Forge is a hybrid product with three explicit responsibility boundaries:

1. The Codex plugin skill is the cognitive and UX layer. It selects the applicable workflow,
   reads repository instructions and canonical sources, normalizes task-specific constraints, and
   explains when to use goals, independent agents, Playwright, or a blind check.
2. The local STDIO MCP server is a stateless, deterministic engine. It inspects allowed workspace
   metadata, renders versioned prompts or packages, and validates their structural and safety
   invariants.
3. The host Codex agent performs semantic reasoning and execution. It owns clarification,
   subagent spawning, goal-tool calls, file changes, tests, browser operation, evidence review, and
   the final verdict.

The MCP server returns generated content inline. It does not write into target repositories,
execute generated tasks, or persist run state.

## Public Tool Surface

The v1 MCP API contains exactly five tools:

| Tool                        | Responsibility                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_workspace`         | Build a bounded, read-only manifest of repository rules, source hashes, Git identity, and available test/browser signals.                                        |
| `forge_implementation_task` | Render an arbiter task for implementation, independent falsification, correction, and fresh final verification.                                                  |
| `forge_documentation_task`  | Render a documentation-authoring task that independently studies intent and implementation before an arbiter approves a normalized specification for the writer. |
| `forge_blind_check_task`    | Render a true D1/D2/D3 documentation-versus-implementation audit with isolated inputs and explicit mismatch classes.                                             |
| `validate_task`             | Recompile the original typed request and validate only a ready, byte-identical generated prompt; edited text is diagnostics-only.                                |

All tools are read-only, non-destructive, idempotent for the same versioned input, and
closed-world. The three `forge_*` tools share one internal renderer and validation core; separate
tool names keep their schemas and user intent precise.

## Blind Documentation Workflows

Documentation authoring and blind auditing are related but distinct:

- `forge_documentation_task` creates a workflow in which an intent analyst reads only product/task
  sources, an implementation analyst reads only code/schema/test evidence, and a comparator sees
  only their normalized reports. The root arbiter must disposition every mismatch before a writer
  receives an approved specification. Current code is not automatically canonical.
- `forge_blind_check_task` audits existing documentation. D1 reconstructs the expected system from
  documentation, D2 reconstructs observed behavior from implementation, and D3 classifies matches,
  missing behavior, extra or forbidden behavior, semantic mismatch, ownership mismatch,
  unverifiable claims, and open decisions. D3 performs full-outer coverage of both inventories;
  every D2-only observation is first an extra/forbidden behavior and receives a separate arbiter
  disposition.

If clean contexts and input allowlists cannot be demonstrated, the generated task must call the
operation an independent review rather than a blind check.

## Versioning

- Forge requests and results use `schemaVersion: "arbiter-forge/v1"`; forge results also expose
  the implementation `generatorVersion`. Workspace inspection results use the same
  `schemaVersion`. The smaller validation request/result is governed by the registered v1 tool
  schema and does not repeat that field.
- Every generated forge result includes deterministic `taskId`, `requestFingerprint`, `policyHash`,
  and `prompt.sha256` values. Selected source files have their own SHA-256 values when inspected or
  supplied.
- `validate_task` receives that prompt, operation, original typed request, and expected hash. It
  recompiles under current policy and grants `assurance: recompiled` only to a `ready`, byte-equal
  result. Caller-supplied hashes alone are not provenance.
- Tool names and required field semantics are stable within a protocol major version.
- Additive optional fields and new warning codes may be introduced in v1. Removing fields,
  changing requiredness, or changing terminal semantics requires `/v2`.
- Long-form policy and templates have one canonical source. TypeScript must not contain a second,
  divergent copy.
- Generation never implies acceptance. Forge status is `ready`, `needs_input`, or `invalid`;
  workspace inspection separately reports `ready`, `partial`, or `denied`; validation returns a
  `pass` boolean. Only the executing root arbiter may issue a runtime `PASS`.

## Security Boundary

The server follows these constraints:

- local STDIO transport only; no listener, telemetry, or network access;
- allowed workspace roots supplied explicitly at startup and enforced after `realpath`
  canonicalization;
- rejection of path traversal and symlinks that resolve outside an allowed root;
- separate authorization of discovered Git worktree/Git-directory roots and every derived metadata
  file before repository-wide inspection or metadata reads;
- registered workspace/source-count and byte limits, with sensitive metadata, `.git`, and
  `node_modules` source paths excluded;
- repository content treated as untrusted data, never as instructions to execute;
- no raw secrets, credentials, private keys, reusable auth state, or unnecessary PII in responses
  or logs;
- Git access restricted to allowlisted read-only subcommands invoked without a shell, inherited
  `GIT_*`, global/system config, hooks, fsmonitor, filters, external diff, and textconv disabled;
- protocol output written only to stdout and sanitized diagnostics only to stderr;
- no LLM calls, agent scheduler, command runner, browser runner, goal mutation, Git mutation, or
  target-workspace writes.

Model identifiers are preferences supplied by policy or caller, not hard-coded capability enums.
The server records degraded routing when the host cannot select a model; it never claims an actual
assignment it cannot observe.

## Plugin and MCP Registration

Arbiter Forge supports two deployment modes, but only one may register the MCP server in a Codex
profile:

1. direct local development registration in `config.toml`; or
2. plugin-owned registration through `.mcp.json`.

Enabling both creates duplicate tool namespaces and ambiguous routing. Installation and upgrade
instructions must detect this condition and require removal or disabling of one registration. The
plugin skill may remain enabled when the MCP server is directly registered, provided the plugin
does not also activate its `.mcp.json` entry.

## Consequences

### Positive

- Project-specific reasoning remains with the strongest available host model.
- Rendering and validation are deterministic, testable, and reusable across projects and clients.
- Implementation, documentation authoring, and blind auditing evolve behind one versioned core.
- The default workflow remains prompt-first instead of creating a permanent orchestration system.

### Trade-offs

- The quality of a generated task still depends on correctly normalized inputs from the host.
- The MCP server cannot prove subagent context isolation or actual model assignment; generated
  tasks must include honest fallbacks.
- Direct local configuration uses machine-specific paths, so distribution documentation must
  render configuration for the current installation path.

## Rejected Alternatives

- **Skill only:** insufficient typed contracts and deterministic validation.
- **MCP only:** weak workflow discovery and no safe substitute for host semantic reasoning.
- **Autonomous MCP orchestrator:** duplicates Codex, expands mutation authority, and requires
  unnecessary state and scheduling infrastructure.
- **Simultaneous plugin and direct MCP registration:** creates duplicated tools and non-deterministic
  selection.
