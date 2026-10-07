import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { encryptSecret, decryptSecret, deriveKey, credentialFingerprint } from '../../src/security/credentials.js';
import { runDigits } from './tenant.js';
// @ts-expect-error — a tool helper, plain JS on purpose (the integration job runs tools without a build).
import { SEALED, APP_SEALED } from '../../tools/lib/sealed.mjs';

/**
 * REKEY — tools/rekey.mjs against Postgres: every sealed column, a rotation
 * finished without a token lost (docs/SECRET-ROTATION.md).
 *
 *   · without the previous key it only counts, and writes nothing;
 *   · a dry run writes nothing; --yes re-seals every token only the previous
 *     key opens, with the current key and the next version, in one go;
 *   · a token neither key opens is named and left alone;
 *   · a second run finds nothing; a role row security filters is refused;
 *   · every `*_ciphertext` column in the schema is one the tool knows.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7e0000-0000-4000-8000-${RUN}0001`;
const OLD = randomBytes(32).toString('hex');
const NEW = randomBytes(32).toString('hex');
const STRANGER = randomBytes(32).toString('hex');

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[], env: Record<string, string | undefined>): Run => {
  const r = spawnSync(process.execPath, ['tools/rekey.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { PATH: process.env['PATH'] ?? '', ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string> },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('REKEY · a CREDENTIAL_KEY rotation finished without a token lost (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  const ids: Record<string, string> = {};
  const secrets = { page: `page-token-${RUN}`, mail: `refresh-${RUN}`, apollo: `apollo-${RUN}`, channel: `channel-${RUN}` };
  const sealedOf = async (table: string, column: string, id: string) =>
    (await admin.query(`select ${column} as s from ${table} where id = $1`, [id])).rows[0].s as string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const old = deriveKey(OLD);
    await admin.query('insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing', [BIZ, `Rekey Shop ${RUN}`]);
    ids['meta'] = (await admin.query(
      `insert into meta_accounts (business_id, page_id, page_name, scopes, token_ciphertext, fingerprint, connected_by)
       values ($1, $2, 'Rekey Page', 'pages_messaging', $3, $4, 'test') returning id`,
      [BIZ, `9${runDigits(RUN, 8)}`, encryptSecret(secrets.page, old), credentialFingerprint(secrets.page)])).rows[0].id;
    ids['mail'] = (await admin.query(
      `insert into mail_accounts (business_id, provider, address, scopes, refresh_token_ciphertext, fingerprint, connected_by)
       values ($1, 'google', $2, 'gmail.send', $3, $4, 'test') returning id`,
      [BIZ, `shop-${RUN}@rekey.example`, encryptSecret(secrets.mail, old, 2), credentialFingerprint(secrets.mail)])).rows[0].id;
    ids['apollo'] = (await admin.query(
      `insert into connector_credentials (business_id, connector, secret_ciphertext, fingerprint, created_by)
       values ($1, 'apollo', $2, $3, 'test') returning id`,
      // sealed with a key nobody has any more: neither key opens it
      [BIZ, encryptSecret(secrets.apollo, deriveKey(STRANGER)), credentialFingerprint(secrets.apollo)])).rows[0].id;
    ids['channel'] = (await admin.query(
      `insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, secret_ciphertext, secret_key_version)
       values ($1, 'webhook_test', $2, 'rekey-test', 'service', $3, 1) returning id`,
      [BIZ, `rekey-${RUN}`, encryptSecret(secrets.channel, old)])).rows[0].id;
  }, 60_000);
  afterAll(async () => { await admin?.end(); });

  const env = (extra: Record<string, string | undefined>) => ({ ADMIN_DATABASE_URL: MIGRATE_URL, ...extra });

  it('every sealed column in the schema is one the tool re-seals — or the advisor\'s, which the app re-seals and no tool opens (0130)', async () => {
    const cols = (await admin.query(
      `select table_name || '.' || column_name as c from information_schema.columns
        where table_schema = 'public' and column_name like '%\\_ciphertext' order by 1`)).rows.map((r) => r.c);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).toEqual([...(SEALED as { table: string; column: string }[]), ...(APP_SEALED as { table: string; column: string }[])]
      .map((s) => `${s.table}.${s.column}`).sort());
  });

  it('without the previous key it only counts; --yes is refused', () => {
    const check = tool([], env({ CREDENTIAL_KEY: OLD }));
    expect(check.code, check.err).toBe(0);
    expect(check.out).toContain('No rotation in progress');
    expect(check.out).toContain(`✗ connector_credentials ${ids['apollo']}: the current key does not open it`);
    expect(check.out).toContain('Nothing was written.');
    const yes = tool(['--yes'], env({ CREDENTIAL_KEY: OLD }));
    expect(yes.code).toBe(2);
    expect(yes.err).toContain('nothing to re-seal with --yes');
  });

  it('a role row security filters is refused, and no key or address is taken from the command line', () => {
    const app = tool([], { ADMIN_DATABASE_URL: DATABASE_URL, CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD });
    expect(app.code).toBe(1);
    expect(app.err).toContain('filtered by row security');
    expect(tool([OLD], env({ CREDENTIAL_KEY: NEW })).code).toBe(2);
    expect(tool([], env({ CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: NEW })).err).toContain('the same key');
  });

  it('a dry run writes nothing', async () => {
    const before = await sealedOf('meta_accounts', 'token_ciphertext', ids['meta']!);
    const dry = tool([], env({ CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD }));
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toMatch(/\d+ under the previous key/);
    expect(dry.out).toContain('Dry run: nothing was written.');
    expect(await sealedOf('meta_accounts', 'token_ciphertext', ids['meta']!)).toBe(before);
  });

  it('--yes re-seals with the current key, the next version; what neither key opens is left; again finds nothing', async () => {
    const strangers = await sealedOf('connector_credentials', 'secret_ciphertext', ids['apollo']!);
    const yes = tool(['--yes'], env({ CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD }));
    expect(yes.code, yes.err).toBe(0);
    expect(yes.out).toMatch(/✓ {2}\d+ tokens? re-sealed with the current key/);
    const now = deriveKey(NEW);
    expect(decryptSecret(await sealedOf('meta_accounts', 'token_ciphertext', ids['meta']!), now)).toEqual({ plain: secrets.page, keyVersion: 2 });
    expect(decryptSecret(await sealedOf('mail_accounts', 'refresh_token_ciphertext', ids['mail']!), now)).toEqual({ plain: secrets.mail, keyVersion: 3 });
    expect(decryptSecret(await sealedOf('channel_credentials', 'secret_ciphertext', ids['channel']!), now).plain).toBe(secrets.channel);
    expect((await admin.query('select secret_key_version as v from channel_credentials where id = $1', [ids['channel']])).rows[0].v).toBe(2);
    const resealed = await sealedOf('meta_accounts', 'token_ciphertext', ids['meta']!);
    expect(() => decryptSecret(resealed, deriveKey(OLD)), 'the old key no longer opens it').toThrow();
    expect(await sealedOf('connector_credentials', 'secret_ciphertext', ids['apollo']!)).toBe(strangers);
    const again = tool([], env({ CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD }));
    expect(again.out).toContain('0 under the previous key');
    expect(again.out).toContain('Nothing to re-seal. CREDENTIAL_KEY_PREVIOUS can be removed.');
  });
});
