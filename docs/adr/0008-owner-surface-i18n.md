# ADR-0008 — Owner-surface internationalization (en / zh / ar)

Status: Accepted (P1 foundation). Supersedes the implicit "owner surface is
Simplified-Chinese only" assumption from M9.

## Context
The buyer-facing side is already trilingual (`workingLanguages: ['zh','en','ar']`,
Arabic detection, per-turn `replyIn`). The **owner-facing** surface — the M9
Command Center and the owner's WhatsApp notifications — is hardcoded Simplified
Chinese, with the language baked into both renderers *and read models*
(`greetingZh`, `statusZh`, SQL that concatenates `'报价已发送 · ' || name`).

Owners now include English and Arabic speakers. We need en / zh / ar with a
switcher, Arabic RTL, and a default of **English**.

## Decision
1. **Language-neutral read models, localizing renderers.** Read models return
   codes/enums/counts/raw names (`greeting: 'morning'`, `status: 'promoted'`,
   `event.kind: 'quote_sent'`, `countryCode: 'AE'`), never pre-translated text.
   Renderers take a `locale` and translate via `t()`. This is the load-bearing
   rule; it is what makes more than one language possible at all.
2. **`Locale = 'en' | 'zh' | 'ar'`, default `en`.** Resolution order:
   owner cookie `yf_locale` → `Accept-Language` → `en`. Selection is a plain
   cookie (locale is not a secret) set by a public `/locale` route; a header
   switcher (English · 中文 · العربية) links to it with a `next` return path.
3. **One pure catalog + `t(locale, key, params)`** in `src/core/owner/i18n/`
   (stays inside the machine-checked pure core). Keys are namespaced
   (`nav.home`, `home.stat.inquiries`). `{name}`/`{buyer}` interpolation only.
   **English is the source of truth**: `type MessageKey = keyof typeof EN`, and
   `zh`/`ar` are typed `Record<MessageKey, string>` so a missing or extra key is
   a **compile-time** error — backed by a runtime completeness test (below).
4. **Arabic RTL** via `<html dir="rtl">` and direction-aware shell CSS (logical
   properties + `[dir="rtl"]` overrides); the sidebar and cards mirror.
5. **Localized formatting** (`src/core/owner/i18n/format.ts`): quantities use 万
   only in `zh` (Western grouping in en/ar); **currencies are never translated**
   (USD stays USD, ￥ stays ￥); dates/weekday names localize via `Intl`.
   Numerals stay Western (Arabic-Indic digits are avoided in a B2B trade UI).
6. **Employee name is a product constant per locale**, not env/DB-configurable:
   `{ zh:'小雅', en:'Lily', ar:'ياسمين' }`.
7. **Branding rename to "FLOWer" is out of scope here** — deliberately a separate
   change so it never mixes into the i18n foundation. The brand stays "YiwuFlow"
   until that task.

## Tests (enforced from P1)
- **Completeness**: every locale has an identical key set (runtime test); CI
  fails on a missing key (compile-time typing is the first gate, the test the
  second).
- **Banned technical vocabulary** (AI/LLM/model/token/api/webhook/模型/…) is
  checked in **every locale's** catalog values, not just Chinese.
- Renderers assert localized output + `dir="rtl"` for Arabic; the `/locale`
  route sets the cookie and round-trips.

## Consequences
- Migrating each page is a real refactor (read model → neutral, renderer → `t()`),
  not a string swap. P1 does the foundation + layout/login/home; P2 the rest of
  the Command Center; P3 owner WhatsApp notifications; P4 owner-facing docs only
  (internal engineering docs — ADRs, ops/incident/migration/security — stay
  English).
- Product names have `name` + `name_zh` only (no Arabic name); en/ar show `name`,
  zh prefers `name_zh`. A future Arabic product-name field can slot in later.
