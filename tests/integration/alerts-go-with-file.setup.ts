import { afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { alertClock, dropAlertsLeftSince } from './alerts-go-with-file.js';

/**
 * Every integration file's setup: the owner alerts it queued and left waiting go with it, so no later file's notify
 * worker spends its time on them (why: alerts-go-with-file.ts; held by alerts-go-with-file.test.ts).
 *
 * Its `afterAll` runs after the file's own (Vitest runs after-hooks in reverse order), so the file's compositions are
 * closed by then. A unit file, or a run with no database, does nothing here.
 */
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
let since: string | null = null;
let file = '';

const withAdmin = async <T>(f: (admin: pg.Client) => Promise<T>): Promise<T> => {
  const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try { return await f(admin); } finally { await admin.end(); }
};

// eslint-disable-next-line no-empty-pattern
beforeAll(async ({}, suite) => {
  file = String((suite as { filepath?: string }).filepath ?? '');
  if (!ADMIN_URL || !file.includes('/tests/integration/')) return;
  // Taken before the file's own beforeAll (this setup's hook is registered first).
  since = await withAdmin(alertClock).catch(() => null);
});

afterAll(async () => {
  if (!ADMIN_URL || since === null) return;
  try {
    const gone = await withAdmin((admin) => dropAlertsLeftSince(admin, since!));
    const n = Object.values(gone).reduce((a, b) => a + b, 0);
    if (n > 0) {
      const kinds = Object.entries(gone).map(([k, c]) => `${k} ${c}`).join(', ');
      console.log(`[alerts] ${file.replace(/.*\/tests\/integration\//, '')} left ${n} alert(s) queued; removed (${kinds})`);
    }
  } catch (e) {
    console.warn(`[alerts] could not remove the alerts this file left queued: ${(e as Error).message}`);
  }
});
