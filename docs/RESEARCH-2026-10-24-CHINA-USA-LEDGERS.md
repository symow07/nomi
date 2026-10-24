# China, the USA, and the Chinese ledgers — research (2026-10-24, docs only)

The Block R addendum, Part 2 (the owner, 2026-10-23; re-sent 2026-10-24). **Research and a plan only: no code.** China
and the USA are **RESEARCHED** countries (PHASE-5.md §1b): the primary sources are read and the defaults written down;
nothing is BUILT until there is a real customer there.

**How to read the marks:**
- **READ:** read in the source itself on 2026-10-24.
- **REPORTED:** only a search snippet or a secondary page said it.
- **NOT CONFIRMED:** no source read says it.

From this machine openstd.samr.gov.cn, std.samr.gov.cn and chinatax.gov.cn timed out; gov.cn and mof.gov.cn loaded.

---

## 1 · China (first, by the owner's order)

### 1.1 · The 统一社会信用代码 (Unified Social Credit Code), GB 32100-2015

**Is the check character's algorithm published in the standard? YES.**

It was read in the standard's own text: "2016年7月第二版", with Amendment No. 1 bound in, 12 pages. The copy read is
https://upload.wikimedia.org/wikipedia/commons/2/25/GB_32100-2015.pdf. It is labelled as taken from openstd's page
for the standard (https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=24691C25985C1073D3A7C85629378AC0), which could
not be opened to compare: that provenance is REPORTED.

- **The characters (§4.1):** "统一代码由十八位的阿拉伯数字或大写英文字母(不使用I、O、Z、S、V)组成" — eighteen
  digits or capitals, never I, O, Z, S, V.
  - Position 1: the registering department. Position 2: the kind of organisation. Positions 3–8: the administrative
    area (GB/T 2260). Positions 9–17: the organisation code (coded per GB 11714). Position 18: the check character.
  - Each character's value is in Appendix A, Table A.1: 0–9 are 0–9, then A=10 … H=17, J=18 … N=22, P … R=25, T, U,
    W, X, Y=30.
- **The formula (§4.2.5), "参照 GB/T 17710":**
  - C18 = 31 − MOD(Σᵢ₌₁¹⁷ Cᵢ × Wᵢ, 31), with Wᵢ = MOD(3^(i−1), 31).
  - The weights (Table 4) are 1 3 9 27 19 26 16 17 20 29 25 13 8 24 10 30 28.
  - "当 MOD 函数值为1(即C18=30)时,校验码应用符号 Y 表示;当 MOD 函数值为0(即C18=31)时,校验码用0表示".
  - **Re-computed here:** the standard's worked example (Appendix B), 91350100M000100Y4, sums to 1640, MOD 31 = 28,
    so the check character is 3: **91350100M000100Y43**. The arithmetic holds; the appendix's wording has a slip
    ("字符值18对应的字符为3").
- **Mandatory, in the part that matters.** The foreword: "本标准第4章为强制性的,其余为推荐性的" — Chapter 4, which holds
  the structure and the check formula, is mandatory. READ.
- **The organisation code inside it (9–17)** has its own check in GB 11714, which was not read: NOT CONFIRMED here.
- **What this decides:**
  - The USCC is **the first identifier in this sweep whose check is published by its authority.** When China is BUILT,
    it may be HARD-validated: a wrong check character is refused, not warned about.
  - That is unlike France's SIREN Luhn sum and Spain's NIF control character (R3), which no authority publishes and
    which are warnings only.
  - Nothing is built now: this is a docs-only PR.

### 1.2 · GB/T 24589 (财经信息技术 会计核算软件数据接口)

- **Its parts (REPORTED,** from snippets of the openstd and std.samr pages, which would not open):
  - .1-2024 for enterprises: in force from 2025-07-01, replacing .1-2010.
  - .2-2010 for administrative and public institutions: current.
  - .3-2011 for general budget accounting: abolished.
  - .4-2011 for commercial banks: current.
