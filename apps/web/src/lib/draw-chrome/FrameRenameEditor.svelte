<script lang="ts">
  /**
   * A frame's name, double-clicked into an input over its label — Excalidraw's
   * `editingFrame` (`App.tsx@1118751f:2219-2261` the input, `:2334-2340` the double click
   * that opens it, `:2166-2170` `resetEditingFrame`, the commit both Enter and Escape run).
   *
   * Unlike `DrawTextEditor`, this needs no `transform: scale(zoom)`: a frame's name is
   * painted at a fixed screen size (`FRAME_NAME_FONT_SIZE`, `engine/scene/frame.rs`), so
   * the request's `x`/`y`/`width`/`height` are already the screen box to sit in, as
   * `frame_name_at`/`request_frame_rename` (`engine/frame_rename.rs`) computed it.
   */
  import { onMount } from "svelte";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { FrameRenameRequest } from "@osionos/draw-engine/types";

  let {
    engine,
    request,
    onDone,
  }: {
    engine: DrawEngine;
    request: FrameRenameRequest;
    /** The edit is over — committed or not. */
    onDone: () => void;
  } = $props();

  let node: HTMLInputElement | undefined = $state();
  let finished = false;

  /** Ends the edit; `commit` writes what was typed, as one step — `renameFrame` no-ops
   *  safely if the frame is already gone. */
  function finish(commit: boolean): void {
    if (finished) return;
    finished = true;
    if (commit && node) engine.renameFrame(request.id, node.value);
    document.querySelector<HTMLElement>('.draw-chrome [role="application"]')?.focus();
    onDone();
  }

  onMount(() => {
    if (!node) return;
    // Set here, not through the attribute: the value is the effective name
    // (`getFrameLikeTitle`), never the raw possibly-empty one.
    node.value = request.name;
    node.focus();
    node.select();
  });

  function onKeydown(event: KeyboardEvent): void {
    // Escape commits too, exactly as Enter does — the oracle's `resetEditingFrame` runs
    // from both keys alike (`App.tsx@1118751f:2256-2261`), never a revert.
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
  }
</script>

<input
  bind:this={node}
  aria-label="Frame name"
  dir="auto"
  autocomplete="off"
  autocapitalize="off"
  autocorrect="off"
  spellcheck="false"
  style:left="{request.x}px"
  style:top="{request.y}px"
  style:width="{request.width}px"
  style:height="{request.height}px"
  style:font-size="{request.fontSize}px"
  style:color={request.color}
  onkeydown={onKeydown}
  onblur={() => finish(true)}
/>

<style>
  /* Opaque, over the frame's own painted name — the canvas keeps drawing it underneath
     while this is open, unlike the text editor's element, which the engine leaves out of
     the scene it paints. */
  input {
    position: absolute;
    margin: 0;
    padding: 0 2px;
    border: 0;
    outline: 2px solid var(--accent);
    background: var(--surface);
    border-radius: 2px;
    font-family: inherit;
    line-height: 1;
    z-index: 12;
  }
</style>
