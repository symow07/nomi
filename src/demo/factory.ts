import { type Money, usd } from '../core/types/money.js';
/**
 * M4 — The demo factory: 义乌宏发日用品厂, a fully populated fake company.
 * One deterministic source used three ways:
 *   1. demoSeedSql() — idempotent SQL for the live DB (demos + screenshots)
 *   2. exported fixtures — tests and future PWA storybook data
 *   3. renderDemoScript() — the cold-demo storyline (marketing asset)
 *
 * Every id is fixed so reseeding never duplicates and screenshots reproduce.
 */

/**
 * The id namespace every demo id derives from. M22: `demoSeedSql` can re-issue
 * the whole factory under a DIFFERENT namespace, which is what makes the
 * integration suite repeatable — each run seeds its own tenant instead of
 * mutating one shared factory and failing confusingly on the second run.
 */
export const DEMO_NAMESPACE = 'de300000';

/**
 * The same buyer number, in another namespace's tenant. Keeps the country code
 * and the trailing buyer index so the number still reads like the buyer it
 * belongs to; only the middle six digits move. Exported so a test can compute
 * exactly what was seeded rather than guessing.
 */
export function demoPhone(phone: string, namespace: string): string {
  if (namespace === DEMO_NAMESPACE) return phone;
  const block = String((parseInt(namespace.slice(0, 6), 16) % 900_000) + 100_000);
  return phone.replace(/^(\d{2})\d{6}/, (_m, cc: string) => cc + block);
}

