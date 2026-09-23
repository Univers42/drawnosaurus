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
  import { DraftStore, indexedDbBackend } from "$lib/autosave/draftStore.ts";
  import { SceneMirror } from "$lib/autosave/sceneMirror.ts";
  import { splitPatch } from "$lib/autosave/split.ts";
  import DrawSurface from "$lib/draw-chrome/DrawSurface.svelte";

  const slug = $derived(page.params.slug ?? "");

  let scene = $state<Scene | undefined>(undefined);
  let status = $state<AutosaveStatus>("idle");
  let title = $state("Board");

  /**
   * Latest elements the engine reported, found by id; the autosaver reads this, never
   * the DOM. See `sceneMirror.ts` for why it is changed in place.
   */
  const live = new SceneMirror<DrawElement>();

  const storage = (): Storage | undefined =>
    typeof localStorage === "undefined" ? undefined : localStorage;

  /**
   * The local copy of the board, for when the server cannot be reached. Written a change
   * at a time, off the frame that made it — see `draftStore.ts` for what it replaced.
   */
  const drafts = new DraftStore(indexedDbBackend());
  const LEGACY_DRAFT_PREFIX = "drawnosaurus:draft:";

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
    readScene: () => live.elements,
    lookup: live.lookup,
    send: async (patch) => {
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
        // The draft this page used to keep in localStorage: the server has the board,
        // and the string only took up the quota.
        storage()?.removeItem(`${LEGACY_DRAFT_PREFIX}${slug}`);
      } catch {
        // The server is unreachable: the local draft, or the one an older version of
        // this page kept in localStorage.
        const drafted = (await drafts.load(slug)) as DrawElement[] | null;
        const legacy = storage()?.getItem(`${LEGACY_DRAFT_PREFIX}${slug}`);
        elements = drafted ?? (legacy ? (elementsFromJson(legacy) ?? []) : []);
        title = slug ? `Board ${slug}` : "Untitled";
      }

      saver.tracker.reset(elements);
      live.replace(elements);
      scene = new Scene(elements);
    })();

    const flushOnHide = (): void => {
      if (document.visibilityState !== "hidden") return;
      void saver.flush();
      void drafts.flush();
    };
    document.addEventListener("visibilitychange", flushOnHide);

    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
    };
  });

  /** The board as the server has it, deletions included — for catching up after a drop. */
  async function fetchLatest(): Promise<DrawElement[]> {
    const board = await getBoard(slug, { tombstones: true });
    return elementsFromJson(JSON.stringify(board.scene)) ?? [];
  }

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
      const appended = live.apply(parsed);
      saver.tracker.noteChanged(parsed.updated.map((element) => element.id));
      saver.tracker.noteChanged(parsed.removed);
      // A delta never rearranges the stack: all it can do is put new elements on top.
      drafts.record(slug, parsed.updated, parsed.removed, { appended });
    } else {
      const elements = elementsFromJson(json);
      if (elements === null) return;
      // A whole scene — an undo, a reorder. Only what it actually changed goes to the
      // draft: undo on a big board would otherwise rewrite every element.
      const { changed, removed } = live.replace(
        elements,
        (before, after) =>
          before.version === after.version && before.versionNonce === after.versionNonce,
      );
      saver.tracker.noteEverything();
      drafts.record(slug, changed, removed, { order: live.elements.map((element) => element.id) });
    }

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
</script>

<svelte:head><title>{title} · drawnosaurus</title></svelte:head>

<div class="board">
  <div class="surface">
    {#if scene !== undefined}
      <DrawSurface
        {scene}
        {title}
        {slug}
        {status}
        {onSceneChange}
        {fetchLatest}
        ariaLabel="Board canvas"
      />
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
