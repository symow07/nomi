/**
 * The public site's demo workspace: an invented clothing brand, Halden Studio,
 * whose customers write in English, Chinese and Arabic over WhatsApp,
 * Instagram, Messenger and e-mail.
 *
 * The site's screenshots are taken from it (the owner, 2026-11-28: "seed a new
 * local demo: an invented clothing brand, customers in English, Chinese and
 * Arabic. Nothing touches production"). LOCAL ONLY: `tools/seed-site-demo.mjs`
 * refuses any database that is not on this machine.
 *
 * Every name, number and address here is invented. Phone numbers sit in
 * reserved fiction ranges, e-mail addresses on example.com.
 *
 * No minimum order, no lead time, no quote language: a shop selling to people.
 */

const NS = '5d0e0000';
const id = (kind: string, n: number): string => `${NS}-0000-4000-8000-${kind}${String(n).padStart(12 - kind.length, '0')}`;

export const SITE_DEMO_BUSINESS_ID = id('b', 1);
const B = SITE_DEMO_BUSINESS_ID;
const ASSISTANT = id('a', 1);
const OWNER = id('f', 1);

export const SITE_DEMO = {
  name: 'Halden Studio',
  assistant: 'Lily',
  owner: 'Maren Halden',
  timezone: 'Europe/London',
} as const;

type Lang = 'en' | 'zh' | 'ar';
type Channel = 'whatsapp' | 'instagram' | 'messenger' | 'email';

interface Product { n: number; sku: string; name: string; price: number; floor: number; aliases: [string, Lang][] }
const PRODUCTS: Product[] = [
  { n: 1, sku: 'HS-LIN-01', name: 'Linen shirt', price: 68, floor: 58, aliases: [['linen shirt', 'en'], ['亚麻衬衫', 'zh'], ['قميص كتان', 'ar']] },
  { n: 2, sku: 'HS-TRS-02', name: 'Wide-leg trousers', price: 84, floor: 72, aliases: [['wide leg trousers', 'en'], ['阔腿裤', 'zh'], ['بنطال واسع', 'ar']] },
  { n: 3, sku: 'HS-DRS-03', name: 'Wrap dress', price: 96, floor: 82, aliases: [['wrap dress', 'en'], ['裹身裙', 'zh'], ['فستان ملفوف', 'ar']] },
  { n: 4, sku: 'HS-SCF-04', name: 'Silk scarf', price: 42, floor: 36, aliases: [['silk scarf', 'en'], ['真丝围巾', 'zh'], ['وشاح حرير', 'ar']] },
  { n: 5, sku: 'HS-CRD-05', name: 'Merino cardigan', price: 110, floor: 94, aliases: [['merino cardigan', 'en'], ['美利奴开衫', 'zh'], ['كارديغان مرينو', 'ar']] },
];
const pid = (n: number): string => id('d', n);

interface Msg { dir: 'inbound' | 'outbound'; text: string; ago: number }
interface Customer {
  n: number; name: string; lang: Lang; country: string; channel: Channel; handle: string;
  product: number; phase: string; messages: Msg[];
  /** A reply that waits for the owner. `quote` carries the price it names. */
  draft?: { capability: string; text: string; ago: number; quote?: { qty: number; unit: number } };
}

