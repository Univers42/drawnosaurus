<script lang="ts">
  import { onMount, tick } from "svelte";
  import { moveStop, type Slide } from "./presentation.ts";

  /**
   * The presentation path: every frame, in the order Present visits them. Prezi's path
   * sidebar — numbered stops, a click flies the camera to one, a drag or Alt+↑/↓ moves it —
   * over Excalidraw+'s frame list. Each reorder is one `onReorder` with the whole order,
   * which the host commits as one step (`engine.setPresentationPath`).
   */
  let {
    stops,
    onVisit,
    onReorder,
    onPresent,
    onClose,
  }: {
    stops: Slide[];
    onVisit: (frameId: string) => void;
    onReorder: (frameIds: string[]) => void;
    onPresent: () => void;
    onClose: () => void;
  } = $props();

  let list = $state<HTMLOListElement>();
  let root: HTMLElement | undefined;
  let dragged = $state<number | null>(null);
  let over = $state<number | null>(null);

  const ids = $derived(stops.flatMap((stop) => (stop.frameId ? [stop.frameId] : [])));

  onMount(() => {
    (list?.querySelector<HTMLButtonElement>(".stop") ?? root)?.focus();
  });

  /** Moves the stop at `from` to `to`, then keeps the focus on it at its new place. */
  async function move(from: number, to: number): Promise<void> {
    const next = moveStop(ids, from, to);
    if (next.every((id, i) => id === ids[i])) return;
    const moved = ids[from]!;
    onReorder(next);
    await tick();
    list?.querySelectorAll<HTMLButtonElement>(".stop")[next.indexOf(moved)]?.focus();
  }

  function onStopKeydown(event: KeyboardEvent, index: number): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    void move(index, event.key === "ArrowUp" ? index - 1 : index + 1);
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  }

  function drop(index: number): void {
    if (dragged !== null) void move(dragged, index);
    dragged = null;
    over = null;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  bind:this={root}
  class="path-panel"
  aria-label="Presentation path"
  tabindex="-1"
  onkeydown={onPanelKeydown}
>
  <header>
    <h2>Presentation path</h2>
    <button type="button" class="close" aria-label="Close presentation path" onclick={onClose}
      >×</button
    >
  </header>

  {#if ids.length === 0}
    <p class="empty">No frames yet. Each frame you draw (F) becomes a stop on the path.</p>
  {:else}
    <p class="hint">Drag a stop, or Alt+↑/↓, to change the order.</p>
    <ol bind:this={list}>
      {#each stops as stop, index (stop.frameId)}
        <li
          draggable="true"
          class:dragging={dragged === index}
          class:over={over === index && dragged !== index}
          ondragstart={(event) => {
            dragged = index;
            event.dataTransfer?.setData("text/plain", stop.frameId ?? "");
          }}
          ondragover={(event) => {
            event.preventDefault();
            over = index;
          }}
          ondragleave={() => {
            if (over === index) over = null;
          }}
          ondrop={(event) => {
            event.preventDefault();
            drop(index);
          }}
          ondragend={() => {
            dragged = null;
            over = null;
          }}
        >
          <button
            type="button"
            class="stop"
            aria-label={`Stop ${index + 1}: ${stop.name}`}
            onclick={() => stop.frameId && onVisit(stop.frameId)}
            onkeydown={(event) => onStopKeydown(event, index)}
          >
            <span class="step" aria-hidden="true">{index + 1}</span>
            <span class="name">{stop.name}</span>
          </button>
          <button
            type="button"
            class="nudge"
            aria-label={`Move ${stop.name} earlier`}
            disabled={index === 0}
            onclick={() => move(index, index - 1)}>↑</button
          >
          <button
            type="button"
            class="nudge"
            aria-label={`Move ${stop.name} later`}
            disabled={index === ids.length - 1}
            onclick={() => move(index, index + 1)}>↓</button
          >
        </li>
      {/each}
    </ol>
    <button type="button" class="present" onclick={onPresent}>Present</button>
  {/if}
</aside>

<style>
  .path-panel {
    position: absolute;
    top: 64px;
    right: 12px;
    z-index: 60;
    width: 248px;
    max-height: calc(100% - 140px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    border-radius: var(--radius);
    color: var(--ink);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .hint,
  .empty {
    margin: 0;
    font-size: 12px;
    color: var(--fg-muted, #868e96);
  }

  ol {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 6px;
    border-top: 2px solid transparent;
  }

  li.dragging {
    opacity: 0.4;
  }

  li.over {
    border-top-color: var(--accent, #6965db);
  }

  button {
    height: 28px;
    border-radius: 6px;
    color: var(--ink);
  }

  button:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  button:disabled {
    opacity: 0.35;
  }

  .stop {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px;
    text-align: left;
    cursor: grab;
  }

  .step {
    flex: none;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent, #6965db);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .nudge,
  .close {
    width: 24px;
    flex: none;
    font-size: 14px;
  }

  .present {
    font-weight: 600;
    background: var(--accent, #6965db);
    color: #fff;
  }

  .present:hover {
    background: var(--accent-strong, #5b57d1);
  }
</style>
