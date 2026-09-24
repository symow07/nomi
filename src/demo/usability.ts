import { DEMO_BUSINESS, DEMO_NAMESPACE, DEMO_PRODUCTS, demoPhone, type DemoProduct } from './factory.js';

/**
 * The usability workspace — what `docs/USABILITY-SCRIPT.md` "开始前的准备"
 * asks for, laid over the demo factory.
 *
 * The script's five tasks need a workspace that looks real, and each line of
 * its list is a row here:
 *   - sixty-plus conversations, so the inbox's fifty-row window is exceeded;
 *   - one of them handed to a NAMED colleague, replied to, and idle for
 *     weeks — the case A9 fixed, which must still be findable;
 *   - a draft waiting for approval, on a buyer who wrote within the hour;
 *   - three products with price tiers (the demo factory's twelve);
 *   - activity yesterday, so Results has something to show;
 *   - Instagram not connected (the demo factory connects WhatsApp only).
 *
 * Same business and products as the demo factory, same namespace scheme, so
 * `tools/seed-usability.mjs` lays it on a local instance and the integration
 * suite lays it on a run tenant. Every id is fixed and every write is guarded,
 * so re-seeding changes nothing. Times are relative to now() IN SQL, not to a
 * fixed date: the workspace looks fresh on whichever day it is seeded.
 *
 * `usabilityChecks` is the list above as SQL — one boolean per line — so the
 * tool can say "ready" only when every line holds, and a test can hold it.
 */

const B = DEMO_BUSINESS.id;

/** Blocks e1–e7 of the demo id space; nothing else in the repo uses them. */
const uid = (block: string, n: number): string =>
  `de300000-0000-4000-8000-00000000${block}${n.toString(16).padStart(2, '0')}`;

export const USABILITY_OWNER = { id: uid('e7', 2), name: '张经理' } as const;
export const USABILITY_STAFF = { id: uid('e7', 1), name: '陈莉' } as const;

export type UsabilityBuyer = {
  readonly id: string; readonly name: string; readonly country: string;
  readonly phone: string; readonly language: string;
};

