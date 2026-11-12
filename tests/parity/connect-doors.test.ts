import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * 4.1 fix D3 — EVERY DOOR THAT CONNECTS A CHANNEL ASKS THE ONE CONNECTION QUESTION FIRST.
 *
 * `first_channel_at()` (0240) starts a workspace's trial from the first row any of these doors writes, and while
 * `billing_required` is on a trial that ends with no card freezes the workspace. So no door may write that row
 * without asking `connectionRefusal` (the operator's stop, the first connection's approval, the card) — before it
 * calls the writer, and before anything is asked of the provider. The tester found the mailbox's two doors did not
 * (2026-11-11); walking the source found the chat page, Telegram and WhatsApp's reconnect did not either.
 *
 * The walk: every route registered in the web app whose handler calls a WRITER (the functions that write a
 * `channels`, `meta_accounts`, `mail_accounts`, `whatsapp_accounts` or `tiktok_accounts` row, or finish a login
 * that does), and every `/start` door that sends the owner to a provider, must call `connectionRefusal` before it.
 * A new writer is added to WRITERS; the completeness check fails a db function that writes a channel row and is
 * called from no route the walk knows.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** The route handlers' calls that make a row `first_channel_at` counts. */
const WRITERS = [
  'connectMetaChannel', 'connectConfiguredNumber', 'reconnectChannel', 'setChatPage', 'setTelegram',
  'completeMailConnection', 'completeMetaConnection', 'completeWhatsAppConnection', 'completeTikTokConnection',
  'completeCommentLogin',
] as const;

/** Every route registration in a file, with the text of its handler (up to the next registration). */
function routes(file: string): { path: string; body: string }[] {
  const text = src(file);
  const at = [...text.matchAll(/\bapp\.(?:get|post|put|delete)\(\s*(['`])([^'`]+)\1/g)];
  return at.map((m, i) => ({ path: m[2]!, body: text.slice(m.index!, at[i + 1]?.index ?? text.length) }));
}

const ALL = [...routes('src/api/web/app.ts'), ...routes('src/api/web/instagramCommentRoutes.ts')];

describe('4.1 fix D3 · every door that connects a channel asks connectionRefusal first', () => {
  const doors = ALL.filter((r) => WRITERS.some((w) => r.body.includes(`${w}(`))
    || (/^\/app\/connect\/[^/]+\/start$/.test(r.path)));

  it('the walk finds every door it must', () => {
    const paths = doors.map((r) => r.path);
    for (const p of [
      '/app/connect/:provider/start', '/app/connect/:provider/callback',
      '/app/channels/chat', '/app/channels/telegram', '/app/channels/whatsapp/reconnect', '/app/channels/whatsapp/connect',
      '/app/channels/${kind}/connect',
      '/app/connect/meta/start', '/app/connect/meta/callback', '/app/connect/meta/choose',
      '/app/connect/whatsapp/start', '/app/connect/whatsapp/callback', '/app/connect/whatsapp/choose',
      '/app/connect/tiktok/start', '/app/connect/tiktok/callback', '/app/connect/meta-ads/start',
      '${ROOT}/callback',
    ]) expect(paths, p).toContain(p);
  });

  for (const r of doors) {
    it(r.path, () => {
      const asked = r.body.search(/\bconnectionRefusal\(/);
      const first = Math.min(...WRITERS.map((w) => r.body.indexOf(`${w}(`)).filter((i) => i >= 0),
        ...['authorizeUrl(', 'reply.redirect(auth', 'startCommentLogin('].map((w) => r.body.indexOf(w)).filter((i) => i >= 0));
      expect(asked, `${r.path} never asks connectionRefusal`).toBeGreaterThanOrEqual(0);
      if (Number.isFinite(first)) expect(asked, `${r.path} writes or leaves for the provider before asking`).toBeLessThan(first);
    });
  }

  it('no writer is called from a route registered any other way (channelAction, a loop the walk cannot read)', () => {
    const app = src('src/api/web/app.ts');
    const viaAction = [...app.matchAll(/channelAction\('([^']+)',[^\n]*/g)].map((m) => m[0]);
    for (const line of viaAction) for (const w of WRITERS) expect(line, line).not.toContain(`${w}(`);
  });

  it('every function in src/db that writes a channel row is reached only through a WRITER', () => {
    // The db writers and the WRITERS that call them; a new db writer must be added here and to the walk.
    const known: Record<string, string> = {
      'src/db/mailAccounts.ts': 'connectMailAccount', 'src/db/metaAccounts.ts': 'connectMetaAccount|linkMetaCredentials',
      'src/db/whatsappAccounts.ts': 'connectWhatsAppAccount|linkWhatsAppCredentials', 'src/db/tiktokAccounts.ts': 'connectTikTokAccount|linkTikTokCredential',
      'src/db/telegram.ts': 'setTelegram', 'src/db/webChat.ts': 'setChatPage',
      'src/api/web/channels.ts': 'connectConfiguredNumber|reconnectChannel', 'src/api/web/metaChannels.ts': 'connectMetaChannel',
    };
    const anywhere = execFileSync('git', ['grep', '-lE', "insert into (channels|meta_accounts|mail_accounts|whatsapp_accounts|tiktok_accounts)[ (]|update channels set status = 'connected'", '--', 'src'],
      { cwd: new URL('../../', import.meta.url), encoding: 'utf8' }).trim().split('\n').filter((f) => f && !f.startsWith('src/demo/'));
    expect(anywhere.sort(), 'a new file writes a channel row: add it here and its door to the walk').toEqual(Object.keys(known).sort());
    for (const [file, fns] of Object.entries(known)) {
      const text = src(file);
      const writes = [...text.matchAll(/insert into (?:channels|meta_accounts|mail_accounts|whatsapp_accounts|tiktok_accounts)\b|update channels set status = 'connected'/g)];
      expect(writes.length, file).toBeGreaterThan(0);
      for (const w of writes) {
        const before = text.slice(0, w.index);
        const fn = [...before.matchAll(/export async function (\w+)/g)].pop()?.[1] ?? '';
        expect(fns.split('|'), `${file}: ${fn} writes a channel row`).toContain(fn);
      }
    }
  });
});
