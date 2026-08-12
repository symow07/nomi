import { defineConfig } from 'vitest/config';

/**
 * The suite ran with no config file until M34.7 — defaults only. This adds one
 * thing and deliberately nothing else: a second reporter that states how many
 * assertions did not run (tools/report-skipped.ts).
 *
 * `reporters` keeps 'default' first, so the familiar output is unchanged and
 * the extra line is appended rather than replacing anything.
 */
export default defineConfig({
  test: {
    reporters: ['default', new URL('./tools/report-skipped.ts', import.meta.url).pathname],
  },
});
