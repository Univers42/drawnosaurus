<script lang="ts">
  /**
   * The text being typed, over the canvas — which does not paint it meanwhile, so it is
   * never on screen twice. A port of Excalidraw's `textWysiwyg`
   * (`packages/excalidraw/wysiwyg/textWysiwyg.tsx@1118751f`): a bare textarea in the text's
   * own font, size and colour, in world units, scaled and turned by the camera onto the
   * box the engine laid the text out in (`engine/text_session.rs`). Every keystroke goes
   * to the engine, which re-wraps the text and grows its shape; the box is read back after
   * it, and after every camera, style or peer change (`revision`).
   */
  import { onMount } from "svelte";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { TextEditRequest } from "@osionos/draw-engine/types";
  import {
    editorBox,
    editorKey,
    indent,
    normalizeText,
    outdent,
    pressKeepsEditor,
  } from "./textEditor.ts";

  let {
    engine,
    request,
    revision,
    onInput,
    onDone,
  }: {
    engine: DrawEngine;
    request: TextEditRequest;
    /** Moves whenever the text may have moved or changed look. */
    revision: number;
    /** Something was typed — for the others to see. */
    onInput?: () => void;
    /** The edit is over. `boardPress`: a primary press on the board ended it. */
    onDone: (boardPress: boolean) => void;
  } = $props();

  let node: HTMLTextAreaElement | undefined = $state();
  /** Moves on every keystroke and resize, so the box is read again. */
  let typed = $state(0);
  let finished = false;
  /**
   * Whether losing focus ends the edit. Not while a press on the style panel or the zoom
   * bar, or a middle-button pan, is under way (`temporarilyDisableSubmit`,
   * `textWysiwyg.tsx@1118751f:938-945`); focus coming back arms it again.
   */
  let blurEnds = true;

  const layout = $derived.by(() => {
    void revision;
    void typed;
    return engine.textEditLayout();
  });

  const box = $derived.by(() => {
    if (!layout) return null;
    const chrome = node?.parentElement;
    return editorBox(layout, {
      width: chrome?.clientWidth ?? window.innerWidth,
      height: chrome?.clientHeight ?? window.innerHeight,
    });
  });

  // The engine let the text go — a peer took it, the board was replaced: nothing is left
  // to type into.
  $effect(() => {
    if (!layout) finish(false);
  });

  onMount(() => {
    if (!node) return;
    // Set here, not through the attribute: Svelte would write it after `select()` and
    // collapse the selection to the end.
    node.value = request.text;
    // A new text is laid out as one empty line from the start, not the press-sized box
    // it was made with.
    if (!request.text && engine.updateTextEdit("")) typed += 1;
    node.focus();
    node.select();
    // At once: the editor opens on a release, a double click or a key, never inside the
    // press it would take for one that ends it — which the oracle waits a frame to skip
    // (`textWysiwyg.tsx@1118751f:1047-1053`). A frame can be long enough to click in.
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pointerdown", onWindowPointerDown, true);
      window.removeEventListener("pointerup", onPressEnd);
      window.removeEventListener("beforeunload", onUnload);
    };
  });

  /** Ends the edit; `commit` writes what was typed, as one step. */
  function finish(commit: boolean, viaKeyboard = false, boardPress = false): void {
    if (finished) return;
    finished = true;
    const focused = document.activeElement === node;
    if (commit && node) engine.commitTextEdit(node.value, viaKeyboard);
    // The keyboard goes back to the board, so Enter opens the text again.
    if (focused) document.querySelector<HTMLElement>('.draw-chrome [role="application"]')?.focus();
    onDone(boardPress);
  }

  function onUnload(): void {
    finish(true);
  }

  function typedIn(): void {
    if (!node || finished) return;
    const normal = normalizeText(node.value);
    if (normal !== node.value) {
      const at = node.selectionStart;
      node.value = normal;
      node.setSelectionRange(at, at);
    }
    if (!engine.updateTextEdit(node.value)) return finish(false);
    typed += 1;
    onInput?.();
  }

  function onKeydown(event: KeyboardEvent): void {
    const action = editorKey(event);
    if (!action || !node) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "submit") finish(true, true);
    else if (action === "zoomIn") engine.zoomIn();
    else if (action === "zoomOut") engine.zoomOut();
    else if (action === "zoomReset") engine.zoomReset();
    else if (action === "indent" || action === "outdent") {
      const current = {
        value: node.value,
        selectionStart: node.selectionStart,
        selectionEnd: node.selectionEnd,
      };
      const next = action === "indent" ? indent(current) : outdent(current);
      node.value = next.value;
      node.setSelectionRange(next.selectionStart, next.selectionEnd);
      typedIn();
    }
  }

  /**
   * A press elsewhere (`onPointerDown`, `textWysiwyg.tsx@1118751f:947-998`): on the board it
   * ends the edit — before the board sees it, so the press only ends it; on the style panel
   * or the zoom bar, or with the middle button, the edit stays open.
   */
  function onWindowPointerDown(event: PointerEvent): void {
    if (finished || event.target === node) return;
    if (pressKeepsEditor(event.target as Element | null, event.button)) {
      blurEnds = false;
      window.addEventListener("pointerup", onPressEnd);
    } else if (event.target instanceof HTMLCanvasElement) {
      finish(true, false, event.button === 0);
    }
  }

  /**
   * After a press that kept the edit open, the typing carries on — unless the press left
   * the focus in something that takes keys of its own, a field or the colour picker.
   */
  function onPressEnd(): void {
    window.removeEventListener("pointerup", onPressEnd);
    setTimeout(() => {
      if (finished || !node) return;
      const active = document.activeElement;
      const keeps = active?.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"]',
      );
      if (keeps && active !== node) return;
      blurEnds = true;
      node.focus();
    });
  }
</script>

<svelte:window onresize={() => (typed += 1)} />

<textarea
  bind:this={node}
  aria-label="Text editor"
  dir="auto"
  wrap="off"
  spellcheck={false}
  class:wrap={layout?.wrap}
  style:left={box ? `${box.left}px` : undefined}
  style:top={box ? `${box.top}px` : undefined}
  style:width={box ? `${box.width}px` : undefined}
  style:height={box ? `${box.height}px` : undefined}
  style:max-height={box ? `${box.maxHeight}px` : undefined}
  style:transform={box?.transform}
  style:font-size={layout ? `${layout.fontSize}px` : undefined}
  style:font-family={layout ? engine.fontFamily(layout.fontFamily) : undefined}
  style:line-height={layout?.lineHeight}
  style:text-align={layout?.textAlign}
  style:color={layout?.color}
  style:opacity={layout?.opacity}
  oninput={typedIn}
  onkeydown={onKeydown}
  onfocus={() => (blurEnds = true)}
  onblur={() => {
    if (blurEnds) finish(true);
  }}
></textarea>

<style>
  /* `textWysiwyg.tsx@1118751f:461-486`: nothing of its own — no border, no padding, no
     background — so what is typed is the text as the canvas will draw it. */
  textarea {
    position: absolute;
    display: inline-block;
    min-height: 1em;
    backface-visibility: hidden;
    margin: 0;
    padding: 0;
    border: 0;
    outline: 0;
    resize: none;
    background: transparent;
    overflow: hidden;
    /* Over the board and what floats on it, under the panels, so a press on the style
       panel reaches it even where the text runs under it. */
    z-index: 12;
    word-break: normal;
    white-space: pre;
    overflow-wrap: break-word;
    box-sizing: content-box;
  }

  /* A label, or a text of fixed width: wrapped at its width, as the engine wraps it. */
  textarea.wrap {
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