- **Mandatory or voluntary? VOLUNTARY as a standard.** It is a GB/T, a recommended national standard, and no Ministry
  of Finance rule read names it. What IS binding is that accounting software offer an interface to "国家统一标准" — a
  national unified standard, unnamed:
  - **《会计软件基本功能和服务规范》, 财会〔2024〕12号** (2024-07-29, in force 2025-01-01). READ:
    https://www.gov.cn/gongbao/2024/issue_11606/202409/content_6976924.html
    - Art. 29: "会计软件应当具有符合国家统一标准的数据接口，满足系统功能拓展、与外部系统对接和监督需要".
    - Art. 41 (cloud services): "会计软件服务商应当提供符合国家统一标准的数据接口供用户导出电子会计资料，不得以任何理由拒绝用户导出
      电子会计资料的请求" — the provider must let users export their electronic accounting records through such an
      interface, and may never refuse.
    - Art. 30 only *encourages* output in a "标准格式".
    - Software in use before 2025-01-01 has three years to comply (the covering notice).
    - *The brief named this rule "财会〔2023〕18号". No rule under that number was found; the 规范 is 财会〔2024〕12号.*
  - **《会计信息化工作规范》, 财会〔2024〕11号.** READ:
    https://www.gov.cn/gongbao/2024/issue_11586/202409/content_6975086.html
    - Art. 23: units "应当遵循国家统一的会计数据标准".
    - Art. 26: systems "应当适配电子凭证会计数据标准…生成符合标准的入账信息结构化数据文件".
    - The Ministry's Q&A (READ: http://m.mof.gov.cn/zcjd/202408/t20240806_3941155.htm) puts the weight on the
      **electronic-voucher accounting data standard** (nine voucher types, fapiao among them), not on GB/T 24589.
- **Does it set a FILE NAME, an ENCODING or a SEPARATOR?**
  - **File name:** NOT CONFIRMED — the standard's text could not be read; the Ministry's rules set none.
  - **Encoding:** NOT CONFIRMED — likewise; the rules set none.
  - **Separator / format:** NOT CONFIRMED. A secondary source (a software vendor's documentation of its own 2010
    export) describes several XML files built from XSD schemas, which would mean no separator at all. Not read in
    the standard.
- **The default, until the text is read:** whatever Nomi writes for China would be **its own default, configurable,
  and never called "required"** — the R2 rule.
- **What is needed before China is BUILT:** the text of GB/T 24589.1-2024 itself. Whether it is free to read on
  openstd (many GB/T are, some are sold) is NOT CONFIRMED. 💰 if it must be bought — the owner's.

### 1.3 · Fapiao (发票) and the Golden Tax system: PREPARE ONLY

**The rule, unchanged:** Nomi prepares; it never files and never issues a fapiao on anyone's behalf. The owner issues
them.

