export type IconName =
  | "lock"
  | "lockOpen"
  | "select"
  | "lasso"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "sticky"
  | "eraser"
  | "laser"
  | "frame"
  | "undo"
  | "redo"
  | "sendToBack"
  | "backward"
  | "forward"
  | "bringToFront"
  | "group"
  | "ungroup"
  | "flipHorizontal"
  | "flipVertical"
  | "alignLeft"
  | "alignCenterX"
  | "alignRight"
  | "alignTop"
  | "alignCenterY"
  | "alignBottom"
  | "distributeX"
  | "distributeY"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "focus";

export type SvgNode =
  | { tag: "path"; d: string }
  | { tag: "rect"; x: string; y: string; width: string; height: string; rx?: string }
  | { tag: "circle"; cx: string; cy: string; r: string }
  | { tag: "line"; x1: string; y1: string; x2: string; y2: string };

export const ICONS: Record<IconName, readonly SvgNode[]> = {
  lock: [
    { tag: "rect", x: "3", y: "11", width: "18", height: "11", rx: "2" },
    { tag: "path", d: "M7 11V7a5 5 0 0 1 10 0v4" },
  ],
  lockOpen: [
    { tag: "rect", x: "3", y: "11", width: "18", height: "11", rx: "2" },
    { tag: "path", d: "M7 11V7a5 5 0 0 1 9.9-1" },
  ],
  select: [{ tag: "path", d: "m4 4 7.07 17 2.51-7.39L21 11.07z" }],
  // Excalidraw's lasso: a dashed loop with a cursor at its tail.
  lasso: [
    {
      tag: "path",
      d: "M4.028 13.252c-.475-.65-.744-1.36-.744-2.11C3.284 7.75 7.19 5 12.009 5s8.725 2.75 8.725 6.143c0 3.392-3.906 6.142-8.725 6.142-.696 0-1.373-.057-2.022-.165",
    },
    { tag: "path", d: "M5.5 17.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" },
    { tag: "path", d: "M6.5 17c.5 1 1 2 1 3.5" },
  ],
  hand: [
    { tag: "path", d: "M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" },
    { tag: "path", d: "M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" },
    { tag: "path", d: "M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" },
    {
      tag: "path",
      d: "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
    },
  ],
  rectangle: [{ tag: "rect", x: "3", y: "3", width: "18", height: "18", rx: "2" }],
  diamond: [
    {
      tag: "path",
      d: "M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z",
    },
  ],
  ellipse: [{ tag: "circle", cx: "12", cy: "12", r: "10" }],
  arrow: [
    { tag: "path", d: "M5 12h14" },
    { tag: "path", d: "m12 5 7 7-7 7" },
  ],
  line: [{ tag: "path", d: "M5 12h14" }],
  freedraw: [
    {
      tag: "path",
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    },
    { tag: "path", d: "m15 5 4 4" },
  ],
  text: [
    { tag: "path", d: "M4 7V4h16v3" },
    { tag: "path", d: "M9 20h6" },
    { tag: "path", d: "M12 4v16" },
  ],
  sticky: [
    { tag: "path", d: "M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" },
    { tag: "path", d: "M15 3v6h6" },
  ],
  eraser: [
    {
      tag: "path",
      d: "m7 21-4.3-4.3c-1-1-1-2.5 0-3.5l9.6-9.6c1-1 2.5-1 3.5 0l5.6 5.6c1 1 1 2.5 0 3.5L13 21",
    },
    { tag: "path", d: "M22 21H7" },
    { tag: "path", d: "m5 11 9 9" },
  ],
  // Excalidraw's `laserPointerToolIcon`, scaled from their 20-unit grid to our 24 (x1.2)
  // and left unrotated — theirs carries a `rotate(90)` on a wrapping <g>, which our icon
  // nodes have no way to express. A pointer body with the beam breaking up at its tip.
  laser: [
    {
      tag: "path",
      d: "m11.57 16.43 9.33-9.33a2.83 2.83 0 0 0-4-4l-9.33 9.33L9.6 14.4l1.97 2.03Z",
    },
    { tag: "path", d: "m15.9 4.1 4 4" },
    { tag: "path", d: "M12 12l2.4-2.4" },
    { tag: "path", d: "M6 18l3.6-3.6" },
    { tag: "path", d: "M2.59 21.47l1.2-1.2" },
    { tag: "path", d: "M6.54 22.84l-.17-1.69" },
    { tag: "path", d: "M2.85 14.26l1.04 1.34" },
    { tag: "path", d: "M10.03 20.73l-1.44-.91" },
    { tag: "path", d: "M1.14 17.58l1.69.16" },
  ],
  // Excalidraw's `frameToolIcon`: two horizontal rules crossing two vertical ones, the
  // crop marks a frame is. Deliberately not a plain rectangle — that is the shape tool.
  frame: [
    { tag: "path", d: "M4 7h16" },
    { tag: "path", d: "M4 17h16" },
    { tag: "path", d: "M7 4v16" },
    { tag: "path", d: "M17 4v16" },
  ],
  undo: [
    { tag: "path", d: "M3 7v6h6" },
    { tag: "path", d: "M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" },
  ],
  redo: [
    { tag: "path", d: "M21 7v6h-6" },
    { tag: "path", d: "M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" },
  ],
  sendToBack: [
    { tag: "rect", x: "8", y: "8", width: "12", height: "12", rx: "2" },
    { tag: "path", d: "M4 16V6a2 2 0 0 1 2-2h10" },
  ],
  backward: [
    { tag: "path", d: "m7 13-5 5 5 5" },
    { tag: "path", d: "M22 18H2" },
    { tag: "path", d: "m7 3-5 5 5 5" },
    { tag: "path", d: "M22 8H2" },
  ],
  forward: [
    { tag: "path", d: "m17 11 5-5-5-5" },
    { tag: "path", d: "M2 6h20" },
    { tag: "path", d: "m17 21 5-5-5-5" },
    { tag: "path", d: "M2 16h20" },
  ],
  bringToFront: [
    { tag: "rect", x: "4", y: "4", width: "12", height: "12", rx: "2" },
    { tag: "path", d: "M16 8h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2" },
  ],
  // Two overlapping rectangles inside a dashed boundary: the selection becomes one
  // thing.
  group: [
    { tag: "rect", x: "3", y: "3", width: "7", height: "7", rx: "1" },
    { tag: "rect", x: "11", y: "11", width: "10", height: "10", rx: "1" },
    { tag: "path", d: "M3 13v6a2 2 0 0 0 2 2h4" },
  ],
  // The same pair with the boundary broken: they go back to being separate.
  ungroup: [
    { tag: "rect", x: "3", y: "3", width: "7", height: "7", rx: "1" },
    { tag: "rect", x: "14", y: "14", width: "7", height: "7", rx: "1" },
    { tag: "path", d: "M12 3h2M12 21h-2M3 12v2M21 12v-2" },
  ],
  // An axis with a shape mirrored across it.
  flipHorizontal: [
    { tag: "line", x1: "12", y1: "3", x2: "12", y2: "21" },
    { tag: "path", d: "M8 7 3 12l5 5z" },
    { tag: "path", d: "M16 7l5 5-5 5z" },
  ],
  flipVertical: [
    { tag: "line", x1: "3", y1: "12", x2: "21", y2: "12" },
    { tag: "path", d: "M7 8 12 3l5 5z" },
    { tag: "path", d: "M7 16l5 5 5-5z" },
  ],
  alignLeft: [
    { tag: "line", x1: "4", y1: "4", x2: "4", y2: "20" },
    { tag: "rect", x: "8", y: "6", width: "12", height: "4", rx: "1" },
    { tag: "rect", x: "8", y: "14", width: "8", height: "4", rx: "1" },
  ],
  alignCenterX: [
    { tag: "line", x1: "12", y1: "4", x2: "12", y2: "20" },
    { tag: "rect", x: "4", y: "6", width: "16", height: "4", rx: "1" },
    { tag: "rect", x: "6", y: "14", width: "12", height: "4", rx: "1" },
  ],
  alignRight: [
    { tag: "line", x1: "20", y1: "4", x2: "20", y2: "20" },
    { tag: "rect", x: "4", y: "6", width: "12", height: "4", rx: "1" },
    { tag: "rect", x: "8", y: "14", width: "8", height: "4", rx: "1" },
  ],
  alignTop: [
    { tag: "line", x1: "4", y1: "4", x2: "20", y2: "4" },
    { tag: "rect", x: "6", y: "8", width: "4", height: "12", rx: "1" },
    { tag: "rect", x: "14", y: "8", width: "4", height: "8", rx: "1" },
  ],
  alignCenterY: [
    { tag: "line", x1: "4", y1: "12", x2: "20", y2: "12" },
    { tag: "rect", x: "6", y: "4", width: "4", height: "16", rx: "1" },
    { tag: "rect", x: "14", y: "6", width: "4", height: "12", rx: "1" },
  ],
  alignBottom: [
    { tag: "line", x1: "4", y1: "20", x2: "20", y2: "20" },
    { tag: "rect", x: "6", y: "4", width: "4", height: "12", rx: "1" },
    { tag: "rect", x: "14", y: "8", width: "4", height: "8", rx: "1" },
  ],
  distributeX: [
    { tag: "rect", x: "3", y: "8", width: "4", height: "8", rx: "1" },
    { tag: "rect", x: "10", y: "6", width: "4", height: "12", rx: "1" },
    { tag: "rect", x: "17", y: "8", width: "4", height: "8", rx: "1" },
  ],
  distributeY: [
    { tag: "rect", x: "8", y: "3", width: "8", height: "4", rx: "1" },
    { tag: "rect", x: "6", y: "10", width: "12", height: "4", rx: "1" },
    { tag: "rect", x: "8", y: "17", width: "8", height: "4", rx: "1" },
  ],
  zoomIn: [
    { tag: "circle", cx: "11", cy: "11", r: "8" },
    { tag: "line", x1: "21", y1: "21", x2: "16.65", y2: "16.65" },
    { tag: "line", x1: "11", y1: "8", x2: "11", y2: "14" },
    { tag: "line", x1: "8", y1: "11", x2: "14", y2: "11" },
  ],
  zoomOut: [
    { tag: "circle", cx: "11", cy: "11", r: "8" },
    { tag: "line", x1: "21", y1: "21", x2: "16.65", y2: "16.65" },
    { tag: "line", x1: "8", y1: "11", x2: "14", y2: "11" },
  ],
  fit: [
    {
      tag: "path",
      d: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
    },
  ],
  focus: [
    { tag: "circle", cx: "12", cy: "12", r: "3" },
    { tag: "path", d: "M3 7V5a2 2 0 0 1 2-2h2" },
    { tag: "path", d: "M17 3h2a2 2 0 0 1 2 2v2" },
    { tag: "path", d: "M21 17v2a2 2 0 0 1-2 2h-2" },
    { tag: "path", d: "M7 21H5a2 2 0 0 1-2-2v-2" },
  ],
};
