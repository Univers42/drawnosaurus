<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { elementsFromJson } from "@osionos/draw-engine/json";
  import { Scene, type DrawElement } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { ApiClientError } from "$lib/api/client.ts";
  import { holdForSave } from "$lib/boards/holdForSave.ts";
  import { openBoard } from "$lib/boards/openBoard.ts";
  import { BROWSER_MODE } from "$lib/mode.ts";
  import { boards } from "$lib/store/index.ts";
  import {
    SceneAutosaver,
    type AutosaveStatus,
    type FailureKind,
  } from "$lib/autosave/autosaver.ts";
  import { DraftStore, indexedDbBackend } from "$lib/autosave/draftStore.ts";
  import { PictureLedger } from "$lib/autosave/pictures.ts";
  import { SceneMirror } from "$lib/autosave/sceneMirror.ts";
  import { splitPatch } from "$lib/autosave/split.ts";
  import DrawSurface from "$lib/draw-chrome/DrawSurface.svelte";
  import { saveLine } from "$lib/draw-chrome/status.ts";
  import { ThumbnailUploader } from "$lib/thumbnail/thumbnailUploader.ts";

  /**
   * Read once: this page is one board's for its whole life (`+layout.svelte` makes a new
   * one for each slug). Followed from the URL, it changed under a save still in flight,
   * and a board's edits were sent to the next one.
   */
  const slug = page.params.slug ?? "";

  let scene = $state<Scene | undefined>(undefined);
  let status = $state<AutosaveStatus>("idle");
  let title = $state("Board");
  /** The public build's: the stored drawing could not be read, so it opened empty. */
  let unread = $state(false);

  /**
   * Latest elements the engine reported, found by id; the autosaver reads this, never
   * the DOM. See `sceneMirror.ts` for why it is changed in place.
   */
  const live = new SceneMirror<DrawElement>();

  const storage = (): Storage | undefined =>
    typeof localStorage === "undefined" ? undefined : localStorage;

  /**
   * The local copy of the board, for when the server cannot be reached. Written a change
   * at a time, off the frame that made it — see `draftStore.ts` for what it replaced. None
   * in the public build: its store is already the local copy (`boards/openBoard.ts`).
   */
  const drafts = BROWSER_MODE ? null : new DraftStore(indexedDbBackend());

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

  /**
   * The pictures the server already has. Left off each save: they never change, and
   * moving a photo re-sent the photo — megabytes per move, from everyone in the room.
   */
  const saved = new PictureLedger();

  let engine: DrawEngine | null = null;
  /** Board opened with elements and no stored picture; spent once the engine is ready. */
  let needsThumbnailBackfill = false;
  let previousStatus: AutosaveStatus = "idle";
  /** Torn down: a load still under way must not seed a page that is gone. */
  let destroyed = false;

  const thumbnails = new ThumbnailUploader({
    render: async () => (engine === null ? null : await engine.exportThumbnail()),
    upload: (blob) => boards.putThumbnail(slug, blob),
    now: () => Date.now(),
  });

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
      for (const part of splitPatch({ ...patch, elements: saved.strip(patch.elements) })) {
        await boards.patchElements(slug, part);
      }
      saved.note(patch.elements);
    },
    onStatus: (next) => {
      thumbnails.onStatus(previousStatus, next);
      previousStatus = next;
      status = next;
    },
    classify,
  });

  onMount(() => {
    void (async () => {
      const opened = await openBoard({
        slug,
        browser: BROWSER_MODE,
        store: boards,
        drafts,
        storage: storage(),
        now: () => Date.now(),
        nonce: () => Math.floor(Math.random() * 0x7fffffff),
      });
      // Left before its board opened: the saver is disposed and nothing of it is on screen.
      if (destroyed) return;
      const { loaded, elements, resave } = opened;
      title = opened.title;
      needsThumbnailBackfill = opened.needsThumbnailBackfill;
      unread = opened.failure !== null;

      // The tracker starts from what the store has, so what was repaired outranks it and
      // goes out whole — and what was dropped, an id that vanished, as its tombstone.
      saver.tracker.reset(loaded);
      saved.reset(loaded);
      live.replace(elements);
      // `opened.tombstones` (empty when nothing was migrated) rides along on `scene`,
      // not on `live`: DrawSurface reads `scene.toArray()` twice, once to seed
      // `engine.setScene()` and once to seed `liveBroadcast.reset()` — the one place
      // that reaches both the engine's own merge and the live link. Without the
      // tombstones here, neither ever learns the shadow and date were deleted, so a
      // peer tab still holding the legacy group answers this page's `join` with them
      // at their old stamp and they are adopted back in (`liveBroadcast.ts` ›
      // missing/adoptRemote); the engine, never having heard of the id at all, takes
      // it unconditionally (`apply_remote_patch_step`, `self.scene.get(id) == None`).
      // Loaded here as deleted elements instead, both refuse it on stamp alone.
      scene = new Scene([...elements, ...opened.tombstones]);
      if (resave.length > 0) {
        saver.tracker.noteChanged(resave);
        saver.notify();
      }
    })();

    const flushOnHide = (): void => {
      if (document.visibilityState === "hidden") flushPending();
    };
    document.addEventListener("visibilitychange", flushOnHide);

    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
    };
  });

  /** Sends everything still waiting: the diff, the local draft and the gallery picture. */
  function flushPending(): void {
    void saver.flush();
    void drafts?.flush();
    void thumbnails.flushNow();
  }

  // Leaving inside the app tears this page down with `onDestroy`, which disposes the
  // saver — an edit still inside the debounce was never sent. `beforeNavigate` runs ahead
  // of any teardown, so the engine can still render the thumbnail too. In the public build
  // the navigation waits for the save as well, and does not happen if it failed: there is
  // no draft behind the saver there (`holdForSave.ts`).
  beforeNavigate((navigation) => {
    const held = holdForSave(navigation, {
      browser: BROWSER_MODE,
      status: () => status,
      flush: () => saver.flush(),
      go: (delta) => history.go(delta),
      goto,
    });
    if (held === null) flushPending();
  });

  /** The board as the server has it, deletions included — for catching up after a drop. */
  async function fetchLatest(): Promise<DrawElement[]> {
    const board = await boards.get(slug, { tombstones: true });
    return elementsFromJson(JSON.stringify(board.scene)) ?? [];
  }

  onDestroy(() => {
    destroyed = true;
    saver.dispose();
    thumbnails.dispose();
  });

  function onReady(next: DrawEngine): void {
    engine = next;
    if (!needsThumbnailBackfill) return;
    needsThumbnailBackfill = false;
    thumbnails.backfill();
  }

  /**
   * Applies what the engine reports, which is usually only what changed.
   *
   * The engine used to hand over the entire scene as JSON on every mutation. At 20k
   * elements that was ~9.8MB and ~60ms per shape drawn — the cost of drawing one
   * rectangle grew with the size of the board. It now sends a delta for the common
   * path and the full scene only for the structural changes a delta cannot describe
   * (a z-order command, a hard delete, an undo). A delta that moved the stack — a shape
   * that joined a frame goes directly below it — carries the order of every id.
   */
  function onSceneChange(json: string): void {
    thumbnails.noteChanged();
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
      if (parsed.order) {
        // The stack moved as well: only comparing everything finds the order to save.
        saver.tracker.noteEverything();
        drafts?.record(slug, parsed.updated, parsed.removed, {
          order: live.elements.map((element) => element.id),
        });
      } else {
        // Nothing moved in the stack: all the delta did was put new elements on top.
        drafts?.record(slug, parsed.updated, parsed.removed, { appended });
      }
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
      drafts?.record(slug, changed, removed, { order: live.elements.map((element) => element.id) });
    }

    saver.notify();
  }

  interface SceneDelta {
    type: "osidraw-delta";
    updated: DrawElement[];
    removed: string[];
    order?: string[];
  }

  const isDelta = (value: unknown): value is SceneDelta =>
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "osidraw-delta";
</script>

<svelte:head><title>{title} · Hydrawn</title></svelte:head>

<div class="board">
  <div class="surface">
    {#if scene !== undefined}
      <DrawSurface
        {scene}
        {title}
        {slug}
        status={saveLine(status, unread)}
        {onSceneChange}
        {onReady}
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
