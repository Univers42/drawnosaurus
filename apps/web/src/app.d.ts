declare global {
  namespace App {
    // No custom Locals/PageData/Error shapes yet — the board routes are CSR-only
    // and talk to the API from the browser.
  }

  interface ImportMetaEnv {
    /** "server" (default, Docker) or "browser" (public build). Folded in by vite.config.ts. */
    readonly VITE_HYDRAWN_MODE: "server" | "browser";
    /** Browser build only: the hosted relay's websocket URL. */
    readonly VITE_HYDRAWN_RELAY_URL?: string;
  }
}

export {};
