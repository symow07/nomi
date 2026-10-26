#!/usr/bin/env node
// 0215 — point TikTok's Business Messaging webhook (event type DIRECT_MESSAGE) at this installation, once, after the
// app's three variables are set and the privacy page names TikTok (docs/env-checklist.md, docs/TIKTOK-CHANNEL.md §4).
// It is the app's setting, not a business's: one callback for every business that connects its own account.
// Run where the secrets are, never with them on the command line:
//
//   railway run --service nomi -- node tools/tiktok-webhook.mjs          # say what it would set, change nothing
//   railway run --service nomi -- node tools/tiktok-webhook.mjs --yes    # set it
//
// It reads TIKTOK_APP_ID, TIKTOK_APP_SECRET and PUBLIC_BASE_URL from the environment, and calls TikTok's
// /business/webhook/update/ ("Subscribe to Business Messaging Webhook events via Webhooks API"). It prints the address
// and TikTok's code, never the secret. Never run against TikTok until the owner's access steps are done.
const appId = (process.env.TIKTOK_APP_ID ?? '').trim();
const secret = (process.env.TIKTOK_APP_SECRET ?? '').trim();
const base = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
const yes = process.argv.includes('--yes');
const hide = (s) => String(s).split(secret).join('…');

if (!/^[0-9A-Za-z]{6,64}$/.test(appId)) { console.error('TIKTOK_APP_ID is not set.'); process.exit(2); }
if (secret.length < 16) { console.error('TIKTOK_APP_SECRET is not set.'); process.exit(2); }
if (!/^https:\/\//.test(base)) { console.error('PUBLIC_BASE_URL must be the https address this installation answers at.'); process.exit(2); }

const url = `${base}/webhook/tiktok`;
if (!yes) {
  console.log(`Would ask TikTok to post DIRECT_MESSAGE events for app ${appId} to ${url}. Nothing sent. Run again with --yes to set it.`);
  process.exit(0);
}
try {
  const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/business/webhook/update/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, secret, event_type: 'DIRECT_MESSAGE', callback_url: url }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => null);
  const ok = j?.code === 0;
  console.log(ok ? `TikTok now posts DIRECT_MESSAGE events to ${url}.` : `TikTok refused: code ${hide(j?.code ?? r.status)}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error(`TikTok did not answer: ${hide(e instanceof Error ? e.message : e)}`);
  process.exit(1);
}