- **The fully digital e-fapiao (数电票), nationwide from 2024-12-01:** 国家税务总局公告2024年第11号 (2024-11-12). READ:
  https://www.gov.cn/zhengce/zhengceku/202411/content_6989164.htm
  - Art. 5: "税务机关建设全国统一的电子发票服务平台，提供免费的数电发票开票、用票服务" — one national platform, run
    by the tax authority, free.
  - Art. 7: issuing requires "实人认证等方式进行身份验证" — the issuer's own identity, verified in person.
  - The explainer (READ: https://www.gov.cn/zhengce/202411/content_6989260.htm): invoices are delivered as XML, PDF
    or OFD.
- **Third-party software that issues is regulated:**
  - 《发票管理办法》 as amended (国务院令第764号), art. 22 §3. READ:
    https://www.gov.cn/zhengce/zhengceku/202308/content_6899249.htm
    - "单位和个人开发电子发票信息系统自用或者为他人提供电子发票服务的，应当遵守国务院税务主管部门的规定"
  - Its implementing rules (令第56号), art. 32. READ: https://www.gov.cn/gongbao/2024/issue_11286/202404/content_6945583.html
    - A system serving others "应当符合税务机关的数据标准和管理规定，并与委托人签订协议，不得超越授权范围".
  - **Why prepare-only matters here:** issuing, even "as a service", brings Nomi under these rules. Preparing data that
    the owner issues on the platform does not.
- **What Nomi could prepare for the owner:**
  - The platform has a bulk-issue import, 《批量导入开具发票模板》, an Excel template downloaded inside the
    电子发票服务平台 (蓝字发票开具 → 批量开具): one 流水号 (serial number) per invoice, its lines sharing it. This is
    REPORTED, from snippets of the Shanghai and Beijing tax bureaus' guides.
  - **Its columns are NOT CONFIRMED**: the template is only inside the platform, behind the owner's own login.
  - Building it waits for the owner to download the template.
- **乐企 (direct connection):** for large enterprises only (high tax credit, revenue thresholds; per province) —
  REPORTED. It is not a path for Nomi's shops, nor for Nomi.

## 2 · The USA (short, as the owner asked)

- **No national audit file.** No national standard file like the FEC or the OECD's SAF-T was found. The closest
  primary source is **Rev. Proc. 98-25** (machine-sensible records). READ: https://www.irs.gov/node/4437
  - Records "must provide sufficient information to support and verify entries made on the taxpayer's return"
    (§5.01(2)), with "sufficient transaction-level detail" (§5.01(3)), and be made available on request (§5.01(4)).
  - The taxpayer documents its OWN "record formats or layouts" (§6.03).
  - The procedure prescribes no layout: that is read from what it requires, since no sentence says "no format".
- **The EIN:** "a nine-digit number the IRS issues … arranged as follows: 00-0000000" (Publication 15, READ:
  https://www.irs.gov/publications/p15).
  - The IRS publishes the valid **prefixes**, the first two digits, by campus. READ:
    https://www.irs.gov/businesses/small-businesses-self-employed/how-eins-are-assigned-and-valid-ein-prefixes
  - **No check digit** is published: none is assumed. When built: the shape, and the prefix list as a warning.
- **Sales tax is per state;** there is no federal VAT or sales tax.
  - Since *South Dakota v. Wayfair* (2018), a state may require a remote seller to collect its tax (South Dakota's
    Department of Revenue, READ: https://dor.sd.gov/businesses/taxes/sales-use-tax/; its threshold is more than
    $100,000 of sales into the state).
  - A federal page saying "no federal sales tax" in so many words: NOT CONFIRMED.
  - The USA is RESEARCHED; nothing is planned to be BUILT.

## 3 · The Chinese ledgers: Yonyou (用友) and Kingdee (金蝶)

**What could be read.** Kingdee's developer portals (open.kingdee.com, open.jdy.com) and Yonyou's (open.yonyou.com,
open.yonyoucloud.com) refused the connection, or are script-only. Yonyou's small-business arm **Chanjet (畅捷通)**
(open.chanjet.com) could be read. So Chanjet's facts are READ, and most of the rest are REPORTED or NOT CONFIRMED.
**They need a second reading from a browser before any build.** Facts only about what exists and what it costs —
nothing about any product's quality or compliance (CLAUDE.md §2); notes of that kind are kept outside the repo.

### 3.1 · Chanjet (Yonyou): T+, 好会计, 好业财, 易代账 — READ on open.chanjet.com

- **API: yes.** For 好会计:
  - vouchers — create, list, detail, modify, delete;
  - accounts and opening balances;
  - one list of trading partners (往来单位) for both customers and suppliers.
  - T+ has the same three.
  - Tax rates: NOT CONFIRMED.
- **Auth: OAuth 2 authorisation code, per enterprise.**
  - The access token "过期时间为6天" (six days).
  - The refresh token "有可能…变更" (may change: keep the new one each time), "限额调用 1000次/日" (1,000 calls a
    day per refresh token).
  - **The app also needs an `appTicket` that Chanjet PUSHES to the developer about every ten minutes.**
  - A revoke endpoint: NOT CONFIRMED. A push, `APP_CANCEL_AUTHORIZATION`, says when the customer withdrew it.
- **Changed since:** no modified-since filter on the voucher list: NOT CONFIRMED.
- **Pushes:** for authorisation, orders and app events only; nothing when a voucher or a record changes.
- **Cost** (the platform's rules, in force from 2026-08-01):
  - each enterprise has **30,000 free API calls a month**;
  - beyond that the developer buys packs: **¥200 for 100,000** up to ¥10,000 for 10 million, or **¥0.01 a call**.
  - 💰 past the free calls.
- **Registration:** a marketplace app needs "企业认证（填写企业部分信息）" (enterprise verification) and a
  qualification review. A self-built app is only for "已购畅捷通应用的企业成员" (members of an enterprise that bought a
  Chanjet app). Whether a FOREIGN developer can register: NOT CONFIRMED.
- **Without the API:** opening balances are imported from the product's own template (设置-科目期初-导入/导出; the
  chart first) — REPORTED, from the product manual.

### 3.2 · Yonyou YonSuite / YonBIP

- A self-built app gets a token from `open-auth/selfAppAuth/getAccessToken`: an app key, a timestamp and an
  HMAC-SHA256 signature. It lasts two hours ("expire": 7200). REPORTED: from a public code sample under a GitHub
  organisation that looks like Yonyou's, which is not confirmed.
- An OAuth flow a shop can grant to a third-party app: NOT CONFIRMED.
- Revoke, what the API covers, writing vouchers, changed-since, pushes, limits, cost, editions and registration: NOT
  CONFIRMED.

### 3.3 · Kingdee 精斗云 (JDY) / 星辰

- REPORTED only (developer blogs):
  - a token per account set (账套) from `jdyconnector/app_management/kingdee_auth_token`, signed with HMAC-SHA256;
  - calls are charged;
  - a developer registers, is verified and subscribes.
- The portal itself, open.jdy.com ("小微生态门户网站"), is script-only.
- Everything else: NOT CONFIRMED.

### 3.4 · Kingdee 云星空 (Cloud Cosmic)

- REPORTED (secondary sources):
  - the shop's administrator creates a "第三方系统登录授权" (third-party login authorisation): an app ID, an app secret
    and an integration user;
  - login is `LoginByAppSecret` with the 数据中心 (the account set);
  - records are read by form through `ExecuteBillQuery`.
- There is no OAuth flow in what was found.
- Vouchers through it, writing, a modified-since filter, pushes, limits and cost: NOT CONFIRMED.

### 3.5 · Do they fit the connector shape? (the owner's question)

The shape (src/core/books/connector.ts): **config** (what the owner gives) · **auth** (connect, refresh, revoke) ·
**mapper** (accounts, parties, taxes, entries, both ways) · **sync** (changed since a cursor).

| | Config | Auth | Mapper | Sync |
|---|---|---|---|---|
| **Chanjet** (Yonyou SMB) | ✓ the OAuth code, as Xero's | ✓ OAuth with a rotating refresh token: Xero's `rotateGrant` already handles that. ✗ **no revoke found**, so the stale-grant rule cannot be met by revoking; the owner withdraws it in Chanjet, which pushes `APP_CANCEL_AUTHORIZATION` | ✓ vouchers, accounts and partners both ways. ? tax rates not found. ⚠ customers and suppliers are ONE list, and 辅助核算 (auxiliary dimensions) has no place in Nomi's books | ⚠ no changed-since: read everything each time, as Sheets does (the shape allows it: "a system without history hands in everything"). It costs calls: 30,000 free a month per enterprise |
| **Kingdee 云星空** | ✓ a key the shop's administrator makes, plus the account set (数据中心): Odoo's shape (an address, a database, a key) | ✓ as Odoo: nothing to refresh, and nothing Nomi can give back — the owner deletes it in Kingdee (the Odoo line on disconnect) | ? reported only | ? NOT CONFIRMED |
| **Kingdee JDY**, **Yonyou YonSuite** | ? | ? a signed app key and secret per account set, reported — if that is all, the DEVELOPER holds the key, not the shop | ? | ? |

**What breaks, plainly:**
1. **Chanjet's pushed `appTicket`.**
   - Every connector today is called by Nomi; none receives anything.
   - Chanjet needs a public endpoint that Chanjet calls every ten minutes, kept per app, before any call can be made.
   - That is new: an inbound webhook for a ledger, as the channels have.
2. **No revoke (Chanjet, Kingdee).**
   - The stale-grant rule (#386) gives a grant back at the system; here there is nothing to call.
   - It falls back to Odoo's rule: Nomi forgets the grant, and the owner withdraws it there. The page says so.
3. **Registration may be closed to a foreign developer.**
   - Both registrations ask for enterprise verification.
   - If that means a Chinese business licence, Nomi cannot register at all.
   - That is the real blocker, and it is the owner's to find out: it needs an account, which Claude does not create.
4. **Calls cost money past the free tier** (Chanjet) — 💰.
5. **Customers and suppliers in one list** (Chanjet) and **auxiliary dimensions**: the mapper must split them, and
   say what it cannot carry, as Xero's "what Xero holds" does.

**The fallback where there is no API:** an import file. The owner exports from the ledger and Nomi reads it, as the
Excel workbook (B2) does — if a national file format (GB/T 24589) is the export, through that, once its text is read.
NOT CONFIRMED for any product, in public. *(A vendor's own words on this are in the owner's private notes.)*

**The plan:** no Chinese connector until a real customer in China (the tiers). When one comes, in this order:
1. Re-read the portals from a browser.
2. The owner registers, or finds out that a foreign developer can't.
3. The import-file fallback first: it needs no registration.
4. Chanjet's API next, if the registration works.

## 4 · What needs the owner

1. **The text of GB/T 24589.1-2024**: free on openstd or bought (💰) — before any Chinese export is built.
2. **The fapiao platform's bulk-issue template**: downloaded from inside the 电子发票服务平台 by someone who signs in
   there. Only if a Chinese customer needs prepared fapiao data.
3. **Chanjet / Yonyou / Kingdee developer registration** — an account, so the owner's. First question: can a foreign
   company register at all?
4. Nothing here costs money now. Chanjet's calls past 30,000 a month per enterprise would.