const B = 'de300000-0000-4000-8000-0000000000b1';   // business id
const pid = (n: number) => `de300000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const cid = (n: number) => `de300000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const vid = (n: number) => `de300000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;

export const DEMO_BUSINESS = {
  id: B,
  name: '义乌宏发日用品厂 (demo)',
  employeeName: '小雅',
} as const;

export type DemoProduct = {
  readonly id: string; readonly sku: string; readonly name: string; readonly nameZh: string;
  readonly category: string; readonly unit: string; readonly moq: number;
  readonly leadTimeDays: number; readonly floor: Money;
  /** [minQty, unit price amount] ascending, in the product's own currency */
  readonly tiers: readonly (readonly [number, number])[];
  readonly aliases: readonly (readonly [string, string])[];  // [alias, language]
};

const P = (n: number, sku: string, name: string, nameZh: string, category: string,
  moq: number, lead: number, floor: number,
  tiers: readonly (readonly [number, number])[],
  aliases: readonly (readonly [string, string])[]): DemoProduct =>
  ({ id: pid(n), sku, name, nameZh, category, unit: 'pcs', moq, leadTimeDays: lead, floor: usd(floor), tiers, aliases });

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  P(1, 'ZX-100', 'Canvas Tote Bag 38x40cm', '帆布袋', 'bags', 500, 15, 0.72,
    [[500, 1.05], [2000, 0.92], [10000, 0.85]],
    [['canvas bag', 'en'], ['tote bag', 'en'], ['cotton shopping bag', 'en'], ['帆布包', 'zh'], ['canvs bag', 'typo'], ['حقيبة قماش', 'ar']]),
  P(2, 'ZX-200', 'Stainless Steel Thermos 500ml', '保温杯', 'drinkware', 1000, 20, 1.80,
    [[1000, 2.60], [5000, 2.35], [20000, 2.10]],
    [['thermos', 'en'], ['vacuum flask', 'en'], ['insulated bottle', 'en'], ['保温瓶', 'zh'], ['termos', 'typo']]),
  P(3, 'ZX-210', 'Ceramic Coffee Mug 350ml', '陶瓷杯', 'drinkware', 2000, 18, 0.55,
    [[2000, 0.85], [10000, 0.72], [50000, 0.62]],
    [['ceramic mug', 'en'], ['coffee cup', 'en'], ['马克杯', 'zh']]),
  P(4, 'ZX-300', 'LED String Lights 10m', 'LED灯串', 'lighting', 1000, 25, 1.10,
    [[1000, 1.65], [5000, 1.45], [20000, 1.28]],
    [['string lights', 'en'], ['fairy lights', 'en'], ['灯串', 'zh'], ['أضواء زينة', 'ar']]),
  P(5, 'ZX-310', 'Solar Garden Lamp', '太阳能草坪灯', 'lighting', 500, 30, 2.40,
    [[500, 3.50], [2000, 3.10], [10000, 2.80]],
    [['solar lamp', 'en'], ['garden light', 'en'], ['太阳能灯', 'zh']]),
  P(6, 'ZX-400', 'Microfiber Cleaning Cloth Set', '清洁布套装', 'home', 3000, 12, 0.30,
    [[3000, 0.48], [10000, 0.42], [50000, 0.36]],
    [['cleaning cloth', 'en'], ['microfiber towel', 'en'], ['抹布', 'zh']]),
  P(7, 'ZX-410', 'Silicone Kitchen Utensil Set 5pc', '硅胶厨具套装', 'home', 1000, 22, 2.20,
    [[1000, 3.20], [5000, 2.85], [20000, 2.55]],
    [['kitchen utensils', 'en'], ['silicone spatula set', 'en'], ['厨具', 'zh']]),
  P(8, 'ZX-500', 'Foldable Storage Box 40L', '折叠收纳箱', 'home', 500, 20, 1.60,
    [[500, 2.30], [2000, 2.05], [10000, 1.85]],
    [['storage box', 'en'], ['folding organizer', 'en'], ['收纳盒', 'zh']]),
  P(9, 'ZX-600', 'Kids Water Bottle with Straw', '儿童吸管杯', 'drinkware', 2000, 25, 0.95,
    [[2000, 1.40], [10000, 1.22], [30000, 1.08]],
    [['kids bottle', 'en'], ['straw cup', 'en'], ['儿童水杯', 'zh']]),
  P(10, 'ZX-700', 'Bamboo Cutting Board', '竹砧板', 'home', 1000, 28, 1.30,
    [[1000, 1.95], [5000, 1.75], [20000, 1.55]],
    [['cutting board', 'en'], ['bamboo chopping board', 'en'], ['砧板', 'zh']]),
  P(11, 'ZX-800', 'Travel Cosmetic Bag', '化妆包', 'bags', 1000, 15, 0.68,
    [[1000, 1.00], [5000, 0.88], [20000, 0.78]],
    [['cosmetic bag', 'en'], ['makeup pouch', 'en'], ['化妆袋', 'zh'], ['حقيبة مكياج', 'ar']]),
  P(12, 'ZX-900', 'Reusable Shopping Trolley Bag', '购物车袋', 'bags', 500, 18, 1.45,
    [[500, 2.10], [2000, 1.88], [10000, 1.70]],
    [['trolley bag', 'en'], ['shopping cart bag', 'en'], ['购物袋', 'zh']]),
];

export type DemoBuyer = {
  readonly id: string; readonly name: string; readonly country: string;
  readonly countryZh: string; readonly phone: string; readonly language: string;
  readonly vip: boolean;
};

export const DEMO_BUYERS: readonly DemoBuyer[] = [
  { id: cid(1), name: 'Ahmed Al-Rashid', country: 'AE', countryZh: '阿联酋', phone: '971500000101', language: 'ar', vip: true },
  { id: cid(2), name: 'Sara Hassan', country: 'SA', countryZh: '沙特', phone: '966500000102', language: 'ar', vip: false },
  { id: cid(3), name: 'Ivan Petrov', country: 'RU', countryZh: '俄罗斯', phone: '79100000103', language: 'en', vip: false },
  { id: cid(4), name: 'Mohammed Noor', country: 'EG', countryZh: '埃及', phone: '201000000104', language: 'ar', vip: true },
  { id: cid(5), name: 'Fatima Zahra', country: 'MA', countryZh: '摩洛哥', phone: '212600000105', language: 'fr', vip: false },
  { id: cid(6), name: 'David Okafor', country: 'NG', countryZh: '尼日利亚', phone: '2348000000106', language: 'en', vip: false },
];

type DemoConversation = {
  readonly id: string; readonly buyer: DemoBuyer; readonly phase: string;
  readonly productSku: string | null; readonly quantity: number | null;
  readonly messages: readonly { readonly dir: 'inbound' | 'outbound'; readonly text: string; readonly minsAgo: number }[];
};

export const DEMO_CONVERSATIONS: readonly DemoConversation[] = [
  { id: vid(1), buyer: DEMO_BUYERS[0]!, phase: 'commercial_discussion', productSku: 'ZX-200', quantity: 20000,
    messages: [
      { dir: 'inbound', text: 'Salam, price for 20000 pcs thermos 500ml FOB Ningbo?', minsAgo: 260 },
      { dir: 'outbound', text: 'For 20,000 pcs ZX-200: $2.10/pc FOB Ningbo, lead time 20 days.', minsAgo: 255 },
      { dir: 'inbound', text: 'Ok let me confirm with my partner', minsAgo: 200 },
    ] },
  { id: vid(2), buyer: DEMO_BUYERS[1]!, phase: 'qualification', productSku: 'ZX-100', quantity: null,
    messages: [
      { dir: 'inbound', text: 'Do you have canvas bags? Need samples first', minsAgo: 120 },
    ] },
  { id: vid(3), buyer: DEMO_BUYERS[2]!, phase: 'clarification', productSku: null, quantity: null,
    messages: [
      { dir: 'inbound', text: 'Hi, looking for household items for my shop in Moscow', minsAgo: 480 },
      { dir: 'outbound', text: 'Welcome! We make storage, kitchen and cleaning lines. What does your shop focus on?', minsAgo: 476 },
    ] },
  { id: vid(4), buyer: DEMO_BUYERS[3]!, phase: 'confirmation', productSku: 'ZX-300', quantity: 5000,
    messages: [
      { dir: 'inbound', text: 'Confirm 5000 pcs LED string lights at $1.45, ship to Alexandria', minsAgo: 1500 },
      { dir: 'outbound', text: 'Confirmed: 5,000 pcs ZX-300 at $1.45/pc. Proforma invoice coming today.', minsAgo: 1490 },
    ] },
  { id: vid(5), buyer: DEMO_BUYERS[4]!, phase: 'warm_intake', productSku: null, quantity: null,
    messages: [
      { dir: 'inbound', text: '[photo of a canvas tote bag] need 5000 pcs like this', minsAgo: 6 },
    ] },
];

const esc = (s: string): string => s.replace(/'/g, "''");

/** Idempotent seed — every insert is `on conflict do nothing`; safe to re-run. */
export function demoSeedSql(namespace: string = DEMO_NAMESPACE): string {
  const out: string[] = [
    `-- M4 demo factory seed (generated by src/demo/factory.ts — do not hand-edit)`,
    `insert into businesses (id, name, timezone, default_language, engine) values`,
    `  ('${B}', '${esc(DEMO_BUSINESS.name)}', 'Asia/Shanghai', 'en', 'service')`,
    `  on conflict (id) do nothing;`,
    `insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine) values`,
    `  ('${B}', 'whatsapp', 'DEMO_PNID', 'demo-no-secret', 'service') on conflict (channel, external_ref) do nothing;`,
    `insert into channels (business_id, kind, status, display_phone, connected_at) values`,
    `  ('${B}', 'whatsapp', 'connected', '+86 579****0001', now()) on conflict (business_id, kind) do nothing;`,
  ];

  for (const p of DEMO_PRODUCTS) {
    out.push(
      `insert into products (id, business_id, sku, name, name_zh, category, unit, moq, lead_time_days, price_usd_per_unit) values`,
      `  ('${p.id}', '${B}', '${p.sku}', '${esc(p.name)}', '${esc(p.nameZh)}', '${p.category}', '${p.unit}', ${p.moq}, ${p.leadTimeDays}, ${p.tiers[0]![1]})`,
      `  on conflict (business_id, sku) do nothing;`,
      `insert into pricing_policy (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct) values`,
      `  ('${B}', '${p.id}', ${p.floor.amount}, '${p.floor.currency}', 8, 5) on conflict (business_id, product_id) do nothing;`,
    );
    for (const [minQty, price] of p.tiers) {
      out.push(`insert into price_tiers (product_id, min_qty, unit_price_usd) values ('${p.id}', ${minQty}, ${price}) on conflict (product_id, min_qty) do nothing;`);
    }
    for (const [alias, lang] of p.aliases) {
      const type = lang === 'typo' ? 'typo' : lang === 'en' ? 'common' : lang;
      out.push(`insert into product_aliases (product_id, alias, language, alias_type) values ('${p.id}', '${esc(alias)}', '${lang === 'typo' ? 'en' : lang}', '${type}') on conflict do nothing;`);
    }
  }

  for (const b of DEMO_BUYERS) {
    out.push(
      `insert into clients (id, business_id, display_name, phone, country, preferred_language, is_vip) values`,
      `  ('${b.id}', '${B}', '${esc(b.name)}', '${b.phone}', '${b.country}', '${b.language}', ${b.vip}) on conflict (id) do nothing;`,
    );
  }

  for (const c of DEMO_CONVERSATIONS) {
    const product = DEMO_PRODUCTS.find((p) => p.sku === c.productSku) ?? null;
    out.push(
      `insert into conversations (id, business_id, client_id, channel, phase) values`,
      `  ('${c.id}', '${B}', '${c.buyer.id}', 'whatsapp', '${c.phase}') on conflict (id) do nothing;`,
      `insert into conversation_state (conversation_id, phase, identified_product_id, product_confidence, inquiry_quantity, inquiry_unit, turn_count) values`,
      `  ('${c.id}', '${c.phase}', ${product ? `'${product.id}'` : 'null'}, ${product ? '0.90' : '0.00'}, ${c.quantity ?? 'null'}, ${c.quantity ? `'pcs'` : 'null'}, ${c.messages.length})`,
      `  on conflict (conversation_id) do nothing;`,
    );
    c.messages.forEach((m, i) => {
      out.push(
        `insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values`,
        `  ('${c.id}', 'demo-${c.id.slice(-4)}-${i}', '${m.dir}', 'text', '${esc(m.text)}', now() - interval '${m.minsAgo} minutes')`,
        `  on conflict do nothing;`,
      );
    });
  }

  out.push(
    `insert into autonomy_policy (business_id, capability) select '${B}', c from (values ('greet'),('qualify'),('recommend'),('quote'),('negotiate'),('confirm_order'),('follow_up')) v(c) on conflict do nothing;`,
    `update autonomy_policy set mode = 'auto', time_window = '22:00-07:00' where business_id = '${B}' and capability in ('greet','qualify');`,
  );
  const sql = out.join('\n');
  if (namespace === DEMO_NAMESPACE) return sql;
  // Every demo id derives from DEMO_NAMESPACE, so re-namespacing the ids is a
  // single substitution. The namespace is eight hex characters that appear
  // nowhere else in the generated text — asserted by a test, since a
  // substitution that hit a product name would corrupt the seed silently.
  let out2 = sql.replaceAll(DEMO_NAMESPACE, namespace);
  // Phone numbers need it too, and for a reason worth writing down:
  // `client_channels` is UNIQUE on (channel, channel_user_id) GLOBALLY, not per
  // business. A second tenant reusing the demo numbers silently loses every
  // client_channels row to `on conflict do nothing`, leaving buyers who cannot
  // be reached — a seed that looks complete and is not.
  for (const b of DEMO_BUYERS) out2 = out2.replaceAll(b.phone, demoPhone(b.phone, namespace));
  return out2;
}

/** The cold-demo storyline — what you show, in order, on one phone. */
export function renderDemoScript(): string {
  return [
    `【${DEMO_BUSINESS.employeeName} · 现场演示脚本】义乌宏发日用品厂（演示公司）`,
    '',
    '一、发图报价（主打时刻，20秒）',
    '1. 用买家手机发一张帆布袋照片，配文 need 5000 pcs',
    `2. 老板手机马上弹出：Fatima 发来产品图，等你审批`,
    `3. 打开审批卡：认出是帆布袋（ZX-100），报价卡已算好`,
    '4. 点「发送」——买家秒收英文报价',
    '5. 一句话收尾：图是它认的，价是按你价格表算的，发不发你说了算',
    '',
    '二、追加看点（各10秒）',
    `· 对话回看：Ahmed（阿联酋）2万个保温杯谈到 $2.10`,
    '· 今日总结：昨晚夜班接待了俄罗斯新买家',
    '· 一键收回：说停就停，随时退回试用',
    '',
    '三、收尾问题',
    '「你现在半夜的询盘，是谁在回？」',
  ].join('\n');
}
