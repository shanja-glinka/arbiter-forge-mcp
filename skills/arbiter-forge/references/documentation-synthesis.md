# Documentation Synthesis

Use this policy to forge specifications and implementation tasks from independent discovery. Do not
confuse documenting the current system with designing a future one.

## Declare the target state

Classify the requested documentation as:

- `as_is`: every material claim must match current implementation evidence;
- `to_be`: desired behavior may differ from code, but every difference must be explicit planned
  work with acceptance criteria;
- `mixed`: label every claim `existing`, `planned`, or `decision_required`.

For each claim capture a stable key, observable behavior, owner and forbidden owners, inputs,
outputs, state transitions, security/scope/ordering/error invariants, evidence references, and open
decisions. Never present planned behavior as existing or silently turn current behavior into the
desired design.

## Independent discovery

Use fresh contexts and explicit input allowlists. Do not expose one discovery report to another.

1. **I1 — intent analyst** reads only the user brief and authoritative business or product sources.
   It returns desired claims, priorities, non-goals, and unresolved product decisions.
2. **I2 — implementation archaeologist** reads only implementation, schemas, migrations, tests, and
   selected runtime evidence. It reconstructs actual behavior and ambiguity without reading I1.
3. **I3 — governance analyst** reads only repository rules, ownership maps, conventions, and
   security boundaries. It returns normative owner and integration constraints.
4. **Comparator** receives only normalized I1/I2/I3 outputs. It classifies matches, implementation
   gaps, forbidden extra behavior, ownership conflicts, and decisions that lack authority.
5. **Hard arbiter** verifies material findings against allowed primary sources. It may resolve a
   conflict only when an authoritative source supports the decision; otherwise it records
   `decision_required`.
6. **Author** receives the approved resolution ledger and writes the requested documentation and,
   when requested, the implementation task and acceptance map.

I3 may be folded into the arbiter for Compact work with one obvious owner. Keep I1 and I2 separate
whenever the document claims both intended and implemented behavior.

## Post-draft falsification

Choose only applicable audits:

- A **cold reader** sees only the draft and reconstructs the implementable specification. Ambiguous
  blocking behavior is a finding.
- A **source-fidelity auditor** sees authoritative intent sources and the draft, but not author
  rationale, and verifies exact coverage.
- A **feasibility and ownership auditor** sees implementation/governance sources and the draft, but
  not I1 conclusions, and checks whether ownership and integration claims are supportable.
- A strict documentation-versus-code blind check follows
  [blind-check.md](blind-check.md) when the draft claims parity with current code.

The audits remain read-only. Route documentation corrections to the author and task/code corrections
to their owners, then rerun stale checks on new source and draft hashes.

## Adaptive profile

- **Compact**: intent discovery, author, and cold reader for a small conceptual document that makes
  no material current-code claim.
- **Standard**: separate I1/I2, comparator, author, source-fidelity audit, and cold reader. Add I3
  when ownership is nontrivial.
- **Critical**: isolated I1/I2/I3, comparator, hard-arbiter resolution ledger, author, source,
  feasibility, and cold-reader audits. Add strict D1/D2/D3 when current implementation parity is a
  blocking claim.

Escalate for security, tenant isolation, pricing, destructive migration, cross-service event flow,
or high-impact public contracts, not for document length.

## Documentation and task invariants

Require all of the following before `PASS`:

- each authoritative requirement maps to exactly one normalized claim or an explicit decision gap;
- every planned blocking claim maps to an implementation-task item, owner, acceptance criterion,
  proof class, and falsifier;
- existing, planned, and unresolved states are not conflated;
- service/package ownership follows governance sources;
- the cold reader can reconstruct material behavior without hidden author context;
- the specification and implementation task use the same IDs and semantics;
- all reports and drafts identify their source-content hashes;
- no material decision remains silently assumed.

For `to_be`, absence in code is an implementation gap rather than a documentation defect when the
claim is explicitly planned and mapped to work. For `as_is`, the same mismatch prevents `PASS`.
