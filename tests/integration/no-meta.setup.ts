import { vi } from 'vitest';

/**
 * Every test file's setup: a production composition that passes no `metaFetch` gets a fake Meta, never the real one.
 *
 * `buildProduction` (src/main.ts) uses the platform's fetch for Meta's Graph API when no `metaFetch` is given — right
 * for production, wrong for a test. Most integration files compose production for something other than Meta (Telegram,
 * mail, the books) and pass none. The app's background jobs run in whichever composition is up when they fire, and
 * they read the whole database: the warmth run (`QUEUES.faces`, every ten minutes) looks up profile photos for
 * customers of ANY workspace with a live Meta account. So when an earlier file had left such customers behind and the
 * clock reached a ten-minute mark during telegram.test.ts, the job asked graph.facebook.com from Telegram's composition
 * (2026-11-10: one connect, refused by the network guard; on CI it would have reached Meta).
 *
 * The rule: a composition with no `metaFetch` of its own gets `noMeta`, which answers every call as Meta refusing it
 * (400, code 100 — a bad request, not a dead token, so nothing marks an account as needing attention) and records the
 * call in `globalThis.__noMetaCalls`. A test that passes its own `metaFetch` keeps it. The jobs still run, faces
 * included, against the fake. tests/integration/no-meta-by-default.test.ts holds it.
 *
 * Here, not in each file: 68 files compose production directly, and the next one would forget.
 */
type NoMetaCall = { readonly url: string; readonly method: string };
declare global {
  var __noMetaCalls: NoMetaCall[] | undefined;
}

vi.mock('../../src/main.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main.js')>();
  const noMeta: import('../../src/channels/meta/messaging.js').MetaFetch = async (url, init) => {
    (globalThis.__noMetaCalls ??= []).push({ url, method: init.method });
    return {
      status: 400,
      text: async () => JSON.stringify({
        error: { message: 'No Meta in tests: this composition passed no metaFetch', type: 'GraphMethodException', code: 100 },
      }),
    };
  };
  const buildProduction: typeof real.buildProduction = (cfg, overrides) =>
    real.buildProduction(cfg, { ...overrides, metaFetch: overrides?.metaFetch ?? noMeta });
  return { ...real, buildProduction };
});