// name · ISO country · dialling code · preferred language
const RAW_BUYERS: readonly (readonly [string, string, string, string])[] = [
  ['Layla Mansour', 'AE', '971', 'ar'], ['Youssef Karim', 'EG', '20', 'ar'], ['Amina Diallo', 'SN', '221', 'fr'],
  ['Carlos Mendes', 'BR', '55', 'pt'], ['Priya Raman', 'IN', '91', 'en'], ['Tunde Adeyemi', 'NG', '234', 'en'],
  ['Noor Al-Sayed', 'SA', '966', 'ar'], ['Elena Volkova', 'RU', '7', 'ru'], ['Kwame Mensah', 'GH', '233', 'en'],
  ['Mariam Benali', 'MA', '212', 'fr'], ['Jorge Alvarez', 'MX', '52', 'es'], ['Hassan Farouk', 'EG', '20', 'ar'],
  ['Ayşe Demir', 'TR', '90', 'tr'], ['Daniel Weber', 'DE', '49', 'de'], ['Fatou Ndiaye', 'SN', '221', 'fr'],
  ['Rahim Chowdhury', 'BD', '880', 'en'], ['Lucia Ferreira', 'PT', '351', 'pt'], ['Samuel Otieno', 'KE', '254', 'en'],
  ['Zainab Qureshi', 'PK', '92', 'en'], ['Ahmed Siddiqui', 'PK', '92', 'en'], ['Grace Mwangi', 'KE', '254', 'en'],
  ['Pedro Santos', 'BR', '55', 'pt'], ['Salma Idrissi', 'MA', '212', 'ar'], ['Ibrahim Sow', 'ML', '223', 'fr'],
  ['Nadia Rahimi', 'AE', '971', 'ar'], ['Marco Rossi', 'IT', '39', 'it'], ['Chidi Okonkwo', 'NG', '234', 'en'],
  ['Sofia Petrova', 'BG', '359', 'en'], ['Ali Rezaei', 'IQ', '964', 'ar'], ['Thandiwe Dlamini', 'ZA', '27', 'en'],
  ['Ricardo Gomez', 'CO', '57', 'es'], ['Huda Al-Amin', 'KW', '965', 'ar'], ['Bilal Khan', 'PK', '92', 'en'],
  ['Anna Kowalska', 'PL', '48', 'en'], ['Jamal Abdi', 'SO', '252', 'en'], ['Isabela Costa', 'BR', '55', 'pt'],
  ['Mehmet Yilmaz', 'TR', '90', 'tr'], ['Farida Hussein', 'EG', '20', 'ar'], ['Nikolai Ivanov', 'RU', '7', 'ru'],
  ['Amara Okafor', 'NG', '234', 'en'], ['Selim Kaya', 'TR', '90', 'tr'], ['Dina Saleh', 'EG', '20', 'ar'],
  ['Rafael Lima', 'BR', '55', 'pt'], ['Halima Yusuf', 'KE', '254', 'en'], ['Tomás Herrera', 'CL', '56', 'es'],
  ['Reem Al-Harbi', 'SA', '966', 'ar'], ['Kofi Boateng', 'GH', '233', 'en'], ['Olga Sokolova', 'RU', '7', 'ru'],
  ['Mustafa Aziz', 'IQ', '964', 'ar'], ['Valentina Ruiz', 'MX', '52', 'es'], ['Emeka Nwosu', 'NG', '234', 'en'],
  ['Hanan Khalil', 'JO', '962', 'ar'], ['Diego Morales', 'PE', '51', 'es'], ['Naledi Mokoena', 'ZA', '27', 'en'],
  ['Sara Lindqvist', 'SE', '46', 'en'], ['Yasmin Farah', 'DJ', '253', 'ar'], ['Arjun Patel', 'IN', '91', 'en'],
  ['Leila Haddad', 'LB', '961', 'ar'], ['Moussa Traoré', 'ML', '223', 'fr'], ['Camila Rocha', 'BR', '55', 'pt'],
  // The six the script names, last so their indices are stable.
  ['Omar Haddad', 'JO', '962', 'ar'],       // 60 · handed to a colleague, replied, idle three weeks
  ['Aisha Bello', 'NG', '234', 'en'],       // 61 · a draft waits, she wrote 35 minutes ago
  ['Khalid Mansoor', 'AE', '971', 'ar'],    // 62 · an order in production
  ['Beatriz Almeida', 'PT', '351', 'pt'],   // 63 · a sample, handled yesterday
  ['Sipho Ndlovu', 'ZA', '27', 'en'],       // 64 · a draft approved yesterday
  ['Ivana Horvat', 'HR', '385', 'en'],      // 65 · plain, yesterday
];

/**
 * Thirteen digits, a unique three-digit tail per buyer. `demoPhone` keeps the
 * first two digits and the tail and replaces the eight between with a block
 * derived from the namespace, so two tenants never share a number and two
 * buyers of one tenant never do either — `client_channels` is unique on the
 * number across every tenant, and a colliding row is dropped silently (G21).
 */
const phoneOf = (dial: string, i: number): string => `${dial}5000000000`.slice(0, 10) + String(200 + i);

export const USABILITY_BUYERS: readonly UsabilityBuyer[] = RAW_BUYERS.map(([name, country, dial, language], i) =>
  ({ id: uid('e1', i), name, country, phone: phoneOf(dial, i), language }));

