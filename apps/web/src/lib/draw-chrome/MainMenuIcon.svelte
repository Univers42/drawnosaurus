<script lang="ts">
  /**
   * The main menu's icon set, transcribed from Excalidraw's own.
   *
   * Their icons are two families with different conventions: a 20x20 set drawn at
   * `stroke-width: 1.25`, and a 24x24 Tabler-derived set at 1.25 or 1.5. Redrawing them
   * by eye gets the weight wrong, which is most of why a menu reads as "not quite right"
   * even when the layout matches — so these are the real paths, and each one keeps the
   * viewBox and stroke weight it was drawn for.
   */
  export type MenuIconName =
    | "folder"
    | "disk"
    | "image"
    | "diagram"
    | "collab"
    | "help"
    | "trash"
    | "sun"
    | "moon"
    | "system"
    | "play";

  let { name }: { name: MenuIconName } = $props();

  /** The 20x20 family: one path, drawn at 1.25. */
  const SMALL: Partial<Record<MenuIconName, string>> = {
    folder:
      "m9.257 6.351.183.183H15.819c.34 0 .727.182 1.051.506.323.323.505.708.505 1.05v5.819c0 .316-.183.7-.52 1.035-.337.338-.723.522-1.037.522H4.182c-.352 0-.74-.181-1.058-.5-.318-.318-.499-.705-.499-1.057V5.182c0-.351.181-.736.5-1.054.32-.321.71-.503 1.057-.503H6.53l2.726 2.726Z",
    disk: "M3.333 14.167v1.666c0 .92.747 1.667 1.667 1.667h10c.92 0 1.667-.746 1.667-1.667v-1.666M5.833 9.167 10 13.333l4.167-4.166M10 3.333v10",
    trash:
      "M3.333 5.833h13.334M8.333 9.167v5M11.667 9.167v5M4.167 5.833l.833 10c0 .92.746 1.667 1.667 1.667h6.666c.92 0 1.667-.746 1.667-1.667l.833-10M7.5 5.833v-2.5c0-.46.373-.833.833-.833h3.334c.46 0 .833.373.833.833v2.5",
    sun: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 4.167V2.5M14.167 5.833l1.166-1.166M15.833 10H17.5M14.167 14.167l1.166 1.166M10 15.833V17.5M5.833 14.167l-1.166 1.166M5 10H3.333M5.833 5.833 4.667 4.667",
    moon: "M10 2.5h.328a6.25 6.25 0 0 0 6.6 10.372A7.5 7.5 0 1 1 10 2.493V2.5Z",
  };

  /** The 24x24 family: several subpaths, drawn at 1.25 or 1.5. */
  const LARGE: Partial<Record<MenuIconName, { width: number; paths: string[] }>> = {
    image: {
      width: 1.25,
      paths: [
        "M15 8h.01",
        "M12 20h-5a3 3 0 0 1 -3 -3v-10a3 3 0 0 1 3 -3h10a3 3 0 0 1 3 3v5",
        "M4 15l4 -4c.928 -.893 2.072 -.893 3 0l4 4",
        "M14 14l1 -1c.617 -.593 1.328 -.793 2.009 -.598",
        "M19 16v6",
        "M22 19l-3 3l-3 -3",
      ],
    },
    diagram: {
      width: 1.25,
      paths: [
        "M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
        "M4 6l8 0",
        "M16 6l4 0",
        "M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
        "M4 12l2 0",
        "M10 12l10 0",
        "M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
        "M4 18l11 0",
        "M19 18l1 0",
      ],
    },
    collab: {
      width: 1.5,
      paths: [
        "M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
        "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
        "M16 3.13a4 4 0 0 1 0 7.75",
        "M21 21v-2a4 4 0 0 0 -3 -3.85",
      ],
    },
    help: {
      width: 1.5,
      paths: [
        "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
        "M12 17v.01",
        "M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4",
      ],
    },
    system: {
      width: 1.5,
      paths: [
        "M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-10z",
        "M7 20h10M9 16v4M15 16v4",
      ],
    },
    // Tabler's `player-play`, for "Present" — not from the oracle, which has no such
    // feature; picked because it is the shape every presentation tool already uses.
    play: { width: 1.5, paths: ["M7 4v16l13 -8z"] },
  };

  const small = $derived(SMALL[name]);
  const large = $derived(LARGE[name]);
</script>

{#if small}
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.25"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d={small} />
  </svg>
{:else if large}
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={large.width}
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {#each large.paths as d (d)}
      <path {d} />
    {/each}
  </svg>
{/if}

<style>
  svg {
    width: 1rem;
    height: 1rem;
    display: block;
    flex: 0 0 auto;
  }
</style>
