<script lang="ts">
  // `null` is a real choice, not "unset": Edges uses it for sharp corners, which is how
  // the engine spells "no roundness".
  type Option = string | number | null;

  let {
    options,
    value,
    ariaLabel,
    onPick,
  }: {
    options: Array<{ label: string; value: Option }>;
    value: Option;
    ariaLabel: string;
    onPick: (value: Option) => void;
  } = $props();

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="seg" role="group" aria-label={ariaLabel}>
  {#each options as option (String(option.value))}
    <button
      type="button"
      class:on={option.value === value}
      aria-pressed={option.value === value}
      onmousedown={holdFocus}
      onclick={() => onPick(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    gap: 4px;
  }

  button {
    flex: 1;
    height: 30px;
    border-radius: 6px;
    font-size: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
  }

  button.on {
    color: var(--accent);
    background: var(--accent-subtle);
  }
</style>