export type UsabilityMessage = { readonly dir: 'inbound' | 'outbound'; readonly text: string; readonly ageMin: number };
export type UsabilityKind = 'plain' | 'handed' | 'draft' | 'order' | 'sample' | 'approved';
export type UsabilityConversation = {
  readonly id: string; readonly kind: UsabilityKind; readonly buyer: UsabilityBuyer;
  readonly product: DemoProduct; readonly qty: number; readonly phase: string;
  /** Oldest first; `ageMin` is minutes before now(), so it descends. */
  readonly messages: readonly UsabilityMessage[];
  /** A quote row, dated to the reply that gave the price. */
  readonly quoteAgeMin: number | null;
};

const HANDED = 60, DRAFT = 61, ORDER = 62, SAMPLE = 63, APPROVED = 64;

type Line = readonly [dir: 'inbound' | 'outbound', text: string];
/** One exchange per demo product, in its order. {qty} {price} {lead} {product} fill from the tier. */
const EXCHANGES: readonly (readonly Line[])[] = [
  [['inbound', 'Hi, do you make canvas tote bags with a custom print? I need about {qty} pcs.'],
   ['outbound', 'Yes — {product} with a one-colour print. For {qty} pcs the price is {price}/pc FOB Ningbo, lead time {lead} days. Which size do you need?'],
   ['inbound', '38x40 is fine. Can you send a sample first?'],
   ['outbound', 'Of course. A sample is $8 by courier, credited against your first order. Where should it go?']],
  [['inbound', 'Price for {qty} pcs stainless thermos 500ml?'],
   ['outbound', 'For {qty} pcs of {product}: {price}/pc FOB Ningbo, lead time {lead} days.'],
   ['inbound', 'Do you have colour options?'],
   ['outbound', 'Black, silver, navy and white as standard. Other colours from 5,000 pcs.']],
  [['inbound', 'Hello, we need ceramic mugs for a café chain, around {qty} pcs, logo printed.'],
   ['outbound', '{product} with your logo: {price}/pc for {qty} pcs, lead time {lead} days. Please send the logo file and we will make a mock-up.'],
   ['inbound', 'Sending it now.']],
  [['inbound', 'Looking for LED string lights 10m, {qty} pcs, warm white.'],
   ['outbound', '{product}, warm white, {qty} pcs: {price}/pc FOB Ningbo, lead time {lead} days. CE certified.'],
   ['inbound', 'What plug type?'],
   ['outbound', 'EU, UK or US plug, same price.']],
  [['inbound', 'Do you have solar garden lamps? Need {qty} for a distributor.'],
   ['outbound', 'Yes, {product}: {price}/pc for {qty} pcs, lead time {lead} days. Eight hours of light on a full charge.'],
   ['inbound', 'Ok, I will come back after checking with my client.']],
  [['inbound', 'Microfiber cloth sets, {qty} sets, what is your best price?'],
   ['outbound', '{product}: {price}/set for {qty} sets, lead time {lead} days.'],
   ['inbound', 'Can you do 3 colours per set?'],
   ['outbound', 'Yes, three colours per set at the same price.']],
  [['inbound', 'Silicone kitchen utensil set 5pc — {qty} sets. Price and MOQ?'],
   ['outbound', 'MOQ 1,000 sets. For {qty} sets: {price}/set FOB Ningbo, lead time {lead} days.'],
   ['inbound', 'Food grade certificate?'],
   ['outbound', 'Yes, LFGB and FDA reports available on request.']],
  [['inbound', 'Foldable storage box 40L, {qty} pcs. Do you ship to our port?'],
   ['outbound', '{product}: {price}/pc for {qty} pcs, lead time {lead} days. FOB Ningbo; your forwarder or ours.'],
   ['inbound', 'Ours. Please quote FOB.']],
  [['inbound', 'Kids water bottle with straw, {qty} pcs, BPA free?'],
   ['outbound', 'Yes, BPA-free Tritan. {product}: {price}/pc for {qty} pcs, lead time {lead} days.'],
   ['inbound', 'Great, send me a proforma please.'],
   ['outbound', 'Proforma sent — please check the attached PDF.']],
  [['inbound', 'Bamboo cutting boards, {qty} pcs, engraved logo possible?'],
   ['outbound', 'Laser-engraved logo, yes. {product}: {price}/pc for {qty} pcs, lead time {lead} days.'],
   ['inbound', 'Thanks, noted.']],
  [['inbound', 'Travel cosmetic bag, {qty} pcs in 4 colours?'],
   ['outbound', '{product}: {price}/pc for {qty} pcs, four colours at no extra cost, lead time {lead} days.'],
   ['inbound', 'What is the fabric?'],
   ['outbound', '600D polyester with a waterproof lining.']],
  [['inbound', 'Shopping trolley bags, {qty} pcs for a supermarket chain.'],
   ['outbound', '{product}: {price}/pc for {qty} pcs, lead time {lead} days. Printing on both sides included.'],
   ['inbound', 'Perfect. I will confirm next week.']],
];

