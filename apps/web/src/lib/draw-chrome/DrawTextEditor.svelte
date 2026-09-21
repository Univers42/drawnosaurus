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

  /** Text bound to a shape, rather than free-standing text placed on the canvas. */
  const isContainer = $derived(Boolean(request.containerId));

  onMount(() => {
    originalText = request.text;
    value = request.text;
    node?.focus();
    node?.select();
    autoResize();
  });

  // Padding and border of the textarea itself, which sit outside the text box.
  const CHROME_PX = 14;

  function autoResize(): void {
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.max(node.scrollHeight, fontSizePx * 1.3)}px`;

    if (isContainer && request.width) {
      // Bound text is as wide as the shape holding it and wraps inside it, so the box
      // must not grow with the text the way free-standing text does.
      node.style.width = `${request.width}px`;
      return;
    }
    // Measured by the engine, against the font the canvas draws with. This used to
    // guess `maxLineLength * fontSize * 0.65`, counting UTF-16 units — so the box was a
    // third too wide for "Hello", nearly three times too wide for "iiii", and far too
    // narrow for "WWWW". The text visibly jumped the moment an edit was committed,
    // because the canvas and the textarea disagreed about how wide it was.
    const measured = engine.measureText(value, fontSizePx).width;
    node.style.width = `${Math.max(measured + CHROME_PX, 60)}px`;
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    const finalVal = value.trim();
    if (!isContainer && finalVal.length === 0 && originalText.trim().length === 0) {
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
  class:container-text={isContainer}
  style:left={`${request.x}px`}
  style:top={`${request.y}px`}
  style:min-height={`${fontSizePx * 1.3}px`}
  style:color={request.color}
  style:font-size={`${fontSizePx}px`}
  style:font-family={engine.fontFamily()}
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
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
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
    border: 1.5px dashed var(--accent, #6965db);
    border-radius: 4px;
    outline: none;
    resize: none;
    overflow: hidden;
    background: transparent;
    /* The family comes from the engine, so the overlay and the canvas render the same
       glyphs at the same widths. Hard-coding it here is how they drift apart. */
    line-height: 1.25;
    white-space: pre;
    z-index: 20;
    box-sizing: border-box;
  }

  textarea.container-text {
    text-align: center;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
