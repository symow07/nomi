-- =============================================================================
-- YiwuFlow MVP — Seed Data
-- Realistic Yiwu export product catalog
-- Run AFTER schema.sql
-- =============================================================================

-- =============================================================================
-- SEED: BUSINESS
-- =============================================================================
insert into businesses (
  id, name, contact_email, escalation_email,
  escalation_telegram_chat_id, timezone, default_language,
  google_sheet_id, is_active
) values (
  'a0000000-0000-0000-0000-000000000001',
  'Yiwu Global Trading Co.',
  'sales@yiwuglobal.example.com',
  'ops@yiwuglobal.example.com',
  '-1001234567890',
  'Asia/Shanghai',
  'en',
  '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
  true
);

-- =============================================================================
-- SEED: CHANNEL SOURCES (WhatsApp real + others simulated)
-- =============================================================================
insert into channel_sources (business_id, channel, channel_account_id, webhook_secret, is_active)
values
  ('a0000000-0000-0000-0000-000000000001', 'whatsapp',     '+8657900001234', 'whatsapp_secret_abc123', true),
  ('a0000000-0000-0000-0000-000000000001', 'wechat',       'yiwuglobal_wx',  'wechat_secret_def456',  true),
  ('a0000000-0000-0000-0000-000000000001', 'instagram',    'yiwuglobal_ig',  'ig_secret_ghi789',      true),
  ('a0000000-0000-0000-0000-000000000001', 'webhook_test', 'test_channel',   'test_secret_xyz',       true);

-- =============================================================================
-- SEED: PRODUCTS (15 realistic Yiwu export products)
-- =============================================================================

-- 1. Custom Printed Non-Woven Shopping Bags
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'BAG-NW-CUST-001',
  'Custom Printed Non-Woven Shopping Bags',
  '定制印刷无纺布购物袋',
  'Non-woven polypropylene shopping bags with custom print. Available in multiple sizes and colors. Min 1 color print included.',
  'packaging',
  'pcs', 2000, 0.38, 2.70, 18, true, true
);

-- 2. LED Flameless Tea Light Candles
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'LED-TL-001',
  'LED Flameless Tea Light Candles',
  'LED无焰茶蜡烛',
  'Battery-operated LED tea light candles in frosted plastic cups. Warm white glow. Sold in bulk boxes of 100.',
  'lighting',
  'pcs', 500, 0.22, 1.60, 14, false, true
);

-- 3. LED Copper Wire String Lights
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  'LED-STR-CW-001',
  'LED Copper Wire String Lights',
  'LED铜线串灯',
  '10-meter copper wire fairy lights, 100 LEDs, USB or battery powered. Warm white, cool white, multicolor options.',
  'lighting',
  'pcs', 200, 1.85, 13.50, 15, false, true
);

-- 4. Plastic Storage Boxes with Lids
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000001',
  'STG-BOX-PP-001',
  'Plastic Storage Boxes with Lids',
  '带盖塑料收纳箱',
  'Stackable PP plastic storage boxes. Available in 5L, 10L, 15L, 20L sizes. Clear or opaque.',
  'storage',
  'pcs', 300, 1.20, 8.80, 14, false, true
);

-- 5. Stainless Steel Insulated Water Bottles
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000001',
  'BTL-SS-500-001',
  'Stainless Steel Insulated Water Bottles',
  '不锈钢保温水瓶',
  'Double-wall 304 stainless steel vacuum insulated bottles. 500ml. Custom logo engraving or printing available.',
  'drinkware',
  'pcs', 500, 3.20, 23.00, 20, true, true
);

-- 6. Custom Logo Printed Kraft Paper Gift Bags
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000001',
  'BAG-KP-GIFT-001',
  'Custom Logo Kraft Paper Gift Bags',
  '定制牛皮纸礼品袋',
  'Brown or white kraft paper gift bags with twisted rope handles. Custom logo print. Small, medium, large sizes.',
  'packaging',
  'pcs', 1000, 0.28, 2.00, 16, true, true
);

-- 7. Silicone Kitchen Utensil Set
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000001',
  'KIT-SIL-SET-001',
  'Silicone Kitchen Utensil Set',
  '硅胶厨房工具套装',
  '5-piece silicone kitchen set: spatula, ladle, slotted spoon, tongs, whisk. Heat resistant to 230°C. Various colors.',
  'kitchenware',
  'sets', 200, 4.50, 32.00, 18, false, true
);

