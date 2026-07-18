/**
 * M8 — Performance budgets, as data. The PWA enforces the interactive ones
 * on-device; the compute ones are enforced by tests here. "Instant" quotes
 * are honest because the quote path is SQL + arithmetic — zero LLM calls,
 * which the pipeline tests already pin.
 */

export const PERF_BUDGETS = {
  approvalCardOpenMs: 1000,     // spec: <1s on mobile
  quoteComputeMs: 50,           // pure arithmetic — no excuse
  rendererMs: 16,               // any owner card renders in a frame
  webhookAckMs: 3000,           // p95; hard contract is <5s
} as const;
