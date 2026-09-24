<script lang="ts">
  /**
   * Asking for a link to embed.
   *
   * Whether a link *can* be embedded, and what it rewrites to, are the engine's — see
   * `resolveEmbed`. This asks the question before anything is placed, so someone pasting
   * a link that will not work is told so here rather than left with an empty box on the
   * board to delete.
   */
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { ALLOWED_EMBED_HOSTS } from "./embed.ts";

  let {
    engine,
    initial = "",
    onInsert,
    onClose,
  }: {
    engine: DrawEngine | null;
    /** The link an embed already has, when this changes it rather than adding one. */
    initial?: string;
    onInsert: (url: string) => void;
    onClose: () => void;
  } = $props();

  // The starting value only: from here on it is what is typed.
  // svelte-ignore state_referenced_locally
  let link = $state(initial);
  const editing = $derived(initial !== "");

  /** What the engine makes of what has been typed so far. */
  const resolved = $derived(link.trim() ? (engine?.resolveEmbed(link.trim()) ?? null) : null);
  const rejected = $derived(link.trim().length > 0 && resolved === null);

  function handleInsert(): void {
    const url = link.trim();
    if (!url || rejected) return;
    onInsert(url);
    onClose();
  }

  function handleKeydown(event: KeyboardEvent): void {
    // A one-field dialog: Enter is the button.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleInsert();
    }
  }
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="embed-title">
  <div class="modal-card">
    <div class="modal-header">
      <h3 id="embed-title">{editing ? "Change the embedded link" : "Embed a web page"}</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:value={link}
      onkeydown={handleKeydown}
      type="url"
      autofocus
      placeholder="https://www.youtube.com/watch?v=…"
      aria-label="Link to embed"
      aria-invalid={rejected}
    />

    {#if rejected}
      <p class="error-msg" role="alert">
        That link cannot be embedded. Only these sites are allowed:
        {ALLOWED_EMBED_HOSTS.join(", ")}.
      </p>
    {:else if resolved}
      <p class="resolved" role="status">
        {resolved.kind === "video" ? "Video" : "Page"} · embeds as
        <code>{resolved.url}</code>
      </p>
    {:else}
      <p class="hint">
        Paste a link — a video, a post, a song, a map, a document or a sandbox — or the embed code a
        site gives you. It is framed on the board and stays live; click its middle to use it.
      </p>
    {/if}

    <div class="actions">
      <button type="button" class="btn-cancel" onclick={onClose}>Cancel</button>
      <button type="button" class="btn-primary" disabled={!resolved} onclick={handleInsert}>
        {editing ? "Save" : "Embed"}
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
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    padding: 1.25rem;
    width: min(34rem, calc(100vw - 2rem));
    box-shadow: 0 16px 48px rgb(0 0 0 / 24%);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.875rem;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  .close-btn {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--muted);
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--text);
    font-size: 0.875rem;
  }

  input[aria-invalid="true"] {
    border-color: #e03131;
  }

  .hint,
  .resolved,
  .error-msg {
    margin: 0.625rem 0 0;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--muted);
  }

  .error-msg {
    color: #e03131;
  }

  /* The resolved URL is often long, and wrapping it is better than a scrollbar in a
     line of prose. */
  .resolved code {
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .actions button {
    padding: 0.4375rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
