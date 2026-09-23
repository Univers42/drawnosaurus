<script lang="ts">
  let { onClose }: { onClose: () => void } = $props();

  const SHORTCUTS = [
    {
      cat: "Tools",
      items: [
        { key: "1 or V", desc: "Selection" },
        { key: "2 or R", desc: "Rectangle" },
        { key: "3 or D", desc: "Diamond" },
        { key: "4 or O", desc: "Ellipse" },
        { key: "5 or A", desc: "Arrow" },
        { key: "6 or L", desc: "Line" },
        { key: "7 or P", desc: "Pencil / Draw" },
        { key: "8 or T", desc: "Text" },
        { key: "9 or N", desc: "Sticky Note" },
        { key: "0 or E", desc: "Eraser" },
        { key: "Q", desc: "Lock tool" },
        { key: "Space", desc: "Pan / Hand tool" },
      ],
    },
    {
      cat: "Actions",
      items: [
        { key: "⌘ Z", desc: "Undo" },
        { key: "⌘ ⇧ Z", desc: "Redo" },
        { key: "⌘ G", desc: "Group selection" },
        { key: "⌘ ⇧ G", desc: "Ungroup selection" },
        { key: "⌘ C / ⌘ V", desc: "Copy / Paste" },
        { key: "Delete / ⌫", desc: "Delete selection" },
        { key: "⌘ D", desc: "Duplicate selection" },
      ],
    },
    {
      cat: "View",
      items: [
        { key: "⌘ +", desc: "Zoom in" },
        { key: "⌘ -", desc: "Zoom out" },
        { key: "⌘ 0", desc: "Reset zoom" },
        { key: "⇧ 1", desc: "Zoom to fit" },
        { key: "⌥ S", desc: "Snap to objects" },
        { key: "Hold ⌘", desc: "Invert snapping while dragging" },
      ],
    },
  ];
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
  <div class="modal-card">
    <div class="modal-header">
      <h3 id="shortcuts-title">Keyboard Shortcuts</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <div class="shortcuts-grid">
      {#each SHORTCUTS as section (section.cat)}
        <div class="shortcut-section">
          <h4>{section.cat}</h4>
          <ul>
            {#each section.items as item (item.key)}
              <li>
                <span class="desc">{item.desc}</span>
                <kbd>{item.key}</kbd>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
    z-index: 100;
    backdrop-filter: blur(3px);
  }

  .modal-card {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 24px;
    width: 620px;
    max-width: 92vw;
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .close-btn {
    border: none;
    background: transparent;
    font-size: 16px;
    cursor: pointer;
    color: var(--muted);
    padding: 4px 8px;
    border-radius: 6px;
  }

  .shortcuts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
  }

  .shortcut-section h4 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }

  .desc {
    color: var(--ink);
  }

  kbd {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg);
    border: 1px solid var(--line);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--fg-strong);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
</style>
