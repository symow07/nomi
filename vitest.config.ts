import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The suite ran with no config file until M34.7 — defaults only. This adds two
 * things and deliberately nothing else: a second reporter that states how many
 * assertions did not run (tools/report-skipped.ts), and (2026-11-10) a global
 * setup that makes pg-boss's schema before any integration file runs.
 *
 * `reporters` keeps 'default' first, so the familiar output is unchanged and
 * the extra line is appended rather than replacing anything.
 *
 * G1 — `fileURLToPath`, not `URL.pathname`. The pathname is percent-ENCODED,
 * so on a checkout whose path holds a space or a non-ASCII character the
 * reporter path pointed at a file that does not exist and the suite could not
 * start at all. CI never noticed: its runner path needs no encoding.
 */
export default defineConfig({
  test: {
    // pg-boss's schema before any integration file runs, so none depends on an earlier file having started the queue
    // (tests/integration/queue-schema.global.ts). Does nothing without DATABASE_URL.
    globalSetup: [fileURLToPath(new URL('./tests/integration/queue-schema.global.ts', import.meta.url))],
    reporters: ['default', fileURLToPath(new URL('./tools/report-skipped.ts', import.meta.url))],
  },
});
