#!/usr/bin/env node
// S7 (Phase 5, item 22) — point Nomi's Telegram bot at this installation's webhook, once, after its three variables
// are set (docs/env-checklist.md). Run where the secrets are, never with them on the command line:
//
//   railway run --service nomi -- node tools/telegram-webhook.mjs          # set it
//   railway run --service nomi -- node tools/telegram-webhook.mjs --check  # say where it points, change nothing
//
// It reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and PUBLIC_BASE_URL from the environment. It prints the
// address and Telegram's answer, never the token or the secret.
const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
const base = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
const check = process.argv.includes('--check');
const hide = (s) => String(s).split(token).join('bot…').split(secret).join('…');

if (!/^\d{5,}:[\w-]{20,}$/.test(token)) { console.error('TELEGRAM_BOT_TOKEN is not set, or is not a bot token.'); process.exit(2); }
if (!check && !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) { console.error('TELEGRAM_WEBHOOK_SECRET must be 16 or more letters, digits, _ or -.'); process.exit(2); }
if (!check && !/^https:\/\//.test(base)) { console.error('PUBLIC_BASE_URL must be the https address this installation answers at.'); process.exit(2); }

const call = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  return r.json();
};

try {
  if (check) {
    const info = await call('getWebhookInfo');
    console.log(hide(JSON.stringify({ url: info?.result?.url ?? null, pending: info?.result?.pending_update_count ?? null, lastError: info?.result?.last_error_message ?? null })));
    process.exit(info?.ok ? 0 : 1);
  }
  const url = `${base}/webhook/telegram`;
  const r = await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message'] });
  console.log(r?.ok ? `Telegram now posts to ${url}.` : `Telegram refused: ${hide(r?.description ?? 'no answer')}`);
  process.exit(r?.ok ? 0 : 1);
} catch (e) {
  console.error(`Telegram did not answer: ${hide(e instanceof Error ? e.message : e)}`);
  process.exit(1);
}
