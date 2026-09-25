<script lang="ts">
  import { presentingNotice } from "./presentation.ts";

  /**
   * "<name> is presenting — Follow", while someone else is — and while this page is not
   * presenting itself. One button: press it to start tracking their slide, press it
   * again (it becomes "Stop following") to let go. See `DrawSurface.svelte`'s
   * `following` state and `docs/collaboration.md`.
   */
  let {
    name,
    following,
    onToggle,
  }: {
    name: string | undefined;
    following: boolean;
    onToggle: () => void;
  } = $props();
</script>

<div class="follow-notice" role="status">
  <span>{following ? "Following — press Esc to stop" : presentingNotice(name)}</span>
  {#if !following}
    <button type="button" onclick={onToggle}>Follow</button>
  {/if}
</div>

<style>
  .follow-notice {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    z-index: 95;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    border-radius: var(--radius);
    backdrop-filter: blur(12px);
    font-size: 13px;
    color: var(--ink);
  }

  .follow-notice button {
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--accent);
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
  }

  .follow-notice button:hover {
    filter: brightness(1.08);
  }
</style>
