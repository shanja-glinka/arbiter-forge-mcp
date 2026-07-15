# Documentation Synthesis

Use this policy to forge specifications and implementation tasks from independent discovery. Do not
confuse documenting the current system with designing a future one.

## Declare the target state

First classify its relationship to current implementation:

- `greenfield`: the user explicitly states that no current-system parity, transition, compatibility,
  removal, or ownership-reuse claim is being made. Implementation discovery may be omitted, but the
  document must say that current implementation was not assessed.
- `current_aware`: the document describes evolution, replacement, migration, compatibility, retained
  behavior, current-versus-future state, or forbidden existing behavior. Implementation discovery is
  mandatory.

Do not infer `greenfield` merely because the requested target is future-facing or implementation
sources were omitted. Missing implementation evidence for a current-aware request is a material input
gap, not permission to continue.

Then classify the requested documentation as:

- `as_is`: every material claim must match current implementation evidence;
- `to_be`: desired behavior may differ from code, but every difference in current-aware mode must be
  explicit planned work with acceptance criteria;
- `mixed`: reconcile current and desired state claim by claim.

For every future or mixed claim record exactly one disposition: `existing`, `planned`, or
`decision_required`. Greenfield claims may be only `planned` or `decision_required`; they must not be
labelled `existing`. Capture a stable key, observable behavior, owner and forbidden owners, inputs,
outputs, state transitions, security/scope/ordering/error invariants, evidence references, and open
decisions. Never present planned behavior as existing, silently turn current behavior into the desired
design, or omit current behavior that the future design forbids or removes.

## Independent discovery

Use fresh contexts and explicit input allowlists. Do not expose one discovery report to another.

Validate the partitions before dispatch. I1 accepts only authoritative intent/product/task sources;
I2 accepts only implementation, schema, migration, test, and selected runtime evidence; I3 accepts
only governance, ownership, and convention sources. Partition IDs and physical identities must be
disjoint. Compare canonical paths or realpaths and content hashes; different IDs for the same source
do not prove isolation. If one source appears to carry multiple roles, assign it to one authoritative
partition and let the hard arbiter verify the cross-role implication later; do not leak it into another
discovery context. A role-incompatible or ambiguous source blocks independent discovery.

1. **I1 — intent analyst** reads only the user brief and authoritative business or product sources.
   It returns desired claims, priorities, non-goals, and unresolved product decisions.
2. **I2 — implementation archaeologist** reads only implementation, schemas, migrations, tests, and
   selected runtime evidence. It reconstructs actual behavior and ambiguity without reading I1.
3. **I3 — governance analyst** reads only repository rules, ownership maps, conventions, and
   security boundaries. It returns normative owner and integration constraints.
4. **Comparator** receives only normalized I1/I2/I3 outputs. I1 and I2 each return a complete sorted
   claim inventory with count and SHA-256. The comparator performs a full-outer reconciliation and
   classifies matches, implementation gaps, forbidden extra behavior, ownership conflicts, and
   decisions that lack authority. Its covered-I1 and covered-I2 sets must exactly equal the input
   inventories; every I2-only behavior receives an explicit disposition.
5. **Hard arbiter** verifies material findings against allowed primary sources. It may resolve a
   conflict only when an authoritative source supports the decision; otherwise it records
   `decision_required`.
6. **Author** receives the approved resolution ledger and writes the requested documentation and,
   when requested, the implementation task and acceptance map.

I3 may be folded into the arbiter for Compact work with one obvious owner. Keep I1 and I2 separate in
every current-aware workflow. In greenfield mode omit I2 only when the no-current-claims boundary is
explicit in both the source manifest and final document.

## Post-draft falsification

Choose only applicable audits:

- When selected, a **cold reader** sees only the draft and reconstructs the implementable
  specification. Ambiguous blocking behavior is a finding. It is the default but may be explicitly
  disabled below Critical risk; Critical documentation always requires it.
- A **source-fidelity auditor** sees authoritative intent sources and the draft, but not author
  rationale, and verifies exact coverage.
- A **feasibility and ownership auditor** sees implementation/governance sources and the draft, but
  not I1 conclusions, and checks whether ownership and integration claims are supportable.
- A strict documentation-versus-code blind check follows
  [blind-check.md](blind-check.md) for current-aware drafts. Greenfield drafts use source-fidelity and
  cold-reader checks and must not claim implementation parity.

The audits remain read-only. Route documentation corrections to the author and task/code corrections
to their owners, then rerun stale checks on new source and draft hashes.

## Adaptive profile

- **Compact**: greenfield intent discovery, author, source-fidelity audit, and a cold reader when the
  audit decision selected one for a small conceptual document that makes no current-code claim.
- **Standard**: separate I1/I2, comparator, author, source-fidelity audit, and a cold reader when the
  audit decision selected one. Add I3 when ownership is nontrivial.
- **Critical**: isolated I1/I2/I3, comparator, hard-arbiter resolution ledger, author, source,
  feasibility, and cold-reader audits. Add strict D1/D2/D3 when current implementation parity is a
  blocking claim.

Escalate for security, tenant isolation, pricing, destructive migration, cross-service event flow,
or high-impact public contracts, not for document length.

## Documentation and task invariants

Require all of the following before `PASS`:

- each authoritative requirement maps to exactly one normalized claim or an explicit decision gap;
- comparator coverage consumes the complete I1 and I2 inventories with matching counts and hashes;
- every I2-only behavior is documented as intentionally retained, mapped to planned removal or
  prohibition work, or marked `decision_required`;
- every planned blocking claim maps to an implementation-task item, owner, acceptance criterion,
  proof class, and falsifier;
- existing, planned, and unresolved states are not conflated;
- service/package ownership follows governance sources;
- when required by the audit decision, the cold reader can reconstruct material behavior without
  hidden author context;
- the specification and implementation task use the same IDs and semantics;
- all reports and drafts identify their source-content hashes;
- no material decision remains silently assumed.

For current-aware `to_be`, absence in code is an implementation gap rather than a documentation defect
when the claim is explicitly planned and mapped to work. Existing behavior that the target omits or
forbids is still a planned removal/prohibition gap and cannot disappear from the ledger. For `as_is`,
the same mismatch prevents `PASS`. For greenfield `to_be`, implementation status and forbidden-extra
coverage are explicitly `not_assessed`, never silently implied.
