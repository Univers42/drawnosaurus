<script lang="ts">
  let {
    title = "Untitled",
    status = "idle",
    onToggleMenu,
    onOpenShare,
    onOpenShortcuts,
  }: {
    title?: string;
    status?: string;
    onToggleMenu: () => void;
    onOpenShare: () => void;
    onOpenShortcuts: () => void;
  } = $props();

  const statusText = $derived(
    status === "saving"
      ? "Saving…"
      : status === "error"
        ? "Saved locally 💾"
        : status === "dirty"
          ? "Unsaved changes"
          : "Saved ✓",
  );
</script>

<header class="draw-header" aria-label="Canvas header">
  <div class="left-group">
    <button
      type="button"
      class="menu-btn"
      onclick={onToggleMenu}
      aria-label="Open main menu"
      title="Main menu"
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        stroke="currentColor"
        stroke-width="2"
        fill="none"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
      </svg>
    </button>

    <span class="board-title" {title}>{title}</span>
    <span class="save-status" class:saving={status === "saving"} class:cached={status === "error"}>
      {statusText}
    </span>
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
        width="16"
        height="16"
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
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: all 0.15s ease;
  }

  .menu-btn:hover,
  .help-btn:hover {
    background: var(--bg);
    border-color: var(--accent);
  }

  .board-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 4px;
  }

  .save-status {
    font-size: 11px;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--line);
    padding: 4px 8px;
    border-radius: 6px;
    box-shadow: var(--shadow-sm);
  }

  .save-status.cached {
    color: var(--accent);
  }

  .share-btn {
    height: 38px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    border-radius: 9px;
    border: none;
    background: var(--accent);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: opacity 0.15s ease;
  }

  .share-btn:hover {
    opacity: 0.92;
  }

  .help-btn {
    font-size: 14px;
    font-weight: 700;
    width: 38px;
  }
</style>
