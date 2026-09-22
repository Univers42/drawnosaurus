<script lang="ts" generics="T extends string">
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";

  /**
   * One exclusive choice, shown as icons.
   *
   * Neither of the two components beside it fits. `InspectorIconRow` is for *actions* —
   * "send to back", "flip" — and has no selected state at all, so an alignment rendered
   * through it could never show which one is in force. `InspectorSegmented` has the
   * state but renders a text label, and these three choices are only legible as pictures.
   *
   * `role="radiogroup"` rather than a row of toggles, because the choices are mutually
   * exclusive: `aria-pressed` on three buttons says three independent things are on or
   * off, and a screen reader would read it that way.
   */
  let {
    options,
    value,
    ariaLabel,
    onPick,
  }: {
    options: Array<{ label: string; icon: IconName; value: T }>;
    value: T;
    ariaLabel: string;
    onPick: (value: T) => void;
  } = $props();

  /**
   * Keeps the canvas selection alive through the click.
   *
   * Without it the mousedown moves focus out of the board, and a control that acts on
   * what is selected acts on nothing. Every other inspector control does the same.
   */
  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="choice" role="radiogroup" aria-label={ariaLabel}>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      class:on={option.value === value}
      aria-checked={option.value === value}
      aria-label={option.label}
      title={option.label}
      onmousedown={holdFocus}
      onclick={() => onPick(option.value)}
    >
      <Icon name={option.icon} size={14} />
    </button>
  {/each}
</div>

<style>
  .choice {
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

  button.on {
    color: var(--accent);
    background: var(--accent-subtle);
  }
</style>