/** The tier price that applies to a quantity (the highest tier at or below it). */
export function tierPrice(p: DemoProduct, qty: number): number {
  let price = p.tiers[0]![1];
  for (const [min, unit] of p.tiers) if (qty >= min) price = unit;
  return price;
}
const money = (n: number): string => `$${n.toFixed(2)}`;
const thousands = (n: number): string => n.toLocaleString('en-US');

/**
 * When the last message of plain conversation i was written, in minutes ago:
 * six today, ten yesterday, the rest spread over the past three weeks — all
 * newer than the handed one, which is what pushes it past the window.
 */
const lastAgeOf = (i: number): number =>
  i < 6 ? 40 + i * 65
  : i < 16 ? 1500 + (i - 6) * 90
  : Math.round((2 + (i - 16) * 0.3) * 1440);

function plainConversation(i: number, lastAge: number): UsabilityConversation {
  const buyer = USABILITY_BUYERS[i]!;
  const product = DEMO_PRODUCTS[i % DEMO_PRODUCTS.length]!;
  const tier = product.tiers[i % 3]!;
  const qty = tier[0] * (1 + (i % 2));
  const price = tierPrice(product, qty);
  const fill = (s: string) => s
    .replaceAll('{qty}', thousands(qty)).replaceAll('{price}', money(price))
    .replaceAll('{lead}', String(product.leadTimeDays)).replaceAll('{product}', product.name);
  const lines = EXCHANGES[i % EXCHANGES.length]!;
  // Vary where the exchange stands: some stop after the price, some after the
  // buyer's next question, most run to the end.
  const keep = i % 4 === 0 ? 2 : i % 4 === 1 ? 3 : lines.length;
  const used = lines.slice(0, keep);
  const messages = used.map(([dir, text], k) => ({ dir, text: fill(text), ageMin: lastAge + (used.length - 1 - k) * 35 }));
  const quoteLine = messages.findIndex((m) => m.dir === 'outbound');
  return {
    id: uid('e2', i), kind: 'plain', buyer, product, qty,
    phase: keep <= 2 ? 'qualification' : 'commercial_discussion',
    messages,
    quoteAgeMin: i % 3 === 0 && quoteLine >= 0 ? messages[quoteLine]!.ageMin : null,
  };
}

const sku = (s: string): DemoProduct => {
  const p = DEMO_PRODUCTS.find((x) => x.sku === s);
  if (!p) throw new Error(`usability seed: no demo product ${s}`);
  return p;
};

