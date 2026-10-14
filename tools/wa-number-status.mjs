#!/usr/bin/env node
/**
 * WHERE A WHATSAPP NUMBER STANDS WITH META — read-only (docs/GATE-A-KIT.md §1, docs/LIVE-VERIFICATION.md).
 *
 * The pilot's long pole is Meta's, not Nomi's: a number sends only once its display name is usable (the refusal of
 * 2026-09-19 was `#131037`, "display name approval"). This asks Meta what it says about a number today, and prints
 * only what can be shown — never the token.
 *
 *   railway run --service nomi -- node tools/wa-number-status.mjs                      # the installation's number
 *   railway run --service nomi -- node tools/wa-number-status.mjs --phone-number-id <id>  # another in the same account
 *
 * `name_status`: APPROVED or AVAILABLE_WITHOUT_REVIEW — the name may be used; PENDING_REVIEW — Meta is reading it;
 * DECLINED — submit another in WhatsApp Manager; NONE — none submitted. Read 2026-10-14 for +1 555-472-3574:
 * AVAILABLE_WITHOUT_REVIEW, quality GREEN, TIER_250.
 *
 * Reads META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID, META_GRAPH_API_VERSION. Exit 0 read · 1 Meta or
 * the network refused · 2 bad usage.
 */
export const FIELDS = ['display_phone_number', 'verified_name', 'name_status', 'new_name_status', 'quality_rating',
  'code_verification_status', 'platform_type', 'status', 'messaging_limit_tier'];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const id = flag('phone-number-id') ?? process.env['META_WHATSAPP_PHONE_NUMBER_ID'] ?? '';
const token = process.env['META_WHATSAPP_ACCESS_TOKEN'] ?? '';
const version = process.env['META_GRAPH_API_VERSION'] || 'v23.0';
if (!/^\d{6,20}$/.test(id)) { console.error('\n  A phone number id is needed: --phone-number-id <digits>, or META_WHATSAPP_PHONE_NUMBER_ID.\n'); process.exit(2); }
if (token.length < 20) { console.error('\n  META_WHATSAPP_ACCESS_TOKEN is not set: run this inside `railway run --service nomi -- …`.\n'); process.exit(2); }

try {
  const r = await fetch(`https://graph.facebook.com/${version}/${id}?fields=${FIELDS.join(',')}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const body = await r.json();
  if (body.error) {
    // Meta's code and type only: its message can quote the request.
    console.error(`\n✗  Meta refused: code ${body.error.code ?? '?'} (${body.error.type ?? 'unknown'}).\n`);
    process.exit(1);
  }
  console.log('');
  for (const k of FIELDS) if (k in body) console.log(`  ${k.padEnd(26)} ${String(body[k])}`);
  const usable = body.name_status === 'APPROVED' || body.name_status === 'AVAILABLE_WITHOUT_REVIEW';
  console.log(`\n  ${usable ? '✓ The display name may be used.' : '○ The display name is not usable yet: WhatsApp Manager → Phone numbers → this number.'}\n`);
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.name : 'error'}: Meta did not answer.\n`);
  process.exit(1);
}
