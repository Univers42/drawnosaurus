<script lang="ts">
  import { onMount } from "svelte";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { TextEditRequest } from "@osionos/draw-engine/types";

  let {
    engine,
    request,
    fontSizePx,
    onDone,
  }: {
    engine: DrawEngine;
    request: TextEditRequest;
    fontSizePx: number;
    onDone: () => void;
  } = $props();

  let value = $state("");
  let node: HTMLTextAreaElement | undefined;
  let editingId = $state("");

  $effect.pre(() => {
    if (editingId === request.id) return;
    editingId = request.id;
    value = request.text;
  });

  onMount(() => {
    node?.focus();
    node?.select();
  });

  function commit(next: string): void {
    engine.setElementText(request.id, next);
  }
</script>

<textarea
  bind:this={node}
  {value}
  aria-label="Text editor"
  spellcheck={false}
  style:left={`${request.x}px`}
  style:top={`${request.y}px`}
  style:min-height={`${fontSizePx * 1.3}px`}
  style:color={request.color}
  style:font-size={`${fontSizePx}px`}
  oninput={(event) => {
    value = event.currentTarget.value;
    commit(value);
  }}
  onblur={() => {
    commit(value);
    onDone();
  }}
  onkeydown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape") event.currentTarget.blur();
  }}
></textarea>

<style>
  textarea {
    position: absolute;
    min-width: 40px;
    padding: 0;
    margin: 0;
    border: 1px dashed var(--accent);
    outline: none;
    resize: none;
    overflow: hidden;
    background: transparent;
    font-family: sans-serif;
    line-height: 1.25;
    white-space: pre;
    z-index: 3;
  }
</style>