-- 8. Promotional Ballpoint Pens with Custom Print
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000008',
  'a0000000-0000-0000-0000-000000000001',
  'PEN-BP-PROMO-001',
  'Promotional Ballpoint Pens',
  '广告圆珠笔',
  'Plastic ballpoint pens for corporate gifting and promotions. Custom logo print on barrel. Blue or black ink.',
  'stationery',
  'pcs', 500, 0.18, 1.30, 12, true, true
);

-- 9. Canvas Tote Bags Plain / Custom
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000009',
  'a0000000-0000-0000-0000-000000000001',
  'BAG-CNV-TOTE-001',
  'Canvas Tote Bags',
  '帆布手提袋',
  '12oz natural cotton canvas tote bags. 38x42cm standard size. Custom screen printing or embroidery available.',
  'packaging',
  'pcs', 300, 1.60, 11.50, 16, true, true
);

-- 10. Ceramic Coffee Mugs Custom Print
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000010',
  'a0000000-0000-0000-0000-000000000001',
  'MUG-CER-350-001',
  'Ceramic Coffee Mugs',
  '陶瓷咖啡杯',
  '350ml white ceramic sublimation mugs. Custom full-color print. Dishwasher safe coating. Gift box packaging available.',
  'drinkware',
  'pcs', 200, 1.45, 10.50, 15, true, true
);

-- 11. Folding Umbrella with Custom Print
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000011',
  'a0000000-0000-0000-0000-000000000001',
  'UMB-FOLD-001',
  'Folding Compact Umbrellas',
  '折叠雨伞',
  '3-fold compact umbrellas, 8 ribs, fiberglass frame. UV protection. Custom print on canopy.',
  'accessories',
  'pcs', 300, 3.80, 27.50, 20, true, true
);

-- 12. Portable Bluetooth Speaker
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000012',
  'a0000000-0000-0000-0000-000000000001',
  'ELEC-BT-SPK-001',
  'Portable Bluetooth Speaker',
  '便携式蓝牙音箱',
  'Mini portable Bluetooth 5.0 speaker, 5W output, 4-hour battery, micro USB charging. Custom logo on housing.',
  'electronics',
  'pcs', 100, 7.50, 54.00, 25, true, true
);

-- 13. Cotton Terry Face Towels
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000013',
  'a0000000-0000-0000-0000-000000000001',
  'TEX-TWL-FACE-001',
  'Cotton Terry Face Towels',
  '纯棉毛巾',
  '100% cotton 32S terry face towels. 35x75cm. 400gsm. Custom embroidery or jacquard border available.',
  'textiles',
  'pcs', 500, 0.95, 6.80, 18, true, true
);

-- 14. Bubble Mailer Padded Envelopes
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000014',
  'a0000000-0000-0000-0000-000000000001',
  'PKG-BUBL-001',
  'Bubble Mailer Padded Envelopes',
  '气泡袋快递信封',
  'White poly bubble mailers with self-seal strip. Available in sizes A4 to A1. Sold in boxes of 100.',
  'packaging',
  'pcs', 1000, 0.12, 0.85, 10, false, true
);

-- 15. Plastic Zip-Lock Bags (Resealable)
insert into products (id, business_id, sku, name, name_zh, description, category, unit, moq, price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active)
values (
  'b0000000-0000-0000-0000-000000000015',
  'a0000000-0000-0000-0000-000000000001',
  'PKG-ZIP-001',
  'Plastic Resealable Zip-Lock Bags',
  '塑料拉链袋',
  'LDPE zip-lock bags. Clear, food-safe. Multiple sizes: 5x7cm to 30x40cm. Custom print available for 5000+.',
  'packaging',
  'pcs', 5000, 0.03, 0.22, 10, true, true
);

-- =============================================================================
-- SEED: PRODUCT ALIASES
-- Each product gets multilingual + variant aliases
-- =============================================================================

