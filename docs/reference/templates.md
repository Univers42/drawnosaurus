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

**Regenerating.** `maybeWriteTemplate` (`e2e/stories/helpers.ts`) writes the file when
`GENERATE_TEMPLATES` is set, from inside the story's own pass — nothing extra to keep
working, since it rides the same run `make verify` already does:

```sh
docker run --rm --ipc=host -e CI= -e GENERATE_TEMPLATES=1 --user 1000:1000 -e HOME=/tmp \
  -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.63.0-noble \
  node node_modules/@playwright/test/cli.js test e2e/stories --trace=off --reporter=line
```

Run it after changing a story so its template stays what the story actually builds.
`.prettierignore` excludes the five files on purpose: they are `serde_json::
to_string_pretty`'s own formatting, one array element per line, which is not what
Prettier would collapse them to — reformatting them would make them no longer
byte-identical to what the app itself exports.

`apps/web/src/lib/templates/index.test.ts` validates each against the contract's
`osidrawFileSchema` — the same schema `PUT /v1/boards/:slug` checks a replace against —
so a template that stopped being a valid `.osidraw` file fails `make quality` rather than
the first person who opens it.

## Using one

Picking a template tries the host's path first: create a board (`POST /v1/boards`, then
`PUT` the template's elements into it) and go there. A guest's `POST` is refused with 403
— the gateway gives board creation to the host only (`docker/gateway/Caddyfile`,
`apps/api/src/share.ts`'s `roleOf`) — and on exactly that refusal the same template is
inserted into the board already open instead, through `engine.pasteJson`, centred on the
current viewport (`engine.screenToWorld` of the canvas's own centre) and minting fresh
ids, as one step of undo. `DrawTemplatesModal.svelte` holds this choice; nothing upstream
of it needs to know which role opened the dialog.

A **preview** is a generic icon, not a rendered thumbnail: producing a real one would
mean running the engine (WASM) somewhere other than a browser tab, which this project's
own boundary rule (`CLAUDE.md`'s "the server never runs WASM") rules out doing in the API,
and a build-time render was more machinery than five icons are worth. Recorded as a gap
below rather than done partway.

## Where it shows up

- The main menu's **Templates…** item (`DrawMainMenu.svelte`), beside "Mermaid to
  diagram…".
- The command palette's **File** category (`docs/reference/palette.md`), alongside
  "Export…".
- `e2e/templates.spec.ts` covers both outcomes: a host taken to the new board it
  created, and a guest — refused — getting the template inserted into the one already
  open.

## Known limits

- No thumbnail preview, as above — every template's card shows the same icon.
- A template's ids are whatever the story that built it produced. Reused verbatim into a
  freshly created board (nothing else there to collide with) but always re-minted on
  insert, since `pasteJson` never keeps a pasted element's original id.
