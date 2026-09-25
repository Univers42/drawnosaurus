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
  import { PictureLedger } from "$lib/autosave/pictures.ts";
  import { recoverStripped } from "$lib/autosave/recover.ts";
  import { SceneMirror } from "$lib/autosave/sceneMirror.ts";
  import { splitPatch } from "$lib/autosave/split.ts";
  import DrawSurface from "$lib/draw-chrome/DrawSurface.svelte";
  import { migrateLegacyStickyGroups } from "$lib/notes/stickyNotes.ts";

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

  /**
   * The pictures the server already has. Left off each save: they never change, and
   * moving a photo re-sent the photo — megabytes per move, from everyone in the room.
   */
  const saved = new PictureLedger();

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
        await patchElements(slug, part);
      }
      saved.note(patch.elements);
    },
    onStatus: (next) => {
      status = next;
    },
    classify,
  });

  onMount(() => {
    void (async () => {
      /** The board as the server has it — or, when it cannot be reached, as the draft does. */
      let loaded: DrawElement[] = [];
      /** The board as it is opened: `loaded`, with what this page repairs on the way in. */
      let elements: DrawElement[] = [];
      /** The ids of what it repaired, each re-stamped or deleted, to be saved again. */
      const resave: string[] = [];
      const nonce = (): number => Math.floor(Math.random() * 0x7fffffff);
      // Read beside the board rather than after it, so it costs the page no time.
      const draft = drafts.load(slug) as Promise<DrawElement[] | null>;
      try {
        const board = await getBoard(slug);
        title = board.title;
        loaded = elementsFromJson(JSON.stringify(board.scene)) ?? [];
        // The draft this page used to keep in localStorage: the server has the board,
        // and the string only took up the quota.
        storage()?.removeItem(`${LEGACY_DRAFT_PREFIX}${slug}`);
        // What the server stripped from boards saved before its schema had the fields —
        // every video an empty box — this browser may still have in its draft.
        const recovered = recoverStripped(loaded, await draft, Date.now(), nonce);
        elements = recovered.elements;
        resave.push(...recovered.repaired.map((element) => element.id));
      } catch {
        // The server is unreachable: the local draft, or the one an older version of
        // this page kept in localStorage.
        const drafted = await draft;
        const legacy = storage()?.getItem(`${LEGACY_DRAFT_PREFIX}${slug}`);
        loaded = drafted ?? (legacy ? (elementsFromJson(legacy) ?? []) : []);
        elements = loaded;
        title = slug ? `Board ${slug}` : "Untitled";
      }

      // A sticky note saved while it was four shapes in a group — shadow, pad, date and
      // label — made the one element the engine draws. See `stickyNotes.ts`.
      const migrated = migrateLegacyStickyGroups(elements, Date.now(), nonce);
      if (migrated.changed.length > 0) {
        elements = migrated.elements;
        const removed = migrated.removed.map((element) => element.id);
        resave.push(...migrated.changed.map((element) => element.id), ...removed);
        // And in the draft, or a board opened offline shows the dropped pieces again,
        // beside a note that is no longer in their group to take them back.
        drafts.record(slug, migrated.changed, removed, {
          order: elements.map((element) => element.id),
        });
      }

      // The tracker starts from what the server has, so what was repaired outranks it and
      // goes out whole — and what was dropped, an id that vanished, as its tombstone.
      saver.tracker.reset(loaded);
      saved.reset(loaded);
      live.replace(elements);
      scene = new Scene(elements);
      if (resave.length > 0) {
        saver.tracker.noteChanged(resave);
        saver.notify();
      }
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
   * (a z-order command, a hard delete, an undo). A delta that moved the stack — a shape
   * that joined a frame goes directly below it — carries the order of every id.
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
      if (parsed.order) {
        // The stack moved as well: only comparing everything finds the order to save.
        saver.tracker.noteEverything();
        drafts.record(slug, parsed.updated, parsed.removed, {
          order: live.elements.map((element) => element.id),
        });
      } else {
        // Nothing moved in the stack: all the delta did was put new elements on top.
        drafts.record(slug, parsed.updated, parsed.removed, { appended });
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
      drafts.record(slug, changed, removed, { order: live.elements.map((element) => element.id) });
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
