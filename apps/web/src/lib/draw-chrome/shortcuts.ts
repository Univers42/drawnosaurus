export interface ShortcutHandlers {
  onOpenShortcuts?: () => void;
  onOpenExport?: () => void;
  onToggleTheme?: () => void;
  onOpenMenu?: () => void;
}

export function handleGlobalKeyboardShortcut(
  event: KeyboardEvent,
  handlers: ShortcutHandlers,
): void {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modifier = isMac ? event.metaKey : event.ctrlKey;

  if (event.key === "?" || (event.shiftKey && event.key === "/")) {
    event.preventDefault();
    handlers.onOpenShortcuts?.();
  } else if (modifier && event.key.toLowerCase() === "e") {
    event.preventDefault();
    handlers.onOpenExport?.();
  } else if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
  }
}
