# Differential testing against the oracle

The check that our behaviour is *right*, rather than merely self-consistent.

## Two things can be compared

**Structural** — the scene. Build the same drawing in both, export, normalize, diff.
**Visual** — screenshots. Weaker: proves output, not state.

Always prefer structural. A screenshot comparison passes when both are wrong in the same
way and fails on antialiasing.

## Canonical form

Raw scenes never compare equal. Normalize first (`tools/editor-inspector`):

- **drop**: `id`, `seed`, `version`, `versionNonce`, `updated`, `isDeleted`
- **round** coordinates — float noise is not a divergence
- **map group ids to stable indices** — they are random per session, and without this a
  nested-group comparison is impossible
- **sort deterministically** so z-order differences show up as order, not as noise

Then `canonical(ours)` vs `canonical(reference)`.

## Getting a reference scene

1. Playwright MCP → excalidraw.com.
2. Perform the gesture.
3. Export the `.excalidraw` JSON, or read `window.__EXCALIDRAW_STATE__`-equivalent state
   via `browser_evaluate`.
4. Save under `e2e/fixtures/oracle/` with a note recording the SHA it was taken at.

The pinned SHA is `scripts/oracle-sha.txt`. A fixture from a different version is not a
reference, it is a rumour.

## Reading source instead

`third_party/excalidraw` is the pinned checkout. Use it for **rules** — what the reference
decides and why. Use the live site for **behaviour** — what it actually does. They differ
more often than you would expect, usually because a rule is guarded by state that is hard
to see in the source.

When source and site disagree, the site wins and the source tells you which condition you
missed.

## Semantic equivalence, not implementation equivalence

We do not need to match their architecture. We need to match what a user can observe.
Before copying a structure, ask **what invariant is it preserving** — then decide whether
we can preserve that invariant more cheaply. Record the answer in `docs/reference/`.
