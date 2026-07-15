# Adding an Arbiter Forge Workflow

Arbiter Forge grows through deterministic compiler strategies, not through autonomous MCP
execution.

## Extension checklist

1. Define the user outcome and explain why none of the existing implementation, documentation, or
   blind-check operations can express it.
2. Add a strict Zod input schema in `src/core/schemas.ts`. Prefer typed risk and capability fields
   over keyword inference. Unknown fields must remain rejected.
3. Add normalization that sorts semantic sets, preserves ordered claims, validates stable IDs, and
   keeps hashes free of timestamps, random IDs, and locale-dependent slugs.
4. Add a compiler branch in `src/core/render.ts`. Reuse the hard-arbiter, artifact, correction, and
   terminal gates. Include only applicable policies.
5. Add structural invariants in `src/core/validate.ts` and route the operation through deterministic
   revalidation in `src/core/revalidate.ts`. User-facing PASS requires a ready byte-identical
   recompile of the original typed request.
6. Register a thin read-only MCP tool in `src/server.ts`. It must not execute the generated task.
7. Add or update one canonical policy file under `skills/arbiter-forge/references/` and route it from
   `SKILL.md`.
8. Add deterministic, risk-profile, adversarial, and bundled STDIO integration tests.
9. Decide version compatibility:
   - additive optional behavior may remain `arbiter-forge/v1`;
   - changed required fields, hash canonicalization, or terminal semantics require v2.
10. Update `docs/protocol.md`, build the self-contained bundle, validate the plugin, and run the MCP
    integration smoke.

## Required boundaries

- no LLM or Codex API calls from the MCP server;
- no agent spawning or model assignment claims;
- no goal lifecycle calls;
- no target-repository writes or Git mutation;
- no arbitrary command framework;
- no network listener or telemetry;
- no source content returned by workspace inspection;
- no PASS claim without host-executed fresh evidence.

If a proposed workflow needs execution state, implement that state in the host orchestration task or
in a separate, explicitly authorized product. Do not turn Arbiter Forge into a second orchestrator.
