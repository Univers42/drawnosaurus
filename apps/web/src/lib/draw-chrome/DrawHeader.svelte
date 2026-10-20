<script lang="ts">
  import type { Snippet } from "svelte";
  import { autosaveIsTrouble, autosaveLabel, type SaveLine } from "./status.ts";
  import { SHARED_LABELS, type SharedLine } from "../sharing/status.ts";
  import { TITLE_MAX, topBarPlan, type TopBarPlan } from "./topBar.ts";

  let {
    title = "Untitled",
    status = "idle",
    live = null,
    shared = null,
    onToggleMenu,
    onOpenShare,
    onOpenShortcuts,
    onRename,
    menu,
    /**
     * The width the tool bar takes in the middle of the row, measured by the tool bar
     * itself. Zero on a phone, which has no tool bar and a header of its own.
     */
    toolbarWidth = 0,
    /** A phone's header is its own: the phone's chrome, not this row. */
    phone = false,
    /** The plan, once it is known: the tool bar's row is the chrome's business. */
    onPlan,
  }: {
    title?: string;
    status?: SaveLine;
    /** What to say about live collaboration, or null when all is well. See `liveLabel`. */
    live?: string | null;
    /** What to say about a shared drawing's online copy, or null when there is none. */
    shared?: SharedLine | null;
    onToggleMenu: () => void;
    /** Opens the Share dialog. Without it there is no Share button: see `DrawSurface`. */
    onOpenShare?: (() => void) | undefined;
    onOpenShortcuts: () => void;
    onRename?: (nextTitle: string) => void;
    /**
     * The main menu, rendered here rather than at the page level so it can be positioned
     * against its own trigger. A dropdown that lives elsewhere has to be told where the
     * button is, and then told again whenever the layout moves.
     */
    menu?: Snippet;
    toolbarWidth?: number;
    phone?: boolean;
    onPlan?: (plan: TopBarPlan) => void;
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

  /**
   * The top bar's plan, and the parts it is measured from.
   *
   * The header knows what its own parts take; the tool bar's width comes from the tool
   * bar, and the plan is the two together (`topBar.ts`). The title gives way first and
   * the status chips next — the oracle's top bar has neither, so this is ours to decide,
   * and the decision is written down in `docs/reference/mobile.md`.
   */
  let plan = $state<TopBarPlan>({
    toolbarOwnRow: false,
    titleMaxWidth: TITLE_MAX,
    foldChips: false,
  });

  let root: HTMLElement | undefined = $state();
  let leftGroup: HTMLElement | undefined = $state();
  let menuAnchor: HTMLElement | undefined = $state();
  let titleButton: HTMLButtonElement | undefined = $state();
  let titleSpan: HTMLElement | undefined = $state();
  let chipsBox: HTMLElement | undefined = $state();
  let rightGroup: HTMLElement | undefined = $state();

  /**
   * Reads the widths off the DOM and asks the plan what to do with them.
   *
   * The title's natural width is its `scrollWidth`, which is the text's own width even
   * while the title is cut short — so a cut title is measured as the title it would be
   * if there were room, and the plan does not chase its own tail. The chips are measured
   * while they are open: when they are folded they are out of the flow and out of the
   * screen, but their width is still what it was.
   */
  function measure(): void {
    if (
      phone ||
      !root ||
      !leftGroup ||
      !menuAnchor ||
      !titleButton ||
      !titleSpan ||
      !chipsBox ||
      !rightGroup
    ) {
      return;
    }
    const gap = Math.max(
      0,
      titleButton.offsetLeft - (menuAnchor.offsetLeft + menuAnchor.offsetWidth),
    );
    const titleChrome = Math.max(0, titleButton.offsetWidth - titleSpan.offsetWidth);
    const next = topBarPlan({
      toolbar: toolbarWidth,
      leftFixed: menuAnchor.offsetWidth + gap + titleChrome,
      title: titleSpan.scrollWidth,
      chips: chipsBox.offsetWidth,
      right: rightGroup.offsetWidth,
      gap,
      margin: root.offsetLeft,
      viewport: window.innerWidth,
    });
    plan = next;
    onPlan?.(next);
  }

  // The measurements follow the title, the statuses, the tool bar and the window.
  $effect(() => {
    void title;
    void status;
    void live;
    void shared;
    void toolbarWidth;
    void phone;
    measure();
  });

  /** Every status, in one line: what the folded chip says and what it is named. */
  const foldedLabel = $derived(
    [statusText, live, shared ? SHARED_LABELS[shared] : null]
      .filter((part): part is string => !!part)
      .join(" · "),
  );
</script>

<svelte:window onresize={measure} />

<header class="draw-header" aria-label="Canvas header" bind:this={root}>
  <div class="left-group" bind:this={leftGroup}>
    <div class="menu-anchor" bind:this={menuAnchor}>
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
        style:max-width={phone ? undefined : `${plan.titleMaxWidth}px`}
      />
    {:else}
      <button
        type="button"
        class="board-title-btn"
        bind:this={titleButton}
        onclick={startEdit}
        title="Click to rename"
      >
        <span
          class="board-title"
          bind:this={titleSpan}
          style:max-width={phone ? undefined : `${plan.titleMaxWidth}px`}>{title}</span
        >
      </button>
    {/if}

    <!--
      The status chips. Folded, they are one icon whose label is the whole line: the
      words are still there for the screen reader and for the tooltip, and only the room
      goes. The open chips stay in the document while they are folded — out of the flow
      and out of the screen — because their width is what the plan measures.
    -->
    <div class="chips" bind:this={chipsBox} class:folded={plan.foldChips}>
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
      {#if shared}
        <span class="save-status shared-status" aria-live="polite" aria-label="Shared copy">
          {SHARED_LABELS[shared]}
        </span>
      {/if}
    </div>

    {#if plan.foldChips}
      <span
        class="save-status folded-status"
        class:trouble
        aria-live="polite"
        aria-label={foldedLabel}
        title={foldedLabel}
      >
        {#if status === "saving"}
          <span class="dot-pulse"></span>
        {:else if trouble}
          <span class="dot-offline"></span>
        {:else}
          <span class="dot-quiet"></span>
        {/if}
        <span class="folded-words">{foldedLabel}</span>
      </span>
    {/if}
  </div>

  <div class="right-group" bind:this={rightGroup}>
    {#if onOpenShare}
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
    {/if}

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
    flex: 0 0 auto;
  }

  .left-group,
  .right-group {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
  }

  /*
    The left end of the row: what is left of the tool bar, and the tool bar is in the
    middle of the row. The end never grows past what the row has for it — the title is
    cut short (`topBar.ts`'s plan) and the chips fold into one icon when even that is
    not enough. No `overflow: hidden` here: the main menu is drawn inside this row and a
    dropdown that is clipped by its own row is not a dropdown.
  */
  .left-group {
    min-width: 0;
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
    min-width: 0;
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

  /* The chips, in a row of their own: the plan measures them together. */
  .chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }

  /*
    Folded, the chips are out of the flow and out of the screen, and the folded icon
    stands in for them. They stay in the document because their width is what the plan
    measures — the width they had when they were open.
  */
  .chips.folded {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
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
    white-space: nowrap;
  }

  .save-status.trouble {
    color: var(--danger);
  }

  /* The folded chip: one icon, and the words as its name. */
  .folded-status {
    padding: 3px 8px;
  }

  /* The words are there for the screen reader and the tooltip, and out of the way. */
  .folded-words {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .dot-offline {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--danger);
  }

  /* The quiet dot: the folded chip when nothing is wrong. */
  .dot-quiet {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
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