function specials(): readonly UsabilityConversation[] {
  const box = sku('ZX-500'), lights = sku('ZX-300'), thermos = sku('ZX-200'), mug = sku('ZX-210'), board = sku('ZX-700');
  return [
    // 60 · Handed to 陈莉 three weeks ago; her reply was the last word. Nothing
    //      since. The oldest conversation in the workspace, so it sits past the
    //      fifty-row window on "All" and must still be on "Waiting" (A9).
    { id: uid('e2', HANDED), kind: 'handed', buyer: USABILITY_BUYERS[HANDED]!, product: box, qty: 3000, phase: 'commercial_discussion',
      messages: [
        { dir: 'inbound', text: 'Can you do 3,000 pcs of the foldable storage box with our logo? Need price and lead time.', ageMin: 30300 },
        { dir: 'outbound', text: `Yes — one-colour logo print, ${money(tierPrice(box, 3000))}/pc for 3,000 pcs, lead time ${box.leadTimeDays} days. Shall I send a proforma?`, ageMin: 30240 },
      ], quoteAgeMin: 30240 },
    // 61 · She wrote 35 minutes ago; the reply is drafted and waits.
    { id: uid('e2', DRAFT), kind: 'draft', buyer: USABILITY_BUYERS[DRAFT]!, product: lights, qty: 5000, phase: 'commercial_discussion',
      messages: [
        { dir: 'inbound', text: 'Hello, what is your price for 5,000 pcs of the LED string lights 10m? Shipping to Lagos.', ageMin: 35 },
      ], quoteAgeMin: 33 },
    // 62 · An order, confirmed two days ago, in production since yesterday.
    { id: uid('e2', ORDER), kind: 'order', buyer: USABILITY_BUYERS[ORDER]!, product: thermos, qty: 5000, phase: 'confirmation',
      messages: [
        { dir: 'inbound', text: `Following up on the thermos quote — we will take 5,000 pcs at ${money(tierPrice(thermos, 5000))}.`, ageMin: 4380 },
        { dir: 'outbound', text: `Confirmed: 5,000 pcs ZX-200 at ${money(tierPrice(thermos, 5000))}/pc, total ${money(5000 * tierPrice(thermos, 5000))}. Proforma invoice attached; production starts on deposit.`, ageMin: 4370 },
        { dir: 'inbound', text: 'Deposit paid today.', ageMin: 2900 },
        { dir: 'outbound', text: 'Received, thank you. Your order is confirmed; I will update you when production starts.', ageMin: 2880 },
      ], quoteAgeMin: 4370 },
    // 63 · A sample asked for three days ago, handled yesterday.
    { id: uid('e2', SAMPLE), kind: 'sample', buyer: USABILITY_BUYERS[SAMPLE]!, product: mug, qty: 2000, phase: 'qualification',
      messages: [
        { dir: 'inbound', text: 'Can you send a sample of the ceramic mug before we order?', ageMin: 4400 },
        { dir: 'outbound', text: 'Yes — a sample is $6 by courier, credited against your first order. Please share the delivery address.', ageMin: 4390 },
        { dir: 'inbound', text: 'Rua das Flores 12, 4050-262 Porto, Portugal.', ageMin: 4300 },
        { dir: 'outbound', text: 'Sample dispatched today; tracking to follow.', ageMin: 1450 },
      ], quoteAgeMin: null },
    // 64 · A draft approved yesterday: the reply went out as written.
    { id: uid('e2', APPROVED), kind: 'approved', buyer: USABILITY_BUYERS[APPROVED]!, product: board, qty: 2000, phase: 'commercial_discussion',
      messages: [
        { dir: 'inbound', text: 'Hi, quote for 2,000 pcs bamboo cutting boards with an engraved logo?', ageMin: 1520 },
        { dir: 'outbound', text: `Laser-engraved logo, yes. ${board.name}: ${money(tierPrice(board, 2000))}/pc for 2,000 pcs, lead time ${board.leadTimeDays} days.`, ageMin: 1500 },
      ], quoteAgeMin: 1500 },
    plainConversation(65, 1560),
  ];
}

export const USABILITY_CONVERSATIONS: readonly UsabilityConversation[] = [
  ...Array.from({ length: HANDED }, (_, i) => plainConversation(i, lastAgeOf(i))),
  ...specials(),
];

export const USABILITY_HANDED = USABILITY_CONVERSATIONS[HANDED]!;
export const USABILITY_DRAFT = USABILITY_CONVERSATIONS[DRAFT]!;

