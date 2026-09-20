<script lang="ts">
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { downloadBlob } from "./download.ts";
  import MainMenuIcon from "./MainMenuIcon.svelte";

  let {
    engine,
    themeMode = "light",
    onToggleTheme,
    onOpenExport,
    onOpenMermaid,
    onClose,
  }: {
    engine: DrawEngine | null;
    themeMode: "light" | "dark";
    onToggleTheme: () => void;
    onOpenExport: () => void;
    onOpenMermaid: () => void;
    onClose: () => void;
  } = $props();

  let fileInput: HTMLInputElement;

  function handleSaveJson(): void {
    if (!engine) return;
    const json = engine.exportJson();
    downloadBlob("drawing.osidraw", new Blob([json], { type: "application/json" }));
    onClose();
  }

  function handleOpenFile(): void {
    fileInput?.click();
  }

  function onFileSelected(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !engine) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      try {
        engine.loadScene(content);
        onClose();
      } catch {
        alert("Could not load file: invalid drawing format");
      }
    };
    reader.readAsText(file);
  }

  function handleClear(): void {
    if (confirm("Clear canvas? This cannot be undone.")) {
      engine?.clear();
      onClose();
    }
  }
</script>

<div class="menu-backdrop" role="presentation" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="menu-drawer draw-panel"
    tabindex="-1"
    role="dialog"
    aria-label="Main menu"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="drawer-header">
      <div class="brand">
        <span class="logo">🦕</span>
        <strong>drawnosaurus</strong>
      </div>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close menu">✕</button>
    </div>

    <input
      type="file"
      accept=".osidraw,.json,.excalidraw"
      bind:this={fileInput}
      style="display: none;"
      onchange={onFileSelected}
    />

    <div class="menu-items">
      <button type="button" class="menu-item" onclick={handleOpenFile}>
        <MainMenuIcon name="folder" />
        <span>Open / Import file</span>
      </button>

      <button type="button" class="menu-item" onclick={handleSaveJson}>
        <MainMenuIcon name="disk" />
        <span>Save to disk (.osidraw)</span>
      </button>

      <button
        type="button"
        class="menu-item"
        onclick={() => {
          onClose();
          onOpenExport();
        }}
      >
        <MainMenuIcon name="image" />
        <span>Export image (PNG, SVG)...</span>
      </button>

      <button
        type="button"
        class="menu-item"
        onclick={() => {
          onClose();
          onOpenMermaid();
        }}
      >
        <MainMenuIcon name="diagram" />
        <span>Mermaid to diagram...</span>
      </button>

      <hr class="divider" />

      <button type="button" class="menu-item" onclick={onToggleTheme}>
        <MainMenuIcon name={themeMode === "dark" ? "sun" : "moon"} />
        <span>{themeMode === "dark" ? "Light mode" : "Dark mode"}</span>
      </button>

      <hr class="divider" />

      <button type="button" class="menu-item danger" onclick={handleClear}>
        <MainMenuIcon name="trash" />
        <span>Clear canvas (Reset)</span>
      </button>
    </div>
  </div>
</div>

<style>
  .menu-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    z-index: 90;
  }

  .menu-drawer {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    background: var(--surface);
    color: var(--ink);
    border-right: 1px solid var(--line);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    padding: 18px 16px;
    animation: slideIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes slideIn {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
  }

  .logo {
    font-size: 22px;
  }

  .close-btn {
    border: none;
    background: transparent;
    font-size: 16px;
    cursor: pointer;
    color: var(--muted);
    padding: 6px 10px;
    border-radius: 6px;
    transition: background var(--transition);
  }

  .close-btn:hover {
    background: var(--bg-hover);
  }

  .menu-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--radius);
    border: none;
    background: transparent;
    color: var(--ink);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition:
      background var(--transition),
      transform 0.1s ease;
  }

  .menu-item:hover {
    background: var(--bg);
  }

  .menu-item:active {
    transform: scale(0.98);
  }

  .menu-item.danger {
    color: var(--danger);
  }

  .divider {
    border: none;
    border-top: 1px solid var(--line);
    margin: 8px 0;
  }
</style>
