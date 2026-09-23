# editor-inspector

An MCP server that gives an agent **semantic** access to the running editor, instead of
leaving it to infer state from screenshots.

## Why

The scene, geometry, hit testing and selection all live in Rust compiled to WASM. None of
it is in the DOM. Without this, debugging from outside means looking at pixels and
guessing — and a screenshot cannot say which element is selected, what the camera is, how
many elements were drawn, or whether the shape cache is being hit.

It reads `DrawEngine.debugSnapshot()`, which exists only in **DEV** builds, so it points
at `vite dev` rather than at a container image.

## Running

Registered in the repo's `.mcp.json`, so Claude Code starts it automatically.

It needs the dev server:

```sh
make dev            # web on :5373
```

and a browser:

```sh
export PLAYWRIGHT_BROWSERS_PATH=/sgoinfre/students/$USER/.cache/ms-playwright
```

Browsers do not fit in `$HOME` on these machines — see CLAUDE.md.

## Tools

|                                                                                              |                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `open_board`, `close_board`                                                                  | session lifecycle; `/v1/**` and the websocket are stubbed |
| `get_scene`, `get_element`, `get_selected_elements`, `export_scene`                          | the document                                              |
| `get_app_state`, `get_viewport`, `get_canvas_state`, `get_render_stats`, `get_pointer_state` | state and cost                                            |
| `hit_test`, `inspect_element_at`                                                             | what the engine thinks is under a point                   |
| `pointer`, `key`, `tool`                                                                     | deterministic gestures                                    |
| `screenshot_canvas`, `region_ink`                                                            | pixels                                                    |
| `get_event_history`                                                                          | what has been driven this session                         |
| `compare_scene`                                                                              | canonical diff against a saved reference                  |

## Canonical form

`compare_scene` normalizes before comparing (see `canonical.ts`): drops `id`, `seed`,
`version`, `versionNonce`, `updated`, `isDeleted`; rounds coordinates; **maps group ids to
stable indices**; sorts deterministically.

The group-id mapping is what makes a nested-group comparison possible at all — the ids are
random per session, so a raw diff of two correct scenes never matches.
