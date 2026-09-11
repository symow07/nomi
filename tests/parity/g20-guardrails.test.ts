import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

/**
 * G20 — guard rails for the invariants that are load-bearing everywhere and
 * stated in one place each.
 *
 * Every rule here already held when it was written. That is exactly why it
 * needs a test: an invariant with no guard rail is a convention, and this
 * repository's most expensive recurring defect is a second implementation of a
 * rule that agreed with the first until it did not.
 *
 * The rails are deliberately SOURCE rules. A behaviour test proves what the
 * code does today; these prove that the next person cannot add a second way to
 * do it without one of them turning red and naming the invariant.
 */

const SRC = new URL('../../src/', import.meta.url);

/** Every .ts file under src/, at any depth — the recursion is the point. */
async function sources(dir = SRC, prefix = ''): Promise<readonly { path: string; src: string }[]> {
  const out: { path: string; src: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const at = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...await sources(at, `${prefix}${entry.name}/`));
    else if (entry.name.endsWith('.ts')) out.push({ path: `${prefix}${entry.name}`, src: await readFile(at, 'utf8') });
  }
  return out;
}

const withoutComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('G20 · one module decides whether a message may be sent', () => {
  it('gateOutbound is called from the send worker and nowhere else, at ANY depth', async () => {
    // The old test read four directories one level deep. A caller in a
    // subdirectory — or in src/pipeline, which it never looked at — was
    // invisible to it, and a second gate is the one defect this rule exists to
    // catch.
    const callers = (await sources())
      .filter((f) => /\bgateOutbound\s*\(/.test(withoutComments(f.src)))
      .map((f) => f.path)
      .filter((p) => p !== 'core/channel/sendGate.ts')      // the gate itself
      .sort();
    expect(callers).toEqual(['outbound/worker.ts']);
  });

  it('and the ONE sender outside that gate is the owner alert, on purpose', async () => {
    /**
     * `deliverOwnerAlert` writes to the owner's own phone, which is not a
     * buyer-facing message and is not subject to her pilot allowlist or the
     * 24-hour window — it is the product telling her something about her own
     * factory. It is the single deliberate exception, and it is named here so
     * that a second one cannot be added quietly.
     */
    const senders = (await sources())
      .filter((f) => /\b(?:adapter|provider)\??\.\s*send(?:Text|Media)\s*\(/.test(withoutComments(f.src)))
      .map((f) => f.path)
      .filter((p) => !p.startsWith('channels/'))            // the adapters themselves
      .sort();
    expect(senders).toEqual(['outbound/worker.ts', 'pipeline/notify.ts']);
  });
});

describe('G20 · one writer of outbound messages', () => {
  it('only enqueueOutboundRow inserts into outbound_messages', async () => {
    // Every refusal the owner ever sees is a row this function wrote: the
    // cancel reason, the audit line, the "what happened / why / what to do"
    // card. A second INSERT would produce a message with no refusal story.
    const writers = (await sources())
      .filter((f) => /insert\s+into\s+outbound_messages/i.test(f.src))
      .map((f) => f.path)
      .sort();
    expect(writers).toEqual(['db/channels.ts']);

    const channels = await readFile(new URL('db/channels.ts', SRC), 'utf8');
    const fn = channels.slice(channels.indexOf('export async function enqueueOutboundRow'));
    const insertAt = channels.search(/insert\s+into\s+outbound_messages/i);
    expect(insertAt, 'the insert moved out of enqueueOutboundRow').toBeGreaterThan(
      channels.indexOf('export async function enqueueOutboundRow'));
    expect(fn).toMatch(/insert\s+into\s+outbound_messages/i);
  });
});

describe('G20 · an applied migration cannot change on disk unnoticed', () => {
  it('the runner checks a checksum before it applies anything', async () => {
    const src = await readFile(new URL('../../tools/migrate.mjs', import.meta.url), 'utf8');
    expect(src).toContain("createHash('sha256')");
    // It refuses, rather than warning: a drifted migration is not a style note.
    const branch = src.slice(src.indexOf('if (changed.length'), src.indexOf('for (const f of pending)'));
    expect(branch).toContain('process.exit(1)');
    // …and it says which file, and what to do instead of editing it.
    expect(branch).toContain('forward-only');
    // And it records what it applied, so the next run has something to compare.
    expect(src).toMatch(/update _migrations set checksum/);
  });

  it('the column it records into ships as a migration, like every other column', async () => {
    const files = await readdir(new URL('../../migrations/', import.meta.url));
    const checksum = files.filter((f) => /^\d{4}_migration_checksums\.sql$/.test(f));
    expect(checksum).toHaveLength(1);
    const sql = await readFile(new URL(`../../migrations/${checksum[0]}`, import.meta.url), 'utf8');
    expect(sql).toMatch(/alter table _migrations add column if not exists checksum text/i);
  });
});