/** Minutes ago. */
const CUSTOMERS: Customer[] = [
  { n: 1, name: 'Emma Clarke', lang: 'en', country: 'GB', channel: 'instagram', handle: '17841400000000101', product: 1, phase: 'commercial_discussion',
    messages: [
      { dir: 'inbound', text: 'Hi! Is the linen shirt still in sand, size M?', ago: 42 },
      { dir: 'outbound', text: 'Hi Emma, yes, sand in M is in stock. It’s $68.', ago: 41 },
      { dir: 'inbound', text: 'I’d like two. Could you do $50 each?', ago: 6 },
    ],
    draft: { capability: 'negotiate', ago: 5, quote: { qty: 2, unit: 58 },
      text: 'I can’t go as low as $50, but for two I can do $58 each, so $116 for both. Does that work for you?' } },
  { n: 2, name: '王静', lang: 'zh', country: 'SG', channel: 'whatsapp', handle: '6580000102', product: 3, phase: 'qualification',
    messages: [
      { dir: 'inbound', text: '你好，裹身裙有黑色吗？我平时穿S码。', ago: 18 },
    ],
    draft: { capability: 'recommend', ago: 17, quote: { qty: 1, unit: 96 },
      text: '你好！裹身裙有黑色，S码现在有货，价格是96美元。需要我帮你留一件吗？' } },
  { n: 3, name: 'ليلى حداد', lang: 'ar', country: 'AE', channel: 'whatsapp', handle: '971500000103', product: 5, phase: 'qualification',
    messages: [
      { dir: 'inbound', text: 'مرحبا، ما الألوان المتوفرة من كارديغان المرينو؟', ago: 27 },
    ],
    draft: { capability: 'recommend', ago: 26, quote: { qty: 1, unit: 110 },
      text: 'أهلاً ليلى! كارديغان المرينو متوفر بالرمادي والكريمي والأخضر الزيتي، وسعره 110 دولارات. أي لون يعجبك؟' } },
  { n: 4, name: 'Sofia Martins', lang: 'en', country: 'PT', channel: 'email', handle: 'sofia.martins@example.com', product: 2, phase: 'confirmation',
    messages: [
      { dir: 'inbound', text: 'Hello, I would like to order the wide-leg trousers in navy, size 38.', ago: 190 },
      { dir: 'outbound', text: 'Thank you, Sofia. Navy in 38 is in stock at $84. I’ll send you a payment link as soon as it’s confirmed.', ago: 185 },
    ] },
  { n: 5, name: 'Daniel Okafor', lang: 'en', country: 'NG', channel: 'instagram', handle: '17841400000000105', product: 4, phase: 'warm_intake',
    messages: [
      { dir: 'inbound', text: 'Do you ship the silk scarf to Lagos?', ago: 75 },
      { dir: 'outbound', text: 'Hi Daniel, we do. Delivery to Lagos usually takes five to seven working days.', ago: 74 },
    ] },
  { n: 6, name: '陈晓雨', lang: 'zh', country: 'MY', channel: 'instagram', handle: '17841400000000106', product: 1, phase: 'qualification',
    messages: [
      { dir: 'inbound', text: '亚麻衬衫可以机洗吗？', ago: 130 },
      { dir: 'outbound', text: '可以的，建议30度轻柔模式，反面洗，自然晾干。', ago: 129 },
    ] },
  { n: 7, name: 'نور الخطيب', lang: 'ar', country: 'SA', channel: 'instagram', handle: '17841400000000107', product: 3, phase: 'commercial_discussion',
    messages: [
      { dir: 'inbound', text: 'هل يمكنني إرجاع الفستان إذا لم يناسبني المقاس؟', ago: 260 },
      { dir: 'outbound', text: 'نعم، يمكنك إرجاعه خلال 30 يوماً ما دام بحالته الأصلية.', ago: 258 },
    ] },
  { n: 8, name: 'Maya Rossi', lang: 'en', country: 'IT', channel: 'whatsapp', handle: '393000000108', product: 5, phase: 'closed',
    messages: [
      { dir: 'inbound', text: 'The cardigan arrived, it’s beautiful. Thank you!', ago: 1440 },
      { dir: 'outbound', text: 'That’s lovely to hear, Maya. Enjoy wearing it!', ago: 1438 },
    ] },
  { n: 9, name: 'James Lee', lang: 'en', country: 'US', channel: 'messenger', handle: '7300000000000109', product: 2, phase: 'warm_intake',
    messages: [
      { dir: 'inbound', text: 'What’s the inside leg on the wide-leg trousers?', ago: 320 },
      { dir: 'outbound', text: 'Hi James, the inside leg is 78 cm on every size. Happy to help with sizing.', ago: 318 },
    ] },
  { n: 10, name: '林佳', lang: 'zh', country: 'TW', channel: 'whatsapp', handle: '886900000110', product: 4, phase: 'warm_intake',
    messages: [
      { dir: 'inbound', text: '真丝围巾可以包装成礼物吗？', ago: 400 },
      { dir: 'outbound', text: '可以，我们可以免费礼品包装，还能附上一张手写卡片。', ago: 398 },
    ] },
];

