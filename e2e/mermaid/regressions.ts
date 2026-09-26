/**
 * Seeds the fuzzer once failed on, by diagram type. Each runs on every pass whatever
 * `MERMAID_FUZZ_CASES` says, so a failure found by a long run stays found.
 */
export const REGRESSIONS: Record<string, number[]> = {
  // Two nodes the converter itself sized into each other: an overlap the engine did not make.
  flowchart: [322],
  // Edges the converter drew far from their shapes (namespaces), a self-relation among them.
  class: [305, 776],
};
