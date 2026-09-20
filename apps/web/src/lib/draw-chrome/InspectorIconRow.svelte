<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";

  let {
    buttons,
  }: {
    buttons: Array<{ label: string; icon: IconName; onPick: () => void }>;
  } = $props();

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="icons">
  {#each buttons as button (button.label)}
    <button
      type="button"
      aria-label={button.label}
      title={button.label}
      onmousedown={holdFocus}
      onclick={button.onPick}
    >
      <Icon name={button.icon} size={14} />
    </button>
  {/each}
</div>

<style>
  .icons {
    display: flex;
    gap: 4px;
  }

  button {
    flex: 1;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
  }
</style>
