import type { OsidrawFile } from "@drawnosaurus/contract";
import checkout from "./checkout.osidraw.json";
import architecture from "./architecture.osidraw.json";
import retro from "./retro.osidraw.json";
import pitch from "./pitch.osidraw.json";
import mindmap from "./mindmap.osidraw.json";

export interface Template {
  id: string;
  name: string;
  description: string;
  file: OsidrawFile;
}

/**
 * The five starter boards, one per `e2e/stories/*.spec.ts` story.
 *
 * Each `.osidraw.json` beside this file is that story's own final scene, captured by
 * `maybeWriteTemplate` (`e2e/stories/helpers.ts`) rather than hand-written — a template
 * is never anything but "what a story already builds and asserts through the real UI".
 * To regenerate them after a story changes, see that function's own doc comment.
 */
export const TEMPLATES: readonly Template[] = [
  {
    id: "checkout",
    name: "Checkout flow",
    description: "A flowchart from cart to payment, with a branching decision.",
    file: checkout as OsidrawFile,
  },
  {
    id: "architecture",
    name: "System architecture",
    description: "Clients, services and data, each in its own frame, connected and labelled.",
    file: architecture as OsidrawFile,
  },
  {
    id: "retro",
    name: "Sprint retro",
    description: "Three columns of sticky notes: went well, to improve, and actions.",
    file: retro as OsidrawFile,
  },
  {
    id: "pitch",
    name: "Pitch deck",
    description: "Four slides as frames, ready to step through in Present mode.",
    file: pitch as OsidrawFile,
  },
  {
    id: "mindmap",
    name: "Mind map",
    description: "A central idea with branches radiating out to it.",
    file: mindmap as OsidrawFile,
  },
] as const;
