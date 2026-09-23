<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import { elementsFromJson } from "@osionos/draw-engine/json";
  import { Scene, type DrawElement } from "@osionos/draw-engine/types";
  import { ApiClientError, getBoard, patchElements } from "$lib/api/client.ts";
  import {
    SceneAutosaver,
    type AutosaveStatus,
    type FailureKind,
  } from "$lib/autosave/autosaver.ts";
  import { DRAFT_PREFIX, writeDraft } from "$lib/autosave/draft.ts";
  import { splitPatch } from "$lib/autosave/split.ts";
  import DrawSurface from "$lib/draw-chrome/DrawSurface.svelte";

  const slug = $derived(page.params.slug ?? "");

  let scene = $state<Scene | undefined>(undefined);
  let status = $state<AutosaveStatus>("idle");
  let title = $state("Board");

  /** Latest elements the engine reported; the autosaver reads this, never the DOM. */
  let live: DrawElement[] = [];

  const storage = (): Storage | undefined =>
    typeof localStorage === "undefined" ? undefined : localStorage;

  /**
   * 413 is the board or the request being too large, 400 a change the server will not
   * take: the same patch would be refused the same way, so neither is retried.
   */
  function classify(error: unknown): FailureKind {
    if (!(error instanceof ApiClientError)) return "retry";
    if (error.status === 413) return "too-large";
    if (error.status === 400 || error.status === 422) return "refused";
    return "retry";
  }

  const saver = new SceneAutosaver<DrawElement>({
    readScene: () => live,
    send: async (patch) => {
      // The local draft is the safety net for a write that does not land, so it is
      // cached before the request goes out, not after it succeeds.
      writeDraft(storage(), slug, live);
      // Deliberately NOT caught. The autosaver needs the rejection: it is what leaves
      // the patch unacknowledged and arms the retry. Swallowing it here made the
      // tracker treat never-sent elements as saved — so they were never resent — and
      // let the "idle" that follows a successful send overwrite the error status,
      // leaving the header reading "Saved" for a board the server had never received.
      //
      // In parts, pictures last and alone, so one the server refuses holds back only
      // itself. See `splitPatch`.
      for (const part of splitPatch(patch)) {
        await patchElements(slug, part);
      }
    },
    onStatus: (next) => {
      status = next;
    },
    classify,
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
          const cached = localStorage.getItem(`${DRAFT_PREFIX}${slug}`);
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

  /**
   * Applies what the engine reports, which is usually only what changed.
   *
   * The engine used to hand over the entire scene as JSON on every mutation. At 20k
   * elements that was ~9.8MB and ~60ms per shape drawn — the cost of drawing one
   * rectangle grew with the size of the board. It now sends a delta for the common
   * path and the full scene only for the structural changes a delta cannot describe
   * (a z-order command, a hard delete, an undo).
   */
  function onSceneChange(json: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return;
    }

    if (isDelta(parsed)) {
      applyDelta(parsed);
    } else {
      const elements = elementsFromJson(json);
      if (elements === null) return;
      live = elements;
    }

    // The draft cache is written from `live` rather than from the payload, which is no
    // longer the whole scene. Best effort, and it cannot throw: it used to, once a few
    // photos filled the storage quota, and the throw stopped the autosave below it.
    writeDraft(storage(), slug, live);
    saver.notify();
  }

  interface SceneDelta {
    type: "osidraw-delta";
    updated: DrawElement[];
    removed: string[];
  }

  const isDelta = (value: unknown): value is SceneDelta =>
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "osidraw-delta";

  function applyDelta(delta: SceneDelta): void {
    // Plain objects rather than Map/Set: these are function-local lookups, not
    // reactive state, and Svelte's lint rightly steers reactive collections elsewhere.
    const removed: Record<string, true> = {};
    for (const id of delta.removed) removed[id] = true;

    const pending: Record<string, DrawElement> = {};
    for (const element of delta.updated) pending[element.id] = element;

    // Rebuilt in place so z-order is preserved: the engine only sends a delta when the
    // order has not changed, so position in this array still means what it did.
    const next: DrawElement[] = [];
    for (const element of live) {
      if (removed[element.id]) continue;
      const replacement = pending[element.id];
      if (replacement) {
        next.push(replacement);
        delete pending[element.id];
      } else {
        next.push(element);
      }
    }
    // Whatever is left is new, and new elements go on top.
    for (const element of Object.values(pending)) next.push(element);

    live = next;
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