const esc = (s: string): string => s.replace(/'/g, "''");
const ago = (min: number): string => `now() - interval '${min} minutes'`;

/** Idempotent: every insert is guarded, so a second run changes nothing. */
export function siteDemoSql(): string {
  const out: string[] = [
    `-- site demo workspace (generated by src/demo/siteDemo.ts — do not hand-edit)`,
    `insert into businesses (id, name, timezone, default_language, engine, kind, product_category, currency, languages_served, owner_locale, channels_used) values`,
    `  ('${B}', '${esc(SITE_DEMO.name)}', '${SITE_DEMO.timezone}', 'en', 'service', 'brand', 'apparel', 'USD', '{en,zh,ar}', 'en', '{whatsapp,instagram,messenger,email}')`,
    `  on conflict (id) do nothing;`,
    `insert into people (id, business_id, name, is_owner) values ('${OWNER}', '${B}', '${esc(SITE_DEMO.owner)}', true) on conflict do nothing;`,
    `insert into assistants (id, business_id, name, role, is_default, tone, length, emoji) values`,
    `  ('${ASSISTANT}', '${B}', '${SITE_DEMO.assistant}', 'sales', true, 'warm', 'short', 'never') on conflict do nothing;`,
    `insert into onboarding_state (business_id, employee_name, assistant_named_at, products_imported, whatsapp_connected) values`,
    `  ('${B}', '${SITE_DEMO.assistant}', now() - interval '20 days', 5, true) on conflict (business_id) do nothing;`,
    `insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine) values`,
    `  ('${B}', 'whatsapp', 'SITE_DEMO_PNID', 'demo-no-secret', 'service') on conflict (channel, external_ref) do nothing;`,
  ];
  for (const kind of ['whatsapp', 'instagram', 'messenger', 'email'] as const) {
    out.push(
      `insert into channels (business_id, kind, status, display_phone, connected_at) values`,
      `  ('${B}', '${kind}', 'connected', ${kind === 'whatsapp' ? `'+44 7700 900123'` : 'null'}, now() - interval '20 days') on conflict (business_id, kind) do nothing;`,
    );
  }

  for (const p of PRODUCTS) {
    out.push(
      `insert into products (id, business_id, sku, name, category, unit, moq, price_usd_per_unit, currency) values`,
      `  ('${pid(p.n)}', '${B}', '${p.sku}', '${esc(p.name)}', 'apparel', 'item', null, ${p.price}, 'USD') on conflict (business_id, sku) do nothing;`,
      `insert into pricing_policy (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct) values`,
      `  ('${B}', '${pid(p.n)}', ${p.floor}, 'USD', 15, 10) on conflict (business_id, product_id) do nothing;`,
      `insert into price_tiers (product_id, min_qty, unit_price_usd) values ('${pid(p.n)}', 1, ${p.price}) on conflict (product_id, min_qty) do nothing;`,
    );
    for (const [alias, lang] of p.aliases) {
      out.push(`insert into product_aliases (product_id, alias, language, alias_type) values ('${pid(p.n)}', '${esc(alias)}', '${lang}', '${lang === 'en' ? 'common' : lang}') on conflict do nothing;`);
    }
  }

  for (const c of CUSTOMERS) {
    const cid = id('c', c.n);
    const vid = id('e', c.n);
    const first = c.messages[0]!.ago;
    const last = c.messages.at(-1)!.ago;
    const lastIn = [...c.messages].reverse().find((m) => m.dir === 'inbound')!.ago;
    const isMail = c.channel === 'email';
    const isPhone = c.channel === 'whatsapp';
    out.push(
      `insert into clients (id, business_id, display_name, email, phone, country, preferred_language, created_at, last_seen_at) values`,
      `  ('${cid}', '${B}', '${esc(c.name)}', ${isMail ? `'${c.handle}'` : 'null'}, ${isPhone ? `'+${c.handle}'` : 'null'}, '${c.country}', '${c.lang}', ${ago(first + 60 * 24 * 3)}, ${ago(lastIn)}) on conflict (id) do nothing;`,
      `insert into client_channels (client_id, business_id, channel, channel_user_id, last_inbound_at) values`,
      `  ('${cid}', '${B}', '${c.channel}', '${c.handle}', ${ago(lastIn)}) on conflict (business_id, channel, channel_user_id) do nothing;`,
      `insert into conversations (id, business_id, client_id, channel, phase, is_active, assistant_id, ai_disclosed_at, ai_disclosure_delivered_at, created_at, updated_at) values`,
      `  ('${vid}', '${B}', '${cid}', '${c.channel}', '${c.phase}', ${c.phase !== 'closed'}, '${ASSISTANT}', ${ago(first)}, ${ago(first)}, ${ago(first)}, ${ago(last)}) on conflict (id) do nothing;`,
      `insert into conversation_state (conversation_id, phase, identified_product_id, product_confidence, turn_count, last_message_at) values`,
      `  ('${vid}', '${c.phase}', '${pid(c.product)}', 0.90, ${c.messages.length}, ${ago(last)}) on conflict (conversation_id) do nothing;`,
    );
    let k = 0;
    for (const m of c.messages) {
      const ext = `site-${c.n}-${k}`;
      if (m.dir === 'outbound') {
        const oid = id('9', c.n * 10 + k);
        out.push(
          `insert into outbound_messages (id, business_id, conversation_id, seq, body, status, origin, channel, created_at, sent_at) values`,
          `  ('${oid}', '${B}', '${vid}', ${k}, '${esc(m.text)}', 'sent', 'employee', '${c.channel}', ${ago(m.ago)}, ${ago(m.ago)}) on conflict (id) do nothing;`,
          `insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values`,
          `  ('${vid}', 'out:${oid}', 'outbound', 'text', '${esc(m.text)}', ${ago(m.ago)}) on conflict do nothing;`,
        );
      } else {
        out.push(
          `insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values`,
          `  ('${vid}', '${ext}', 'inbound', 'text', '${esc(m.text)}', ${ago(m.ago)}) on conflict do nothing;`,
        );
      }
      k += 1;
    }
    if (c.draft) {
      const qid = c.draft.quote ? id('7', c.n) : null;
      if (c.draft.quote && qid) {
        const q = c.draft.quote;
        out.push(
          `insert into quotes (id, business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, requires_human, applied_rules, engine_version, created_at, currency) values`,
          `  ('${qid}', '${B}', '${vid}', '${pid(c.product)}', ${q.qty}, '{"seed":"site-demo"}'::jsonb, ${q.unit}, 0, ${(q.qty * q.unit).toFixed(2)}, false, '{}', 'site-demo-seed', ${ago(c.draft.ago)}, 'USD') on conflict (id) do nothing;`,
        );
      }
      out.push(
        `insert into drafts (id, business_id, conversation_id, capability, draft_text, status, created_at, quote_id) values`,
        `  ('${id('8', c.n)}', '${B}', '${vid}', '${c.draft.capability}', '${esc(c.draft.text)}', 'pending', ${ago(c.draft.ago)}, ${qid ? `'${qid}'` : 'null'}) on conflict (id) do nothing;`,
      );
    }
  }

  out.push(
    `insert into autonomy_policy (business_id, capability) select '${B}', c from (values ('greet'),('qualify'),('recommend'),('quote'),('negotiate'),('confirm_order'),('follow_up')) v(c) on conflict do nothing;`,
  );
  return out.join('\n');
}
