<script lang="ts">
  /**
   * Mermaid to diagram — the oracle's "Mermaid to Excalidraw"
   * (`TTDDialog/MermaidToExcalidraw.tsx@1118751f`): the definition on the left, what Insert
   * places on the right, redrawn as it is typed, and Insert or Ctrl/Cmd+Enter puts it in
   * the middle of the view. The definition is kept for next time, as the oracle keeps it.
   *
   * The preview is a second engine, drawn by the same renderer through the same
   * `insertJson` as the board, so what it shows is what lands — labels laid out in the
   * board's fonts included. It takes no input.
   */
  import type { DrawElementDto } from "@drawnosaurus/contract";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { DrawCanvas } from "@osionos/draw-engine/svelte";
  import { onMount } from "svelte";
  import { mermaidToElements, sceneJson } from "../mermaid/importMermaid.ts";

  let {
    onInsert,
    onClose,
  }: {
    onInsert: (elements: DrawElementDto[]) => void;
    onClose: () => void;
  } = $props();

  /** The oracle's own example (`MermaidToExcalidraw.tsx@1118751f:27-28`). */
  const EXAMPLE =
    "flowchart TD\n A[Christmas] -->|Get money| B(Go shopping)\n B --> C{Let me think}\n C -->|One| D[Laptop]\n C -->|Two| E[iPhone]\n C -->|Three| F[Car]";
  const STORAGE_KEY = "drawnosaurus:mermaid-definition";
  /** How long typing rests before the preview is redrawn. */
  const SETTLE_MS = 200;

  function stored(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function store(definition: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, definition);
    } catch {
      // Private mode or no storage: the definition is simply not remembered.
    }
  }

  let definition = $state(stored() ?? EXAMPLE);
  let elements = $state.raw<DrawElementDto[]>([]);
  let error = $state<string | null>(null);
  let preview = $state.raw<DrawEngine | null>(null);
  let syntax: HTMLTextAreaElement | undefined = $state();

  // Not `autofocus`: Svelte honours that itself, in a microtask that only fires when
  // nothing in the document is focused (`dom/elements/misc.js:11`).
  onMount(() => syntax?.focus());

  // Converted once typing settles; a result that arrives after a newer one started is dropped.
  let latest = 0;
  $effect(() => {
    const source = definition;
    const run = ++latest;
    const timer = setTimeout(async () => {
      if (!source.trim()) {
        elements = [];
        error = null;
        return;
      }
      try {
        const converted = await mermaidToElements(source);
        if (run !== latest) return;
        elements = converted;
        error = null;
      } catch (cause) {
        if (run !== latest) return;
        elements = [];
        error = cause instanceof Error ? cause.message : String(cause);
      }
      store(source);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!preview) return;
    preview.clear();
    if (elements.length === 0) return;
    preview.insertJson(sceneJson(elements));
    preview.zoomToFitSelection();
    preview.clearSelection();
  });

  function insert(): void {
    if (elements.length === 0) return;
    onInsert(elements);
    onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      insert();
    }
  }
</script>

<div class="modal-backdrop">
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="mermaid-title">
    <div class="modal-header">
      <h3 id="mermaid-title">Mermaid to diagram</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>
    <p class="description">
      Flowchart, sequence, class, entity relationship and state diagrams become shapes you can edit.
      Every other type is placed as a picture.
    </p>

    <div class="panels">
      <label class="panel">
        <span class="panel-title">Mermaid syntax</span>
        <textarea
          bind:this={syntax}
          bind:value={definition}
          onkeydown={onKeydown}
          spellcheck="false"
          placeholder="Write a Mermaid diagram definition here…"
        ></textarea>
      </label>
      <div class="panel">
        <span class="panel-title">Preview</span>
        <div class="preview" class:failed={error !== null}>
          <DrawCanvas ariaLabel="Mermaid preview" onReady={(engine) => (preview = engine)} />
          {#if error}
            <p class="error" role="alert">{error}</p>
          {/if}
        </div>
      </div>
    </div>

    <div class="actions">
      <span class="hint">Ctrl/Cmd+Enter</span>
      <button type="button" class="btn-primary" disabled={elements.length === 0} onclick={insert}>
        Insert ▸
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
    z-index: 100;
    backdrop-filter: blur(3px);
  }

  .modal-card {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 24px;
    width: 960px;
    max-width: 94vw;
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .close-btn {
    border: none;
    background: transparent;
    font-size: 16px;
    cursor: pointer;
    color: var(--muted);
    padding: 4px 8px;
    border-radius: 6px;
  }

  .description {
    margin: 8px 0 16px;
    font-size: 13px;
    color: var(--muted);
  }

  .panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .panel-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }

  textarea,
  .preview {
    height: 360px;
    box-sizing: border-box;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
  }

  textarea {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    padding: 10px 12px;
    color: var(--ink);
    resize: none;
  }

  .preview {
    position: relative;
    overflow: hidden;
  }

  /* A picture of the result, not a second board to draw on. */
  .preview :global(canvas) {
    pointer-events: none;
  }

  .preview.failed :global(canvas) {
    opacity: 0.25;
  }

  .error {
    position: absolute;
    inset: auto 0 0 0;
    margin: 0;
    padding: 10px 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    color: var(--danger);
    background: var(--surface);
    border-top: 1px solid var(--line);
    max-height: 50%;
    overflow: auto;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
  }

  .hint {
    font-size: 12px;
    color: var(--muted);
  }

  .btn-primary {
    padding: 8px 16px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