-- BAG-NW-CUST-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000001', 'custom printed shopping bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000001', 'non-woven bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000001', 'non woven bags', 'en', 'typo'),
  ('b0000000-0000-0000-0000-000000000001', 'nonwoven bags', 'en', 'typo'),
  ('b0000000-0000-0000-0000-000000000001', 'reusable shopping bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000001', 'custom bags', 'en', 'abbreviation'),
  ('b0000000-0000-0000-0000-000000000001', 'printed bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000001', 'promotional bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000001', 'pp bags', 'en', 'abbreviation'),
  ('b0000000-0000-0000-0000-000000000001', 'polypropylene bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000001', 'akyas tasawuq', 'ar', 'common'),
  ('b0000000-0000-0000-0000-000000000001', 'أكياس تسوق مطبوعة', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000001', 'شنط تسوق', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000001', '无纺布袋', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000001', '定制购物袋', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000001', 'bolsas de compras impresas', 'es', 'es'),
  ('b0000000-0000-0000-0000-000000000001', 'bolsas personalizadas', 'es', 'es');

-- LED-TL-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000002', 'led tea light candles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000002', 'flameless candles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000002', 'battery candles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000002', 'electric candles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000002', 'led candles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000002', 'tea lights', 'en', 'abbreviation'),
  ('b0000000-0000-0000-0000-000000000002', 'votive candles led', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000002', 'شموع led', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000002', 'شموع كهربائية', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000002', 'led蜡烛', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000002', '无焰蜡烛', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000002', 'velas led', 'es', 'es');

-- LED-STR-CW-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000003', 'led string lights', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000003', 'copper wire lights', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000003', 'fairy lights', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000003', 'twinkle lights', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000003', 'christmas lights', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000003', 'decorative string lights', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000003', 'أضواء خيوط led', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000003', 'أضواء مضيئة', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000003', 'led铜线灯', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000003', '串灯', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000003', 'luces navideñas', 'es', 'es');

-- STG-BOX-PP-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000004', 'plastic storage boxes', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000004', 'storage containers', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000004', 'plastic bins', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000004', 'stackable boxes', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000004', 'organizer boxes', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000004', 'صناديق تخزين', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000004', '收纳箱', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000004', '塑料储物箱', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000004', 'cajas de almacenamiento', 'es', 'es');

-- BTL-SS-500-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000005', 'stainless steel water bottles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000005', 'insulated water bottles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000005', 'vacuum flasks', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000005', 'thermos bottles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000005', 'custom water bottles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000005', 'branded water bottles', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000005', 'زجاجات مياه', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000005', 'ترمس', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000005', '保温水瓶', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000005', '不锈钢水壶', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000005', 'botellas de agua', 'es', 'es');

-- BAG-KP-GIFT-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000006', 'kraft paper gift bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000006', 'paper bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000006', 'kraft bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000006', 'paper gift bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000006', 'retail paper bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000006', 'أكياس ورقية', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000006', '牛皮纸袋', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000006', '礼品袋', 'zh', 'zh');

-- KIT-SIL-SET-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000007', 'silicone kitchen utensils', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000007', 'silicone cooking tools', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000007', 'kitchen utensil set', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000007', 'cooking utensils', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000007', 'silicone spatula set', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000007', 'أدوات مطبخ سيليكون', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000007', '硅胶厨具套装', 'zh', 'zh');

-- PEN-BP-PROMO-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000008', 'promotional pens', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000008', 'ballpoint pens', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000008', 'custom pens', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000008', 'branded pens', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000008', 'logo pens', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000008', 'advertising pens', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000008', 'أقلام ترويجية', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000008', '广告笔', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000008', '圆珠笔', 'zh', 'zh');

-- BAG-CNV-TOTE-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000009', 'canvas tote bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000009', 'cotton bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000009', 'tote bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000009', 'eco bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000009', 'canvas shopping bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000009', 'حقائب قماشية', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000009', '帆布袋', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000009', '棉布购物袋', 'zh', 'zh');

-- MUG-CER-350-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000010', 'ceramic mugs', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000010', 'coffee mugs', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000010', 'custom mugs', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000010', 'printed mugs', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000010', 'sublimation mugs', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000010', 'branded mugs', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000010', 'أكواب قهوة', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000010', '陶瓷杯', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000010', '定制马克杯', 'zh', 'zh');

-- UMB-FOLD-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000011', 'folding umbrellas', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000011', 'compact umbrellas', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000011', 'custom umbrellas', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000011', 'promotional umbrellas', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000011', 'logo umbrellas', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000011', 'مظلات قابلة للطي', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000011', '折叠伞', 'zh', 'zh');

-- ELEC-BT-SPK-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000012', 'bluetooth speaker', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000012', 'mini speaker', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000012', 'portable speaker', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000012', 'wireless speaker', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000012', 'custom speaker', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000012', 'مكبر صوت بلوتوث', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000012', '蓝牙音箱', 'zh', 'zh');

-- TEX-TWL-FACE-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000013', 'face towels', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000013', 'cotton towels', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000013', 'hand towels', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000013', 'terry towels', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000013', 'hotel towels', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000013', 'مناشف وجه', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000013', '毛巾', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000013', '纯棉面巾', 'zh', 'zh');

