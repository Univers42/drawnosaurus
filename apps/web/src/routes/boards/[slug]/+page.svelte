<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { DrawCanvas } from "@osionos/draw-engine/svelte";
  import { elementsFromJson } from "@osionos/draw-engine/json";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { Scene, type DrawElement, type DrawTool } from "@osionos/draw-engine/types";
  import { getBoard, patchElements } from "$lib/api/client.ts";
  import { SceneAutosaver, type AutosaveStatus } from "$lib/autosave/autosaver.ts";

  const slug = $derived(page.params.slug ?? "");

  let scene = $state<Scene | undefined>(undefined);
  let status = $state<AutosaveStatus>("idle");
  let error = $state<string | null>(null);
  let title = $state("");
  let tool = $state<DrawTool>("select");

  let engine: DrawEngine | null = null;
  /** Latest elements the engine reported; the autosaver reads this, never the DOM. */
  let live: DrawElement[] = [];

  const TOOLS: readonly DrawTool[] = [
    "select",
    "rectangle",
    "ellipse",
    "diamond",
    "arrow",
    "line",
    "freedraw",
    "text",
    "eraser",
  ];

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

  function pick(next: DrawTool): void {
    engine?.setTool(next);
    tool = next;
  }

  const statusLabel = $derived(
    status === "saving"
      ? "Saving…"
      : status === "pending"
        ? "Unsaved changes"
        : status === "error"
          ? "Save failed — retrying"
          : "Saved",
  );
</script>

<svelte:head><title>{title === "" ? "Board" : title} · drawnosaurus</title></svelte:head>

<div class="board">
  <div class="toolbar">
    <a class="back" href={resolve("/")}>← Boards</a>

    <div class="tools" role="toolbar" aria-label="Drawing tools">
      {#each TOOLS as name (name)}
        <button
          type="button"
          class:active={tool === name}
          aria-pressed={tool === name}
          onclick={() => pick(name)}
        >
          {name}
        </button>
      {/each}
    </div>

    <div class="arrange">
      <button type="button" onclick={() => engine?.reorderSelection("front")}>Front</button>
      <button type="button" onclick={() => engine?.reorderSelection("back")}>Back</button>
      <button type="button" onclick={() => engine?.fit(64)}>Fit</button>
    </div>

    <span class="status" class:error={status === "error"} aria-live="polite">{statusLabel}</span>
  </div>

  {#if error !== null}
    <p class="error-banner" role="alert">{error}</p>
  {/if}

  <div class="surface">
    {#if scene !== undefined}
      <DrawCanvas
        {scene}
        {onSceneChange}
        onReady={(instance) => {
          engine = instance;
        }}
        onToolChange={(next) => {
          tool = next;
        }}
        ariaLabel="Board canvas"
      />
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

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.9rem;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    flex-wrap: wrap;
  }

  .tools,
  .arrange {
    display: flex;
    gap: 0.3rem;
  }

  .tools button {
    text-transform: capitalize;
    padding: 0.3rem 0.55rem;
    font-size: 0.85rem;
  }

  .tools button.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .status {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.82rem;
  }

  .status.error,
  .error-banner {
    color: #b42318;
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
