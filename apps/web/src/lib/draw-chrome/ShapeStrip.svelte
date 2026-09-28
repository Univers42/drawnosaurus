<script lang="ts">
  /**
   * A row of type buttons, for the two places the chrome offers a type by click:
   *
   * - growing a flowchart with Ctrl/Cmd held — an extra the oracle lacks (task brief,
   *   "Better than Excalidraw"): it sits above the node being created and offers the
   *   1/2/3 choice `keys.ts` reads from the keyboard, so the choice is discoverable
   *   rather than a hidden chord;
   * - Tab's shape switch, which the oracle shows under the selection with the shared
   *   type pressed (`ConvertElementTypePopup.tsx@1118751f`). That one offers the three
   *   closed shapes or the four linear types, whichever the selection is
   *   (`shapeSwitch.ts` › `switchTypes`), so the row is given its types rather than
   *   naming them itself.
   */
  import Icon from "./Icon.svelte";
  import type { ConversionType } from "@osionos/draw-engine/types";
  import { typeIcon, typeLabel } from "./shapeSwitch.ts";

  let {
    x,
    y,
    label,
    below = false,
    keyHints = false,
    current,
    types,
    onChoose,
  }: {
    x: number;
    y: number;
    label: string;
    /** Hangs down and to the right of its point, rather than sitting above it, centred. */
    below?: boolean;
    /** Names each button with the key that picks it, `"Rectangle (1)"`. */
    keyHints?: boolean;
    /** The type shown pressed — none, when the shapes differ. Left out, no button toggles. */
    current?: ConversionType | null;
    /** The types on offer. Left out, the three closed shapes with their 1/2/3 keys. */
    types?: readonly ConversionType[];
    onChoose: (shape: ConversionType) => void;
  } = $props();

  const KEYS = ["1", "2", "3", "4"];

  const SHAPES = $derived(
    (types ?? ["rectangle", "diamond", "ellipse"]).map((shape, index) => ({
      shape,
      name: typeLabel(shape),
      icon: typeIcon(shape),
      key: KEYS[index],
    })),
  );
</script>

<div
  class="draw-panel strip"
  class:below
  role="toolbar"
  aria-label={label}
  style:left="{x}px"
  style:top="{y}px"
>
  {#each SHAPES as { shape, name, icon, key } (shape)}
    <!-- Focus stays on the board: a flowchart's Ctrl is still held, and the release that
         commits the node is read by the board's own key listener; the switch's next Tab
         is the board's to read too. -->
    <button
      type="button"
      aria-label={keyHints ? `${name} (${key})` : name}
      aria-pressed={current === undefined ? undefined : current === shape}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => onChoose(shape)}
    >
      <Icon name={icon} size={16} />
    </button>
  {/each}
</div>

<style>
  .strip {
    position: absolute;
    display: flex;
    gap: 3px;
    padding: 4px;
    border-radius: 10px;
    z-index: 25;
    /* Sits above the point it is given, centred on it, and never intercepts the drag
       that is still growing the cluster underneath. */
    transform: translate(-50%, calc(-100% - 8px));
    pointer-events: auto;
  }

  .strip.below {
    transform: none;
  }

  button {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--ink);
    transition:
      background var(--transition),
      color var(--transition);
  }

  button:hover {
    background: var(--bg-hover);
  }

  button[aria-pressed="true"] {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  button:active {
    transform: scale(0.92);
  }
</style>
