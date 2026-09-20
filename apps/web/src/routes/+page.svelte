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

  async function remove(slug: string, event: MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm("Are you sure you want to delete this board?")) return;
    busy = true;
    try {
      await deleteBoard(slug);
      boards = boards.filter((b) => b.slug !== slug);
    } catch (cause) {
      error = describe(cause);
    } finally {
      busy = false;
    }
  }

  const extent = (b: WorldBounds | null): string =>
    b === null ? "Empty" : `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} px`;
</script>

<div class="gallery-container">
  <div class="gallery-header">
    <div class="header-text">
      <h1>Your Boards</h1>
      <p class="subtitle">Create and collaborate on virtual whiteboards in real time.</p>
    </div>

    <form onsubmit={add} class="create-form">
      <input bind:value={title} placeholder="New board title…" maxlength="200" />
      <button type="submit" class="create-btn" disabled={busy || title.trim() === ""}
        >+ New Board</button
      >
    </form>
  </div>

  {#if error !== null}
    <div class="alert error" role="alert">{error}</div>
  {/if}

  {#if loading}
    <div class="empty-state"><p>Loading your boards…</p></div>
  {:else if boards.length === 0}
    <div class="empty-state">
      <div class="empty-icon">🎨</div>
      <h2>No drawings yet</h2>
      <p>Type a name above to create your first collaborative drawing board.</p>
    </div>
  {:else}
    <div class="grid">
      {#each boards as board (board.slug)}
        <a class="board-card" href={resolve("/boards/[slug]", { slug: board.slug })}>
          <div class="card-preview">
            <span class="preview-badge">{board.elementCount} elements</span>
          </div>
          <div class="card-body">
            <div class="card-title-row">
              <strong class="title">{board.title}</strong>
              <button
                type="button"
                class="del-btn"
                title="Delete board"
                onclick={(e) => remove(board.slug, e)}>✕</button
              >
            </div>
            <div class="meta-row">
              <span>{extent(board.bounds)}</span>
              <span>·</span>
              <span>{new Date(board.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        </a>
      {/each}
    </div>

    {#if nextCursor !== null}
      <div class="load-more-row">
        <button type="button" onclick={() => load(nextCursor ?? undefined)} disabled={busy}
          >Load more boards</button
        >
      </div>
    {/if}
  {/if}
</div>

<style>
  .gallery-container {
    max-width: 68rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem;
  }
  .gallery-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }
  h1 {
    font-size: 1.85rem;
    font-weight: 700;
    color: var(--fg-strong);
    margin: 0 0 0.35rem;
    letter-spacing: -0.02em;
  }
  .subtitle {
    font-size: 0.95rem;
    color: var(--muted);
    margin: 0;
  }
  .create-form {
    display: flex;
    gap: 0.5rem;
    flex-grow: 1;
    max-width: 26rem;
  }
  .create-form input {
    flex: 1;
  }
  .create-btn {
    background: var(--accent);
    color: #ffffff;
    border: none;
    font-weight: 600;
    white-space: nowrap;
  }
  .create-btn:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .alert.error {
    background: rgba(224, 49, 49, 0.1);
    color: var(--danger);
    border: 1px solid var(--danger);
    padding: 0.75rem 1rem;
    border-radius: var(--radius);
    margin-bottom: 1.5rem;
  }
  .empty-state {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--muted);
  }
  .empty-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }
  .empty-state h2 {
    color: var(--fg-strong);
    font-size: 1.25rem;
    margin: 0.5rem 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1.25rem;
  }
  .board-card {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    box-shadow: var(--shadow-sm);
    transition:
      transform var(--transition),
      box-shadow var(--transition),
      border-color var(--transition);
  }
  .board-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: var(--accent);
  }
  .card-preview {
    height: 110px;
    background: var(--bg);
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 8px;
    border-bottom: 1px solid var(--line);
  }
  .preview-badge {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
    background: var(--surface);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .card-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .card-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--fg-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .del-btn {
    border: none;
    background: transparent;
    color: var(--muted);
    padding: 2px 6px;
    font-size: 0.8rem;
    border-radius: 4px;
    opacity: 0.6;
    cursor: pointer;
    transition:
      opacity var(--transition),
      color var(--transition);
  }
  .del-btn:hover {
    opacity: 1;
    color: var(--danger);
    background: rgba(224, 49, 49, 0.1);
  }
  .meta-row {
    display: flex;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .load-more-row {
    display: flex;
    justify-content: center;
    margin-top: 2rem;
  }
</style>
