# The conformance ledger

`CLAUDE.md` points here. `prompt/design.md` and `prompt/shortkey.md` are the feature
checklists this project is built against. `packages/conformance` parses **every line** of
them and requires each to match a rule in `src/registry.ts`.

## What `make conformance` enforces

A rule is `covered` with named test files, `gap` with a reason, or `out-of-scope` with a
reason. On top of that the test checks:

- **every file named in a `covered` rule exists and actually contains a test** — so a rule
  cannot claim coverage that was renamed away or never written;
- **every checklist line matches some rule** — so a line added to `prompt/*.md` is a failing
  test rather than a silent omission;
- **no rule is dead** — nothing matches it any more.

It prints the coverage percentage, which is the headline number. Measured on `bunny/night`
`9bbd718` on 27 September 2026 — **a measurement, not a fixed fact; re-run it rather than
repeating it**:

```
conformance: 650/931 in-scope items covered (69.8%)
281 gap(s), 181 out of scope, 1112 lines read
```

`gap` is a **status, not an absence**. An unimplemented feature is counted and printed, which
is the difference between a roadmap and a blind spot. The honesty of the whole file rests on
those checks rather than on good intentions — see the header comment in `registry.ts`.

## Working in here

- **Adding a line to `prompt/*.md` fails `make conformance`** until a rule is added. A
  recorded `gap` is a fine answer.
- **Renaming or deleting a test file named in the registry fails it too.**
- **Flip a rule only when a named test really covers it.** If a rule is half done, split it.
  Never overclaim: `covered` with a test that does not exercise the claim is the failure
  mode this ledger exists to prevent.
- **One rule can match more than one line, across finished and unbuilt work.** Flipping such
  a rule overclaims for the unbuilt part. Five such shared rules are reported by the 4.2/4.3
  export scout — in the PNG/SVG export area and around `design.md:1339`/`:1364`. **Split them
  before flipping.** This is the most likely way to move the number for work that does not
  exist. (Reported, not re-verified here: the scout's finding, not a measurement of mine.)
- A **figure measured on a task branch is a delta, never a total.** Measured in isolation and
  reported as an absolute, repeatedly. Read the arithmetic on the merged tree.

## `prompt/` is not ours to reformat

`prompt/` is in `.prettierignore` on purpose: the conformance parser reads it line by line,
so reformatting would move every line number in a failure message. These are someone else's
documents and their line numbers are references.

## Regenerating a per-line dump

`make conformance` prints the headline. For the per-line ledger — which is what the
`wiki/parity-report.html` and `wiki/remaining-work.html` figures come from — run every
checklist line through the registry in the tooling container (`make shell`):

```sh
cat > /tmp/dump.mts <<'EOF'
import { readChecklists } from "/app/packages/conformance/src/checklist.ts";
import { ruleFor } from "/app/packages/conformance/src/registry.ts";
const out = readChecklists("/app/prompt").map((i) => {
  const r = ruleFor(i)!;
  return { src: i.source, section: i.section, line: i.line, text: i.text,
           status: r.status, why: r.why ?? "" };
});
process.stdout.write(JSON.stringify(out));
EOF
node --experimental-strip-types /tmp/dump.mts > items.json
```

Both wiki pages are **hand-kept**. Nothing generates them, which is why a claim in one of
them can be true when written and false an hour later — and why nothing catches it. If you
change a `why:` in the registry, that text has to be carried across by hand.
