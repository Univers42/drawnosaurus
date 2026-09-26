/**
 * Seeds the fuzzer once failed on, by diagram type. Each runs on every pass whatever
 * `MERMAID_FUZZ_CASES` says, so a failure found by a long run stays found.
 */
export const REGRESSIONS: Record<string, number[]> = {};
