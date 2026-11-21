import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The suite ran with no config file until M34.7 — defaults only. This adds four
 * things and deliberately nothing else: a second reporter that states how many
 * assertions did not run (tools/report-skipped.ts), and (2026-11-10) a global
 * setup that makes pg-boss's schema before any integration file runs, a per-file
 * setup that gives a composition with no Meta fetch of its own a fake, and
 * (2026-11-22) one that removes the owner alerts a file left waiting.
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
    // A production composition that passes no `metaFetch` gets a fake Meta, so no background job reaches
    // graph.facebook.com from a file that never meant to talk to Meta (tests/integration/no-meta.setup.ts).
    // The owner alerts a file left waiting go with it, so a later file's notify worker is not kept busy with them
    // (tests/integration/alerts-go-with-file.setup.ts; boot.test.ts P3, 2026-11-21).
    setupFiles: [
      fileURLToPath(new URL('./tests/integration/no-meta.setup.ts', import.meta.url)),
      fileURLToPath(new URL('./tests/integration/alerts-go-with-file.setup.ts', import.meta.url)),
    ],
    reporters: ['default', fileURLToPath(new URL('./tools/report-skipped.ts', import.meta.url))],
  },
});
