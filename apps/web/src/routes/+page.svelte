<script lang="ts">
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import type { BoardSummary, WorldBounds } from "@drawnosaurus/contract";
  import { createBoard, deleteBoard, listBoards } from "$lib/api/client.ts";

  let boards = $state<BoardSummary[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let title = $state("");

  const describe = (cause: unknown): string =>
    cause instanceof Error ? cause.message : "something went wrong";

  async function load(cursor?: string): Promise<void> {
    try {
      const page = await listBoards(24, cursor);
      boards = cursor === undefined ? page.boards : [...boards, ...page.boards];
      nextCursor = page.nextCursor;
      error = null;
    } catch (cause) {
      error = describe(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = title.trim();
    if (name === "" || busy) return;

    busy = true;
    try {
      const board = await createBoard(name);
      boards = [board, ...boards];
      title = "";
      error = null;
    } catch (cause) {
      error = describe(cause);
    } finally {
      busy = false;
    }
  }

  async function remove(slug: string): Promise<void> {
    busy = true;
    try {
      await deleteBoard(slug);
      boards = boards.filter((board) => board.slug !== slug);
    } catch (cause) {
      error = describe(cause);
    } finally {
      busy = false;
    }
  }

  /**
   * Preview frame from the stored bounds. The API denormalises them on write, so the
   * gallery never loads an element array to show how big a board is.
   */
  const extent = (bounds: WorldBounds | null): string => {
    if (bounds === null) return "empty";
    return `${Math.round(bounds.maxX - bounds.minX)} x ${Math.round(bounds.maxY - bounds.minY)}`;
  };
</script>

<section>
  <form onsubmit={add}>
    <input
      bind:value={title}
      placeholder="New board title"
      aria-label="New board title"
      maxlength="200"
    />
    <button type="submit" disabled={busy || title.trim() === ""}>Create board</button>
  </form>

  {#if error !== null}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if loading}
    <p class="muted">Loading boards…</p>
  {:else if boards.length === 0}
    <p class="muted">No boards yet. Create one above.</p>
  {:else}
    <ul>
      {#each boards as board (board.slug)}
        <li>
          <a href={resolve("/boards/[slug]", { slug: board.slug })}>
            <strong>{board.title}</strong>
            <span class="meta">
              {board.elementCount} element{board.elementCount === 1 ? "" : "s"} ·
              {extent(board.bounds)} · rev {board.rev}
            </span>
            <span class="meta">edited {new Date(board.updatedAt).toLocaleString()}</span>
          </a>
          <button type="button" onclick={() => remove(board.slug)} disabled={busy}>Delete</button>
        </li>
      {/each}
    </ul>

    {#if nextCursor !== null}
      <button type="button" onclick={() => load(nextCursor ?? undefined)} disabled={busy}>
        Load more
      </button>
    {/if}
  {/if}
</section>

<style>
  section {
    max-width: 62rem;
    margin: 0 auto;
    padding: 1.5rem 1.1rem;
  }

  form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }

  form input {
    flex: 1 1 auto;
  }

  ul {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.8rem 0.9rem;
  }

  li a {
    flex: 1 1 auto;
    display: grid;
    gap: 0.15rem;
  }

  .meta,
  .muted {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .error {
    color: #b42318;
  }
</style>
