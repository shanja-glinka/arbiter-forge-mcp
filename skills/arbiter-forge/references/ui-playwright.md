# UI, Playwright, and GraphQL Proof

Use this policy when a requirement changes browser-visible behavior, manual/admin UI, a browser
GraphQL client, responsive behavior, or a visual contract.

## Check the harness first

Inspect Playwright configuration, package and scripts, fixtures, authentication state, web-server
startup, dependency readiness, supported actors/scopes, test data, and browser availability.

- If Playwright exists, use the project harness.
- If it is absent and test infrastructure changes are authorized, assign harness authoring to a
  coding/scenario worker. Keep the acceptance auditor read-only.
- If it is required but cannot be added or executed within authority, report the missing capability
  as a blocker. Do not rename Vitest, a screenshot, or source review as Playwright E2E.

## Derive journeys from requirements

For every applicable journey define:

- actor, role, tenant/organization/branch scope, and auth precondition;
- starting route and authoritative seed state;
- accessible locators and user actions;
- DOM, navigation, loading, empty, success, error, stale, dirty-form, and denied assertions that
  matter to the requirement;
- expected API/GraphQL operation, variables, scope, response semantics, and authoritative readback;
- required viewport, theme, locale, browser, cleanup, and isolation.

Use separate browser contexts for distinct identities or scopes. Include negative isolation: one
actor must not observe or mutate another scope. Avoid arbitrary sleeps and brittle CSS-structure
selectors. Treat unexpected console errors, page errors, relevant request failures, hydration errors,
and unhandled GraphQL errors as findings.

## Prove GraphQL behavior

When the UI uses GraphQL, verify:

- expected operation document or generated SDK method;
- variables and auth/scope propagation without leaking secrets;
- GraphQL `errors`, including responses with HTTP 200;
- partial-data and failure rendering;
- mutation persistence through authoritative readback, required cache update, or refetch;
- absence of forbidden REST or private-import fallback when the contract forbids it.

Persisted-query/APQ requests may omit query text. Validate operation identity, persisted-query
extensions and fallback, variables, and result rather than requiring a raw query string.

Hidden controls are not authorization proof. Exercise applicable direct routes and direct API or
GraphQL negatives. Do not use `page.route`, MSW, or another browser mock as final proof of an
owner-backed boundary unless the requirement explicitly targets the mock.

## Visual and artifact proof

Screenshots support behavioral assertions; they do not prove them alone. Keep viewport, theme,
locale, data state, and checkpoints stable. Inspect layout, clipping, overflow, focus,
disabled/loading/error states, and responsive behavior when material.

Store reports, sanitized network summaries, screenshots, and traces outside Git. Treat traces and
browser auth state as sensitive. Do not retain reusable auth state. Hash retained evidence and map it
to requirement IDs and the audited repository snapshot.

Required evidence slices are criterion-specific: browser journey, DOM assertions, transport
summary, owner readback, cache/refetch behavior, event/downstream effect, readiness/logs,
console/page/network errors, visual checkpoint, and cleanup. Mark each required slice `present`,
`not_applicable` with reason, or `missing`.

## Verdict

Use a no-retry verdict run when supported. A test that passes only after retry remains flaky until
diagnosed. `PASS` requires all required journeys and negatives on the same integrated snapshot, no
unexplained browser/console/network failure, and every required evidence slice present.

`SKIPPED`, `NOT_RUN`, missing server/auth/data, flaky retry, mocked owner behavior, or screenshots
without behavioral assertions are not `PASS`.
