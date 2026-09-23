<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AutosaveStatus } from "$lib/autosave/autosaver.ts";
  import { autosaveIsTrouble, autosaveLabel } from "./status.ts";

  let {
    title = "Untitled",
    status = "idle",
    live = null,
    onToggleMenu,
    onOpenShare,
    onOpenShortcuts,
    onRename,
    menu,
  }: {
    title?: string;
    status?: AutosaveStatus;
    /** What to say about live collaboration, or null when all is well. See `liveLabel`. */
    live?: string | null;
    onToggleMenu: () => void;
    onOpenShare: () => void;
    onOpenShortcuts: () => void;
    onRename?: (nextTitle: string) => void;
    /**
     * The main menu, rendered here rather than at the page level so it can be positioned
     * against its own trigger. A dropdown that lives elsewhere has to be told where the
     * button is, and then told again whenever the layout moves.
     */
    menu?: Snippet;
  } = $props();

  let isEditing = $state(false);
  let editValue = $state("");

  function startEdit(): void {
    editValue = title;
    isEditing = true;
  }

  function commitEdit(): void {
    if (!isEditing) return;
    isEditing = false;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onRename?.(trimmed);
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") commitEdit();
    else if (e.key === "Escape") isEditing = false;
  }

  // The one wording, from `status.ts`. This used to keep its own, in which every state it
  // did not name read "Saved" — a board the server had refused among them — and a failed
  // save read "Saved locally".
  const statusText = $derived(autosaveLabel(status));
  const trouble = $derived(autosaveIsTrouble(status));
</script>

<header class="draw-header" aria-label="Canvas header">
  <div class="left-group">
    <div class="menu-anchor">
      <button
        type="button"
        class="menu-btn"
        onclick={onToggleMenu}
        aria-label="Open main menu"
        aria-haspopup="menu"
        title="Main menu"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          fill="none"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>
      {@render menu?.()}
    </div>

    {#if isEditing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        class="title-input"
        bind:value={editValue}
        onblur={commitEdit}
        onkeydown={handleKeyDown}
        aria-label="Edit board title"
        autofocus
      />
    {:else}
      <button type="button" class="board-title-btn" onclick={startEdit} title="Click to rename">
        <span class="board-title">{title}</span>
      </button>
    {/if}

    <span
      class="save-status"
      class:saving={status === "saving"}
      class:trouble
      aria-live="polite"
      aria-label="Save status"
    >
      {#if status === "saving"}
        <span class="dot-pulse"></span>
      {/if}
      {statusText}
    </span>
    {#if live}
      <span
        class="save-status live-status trouble"
        aria-live="polite"
        aria-label="Live collaboration"
      >
        <span class="dot-offline"></span>
        {live}
      </span>
    {/if}
  </div>

  <div class="right-group">
    <button
      type="button"
      class="share-btn"
      onclick={onOpenShare}
      aria-label="Share & collaborate"
      title="Live Collaboration"
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        stroke="currentColor"
        stroke-width="2"
        fill="none"
      >
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
      <span>Share</span>
    </button>

    <button
      type="button"
      class="help-btn"
      onclick={onOpenShortcuts}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
    >
      ?
    </button>
  </div>
</header>

<style>
  .draw-header {
    position: absolute;
    top: 12px;
    left: 14px;
    right: 14px;
    height: 44px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    pointer-events: none;
    z-index: 20;
  }

  /* The dropdown positions itself against this, so it follows the button. */
  .menu-anchor {
    position: relative;
    display: flex;
    align-items: center;
  }

  .left-group,
  .right-group {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
  }

  .menu-btn,
  .help-btn {
    height: 38px;
    min-width: 38px;
    padding: 0 10px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(8px);
    transition: all var(--transition);
  }

  .menu-btn:hover,
  .help-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .board-title-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 3px 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition:
      border-color var(--transition),
      background var(--transition);
  }

  .board-title-btn:hover {
    background: var(--bg);
    border-color: var(--line);
  }

  .board-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title-input {
    font-size: 13px;
    font-weight: 600;
    max-width: 180px;
    padding: 3px 6px;
    height: 28px;
  }

  .save-status {
    font-size: 11px;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--line);
    padding: 3px 8px;
    border-radius: 6px;
    box-shadow: var(--shadow-sm);
    display: flex;
    align-items: center;
    gap: 6px;
    backdrop-filter: blur(8px);
  }

  .save-status.trouble {
    color: var(--danger);
  }

  .dot-offline {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--danger);
  }

  .dot-pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s infinite alternate;
  }

  @keyframes pulse {
    from {
      opacity: 0.3;
      transform: scale(0.8);
    }
    to {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  .share-btn {
    height: 38px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    border-radius: var(--radius);
    border: none;
    background: var(--accent);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: all var(--transition);
  }

  .share-btn:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .share-btn:active {
    transform: translateY(0);
  }

  .help-btn {
    font-size: 14px;
    font-weight: 700;
    width: 38px;
  }
</style>
