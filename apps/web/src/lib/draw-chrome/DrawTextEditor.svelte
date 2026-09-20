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
  let originalText = "";
  let finished = false;

  onMount(() => {
    originalText = request.text;
    value = request.text;
    node?.focus();
    node?.select();
    autoResize();
  });

  function autoResize(): void {
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.max(node.scrollHeight, fontSizePx * 1.3)}px`;
    const lines = value.split("\n");
    const maxLineLen = Math.max(...lines.map((l) => l.length), 1);
    const approxWidth = Math.max(maxLineLen * fontSizePx * 0.65 + 24, 60);
    node.style.width = `${approxWidth}px`;
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    const finalVal = value.trim();
    if (finalVal.length === 0 && originalText.trim().length === 0) {
      engine.deleteSelection();
    } else {
      engine.setElementText(request.id, value);
    }
    onDone();
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
    autoResize();
  }}
  onblur={() => {
    finish();
  }}
  onkeydown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      finished = true;
      engine.setElementText(request.id, originalText);
      onDone();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish();
    }
  }}
></textarea>

<style>
  textarea {
    position: absolute;
    min-width: 60px;
    padding: 2px 6px;
    margin: 0;
    border: 1.5px dashed var(--accent, #4c6ef5);
    border-radius: 4px;
    outline: none;
    resize: none;
    overflow: hidden;
    background: var(--color-bg, #ffffff);
    font-family: sans-serif;
    line-height: 1.25;
    white-space: pre;
    z-index: 20;
    box-sizing: border-box;
  }
</style>
