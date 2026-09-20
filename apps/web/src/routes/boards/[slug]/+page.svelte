<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { elementsFromJson } from "@osionos/draw-engine/json";
  import { Scene, type DrawElement } from "@osionos/draw-engine/types";
  import { getBoard, patchElements } from "$lib/api/client.ts";
  import { SceneAutosaver, type AutosaveStatus } from "$lib/autosave/autosaver.ts";
  import DrawSurface from "$lib/draw-chrome/DrawSurface.svelte";
  import { autosaveLabel } from "$lib/draw-chrome/status.ts";

  const slug = $derived(page.params.slug ?? "");

  let scene = $state<Scene | undefined>(undefined);
  let status = $state<AutosaveStatus>("idle");
  let error = $state<string | null>(null);
  let title = $state("");

  /** Latest elements the engine reported; the autosaver reads this, never the DOM. */
  let live: DrawElement[] = [];

  const saver = new SceneAutosaver<DrawElement>({
    readScene: () => live,
    send: async (patch) => {
      await patchElements(slug, patch);
    },
    onStatus: (next) => {
      status = next;
    },
  });

  onMount(() => {
    void (async () => {
      try {
        const board = await getBoard(slug);
        title = board.title;

        // Round-trip through the engine's own parser rather than casting the wire
        // types: the engine owns the DrawElement shape, and this is once per load.
        const elements = elementsFromJson(JSON.stringify(board.scene)) ?? [];

        saver.tracker.reset(elements);
        live = elements;
        scene = new Scene(elements);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "could not load this board";
      }
    })();

    const flushOnHide = (): void => {
      // Leaving the tab is the last chance to persist a pending debounce.
      if (document.visibilityState === "hidden") void saver.flush();
    };
    document.addEventListener("visibilitychange", flushOnHide);

    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
    };
  });

  onDestroy(() => {
    saver.dispose();
  });

  function onSceneChange(json: string): void {
    const elements = elementsFromJson(json);
    if (elements === null) return;
    live = elements;
    saver.notify();
  }

  const statusLabel = $derived(autosaveLabel(status));
</script>

<svelte:head><title>{title === "" ? "Board" : title} · drawnosaurus</title></svelte:head>

<div class="board">
  <div class="board-bar">
    <a class="back" href={resolve("/")}>← Boards</a>
    {#if title !== ""}
      <strong>{title}</strong>
    {/if}
    <span class="status" class:error={status === "error"} aria-live="polite">{statusLabel}</span>
  </div>

  {#if error !== null}
    <p class="error-banner" role="alert">{error}</p>
  {/if}

  <div class="surface">
    {#if scene !== undefined}
      <DrawSurface {scene} {onSceneChange} ariaLabel="Board canvas" />
    {:else if error === null}
      <p class="muted">Loading board…</p>
    {/if}
  </div>
</div>

<style>
  .board {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .board-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.9rem;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    flex-wrap: wrap;
    flex: 0 0 auto;
  }

  .back {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .status {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.82rem;
  }

  .status.error,
  .error-banner {
    color: var(--danger);
  }

  .error-banner {
    margin: 0;
    padding: 0.6rem 0.9rem;
  }

  .surface {
    flex: 1 1 auto;
    min-height: 0;
  }

  .muted {
    color: var(--muted);
    padding: 1rem;
  }
</style>