-- PKG-BUBL-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000014', 'bubble mailers', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000014', 'padded envelopes', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000014', 'bubble wrap envelopes', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000014', 'shipping envelopes', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000014', 'mailing bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000014', 'أكياس فقاعات', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000014', '气泡袋', 'zh', 'zh');

-- PKG-ZIP-001
insert into product_aliases (product_id, alias, language, alias_type) values
  ('b0000000-0000-0000-0000-000000000015', 'zip lock bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000015', 'ziplock bags', 'en', 'typo'),
  ('b0000000-0000-0000-0000-000000000015', 'resealable bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000015', 'plastic bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000015', 'poly bags', 'en', 'common'),
  ('b0000000-0000-0000-0000-000000000015', 'أكياس بلاستيكية', 'ar', 'ar'),
  ('b0000000-0000-0000-0000-000000000015', '拉链袋', 'zh', 'zh'),
  ('b0000000-0000-0000-0000-000000000015', '自封袋', 'zh', 'zh');

-- =============================================================================
-- SEED: PRODUCT IMAGES
-- Using placeholder URLs — replace with real Supabase Storage URLs
-- =============================================================================
insert into product_images (product_id, url, is_primary, label, sort_order) values
  ('b0000000-0000-0000-0000-000000000001', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/bag-nw-001-main.jpg',  true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000001', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/bag-nw-001-side.jpg',  false, 'side',  2),
  ('b0000000-0000-0000-0000-000000000002', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/led-tl-001-main.jpg',  true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000002', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/led-tl-001-group.jpg', false, 'group', 2),
  ('b0000000-0000-0000-0000-000000000003', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/led-str-001-main.jpg', true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000004', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/stg-box-001-main.jpg', true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000004', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/stg-box-001-stack.jpg',false, 'stack', 2),
  ('b0000000-0000-0000-0000-000000000005', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/btl-ss-001-main.jpg',  true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000006', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/bag-kp-001-main.jpg',  true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000007', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/kit-sil-001-main.jpg', true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000008', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/pen-bp-001-main.jpg',  true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000009', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/bag-cnv-001-main.jpg', true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000010', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/mug-cer-001-main.jpg', true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000011', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/umb-fold-001-main.jpg',true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000012', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/elec-spk-001-main.jpg',true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000013', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/tex-twl-001-main.jpg', true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000014', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/pkg-bubl-001-main.jpg',true,  'main',  1),
  ('b0000000-0000-0000-0000-000000000015', 'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/yiwuflow/products/pkg-zip-001-main.jpg', true,  'main',  1);

-- =============================================================================
-- REQUIRED: point product images at your project's storage bucket
--
-- The URLs above are placeholders. The image pipeline (Claude Vision) fetches
-- them over the public internet, so TC-006 / TC-007 fail until these resolve.
--
-- 1. Supabase → Storage → New bucket, name it `yiwuflow`, mark it PUBLIC.
-- 2. Upload your product photos under products/ using the filenames above.
-- 3. Run the UPDATE below with your project ref (Settings → API → Project URL,
--    the subdomain of https://<PROJECT_REF>.supabase.co).
--
-- To verify afterwards, open any product_images.url in a browser — it must
-- return the image without authentication.
-- =============================================================================

-- update product_images
-- set url = replace(url, 'YOUR_PROJECT_REF', 'abcdefghijklmnop');

-- Check for any placeholders left behind:
-- select id, url from product_images where url like '%YOUR_PROJECT_REF%';
