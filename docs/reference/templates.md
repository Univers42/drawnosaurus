# Templates

Five ready-made boards, opened from "Templates…" (the main menu, or the command
palette's File category). Each is one `.osidraw` scene — the same file format Save to
disk writes and Open reads — under `apps/web/src/lib/templates/*.osidraw.json`, paired
with a name and a one-line description in `apps/web/src/lib/templates/index.ts`.

## Where a template comes from

Each file is not hand-written: it is `engine.exportJson()`'s own output, captured at the
end of the matching story in `e2e/stories/*.spec.ts` — checkout, system architecture,
sprint retro, pitch deck, mind map. Those stories build their board through the real
toolbar, shortcuts, the command palette and the figure picker, and assert every element
count, binding, frame membership and label along the way, so a template is never
anything but "what a story already builds and is held to" — never a scene written
directly into a fixture, which would drift from what the app can actually produce the
moment either side changed.

**Regenerating.** `maybeWriteTemplate` (`e2e/stories/helpers.ts`) writes both files when
`GENERATE_TEMPLATES` is set, from inside the story's own pass — nothing extra to keep
working, since it rides the same run `make verify` already does. Beside the `.osidraw.json`
it zooms to fit the board (Shift+1), rasterises the current view exactly as the Export
dialog's PNG button does (`engine.exportPng()`), downscales that to a ~360px-wide preview
over a white fill on an in-page canvas, and writes it to
`apps/web/static/templates/<id>.png`:

```sh
docker run --rm --ipc=host -e CI= -e GENERATE_TEMPLATES=1 --user 1000:1000 -e HOME=/tmp \
  -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.63.0-noble \
  node node_modules/@playwright/test/cli.js test e2e/stories --trace=off --reporter=line
```

Run it after changing a story so its template — and its preview — stay what the story
actually builds. `.prettierignore` excludes the five `.osidraw.json` files on purpose: they
are `serde_json::to_string_pretty`'s own formatting, one array element per line, which is
not what Prettier would collapse them to — reformatting them would make them no longer
byte-identical to what the app itself exports. The PNGs are binary and untouched by either
tool.

`apps/web/src/lib/templates/index.test.ts` validates each against the contract's
`osidrawFileSchema` — the same schema `PUT /v1/boards/:slug` checks a replace against —
so a template that stopped being a valid `.osidraw` file fails `make quality` rather than
the first person who opens it. The same test also checks every template has its preview
PNG under `apps/web/static/templates/`.

## Using one

Picking a template tries the host's path first: create a board (`POST /v1/boards`, then
`PUT` the template's elements into it) and go there. A guest's `POST` is refused with 403
— the gateway gives board creation to the host only (`docker/gateway/Caddyfile`,
`apps/api/src/share.ts`'s `roleOf`) — and on exactly that refusal the same template is
inserted into the board already open instead, through `engine.pasteJson`, centred on the
current viewport (`engine.screenToWorld` of the canvas's own centre) and minting fresh
ids, as one step of undo. `DrawTemplatesModal.svelte` holds this choice; nothing upstream
of it needs to know which role opened the dialog.

A **preview** is a real thumbnail of the template's own board, produced in the browser at
the same time as the `.osidraw.json` — the server never runs WASM (`CLAUDE.md`'s boundary
rule), so a build-time render server-side was never an option; instead each story, while
its board is still open in a real browser tab, captures one. `DrawTemplatesModal.svelte`
shows it as `<img src="/templates/<id>.png">` in a fixed-aspect box so the card layout
never jumps while it loads.

## Where it shows up

- The main menu's **Templates…** item (`DrawMainMenu.svelte`), beside "Mermaid to
  diagram…".
- The command palette's **File** category (`docs/reference/palette.md`), alongside
  "Export…".
- `e2e/templates.spec.ts` covers both outcomes: a host taken to the new board it
  created, and a guest — refused — getting the template inserted into the one already
  open.

## Known limits

- A template's ids are whatever the story that built it produced. Reused verbatim into a
  freshly created board (nothing else there to collide with) but always re-minted on
  insert, since `pasteJson` never keeps a pasted element's original id.