/** The text of the draft that waits (task two: "she has written a reply"). */
export const USABILITY_DRAFT_TEXT =
  `Hello Aisha — for 5,000 pcs of ${sku('ZX-300').name} (ZX-300): ${money(tierPrice(sku('ZX-300'), 5000))}/pc FOB Ningbo, lead time ${sku('ZX-300').leadTimeDays} days, CE certified. Would you like a proforma invoice?`;

const esc = (s: string): string => s.replace(/'/g, "''");
const ago = (min: number): string => `now() - interval '${min} minutes'`;

/** The demo business id under a namespace. */
export const usabilityBusinessId = (namespace: string = DEMO_NAMESPACE): string => B.replaceAll(DEMO_NAMESPACE, namespace);
/** Any usability id under a namespace. */
export const inNamespace = (id: string, namespace: string): string => id.replaceAll(DEMO_NAMESPACE, namespace);

/** Idempotent SQL: every insert is guarded, so a second run changes nothing. */
export function usabilitySeedSql(namespace: string = DEMO_NAMESPACE): string {
  const out: string[] = [
    `-- usability workspace seed (generated by src/demo/usability.ts — do not hand-edit)`,
    `insert into people (id, business_id, name, is_owner) values ('${USABILITY_OWNER.id}', '${B}', '${esc(USABILITY_OWNER.name)}', true) on conflict do nothing;`,
    `insert into people (id, business_id, name, is_owner) values ('${USABILITY_STAFF.id}', '${B}', '${esc(USABILITY_STAFF.name)}', false) on conflict do nothing;`,
  ];

  for (const b of USABILITY_BUYERS) {
    const conv = USABILITY_CONVERSATIONS.find((c) => c.buyer.id === b.id);
    const lastIn = conv ? [...conv.messages].reverse().find((m) => m.dir === 'inbound')?.ageMin ?? 60 : 60;
    // A buyer exists from the first message, not from the day the seed ran:
    // Results counts "new customers" by `created_at`, and seventy-two new
    // buyers in one week is not a workspace anyone recognises.
    const firstIn = conv ? conv.messages[0]!.ageMin : 60;
    out.push(
      `insert into clients (id, business_id, display_name, phone, country, preferred_language, total_orders, created_at, last_seen_at) values`,
      `  ('${b.id}', '${B}', '${esc(b.name)}', '${b.phone}', '${b.country}', '${b.language}', ${conv?.kind === 'order' ? 1 : 0}, ${ago(firstIn)}, ${ago(lastIn)}) on conflict (id) do nothing;`,
      `insert into client_channels (client_id, channel, channel_user_id, last_inbound_at) values`,
      `  ('${b.id}', 'whatsapp', '${b.phone}', ${ago(lastIn)}) on conflict (channel, channel_user_id) do nothing;`,
    );
  }

  for (const c of USABILITY_CONVERSATIONS) {
    const first = c.messages[0]!.ageMin;
    const last = c.messages.at(-1)!.ageMin;
    const handed = c.kind === 'handed';
    out.push(
      `insert into conversations (id, business_id, client_id, channel, phase, is_active, assigned_to, assigned_at, created_at, updated_at) values`,
      `  ('${c.id}', '${B}', '${c.buyer.id}', 'whatsapp', '${c.phase}', true, ${handed ? `'${USABILITY_STAFF.id}'` : 'null'}, ${handed ? ago(last) : 'null'}, ${ago(first)}, ${ago(last)})`,
      `  on conflict (id) do nothing;`,
      `insert into conversation_state (conversation_id, phase, identified_product_id, product_confidence, inquiry_quantity, inquiry_unit, turn_count, last_message_at) values`,
      `  ('${c.id}', '${c.phase}', '${c.product.id}', 0.90, ${c.qty}, 'pcs', ${c.messages.length}, ${ago(last)})`,
      `  on conflict (conversation_id) do nothing;`,
    );
    c.messages.forEach((m, k) => {
      out.push(
        `insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values`,
        `  ('${c.id}', 'usab-${c.id.slice(-4)}-${k}', '${m.dir}', 'text', '${esc(m.text)}', ${ago(m.ageMin)})`,
        `  on conflict do nothing;`,
      );
    });
    if (c.quoteAgeMin !== null) {
      const unit = tierPrice(c.product, c.qty);
      out.push(
        `insert into quotes (id, business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, requires_human, applied_rules, engine_version, created_at) values`,
        `  ('${uid('e4', USABILITY_CONVERSATIONS.indexOf(c))}', '${B}', '${c.id}', '${c.product.id}', ${c.qty}, '{"seed":"usability"}'::jsonb, ${unit}, 0, ${(c.qty * unit).toFixed(2)}, false, '{}', 'usability-seed', ${ago(c.quoteAgeMin)})`,
        `  on conflict (id) do nothing;`,
      );
    }
  }

  // 60 · the hand-off, on the record the way `handTo` writes it.
  out.push(
    `insert into conversation_events (business_id, conversation_id, type, payload, created_at)`,
    `  select '${B}', '${USABILITY_HANDED.id}', 'handed_to', '{"actor":"${USABILITY_OWNER.id}","to":"${USABILITY_STAFF.id}"}'::jsonb, ${ago(30250)}`,
    `  where not exists (select 1 from conversation_events where conversation_id = '${USABILITY_HANDED.id}' and type = 'handed_to');`,
  );

  // 61 · the draft that waits.
  out.push(
    `insert into drafts (id, business_id, conversation_id, capability, draft_text, status, created_at) values`,
    `  ('${uid('e3', DRAFT)}', '${B}', '${USABILITY_DRAFT.id}', 'quote', '${esc(USABILITY_DRAFT_TEXT)}', 'pending', ${ago(33)})`,
    `  on conflict (id) do nothing;`,
  );

  // 62 · the order, confirmed two days ago. No `order_updates` rows: that log
  //      has ONE writer (`writeOrderState`, tests/integration/after-order.test.ts
  //      holds it structurally), and a seed is not it. The order reads as one
  //      confirmed before the log existed, which 0034 allows.
  const order = USABILITY_CONVERSATIONS[ORDER]!;
  const orderId = uid('e5', ORDER);
  const unit = tierPrice(order.product, order.qty);
  out.push(
    `insert into orders (id, order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, agreed_unit_price_usd, total_value_usd, status, payment_terms, shipping_address, incoterm, quote_id, created_at, confirmed_at) values`,
    `  ('${orderId}', 'USAB-${DEMO_NAMESPACE}-0001', '${B}', '${order.buyer.id}', '${order.id}', '${order.product.id}', ${order.qty}, 'pcs', ${unit}, ${(order.qty * unit).toFixed(2)}, 'confirmed', '30% deposit, balance before shipment', 'Jebel Ali Free Zone, Dubai, UAE', 'FOB', '${uid('e4', ORDER)}', ${ago(2880)}, ${ago(2880)})`,
    `  on conflict (id) do nothing;`,
  );

  // 63 · the sample, handled yesterday.
  const sample = USABILITY_CONVERSATIONS[SAMPLE]!;
  out.push(
    `insert into sample_requests (id, business_id, conversation_id, asked_text, requested_at, address, handled_at, handled_by) values`,
    `  ('${uid('e6', SAMPLE)}', '${B}', '${sample.id}', '${esc(sample.messages[0]!.text)}', ${ago(4400)}, 'Rua das Flores 12, 4050-262 Porto, Portugal', ${ago(1450)}, '${esc(USABILITY_OWNER.name)}')`,
    `  on conflict (id) do nothing;`,
  );

  // 64 · the draft approved yesterday — what Results counts as handled.
  const approved = USABILITY_CONVERSATIONS[APPROVED]!;
  const sent = approved.messages[1]!;
  out.push(
    `insert into drafts (id, business_id, conversation_id, capability, draft_text, status, sent_text, decided_at, created_at) values`,
    `  ('${uid('e3', APPROVED)}', '${B}', '${approved.id}', 'quote', '${esc(sent.text)}', 'approved', '${esc(sent.text)}', ${ago(sent.ageMin)}, ${ago(sent.ageMin + 10)})`,
    `  on conflict (id) do nothing;`,
  );

  const sql = out.join('\n');
  if (namespace === DEMO_NAMESPACE) return sql;
  // Every id derives from DEMO_NAMESPACE, and so does the order reference, so
  // re-namespacing is one substitution; the phones follow demoPhone's rule.
  let out2 = sql.replaceAll(DEMO_NAMESPACE, namespace);
  for (const b of USABILITY_BUYERS) out2 = out2.replaceAll(b.phone, demoPhone(b.phone, namespace));
  return out2;
}

export type UsabilityCheck = { readonly key: string; readonly zh: string; readonly en: string; readonly sql: string };

/**
 * The script's list, as SQL. Each statement returns one row with a boolean
 * `ok`, read inside the tenant, so the tool and the test ask the same
 * questions of the same rows the pages read.
 */
export function usabilityChecks(namespace: string = DEMO_NAMESPACE): readonly UsabilityCheck[] {
  const bid = usabilityBusinessId(namespace);
  const handed = inNamespace(USABILITY_HANDED.id, namespace);
  const lastAt = (conv: string) => `(select max(m.sent_at) from messages m where m.conversation_id = ${conv})`;
  return [
    { key: 'sixty', zh: '至少 60 个对话', en: '60+ conversations',
      sql: `select count(*) >= 60 as ok from conversations where business_id = '${bid}'` },
    { key: 'handed', zh: '一个交给了员工、已经回过、很久没动', en: 'one handed to a colleague, replied to, idle a week or more',
      sql: `select exists (
              select 1 from conversations c
              join people p on p.id::text = c.assigned_to
             where c.business_id = '${bid}' and c.is_active and not p.is_owner and p.archived_at is null
               and (select m.direction from messages m where m.conversation_id = c.id order by m.sent_at desc limit 1) = 'outbound'
               and ${lastAt('c.id')} < now() - interval '7 days') as ok` },
    { key: 'window', zh: '那个对话排在 50 行之外（A9 修的那一类）', en: 'that conversation sits past the fifty-row window (the A9 case)',
      sql: `select (select count(*) from conversations c2
                    where c2.business_id = '${bid}' and c2.id <> '${handed}'
                      and ${lastAt('c2.id')} > ${lastAt(`'${handed}'`)}) >= 50 as ok` },
    { key: 'draft', zh: '至少一条等你批准的草稿', en: 'a draft awaiting approval',
      sql: `select exists (select 1 from drafts where business_id = '${bid}' and status = 'pending') as ok` },
    { key: 'products', zh: '至少三个产品，其中一个有价格档位', en: 'three products, one with price tiers',
      sql: `select (select count(*) from products where business_id = '${bid}' and is_active) >= 3
               and exists (select 1 from products p where p.business_id = '${bid}'
                             and (select count(*) from price_tiers t where t.product_id = p.id) >= 2) as ok` },
    { key: 'yesterday', zh: '昨天有活动', en: 'activity yesterday',
      sql: `select exists (select 1 from messages m join conversations c on c.id = m.conversation_id
                           where c.business_id = '${bid}'
                             and m.sent_at < now() - interval '20 hours' and m.sent_at > now() - interval '48 hours') as ok` },
    { key: 'instagram', zh: 'Instagram 未连接', en: 'Instagram not connected',
      sql: `select not exists (select 1 from channels where business_id = '${bid}' and kind = 'instagram' and status = 'connected') as ok` },
  ];
}
