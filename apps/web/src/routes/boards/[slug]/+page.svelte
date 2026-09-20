<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { elementsFromJson } from "@osionos/draw-engine/json";
  import { Scene, type DrawElement } from "@osionos/draw-engine/types";
  import { getBoard, patchElements } from "$lib/api/client.ts";
  import { SceneAutosaver, type AutosaveStatus } from "$lib/autosave/autosaver.ts";
  import DrawSurface from "$lib/draw-chrome/DrawSurface.svelte";

  const slug = $derived(page.params.slug ?? "");

  let scene = $state<Scene | undefined>(undefined);
  let status = $state<AutosaveStatus>("idle");
  let title = $state("Board");

  /** Latest elements the engine reported; the autosaver reads this, never the DOM. */
  let live: DrawElement[] = [];

  const LOCAL_STORAGE_PREFIX = "drawnosaurus:draft:";

  const saver = new SceneAutosaver<DrawElement>({
    readScene: () => live,
    send: async (patch) => {
      // Cache locally always so work is never lost
      if (typeof localStorage !== "undefined" && slug) {
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${slug}`, JSON.stringify(live));
      }
      try {
        await patchElements(slug, patch);
      } catch {
        // Fall back to local draft silently without crashing UI
        status = "error";
      }
    },
    onStatus: (next) => {
      status = next;
    },
  });

  onMount(() => {
    void (async () => {
      let elements: DrawElement[] = [];
      try {
        const board = await getBoard(slug);
        title = board.title;
        elements = elementsFromJson(JSON.stringify(board.scene)) ?? [];
      } catch {
        // Check local storage draft
        if (typeof localStorage !== "undefined") {
          const cached = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${slug}`);
          if (cached) {
            elements = elementsFromJson(cached) ?? [];
          }
        }
        title = slug ? `Board ${slug}` : "Untitled";
      }

      saver.tracker.reset(elements);
      live = elements;
      scene = new Scene(elements);
    })();

    const flushOnHide = (): void => {
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
    if (typeof localStorage !== "undefined" && slug) {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${slug}`, json);
    }
    saver.notify();
  }
</script>

<svelte:head><title>{title} · drawnosaurus</title></svelte:head>

<div class="board">
  <div class="surface">
    {#if scene !== undefined}
      <DrawSurface {scene} {title} {slug} {status} {onSceneChange} ariaLabel="Board canvas" />
    {:else}
      <div class="loading-state">
        <p>Loading board…</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .board {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--bg);
  }

  .surface {
    flex: 1 1 auto;
    height: 100%;
    width: 100%;
    position: relative;
  }

  .loading-state {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--muted);
    font-size: 14px;
  }
</style>
