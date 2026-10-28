-- ---------------------------------------------------------------------------
-- 0218 — THE BOOKS ARE KEPT AS LONG AS THEIR COUNTRY'S LAW SAYS: THE UNITED KINGDOM AND SPAIN (the owner, 2026-10-28).
--
-- 0172 knew two countries (France and Morocco, ten years) and kept ten everywhere else. Read from the laws themselves:
--
--   · United Kingdom — six years. Corporation tax: records kept until "the sixth anniversary of the end of the
--     period" (Finance Act 1998, Sch. 18, para. 21). VAT: up to six years (Value Added Tax Act 1994, Sch. 11,
--     para. 6(3)). The Companies Act 2006, s. 388(4) (three years private, six public) and a sole trader's duty
--     (Taxes Management Act 1970, s. 12B(2): about five years ten months) are both shorter. Counted here from the END
--     of the financial year, so never too short. An open HMRC enquiry can extend it; Nomi cannot know of one.
--   · Spain — ten years, kept as it was, now with its own law. The Código de Comercio, art. 30.1, asks six years from
--     the last entry; but the Ley General Tributaria, art. 66 bis.2 and .3, lets the tax office check losses and
--     deductions carried forward for ten years, with the accounting behind them. Nomi cannot tell which businesses
--     carry any forward, so ten — the only figure never too short (the owner's decision).
--
-- France, Morocco and every country not on record keep ten. A workspace already HELD keeps the date it was given at
-- closure (`books_held_until`), and a paper keeps the `keep_until` written when it was attached: this changes what
-- is computed from now on, nothing already decided. The app role still only reads the table.
-- ---------------------------------------------------------------------------

insert into books_retention (country, years, law) values
  ('GB', 6, 'Finance Act 1998, Sch. 18, para. 21; Value Added Tax Act 1994, Sch. 11, para. 6(3): six years'),
  ('ES', 10, 'Ley General Tributaria, art. 66 bis: diez años para pérdidas y deducciones pendientes')
on conflict (country) do nothing;

insert into _migrations (version, name) values (218, 'books_retention_gb_es')
  on conflict (version) do nothing;
