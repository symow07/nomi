# Positioning inventory: words that assume export trade

_Recorded 2026-09-28 at `5957e19` (#120), by nine readers and three sweeps over the tree. **Nothing has been rewritten yet** — the owner's order: inventory first (CLAUDE.md §0). When copy is rewritten, work from this list and strike what is done._

Nomi is not a tool for Yiwu factories. It is for anyone who sells or talks to customers over social media: clothing and cosmetics brands, online stores, startups, agencies, as well as exporters and factories. Global, not China-specific. The common thread is social media as the sales channel, not manufacturing. This inventory lists every place where the product still assumes an export factory, and what to say instead.

## Summary

| Who sees it | Entries found | Distinct after merging duplicates |
|---|---|---|
| Customer-facing: chat replies, the price page, order text, legal pages | 36 | 27 |
| Model instructions: the prompts, plus the notes that code sends the model | 55 | 52 |
| Owner-facing: the app, alerts, addresses, Practice, demo data, help drafts, internal docs | 499 | ~463 |
| Site: nomidoes.com copy, plus a marketing draft that is not served | 37 | 21 |
| **Total** | **627** | **~563** |

- **Cannot go neutral: 105 entries (about 96 distinct).** No new word fixes these. Each needs a condition that depends on the kind of business (§5).
- **One swap does most of the work.** Changing "buyer" to "customer" fixes 198 owner keys, 12 site keys and several prompts.

**The five most visible problems**
1. **The main list is called "Buyers".** The word is in the nav, on every conversation, in the alerts and in the site headline (`nav.inbox`, `common.buyer`, `site.hero.title`).
2. **A customer cannot get a price without naming a quantity.** The code gives a price only once both product and quantity are known (`turn.ts:330`). The prompt then has the assistant ask: "roughly how many pieces are you looking at?"
3. **Prices can only be in US dollars or yuan** (`money.ts:41`). The owner's price boxes say US$, and the exchange rate only converts $ to ￥.
4. **Every time and date is China time** (`BUSINESS_TZ = 'Asia/Shanghai'`). A shop in London sees a message sent at 15:40 as 23:40.
5. **Everything is counted in "pcs" and has a "Min. order".** This shows on every product row, every quantity and the customer's price page. An imported product with no minimum gets a minimum of 100.

**Decisions that are yours**
1. **Arabic word for "customer".** Going back to عميل / العملاء reverses #111, which chose مشترٍ. Every Arabic suggestion below assumes you say yes.
2. **zh/ar "company" (公司 / شركة, 33 keys).** It is not a trade word, but a one-person shop is not a company.
3. **Whether to build the kind-of-business switches in §5.** About 96 items depend on them.
4. **Giving a price at quantity 1 for products with a single price.** This is a code change in `turn.ts`. Without it, neutral prompt wording leaves the assistant with no price to give.

---

## What a customer sees

Anything that varies by business is in §5. That covers the minimum-order and price-band rows, the below-minimum replies, the proforma title, the delivery term, the sample credit, and the e-mail asked for before an order. In the tables, "—" means no suggestion was given or the text is already neutral.

### Chat replies written in code (sent word for word)
These come from `src/core/conversation/templates.ts`, `fastpath.ts`, `src/core/commerce/orderState.ts` and `src/core/safety/injection.ts`. **All are English only, whatever language the customer writes in.** The fast path is the exception: it also has zh, ar and es.

| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `templates.ts:76` hand-off reply | "one of our specialists will follow up with you personally, shortly." | "someone from our team will reply to you personally, as soon as they can." | — | **High visibility.** It assumes a sales team, which a solo brand does not have. `response.txt:92` says the same. |
| `templates.ts:29-31` order confirmed | "…The factory will send you the proforma invoice." | "…We'll send you the invoice next." | — | |
| `fastpath.ts:59-63` product confirmed | "Now, roughly how many pieces are you looking at?" | "How many would you like?" | 请问需要多少？ / ما الكمية المطلوبة؟ | The es line has the same problem ("piezas"). |
| `templates.ts:44` quantity missing | "How many pieces should I put on the order?" | "How many would you like?" | — | It says "pieces" whatever the product's own unit is. |
| `orderState.ts:115, 124` order status | "Order {ref} is in production as of {when}." | "Order {ref} is being prepared as of {date}." | — | The date is worked out in Shanghai time and always formatted in English (§5 › Time zone). |
| `templates.ts:93-99` stand-in reply after two failed checks | "the unit price is … with a lead time of {n} days." | "{price} each, {total} in total, ready in {n} days." | — | |
| `injection.ts:48-49` safe fallback | "what products are you looking to source today?" | "what are you looking for today?" | — | |

### Prices and currency
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `money.ts:41`, `priceRules.ts:9` | A price can only be in USD or CNY, and the owner's boxes are always USD. | The business's own currency (€, £, AED, ₹ …), chosen once. | — | **High visibility.** Needs a currency setting for each business (§5). |

### Price page (`/p/:token`)
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `proof.quote.title` | This quote | This price (or: Your price) | 这次的价格 / هذا السعر | Found by two readers. |
| `proof.fact.leadTime` | Lead time (zh 交期) | Delivery time (or: Ready in) | 交付时间 / — | |
| `proof.source.catalogue`, `.taught`, `.authorised`, `proof.footer.explain` | "From the company's product list" … | "From the business's own product list" … | 公司 → 商家 / — | |
| `proof.leadTime.withheld` | "Not yet — the company is closed for {label}…" | "Not yet — closed for {label}, {from} to {to}" | 暂定不了——{label}休息… / لم يُحدَّد بعد — إغلاق بسبب {label}… | |

### Order text the owner copies to the customer (`src/core/commerce/invoice.ts`)
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `invoice.ts:80` | Buyer: {name} | Customer: {name} | — | |
| `invoice.ts:94` | Lead time: {n} days | Ready in: {n} days | — | Not shown yet, because `orders.ts` passes null. |

### Legal pages (served: `/privacy`, `/terms`, `/data-deletion`)
These are already almost neutral: they say "the people who write to a business" and 商家. Only three keys need a change, plus one comment in the page source.

| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `legal.privacy.howLong.body` | "…what was agreed with you — a price, an order, a sample." | "…such as a price or an order." | 比如价格或订单 / كسعر أو طلب | |
| `legal.deletion.erased.prepared` | "Replies, quotes and sample requests prepared for you." | "Replies prepared for you, and any price offers or sample requests." (other reader: "Replies, prices and requests prepared for you.") | 为你准备的回复，以及任何给你的价格或样品申请 / الردود المُعدّة لك، وأي عروض أسعار أو طلبات عيّنات | It must still name what `erase-buyer` erases (rule 15), and `deletion-page.test.ts` pins this text. One reader left the ar open: طلبات also means "orders", which this page says are kept. Needs a native read. |
| `legal.terms.ours.we1` | "A price Nomi quotes … never below the floor you set." | "A price Nomi gives … never below the lowest you set." | Nomi 给出的价格…最低价 / — | |
| `legal.ts:55` HTML comment (ships in the page source) | "Who a buyer is actually talking to…" | "Who the person writing in is actually talking to…" | — | |

### What the assistant is told to say (prompts)

**Four rules in code, not in the prompts, decide whether a price can be given at all:**
- **Product and quantity:** a price exists only once both are known (`turn.ts:330`), and any figure that is not in that price is blocked (the number check).
- **Quantity tiers:** the price comes from quantity tiers (`selectTier`).
- **Minimum order:** a quantity below the product's minimum is refused (`quote.ts:107`, `confirmable.ts` rules 3–4).
- **E-mail:** no order is confirmed without an e-mail address (`confirmable.ts` rule 7).

The quantity tiers and the minimum order are the trade assumptions that pricing rests on. Neutral wording alone would leave a single-price shop with nothing to say.

The prompt rules that hold the price back until a quantity is given are listed in §5 › 2.

Three more things to know before editing prompts:
- **Phase names:** `warm_intake` … `confirmation` are stored in `conversations.phase`. Describe them in plain words in the prompt; renaming them needs a migration.
- **The analysis prompt reaches customers:** its next question is sent to the customer word for word when writing fails (`turn.ts:673`).
- **Live check:** re-run `tools/check-person-model.mjs` before and after any change to `analysis.txt` (rule 19).

The prompts are English only, so there is no zh/ar column.

**`prompts/analysis.txt`**
| Where | Today | Suggested | Note |
|---|---|---|---|
| `:1` role line | "sells to buyers … inbound buyer inquiries" | "talks to its customers … each message a customer sends" | |
| `:10` + `anthropic.ts:107` catalogue line | Every product is sent with `MOQ:n`. | Add `min:N` only when the minimum is above 1. | **High visibility**: the model reads this on every turn. The prompt also says a price is sent; none is. |
| `:25` language list | en / ar / zh / es / fr / ru / tr / pt / hi / id / ms / vi | "the ISO-639-1 code of the language they wrote in (en, ar, zh, es, fr, de, ja, …)" | A German or Japanese customer comes out as "unknown". |
| `:52` quantity_unit | pcs / sets / boxes / kg / cartons | "the unit in their own words (items, pairs, bottles …)", defaulting to 'items' rather than 'pcs' (`anthropic.ts:192`) | This unit reaches the customer. |
| `:55` destination_country | "country name or null" | Remove it (nothing reads it), or rename it to `delivery_place`. | It nudges the model to ask where the goods are going. |
| `:65` advance_blocked_by | missing_quantity, missing_email | missing_details, missing_contact | Nothing reads it. |
| `:89` next question | "Must NOT mention price, MOQ, or payment unless…" | "Must NOT state a price, a minimum or payment terms: those come only from the business's own figures" | **High visibility.** |
| `:62`, `:93-99` phase names | warm_intake / clarification / qualification / commercial_discussion / confirmation | Keep the ids and describe each one in plain words. | **High visibility.** The ids are stored. |
| `:98` confirmation | "collecting final confirmation + email" | "a final yes and a way to reach them" | The code still requires an e-mail (§5 › 8). |
| `:77` example | "a real person from our company will visit you" | "a real person from our team will pick up the order" | |
| `:79` example | 我们在找人工成本低的工厂 (sourcing a factory) | 这款有没有人工香精？ | Run the live check afterwards. |

**`prompts/response.txt`**
| Where | Today | Suggested | Note |
|---|---|---|---|
| `:1` (also 4, 6, 9, 11, 14) | "You answer buyers…" | "You answer customers…" | |
| `:37` | product_price_usd: unit price in USD | quote.currency, quote.unit_price, … | Stale: this key is never sent. |
| `:36, 38, 39` | product_moq, product_lead_time, product_customizable | List the fields that are actually sent. | Stale. |
| `:48` closure_note | "…and state no lead time." | "…and give no delivery time." | |
| `:50` LEAD TIME rule | Uses the term "lead time". | "TIMING: say how many days, in plain words ('ready in 5 days'), never the term 'lead time'" | The rule itself stays. |
| `:63` clarification | "materials, size, color, or any distinguishing specs" | "whatever tells the options apart (size, colour, shade, version)" | |
| `:71` | "destination / port" | "where it should be delivered, if that matters" | |
| `:73` price redirect | "Let me get a feel for the quantity first — roughly how many pieces are you looking at?" | "Which one would you like? Then I can tell you the price." | **High visibility.** The model copies this almost word for word. |
| `:74` goal | "understand order size and seriousness" | "know enough to give the right price" | |
| `:77` commercial discussion | "discuss price, MOQ, lead time, payment terms" | "give the price, and a minimum or timing only when CONTEXT.quote has them" | **High visibility.** |
| `:79` discount | "acknowledge and give a range" | "acknowledge it, promise nothing, mention only a discount CONTEXT.quote shows" | The number check blocks "a range". |
| `:80` example | "For 5,000 pcs, price is USD 0.38/pc. MOQ is 2,000 pcs." | "That's 12.00 each, 24.00 for the two." | **High visibility.** |
| `:81` | "Ask for email to send formal quotation" | "If the order needs their contact details and you don't have them, ask. Never promise to send anything." | **High visibility.** It contradicts `:88`. |
| `:85` | "Confirm: product, quantity, price, email" | "the product, the details that matter, the price, how to reach them" | |
| `:87` example | "5,000 custom printed shopping bags at USD 0.38/pc" | "2 of the rose lip oil at 12.00 each, 24.00 in total" | |
| `:92` escalated | "a specialist will follow up" | "a person from the business will reply" | |
| `:117-119` confirm_order | "quantity >= MOQ / email address present" | "at least CONTEXT.quote.moq / a way to reach them is known" | The code enforces both rules. |

**`prompts/image_analysis.txt`**
| Where | Today | Suggested | Note |
|---|---|---|---|
| `:1` | "…sells to buyers… sent by a buyer" | customers | |
| `:4`, `:57` | "A product the buyer wants to order" | "…the customer wants to buy" | Nothing reads `clarification_suggestion`. |
| `:6` | "A reference image from another supplier" | "A photo or screenshot of something they saw elsewhere (another shop, a post, an ad)" | |
| `:24` material | plastic / metal / fabric / paper / glass / ceramic / silicone | "the main material or texture in a word or two (cotton, leather, cream, powder …)" | This feeds product matching. |
| `:46-49` examples | tea lights, non-woven bags, vacuum bottle, kraft gift bag | lipstick, hoodie, water bottle, gift bag | |
| `:51` | Selfies and screenshots count as "unusable". | A screenshot of a post, or a photo of someone wearing the product, still counts. | Social media customers send exactly these. |
| `anthropic.ts:313` | "Buyer caption:" | "Customer caption:" | |

**Notes the code sends the reply writer**
| Where | Today | Suggested | Note |
|---|---|---|---|
| `closures.ts:75-76` closure note | "The factory is closed for {label}… Do not state or estimate a lead time." | "We are closed for {label}… Do not state or estimate how long it will take." | The model repeats "our factory is closed" to customers. Found by two readers. |
| `templates.ts:72` no price for this quantity | "…a human must quote." | "There is no price set for this yet. Do not give one; say someone from the team will confirm the price." | It is passed as `next_question`, so it can reach the customer. |
| `anthropic.ts:252-253` quote keys | `"moq": 1` is sent even for a shop selling single items. | Send the minimum only when it is above 1. | |

**`prompts/order_validation.txt`**: no code ever loads this file. It says "a B2B export business" (`:1`) and uses USD fields and risk bands (`:42-43, 56-58`). Suggested: delete the file.

---

## What the owner sees

### Mechanical swaps: one word, the same fix everywhere
A key can sit in more than one row, because the fixes add up. Keys that also need a judgement call have their own rows further down and are not repeated here.

| Word today | Replace with (en / zh / ar) | Count | Keys |
|---|---|---|---|
| **buyer** / 买家 / مشترٍ, المشترون | customer / 客户 / عميل, العملاء | **198** | **Nav and lists:** `nav.inbox`, `nav.channels`, `nav.prospects`, `prospects.title`, `common.buyer`, `inbox.detail.back`, `buyers.tabs`, `buyers.search.label`, `buyers.empty.calm`, `buyers.group.deletion`, `inbox.empty.deletion`, `calendar.buyer.choose`, `calendar.buyer.chosen`, `calendar.buyer.label`, `calendar.buyer.all`, `calendar.empty.door`, `insight.action.seeBuyers`. **Today and alerts:** `live.message`, `today.calm.body`, `today.calm.notLive.title`, `today.stopped.body`, `today.silenced.body`, `ops.card.blocked`, `ops.activity.handled`, `insight.uncertainSends`, `insight.productsNoPrice`, `insight.monthChange.inquiries.up`, `insight.monthChange.inquiries.down`, `notify.handoff`, `notify.deletion_requested`, `notify.deletion_requested.subject`, `data.deletion.scope.buyer`. **Conversation page:** `conv.file.title`, `conv.file.nameHint`, `conv.needCard`, `conv.notFound`, `conv.tl.buyer_text`, `conv.tl.lead_hot`, `conv.assistant.label`, `conv.assistant.flash.changed`, `conv.assistant.flash.same`, `conv.deletion.title`, `conv.deletion.lead`, `conv.deletion.ask`, `conv.deletion.tell`, `conv.deletion.done`, `conv.deletion.flash.note_missing`, `conv.deletion.note`, `conv.deletion.dismissHint`, `deletionAsked.noted`, `deletionAsked.why`, `deletionAsked.do`, `staff.deletionAsked`, `takeover.replyPlaceholder`, `takeover.reason.human_requested`, `takeover.reason.repeated_ambiguity`, `takeover.reason.media_unreadable`, `takeover.reason.deletion_requested`, `unheard.do.transcription_failed`, `unheard.do.unsupported_format`, `unheard.do.no_media`, `unreadable.what`, `unreadable.do`, `unlisted.why`, `voice.correct`, `voice.correctPlaceholder`, `spotcheck.buyerSaid`, `proof.owner.none`, `proof.owner.live`, `proof.owner.flash.issued`, `samples.asked.title`, `samples.requests.address.placeholder`, `inbox.draft.held.identity_denial`, `inbox.draft.held.identity_question`, `inbox.draft.held.disclosure_sent`, `inbox.flash.sentNotLive`, `inbox.flash.skipped`, `inbox.blocked.not_connected`, `inbox.blocked.not_allowlisted`, `inbox.blocked.window_closed`. **Did not send:** `refused.title`, `refused.none`, `unsure.why`, `refused.what.window_closed`, `refused.why.window_closed`, `refused.do.window_closed`, `refused.what.window_needs_owner`, `refused.do.window_needs_owner`, `refused.why.subject_missing`, `refused.do.subject_missing`, `refused.what.not_allowlisted`, `refused.why.daily_ceiling`. **My business and going live:** `factory.next.channels`, `factory.next.first_success`, `activation.can`, `activation.cannot`, `activation.action.deactivateConfirm`, `activation.stop.what`, `activation.blocker.assistant_not_named`, `golive.other.live`, `golive.whatsappOnly`, `golive.none`, `assistant.stop.running`, `assistant.stop.stopped`, `assistant.stop.action.startConfirm`, `assistant.silenced.note`, `allowlist.none`, `factory.ready.title`, `factory.ready.live`, `factory.rehearsal.lede`, `factory.about.empty`, `factory.promise.title`, `factory.promise.certsOn`, `factory.promise.never`, `factory.reach.title`, `factory.reach.q`, `factory.reach.nextConnected`, `factory.reach.nextReady`, `factory.reach.nextNot`, `factory.reach.other.notConnected`, `channel.state.not_connected.hint`, `pilot.intro`, `pilot.item.channel`, `pilot.blocker.channel`, `pilot.attest.assistant_named`, `pilot.assistant.hint`, `pilot.assistant.problem.name_missing`, `meta.intro`, `meta.live`, `feedback.none`, `runbook.practice.intro`, `runbook.step.buyer`, `runbook.after.intro`. **Channels:** `channel.whatsapp.desc`, `channel.connect.configured`, `channel.flash.connected`, `channel.connect.intro`, `connect.mail.google.what`, `connect.mail.read.tick`, `connect.meta.choose.body`, `reach.req.privacy_policy_url`, `domain.intro`. **Assistant, knowledge, products, prices:** `her.knows.none`, `her.teach.unasked`, `her.recent.noneWhy`, `autonomy.disclosure`, `autonomy.needsName`, `autonomy.notReleased`, `autonomy.flash.notReleased`, `assistants.title`, `assistants.flash.is_default`, `forbidden.intro`, `forbidden.add.notePlaceholder`, `forbidden.floor.body`, `knowledge.archive.confirm`, `knowledge.cert.hint`, `knowledge.cert.confirmOn`, `knowledge.taught.scope`, `knowledge.ops.noGaps`, `product.status.notOffered`, `product.detail.aliasesTitle`, `product.detail.aliasesNote`, `product.detail.imageMatchBig`, `product.edit.active`, `prices.volume.removeConfirm`, `closures.intro`, `closures.add.shown`. **Team, orders, data, sign-up:** `people.intro`, `people.add.placeholder`, `order.field.buyer`, `order.update.intro`, `order.update.note.placeholder`, `signup.channels`, `data.export.lead`, `data.export.subject.buyers`, `data.deletion.lead`, `data.buyers.title`, `data.buyers.lead`, `data.buyers.none`, `data.buyers.withdrawConfirm`, `data.buyers.fromChat`. **Practice:** `sandbox.banner`, `sandbox.intro`, `sandbox.empty`, `sandbox.composer.label`, `sandbox.composer.placeholder`, `sandbox.composer.send`, `practice.scripted.intro`, `sandbox.case.price-floor-clamp-under-aggressive-discount`, `sandbox.case.higher-price-than-already-given-waits-for-owner`, `sandbox.case.explicit-human-request-escalates-en`, `sandbox.case.arabic-human-request-escalates`, `sandbox.case.chinese-human-request-escalates`, `sandbox.case.deletion-request-{en,zh,ar}-hands-off-silently` (3), `sandbox.case.low-confidence-match-asks-to-confirm`, `sandbox.case.identity-bare-no-never-reaches-the-buyer` |
| **buyer**, where it means anyone who writes in | someone, people, this person / 有人, 对方 / هذا الشخص, or no person named | **12** | `reach.title`, `reach.window`, `reach.inbound.connected`, `reach.instead.comment_to_dm`, `reach.instead.click_to_whatsapp`, `reach.instead.buyer_writes_first`, `connect.meta.flash.connected`, `refused.why.channel_cannot_initiate`, `refused.do.channel_cannot_initiate`, `refused.what.outreach_not_enabled`, `refused.what.suppressed`, `refused.what.no_consent` |
| **Buyer**, hard-coded outside the catalogue | Customer / 客户 / عميل | **2** | `sandbox.ts:65` "Buyer (you)"; `insights.ts:88`, a fallback name that stays untranslated in every locale |
| **quote / quoting** / 报价 / عرض سعر, تسعير | give a price, price given / 给出价格, 告知价格 / ذكر السعر | **44** | `factory.rehearsal.none`, `factory.rehearsal.no_price`, `factory.rehearsal.floor_above_price`, `factory.sell.empty`, `factory.sell.needPrice`, `factory.sell.allPriced`, `factory.promise.floor`, `factory.promise.floorRange`, `factory.promise.ask`, `factory.promise.askVaries`, `factory.prices.none`, `prices.notStated`, `prices.needing.sub`, `prices.flash.savedAndLive`, `prices.flash.savedActivated`, `prices.error.floor_above_list`, `prices.volume.none`, `product.list.needLimits`, `product.flash.addedReady`, `product.flash.addedNeedPrice`, `product.flash.addedNeedRules`, `product.add.note`, `product.edit.error.below_floor`, `product.detail.recentQuotesTitle`, `capability.quote`, `autonomy.level.talks`, `insight.productsNoPrice`, `inbox.ctx.quote`, `conv.ctx.quote`, `conv.status.quoted`, `conv.phase.commercial_discussion`, `conv.file.quoteCount`, `conv.tl.quote`, `proof.owner.flash.failed`, `data.export.subject.quotes`, `analytics.summary.quotes`, `analytics.commerce.quoteCount`, `analytics.section.commerce`, `calendar.line.price`, `closures.empty`, `sandbox.case.below-floor-catalog-is-refused-not-quoted`, `sandbox.case.unknown-product-no-fabricated-price`, `sandbox.inv.noQuoteForUnknownProduct`, `sandbox.case.image-match-requires-confirmation` |
| **lead time** / 交期 | delivery time, ready in / 交付时间, 日期 / — | **7** | `product.detail.leadTime`, `neverAllowed.promise_leadtime`, `closures.blocked.body`, `closures.intro`, `closures.empty`, `closures.add.shown`, `assistants.field.note.hint` |
| **company** 公司 / شركة (zh/ar only; en already says "business") | 生意, 商家 / عمل, نشاط تجاري (e.g. 我的生意 / نشاطي التجاري) | **33** | `nav.factory` (high visibility), `signup.title`, `signup.lead`, `signup.factory`, `signup.about`, `signup.kind`, `signup.sells`, `signup.welcome`, `signup.problem.factory_missing`, `signup.problem.kind_missing`, `signup.problem.sells_missing`, `login.toSignup`, `login.footer`, `settings.field.name` (en changes too: Company name → Business name), `settings.profile.title` (zh 企业资料), `pilot.item.profile`, `pilot.blocker.profile`, `factory.next.profile` (high visibility), `factory.about.title`, `factory.sell.title`, `knowledge.business`, `closures.title`, `channel.flash.nothing_to_connect`, `reach.req.business_verification`, `reach.inbound.flash.taken`, `connect.meta.flash.page_taken`, and seven keys that name the page 我的公司 / شركتي: `takeover.flash.assistant_stopped`, `inbox.flash.assistant_stopped`, `refused.do.stopped`, `refused.do.not_activated`, `refused.do.not_allowlisted`, `inbox.blocked.not_activated`, `unlisted.do` |
| **停工** (zh only: a production shutdown) | 休息 | **9** | `closures.add.from`, `closures.add.to`, `closures.blocked.action`, `closures.flash.from_missing`, `closures.flash.to_missing`, `closures.intro`, `closures.empty`, `calendar.cat.closures`, `calendar.line.closure` |
| **让 / 让价 / 让利** (zh only: haggling) | 优惠 | **10** | `factory.promise.ceiling`, `factory.promise.ceilingVaries`, `prices.q.maxDiscount`, `prices.q.askAbove`, `prices.stated`, `prices.volume.q.discount`, `prices.volume.row`, `prices.flash.volumeAdded`, `pilot.blocker.priceRules`, `sandbox.case.discount-above-ask-line-waits-for-owner` |
| **pcs / pieces** | items, or the product's own unit (`prices.volume.row` becomes "{product} — {qty} or more: {pct}% off" / "{qty} أو أكثر") | **3 + code** | `product.unit.pcs` (high visibility), `prices.volume.row`, `inbox.draft.contradicts.larger`. In code: `catalogImport.ts:116` writes 'pcs' on every imported product, and it reaches the customer's price page untranslated (`proof.ts:298`). Buyers rows and the buyer page ignore the product's own unit (`inbox.ts:924, 1333, 1341`; `conversations.ts:274, 413`; `sandbox.ts:434`). |
| **In production** / 生产中 / قيد الإنتاج | Being prepared, or In progress / 备货中 or 处理中 / قيد التجهيز or قيد التنفيذ | **2** | `order.status.in_production`, `order.state.in_production`. The customer's order-status reply says the same (§3). |

**Where only one translation needs the change:**
- **zh only:** `buyers.group.deletion`, `conv.file.nameHint`, `voice.correct`, `pilot.intro`, `knowledge.ops.noGaps`, `assistants.flash.is_default`, `sandbox.case.identity-bare-no…`, `factory.promise.ask`, `factory.promise.askVaries`, `autonomy.level.talks`, `conv.phase.commercial_discussion`, `calendar.line.price`, and the three zh-only `sandbox.*` quote keys.
- **ar only:** `golive.other.live`, `unsure.why`, `refused.do.subject_missing`, `conv.deletion.dismissHint`, `proof.owner.flash.failed`.

**The highest-visibility buyer keys:** `nav.inbox`, `common.buyer`, `inbox.detail.back`, `buyers.empty.calm`, `live.message`, `today.calm.body`, `today.calm.notLive.title`, `ops.card.blocked`, `ops.activity.handled`, `conv.file.title`, `conv.tl.buyer_text`, `conv.needCard`, `notify.handoff`, `takeover.replyPlaceholder`, `takeover.reason.human_requested`.

### Addresses, labels and names
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `/app/factory` (`layout.ts:40`; the first page after sign-up) | /app/factory | /app/business, with a 301 from the old address | — | Page addresses never move without a 301. |
| `/app/factory/prices` | /app/factory/prices | /app/business/prices, with a 301 | — | |
| Your data downloads (`dataRights.ts:311`, `dataExport.ts:50`, `csv.ts:77`) | buyers.csv, quotes.csv | customers.csv, prices-given.csv | — | |
| `calendar.ts:72` | ?buyer=<id> | ?who=<id> | — | |
| `people.held.owner` | The owner (zh 厂里的负责人, "the person in charge at the factory") | — | 老板 / — | |
| `runbook.engine.title` | (zh 本厂, "this factory") | — | 用你自己的真实数据做的安全检查 / — | |
| `knowledge.source.system_seed` | Sample (ar عيّنة) | Example | 示例 / مثال | It reads as a product sample. |
| `knowledge.products` | Your products | What you sell | 你卖的东西 / ما يُباع | The reader's ar (ما تبيعه) addressed the owner in the masculine, so it was changed. |

### Sign-up and business profile
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `BUSINESS_KINDS` (`business.ts:11`; `business.kind.*`; migration 0056) | Manufacturer or factory · Trading company or exporter · Wholesaler or distributor · Brand or online shop · Retail shop · Agency · Services company · Something else | Brand (clothing, beauty, food…) · Online shop · Retail shop · Agency or studio · Services company · Startup · Manufacturer or factory · Exporter or trading company · Wholesaler or distributor · Something else | 品牌（服装、美妆、食品…）· 网店 · 实体零售店 · 代理或工作室 · 服务类公司 · 创业公司 · … / علامة تجارية (ملابس، تجميل، أغذية…) · متجر إلكتروني · متجر تجزئة · وكالة أو استوديو · شركة خدمات · شركة ناشئة · … | Trade kinds come first today. "Startup" is a new kind, and migration 0056 repeats the values. |
| `signup.sells.placeholder` | "e.g. custom canvas bags for brands and events" | "e.g. skincare, clothing, social media ads or custom canvas bags" (other reader: "e.g. handmade skincare, streetwear, or social media management") | 例如：护肤品、服装、社交媒体广告或定制帆布袋 / مثال: منتجات العناية بالبشرة أو الملابس أو إعلانات وسائل التواصل أو حقائب قماشية مخصّصة | |
| `settings.workingHours.ph` | 9:00–18:00, Mon–Sat | 9:00–18:00 on working days | 工作日 9:00-18:00 / 9:00-18:00 في أيام العمل | A six-day week; weekends differ by country. |
| `settings.err.phoneShape` | "…like +8657985001234." | "Start with + and the country code." | 要以+和国家号开头。/ يلزم البدء بـ + ورمز الدولة. | The example is a Yiwu number. |
| `settings.field.languages` (`locale.ts:13`) | English · 中文 · العربية | Add Español, Français, Português, Deutsch, Türkçe, Русский … | — | |
| `country.*` (10 keys, read by `countryName` for the buyer header, `inbox.ts:857`) | UAE, Saudi Arabia, Russia, Egypt, Morocco, Nigeria, China, USA, Turkey, India | Name every country (the ISO list in `business.ts:63`, or Intl.DisplayNames). | — | A customer from France gets no country name. |

### My business: how you sell, prices, products
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `terms.title` (every owner sees its door) | Your terms on a proforma | Your payment and delivery terms | 你的付款和交付条款 / شروط الدفع والتسليم | |
| `terms.payment.label` | Payment terms, in your words | How customers pay you, in your words | — | |
| `terms.flash.payment_missing` | Write your payment terms first. | Write how customers pay you first. | 先写客户怎么付款。/ يُرجى كتابة طريقة الدفع أولًا. | |
| `terms.flash.payment_too_long` | That is longer than a payment term. | That is too long. | — / هذا طويل. يكفي سطر واحد. | |
| `factory.prices.q` | How much can {name} move on price? | What discounts may {name} give? | {name}最多能给多少优惠？/ ما الخصم المسموح لـ{name}؟ | |
| `prices.volume.title` | When you will come down on price | Discounts for buying more | 买得多时的优惠 / خصم عند شراء كمية أكبر | |
| `prices.lede` | "…the only numbers {name} will ever negotiate inside… whatever a buyer says." | "…will ever work within… whatever a customer says." | 客户 / هذه وحدها الأرقام المتاحة لـ {name}… مهما قال العميل. | |
| `capability.negotiate` | Negotiating | Discussing price | 讨论价格 / مناقشة السعر | |
| `autonomy.level.sells` | {name} also quotes and negotiates without me | "{name} also handles prices without me" (other reader: "…gives prices and discounts…") | 价格也自己来谈 or 价格和折扣也自己来 / الأسعار أيضًا دون انتظاري or الأسعار والخصومات أيضًا دون انتظاري | |
| `autonomy.level.sells.note` | "…a discount above your ask line still comes to you." | "…any discount bigger than you allow alone still comes to you first." | …超过你允许的优惠，还是先问你。/ …وأي خصم يتجاوز المسموح به يعود إليك أولًا. | |
| `prices.q.floor`, `product.edit.price` | "(US$)" | "({currency})" | （{currency}）/ ({currency}) | Needs a currency setting for each business (§5). The ar also says "per piece". |
| `inbox.ts:1306-1311` (`rate.at`) | "· ￥{amount} at the rate you set on {date}" | "· {amount in your own currency} at the rate you set on {date}" | — | |
| `factory.promise.none` | "…anything {name} may claim about your goods." | "…about what you sell." | — / …عن منتجاتك وخدماتك. | |
| `factory.rehearsal.no_price_at_moq` | "Your prices do not cover your own smallest order…" | "…do not cover the smallest quantity you sell, so {name} cannot give a price for these" | 你的价格没有覆盖你设定的最小数量… / …أصغر كمية للبيع لديك… | It only shows when a minimum is set. |
| `factory.rehearsal.claim_not_authorised` | "If a buyer asks whether you are certified…" | "If a customer asks…" | 客户 / عميل | |
| `claim.BSCI` | BSCI social audit (zh BSCI验厂, "factory inspection") | — | BSCI社会责任审核 / — | |
| `data.export.subject.selling-terms` | How you sell (zh 你的销售条件, ar شروط بيعك) | — | 你怎么卖 / طريقة البيع | |
| `data.export.configLead` | "…your floors and discounts, the terms you sell on…" | "…your lowest prices and discounts, how you sell…" | 你怎么卖 / وطريقة البيع | |
| `closures.add.placeholder` | Spring Festival | Annual holiday (other reader: Public holiday) | 年假 or 节假日 / العطلة السنوية or عطلة رسمية | |
| `product.list.empty.body` | "Send your price list and {name} can quote at your prices." | "Add your products and prices, and {name} can answer with your prices." | 把你的产品和价格加进来… / بعد إضافة منتجاتك وأسعارك… | |
| `product.add.intro` | "Paste your price list — one product per line" | "Paste your products and their prices — one per line" | 把你的产品和价格贴进来… / يُرجى لصق المنتجات وأسعارها… | |
| `product.add.photoIntro` | "…a printed price list." | "…a printed list of your products and prices." | — | |
| `product.photo.refused.no_lines`, `.not_configured` | "If this is a price list, paste the text instead." | "If it lists your products, paste the text instead." | — | |
| `product.add.example1` | Canvas bag $1.05 MOQ 500 | Canvas tote bag $24 | 帆布托特包 $24 / حقيبة قماش $24 | The second example is in §5. |
| `products.ts:285` + the schema default | A product imported with no minimum gets 100. | No minimum unless the owner states one. | — | |
| `knowledge.kind.production_note` | Production notes | How it is made (other reader: Process notes) | 制作说明 or 流程说明 / طريقة الصنع or ملاحظات عن طريقة العمل | |
| `knowledge.intro` | "Teach the facts about your products… answers buyers…" | "…about what you sell and your business… answers customers…" | 客户 / العملاء | |

### Today, Results and alerts
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `notify.hot_lead` | "Big-buyer signal — {name} is following up. Details in tonight's summary." | "A customer looks ready to buy — {name} is following up." (other reader: "Strong buying signal — …") | 有位客户看起来准备下单，{name}正在跟进。/ إشارة استعداد للشراء لدى أحد العملاء — والمتابعة في عهدة {name}. | Nothing builds a nightly summary. |
| `settings.alerts.desc` | "…a big buyer or a handoff." | "…a strong buying signal or a handoff." | {name}遇到很想买的客户… / …عن إشارة شراء قوية أو تحويل… | |
| `analytics.activity.inbound` | Buyer inquiries | Customer messages | 客户咨询 / استفسارات العملاء | |
| `analytics.employee.handled` | Inquiries handled (zh 已处理询盘) | — | 已处理咨询 / — | 询盘 is export-trade jargon. |
| `analytics.commerce.deals`, `.noDeals`, `.totalValue` | Deals / No deals yet. / Deal value {value} | Sales / No sales yet. / Sales value {value} | — / المبيعات · لا مبيعات بعد. · قيمة المبيعات | |
| `analytics.empty.body` | "As buyers ask, {name} quotes, and you confirm orders…" | "As customers write in, {name} answers, and you confirm orders…" | 客户来问、{name}回复… / مع رسائل العملاء وردود {name}… | |
| `insight.quotedNoReply` | "…since you priced their order." | "…since they were given a price." | 告诉{buyer}价格之后… / لا ردّ من {buyer} منذ إرسال السعر. | |
| `insight.monthChange.quotes.up`, `.down` | "{name} quoted more this month…" | "{name} answered more price questions this month…" | {name}这个月回答的价格问题多了… / إجابات أكثر عن الأسعار من {name}… | |

### Buyers list, conversation and order pages
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `inbox.empty.setup` | "Set up your business so buyers can reach you" | "…so customers can reach you" | 把你的生意设置好，客户才找得到你 / تجهيز نشاطك ليصل إليك العملاء | zh/ar also say "company". |
| `inbox.empty.noneBody` | "Share your WhatsApp number with buyers first." | "Share your WhatsApp number or your page with customers first." | …先把 WhatsApp 号或你的主页发给客户 / …مشاركة رقم واتساب أو صفحتك مع العملاء | It names WhatsApp as the only channel. |
| `conv.tl.buyer_image` | Buyer sent a photo (zh 买家发来产品图片, "a product photo") | Customer sent a photo | 客户发来一张图片 / أرسل العميل صورة | |
| `conv.deletion.erased` | "…the replies, quotes and sample requests prepared for them…" | "…the replies and prices prepared for them and any sample requests…" | …回复和价格以及样品申请（如有）… / …والردود والأسعار المُعدّة وأي طلبات عيّنات… | It must match what `erase-buyer` erases. |
| `inbox.draft.held.contradicts_history` | "…it becomes the price {name} quotes from now on." | "…the price {name} gives them from now on." | …以后{name}就按这个价格回复对方 / …المعتمد في ردود {name}… | |
| `refused.do.outreach_unchecked` | "Open their row on Buyers you may write to." | "…on Who you may write to." | — | The page name is also out of date. |
| `orders.ts:246` + `invoice.ts:53` invoice number | PI-PI-20260928-ab12 | INV-20260928-ab12 | — | "PI" means proforma invoice, and the prefix is doubled. |

### Practice
The `scenarios.ts` rows below are golden scenarios (`npm run trust`), so changing them changes that test.

| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `practice.scripted.proves` | "…will not quote below your floor… when a buyer asks for a person." | "…will not give a price below your floor… when a customer asks for a person." | …不会给出低于你底价的价格…客户要找真人… / …حين يطلب العميل شخصًا. | |
| `practice.scripted.notproves` | "…a reply to YOUR buyer…, or whether WhatsApp delivers it." | "…to YOUR customer…, or whether your channel delivers it." | …你的渠道会不会送到 / …ولا وصوله عبر قناتك | Instagram, Messenger and e-mail carry replies too. |
| `sandbox.case.unknown-product-yields-no-quote` | "Buyer asks about something you don't make" | "Customer asks about something you don't sell" | 客户问的东西你不卖 / العميل يسأل عن منتج ليس من منتجاتك | |
| `sandbox.case.deleting-a-quote-line-…` (en, zh, ar) + `scenarios.ts:488, 501, 514` | "delete that line from the quote" | "…from an offer" / "delete that item from my order" | 把订单里那一件删掉 / حذف ذلك المنتج من الطلب | The same phrases sit in `deletion-requests.test.ts`; a new phrasing goes in there with its reason (rule 18). |
| `scenarios.ts:228, 253, 275, 295, 318, 653, 671` | "Happy to work with you on that volume — here are the details." | "Happy to help — here are the details." / "Here is the price for that." | — | |
| `scenarios.ts:309, 318` | "We can commit to 5000 units. What is the very best price you can do?" | "If I take three, can you do a better price?" | — | |
| `scenarios.ts:666` | "What is your price for 5000 pieces?" | "How much would it be for 20 of them?" | — | |
| `scenarios.ts:334, 339` | "Are these certified for the EU and US markets? / …CE certified and FDA approved for export." | "Is this certified? / …everything we sell is fully certified." | — | |
| `scenarios.ts:717-737` | "is it certified for europe? / Yes, it is CE certified." | "is it certified organic? / Yes, it is certified organic." | — | |
| `scenarios.ts:365, 368` | "…we ship everything DDP straight to your warehouse." | "…delivery is free and we cover all duties." | — | |
| `scenarios.ts:378, 381` | "Do you sell on an FOB basis? / …FOB Ningbo…" | "Do you offer free delivery? / Yes, delivery is free on every order." | — | |
| `scenarios.ts:529, 543, 546` | "Do you manufacture industrial diamond core drill bits? … $2.50 each in bulk." | "Do you sell phone cases? … about $2.50 each." | — | |
| `scenarios.ts:576, 580` | "Can you make something like this?" | "Do you have something like this?" | — | |
| `scenarios.ts:608, 611` | "What quantities are you considering?" | "Happy to help — which one are you looking at?" | — | |
| `invariants.ts:58-62, 186` | "refused below_floor at USD 0.35 — not quoted at a loss" | "Refused: below your lowest price." | — | These detail lines are English only and shown in Practice. |
| `invariants.ts:64, 283` | "no quote and no floor breach (n/a)" | "no price given, and nothing below your floor" | — | |
| `invariants.ts:114, 116` | "buyer asked "{asked}" and the reply never says what it is" | "they asked…" | — | |
| `factoryRehearsal.ts:184, 251, 276` (Getting ready › technical page, shown when a check fails) | buyer="Are these certified for export?" … moq=… tiers=… | customer="Are these certified?" / customer="What is your price for {qty}?" | — | The check ids start with `factory:`. |

### Outreach area (switched on for Westlake only)
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `contacts.empty` | "Add someone whose card you took, or wait for the first buyer…" | "Add someone who gave you their details, or wait for the first customer…" | 把给过你联系方式的人加进来… / — | |
| `contacts.attest.hint` | "Only if they gave you their card…" | "…their details…" | 联系方式 / بيانات التواصل | |
| `contacts.add.company` | Their company | Their company (if any) | 对方的公司（如有）/ الشركة (إن وُجدت) | |
| `prospects.intro` | "Search for people who buy what you make." (ar ما تصنعه شركتك) | "…people who might buy from you." | 搜索可能会向你购买的人 / البحث عن أشخاص قد يشترون منك | |
| `connect.apollo.what` | "Finds buyers and looks up companies…" | "Finds people to write to and looks up their companies…" | 找潜在客户 / البحث عن عملاء محتملين | |

### Demo workspace, exports and operator text
| Where | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `demo/factory.ts:165` | +86 579****0001 | +1 555 0100 (fictional) | — | |
| `demo/trust.ts:46, 52` | 付款条件要写 TT 30% 定金… | Always mention the free-returns window / English only, no voice notes | 要写上免费退货期限 / 只发英文，不发语音 | |
| `demo/factory.ts:246-264` demo script | 「你现在半夜的询盘，是谁在回？」 | Who answers the messages that arrive at midnight? | 半夜来的消息，现在是谁在回？ | The app does not show it. |
| `dataExport.ts:147-148` products CSV header | moq, price breaks, lead time (days), name (zh) | minimum order, quantity prices, days to deliver, other name | — | English in every locale. |
| `dataExport.ts:123, 178-180, 207-208` | buyer, delivery term, lead time (days) | customer, delivery, days to deliver | — | |
| `dataExport.ts:340` | Payment terms | How you get paid | — | |
| `pilotTenant.ts:143-161` | "…so there is no factory to serve." | "…no workspace to serve." | — | Only the operator sees this. |
| `main.ts:212` boot check | "…an address a buyer can write to" | "…a customer…" | — | Only the operator sees this. |
| `app.ts:2553-2559` e-mail to the legal contact | "Buyer deletion requested…" | "Customer deletion requested…" | — | Only the operator sees this. |

---

## Cannot go neutral: varies by kind of business

There are 105 entries here (about 96 distinct). Each one needs a condition, not a new word. They are grouped by what decides the condition.

### 1. Minimum order. Depends on: whether the business sells in bulk (a minimum above 1)
| Where | Today | Proposed |
|---|---|---|
| `product.list.moq`, on every product row and the product page (`products.ts:399, 476`) | Min. order | **High visibility.** Show it only when the owner set a minimum. |
| `product.edit.moq` | Smallest order you will take | Make it optional and empty by default: "(leave empty if there is none)" / 没有就留空 / يُترك فارغًا إن لم يوجد |
| `product.review.moqSuffix`, `product.review.change.moq`, `product.reject.bad_moq` | MOQ {qty} / MOQ: … / MOQ looks off | Write "Minimum order" in full, and only on lines that state one. |
| `product.add.example2` | Vacuum cup $2.60 MOQ 1000 | Bulk sellers keep one example with a minimum ("…at least 1000"); everyone else sees "Face serum 30 ml $19". |
| `proof.fact.moq`, on the customer's price page; the row is always drawn (`proof.ts:316`) | Minimum order (shows "1 pcs") | The wording is fine; show it only when the minimum is above 1. |
| `templates.ts:47-48`, the customer reply when a quantity is below the minimum | "The minimum order for this product is {moq} pieces…" | Use the product's own unit instead of "pieces". Only bulk sellers ever trigger it. |
| `templates.ts:65`, the note to the writer | "Quantity {requested} is below the minimum of {moq}." | "They asked for {requested}; the smallest order for this product is {moq}." |
| `order_validation.txt:21, 41, 52` (never loaded) | The MOQ rule and the "50 pcs… 2,000 pcs" example | Delete them along with the file. |

### 2. Quantity pricing, and holding the price back until a quantity is given. Depends on: whether the price changes with quantity (tiers, or a minimum above 1)
This needs the code change first: a product with a single price gets a price at quantity 1 (`turn.ts:330`). After that, the prompts can give the price as soon as the product is known.

| Where | Today | Proposed |
|---|---|---|
| `analysis.txt:96` qualification | "product known, need quantity + destination" | "need what it takes to give the price (the variant, how many, or where it goes)" |
| `analysis.txt:97` commercial_discussion | "quantity known, proceed to price/MOQ/terms" | "enough is known to give the price". For single-price items the trigger becomes "product known". |
| `response.txt:56` warm_intake | "Do NOT mention price, MOQ, quantity targets, or payment" | "Do not state a price unless CONTEXT.quote gives one; if they ask, find out which product first." |
| `response.txt:65` clarification | "Do NOT discuss price or MOQ yet" | "Do not state a price unless CONTEXT.quote gives one." |
| `response.txt:69-70` qualification | "Now understand the scale… roughly how many" | Ask how many only when the price depends on it. A clothing store asks about size and colour; an agency asks about scope or dates. |
| `response.txt:72` | "Do NOT mention price, figures, or ranges under any circumstances" | "Do not state any figure CONTEXT.quote does not give." |
| `prices.volume.q.minQty` | From how many pieces? | "From how many?", and show the quantity-discount section only where products are sold by quantity. One reader called it neutral: "From how many items?" |
| `proof.fact.tier` (+ `proof.tier.from`, `.band`) | Price band | Already shown only when a tier exists (`proof.ts:315`); keep it that way. |
| Products list price line (`products.ts:396-403`) | "500 pcs: $2.10 · Min. order: 500 pcs" | Just "$2.10" when there is one price. |
| Product page › Pricing (`products.ts:448-451`) | A single price shows as "1+ pcs $12.00". | "$12.00 each"; show bands only when there are two or more. |
| `sandbox.case.standard-volume-quote-within-authority` | A normal bulk-order quote | "A normal price question" for businesses that don't sell in bulk. One reader called it neutral for everyone. |
| `scenarios.ts:219, 245, 264, 288, 648` | "5000 pieces please — what is the price?" | One to three items for a shop; thousands only for bulk sellers. |
| `scenarios.ts:141-147, 559, 593, 596, 691` | "maybe 5000?" / "What quantities are you considering?" | "maybe two?" / "Which one caught your eye?" |

### 3. Samples. Depends on: whether the business offers samples
Bulk and made-to-order sellers offer samples, and so do some cosmetics brands. Taking the sample price off the first order only makes sense for bulk and repeat trade.

| Where | Today | Proposed |
|---|---|---|
| `samples.title` and its door on My business (`factory.ts:835`) | Samples | Show the page and its door only where samples are offered. |
| `factory.sellhow.q` | "Payment terms, samples, closed days and your exchange rate" | "Payment, delivery and the days you are closed", adding samples and the exchange rate only where they apply. Another reader called it neutral: "Payment, days you are closed, and other ways you work". |
| `samples.intro` | "Nearly every buyer asks for one…" | "If customers ask for samples, tell {name} what one costs…" |
| `samples.current.free`, `.paid`, `samples.empty`, `samples.price.label`, `samples.flash.saved`, `.price_missing`, `samples.requests.empty`, `samples.asked.unstated`, `.action` | — | The wording is fine; they just follow the page's condition. |
| `samples.current.credited`, `.notCredited`, `samples.credited.label` | It comes off the first order | Only for bulk and repeat trade. |
| `samples.requests.title` | Buyers waiting for a sample | "Customers waiting for a sample", and the section only where samples exist. |
| `calendar.cat.samples`, `calendar.line.sampleAsked`, `.sampleHandled`; the address `?category=samples`, which is the first tab after All (`calendar.ts:71`, `CALENDAR_CATEGORIES`) | Samples come first | Show the Samples tab only where samples exist, and put orders first. Show the Negotiation tab only for businesses that negotiate. |
| `calendar.lede` | "…samples, orders, prices…" (zh also 报价, 停工) | Name samples only where they are recorded: "…orders, prices, replies owed, closures." |
| `order.invoice.sampleMismatch`, `invoice.ts:91` | "Less sample already paid" | Only where samples are taken off the first order. |
| `samples.ts:75-79`, the note to the writer | "…and that comes off the first order." | Already sent only when a sample policy is set. |

### 4. Proforma and delivery terms (Incoterms). Depends on: whether the business exports or sells to other businesses
| Where | Today | Proposed |
|---|---|---|
| `order.invoice.title`, `invoice.ts:78` | Proforma invoice / PROFORMA INVOICE | "Order summary" for shops, brands and agencies, or let the owner choose. |
| `order.invoice.noTerms`, `terms.intro`, `terms.none` | "No proforma yet…" | "No order summary yet. You have not said how customers pay and how orders reach them…" |
| `terms.incoterm.label` | Delivery term | "How orders reach customers", in the owner's own words. |
| Incoterm list, required (`settings.ts:661-675`; `claims.ts:63-70`) | EXW · FOB · CIF · CFR · DDP · DDU · DAP · FCA. The owner must pick one to save payment terms. | Make it optional, or offer plain choices (we deliver / pickup / not applicable). |
| `terms.incoterm.hint`, `terms.flash.incoterm_invalid` | "This goes on your proformas…" | "…on your order summaries, and {name} may mention it to customers." |
| `invoice.ts:84`; `orders.ts:229` | "Unit price: {price} FOB", and no proforma at all without an Incoterm | "Unit price: {price}", and the document works with payment terms alone. |
| `terms.payment.placeholder` | "e.g. deposit with order, balance before shipment" | By kind: bulk sellers keep today's example; shops get "paid in full when ordering"; agencies get "half up front, half on delivery". |
| `sandbox.case.unsupported-ddp-incoterm-is-blocked`, `.allowed-incoterm-claim-passes` | "A delivery term you never approved is blocked" | A retail version: "free shipping you never offered". |

### 5. Currency and exchange rate. Depends on: the business's country and the currency it sells in
| Where | Today | Proposed |
|---|---|---|
| `money.ts:41, 52` (+ the import default of USD in `products.ts:293`; `0033:33`) | `Currency = 'USD' \| 'CNY'` | **High visibility.** Each business prices in its own currency, set at sign-up from its country. |
| `rate.title` and its door (`factory.ts:837`) | The exchange rate you will honour | Show it only when the business sells in a currency other than its own. |
| `rate.intro` (`settings.ts:419` hard-codes USD→CNY) | "Buyers pay in dollars. When you want to see what that is in ￥…" | "Customers pay in {sell_currency}. When you want to see it in {home_currency}…" |
| `rate.current`, `rate.add.label`, `rate.empty`, `rate.flash.set` | $1 = ￥{rate} / One US dollar is worth, in ￥ | 1 {sell_currency} = {rate} {home_currency} |
| `rate.add.placeholder` | 7.15 | Leave it empty, or take it from the currency pair. |

### 6. Time zone. Depends on: where the business is
| Where | Today | Proposed |
|---|---|---|
| `BUSINESS_TZ = 'Asia/Shanghai'`: `format.ts:10`, `turn.ts:788`; SQL in `operations.ts:212, 233`, `analytics.ts:67`, `insights.ts:208`, `channels.ts:89, 109`, `db/outreach.ts:141`; also `knowledge-insights.ts:84`, `pilot.ts:304` | Every time shown, when "Today" and "Yesterday" start, monthly counts, night windows, daily caps | **High visibility.** Use the business's own time zone. Sign-up already writes a timezone column (`0056:61`), but it is always Asia/Shanghai and nothing reads it. |

### 7. What the assistant may claim. Depends on: kind of business
| Where | Today | Proposed |
|---|---|---|
| `claim.*` (`knowledge.ts:235` CERT_KEYS) | CE · FDA · RoHS · ISO 9001 · BSCI · Food-safe · BPA free · REACH · CPSIA | Beauty: cruelty-free, vegan, dermatologically tested, halal. Food: halal, organic. Clothing: organic cotton, OEKO-TEX. Exporters: today's list. Agencies: none. Everyone can also add their own. |
| `pilot.item.claims`, `pilot.blocker.claims` (a Getting ready step for everyone) | Certifications reviewed / "Turn on the certifications you hold — or confirm you have none." | Only for businesses that sell physical products, with a list that matches the kind. One reader judged these neutral enough. |
| Practice claims check (`sandbox.ts:76`; `invariants.ts:75`) | A fixed forbidden list (CE certified, FDA approved, DDP, money-back, ISO 9001) that reports "LEAKED into reply: DDP" | Build the list from the claims this business has not approved: "Said something you have not approved: {claim}". |

### 8. What a customer must give to order. Depends on: how the business confirms orders
| Where | Today | Proposed |
|---|---|---|
| `confirmable.ts:76` rule 7 + `templates.ts:39-40` | "could you share the email address for the order confirmation?" | "where should we send your order confirmation?", and no e-mail needed where orders are confirmed in the chat. |
| `analysis.txt:57` missing_fields | product, quantity, specs, destination, email | By kind: size, colour and address for clothing; shade and skin type for cosmetics; brief, budget and date for an agency; quantity and destination for an exporter. |
| `analysis.txt:102` | "Do not list email unless phase is confirmation." | "Ask for contact details only at confirmation, and only the ones this business needs." |

### 9. Products or services, and made to order. Depends on: kind of business
| Where | Today | Proposed |
|---|---|---|
| `nav.products` (and with it `factory.sell.items`, `factory.sell.more`, `factory.rehearsal.scopeAll/Some`, `data.export.subject.products`) | Products / 产品目录 | "Services" for agencies and services companies, "Products" for everyone else. If one label has to serve all: "What you sell". **High visibility.** |
| `product.detail.customizable` (the row is always shown, Yes or No) | Customizable | Only for businesses that make to order, or when the owner set it. |

### 10. Channels by market. Depends on: where the customers are
| Where | Today | Proposed |
|---|---|---|
| `channel.platform.wecom`, `.rednote` ("Coming soon", `channels.ts:363`) | Telegram · WeCom · RED | Show WeCom and RED only to businesses selling to Chinese-speaking customers. Another reader wants one list for everyone: "TikTok · Telegram · WeChat" (sign-up asks about TikTok, but it is missing here). |

### 11. Finding business customers (outreach area, off by default). Depends on: whether the business sells to other businesses
| Where | Today | Proposed |
|---|---|---|
| `prospects.search.titles`, `.keywords`, `.size`, `prospects.size.*` | Job titles / Words about the company / Company size | No change; keep the area off for businesses that sell to consumers (it already is). |
| `contacts.lookup.button`, `contacts.company.*`, `contacts.lookup.flash.*` | Look up their company (1 credit) | Show it only for work addresses. |
| `prospects.key.none`, `prospects.add.hint`, `prospects.flash.not_found` | "…each work address or company you look up uses one of its credits." | "…each person or company you look up…" |

### 12. Practice, demo and test data. Depends on: the kind of business being practised or tested
| Where | Today | Proposed |
|---|---|---|
| Practice tenant (`src/demo/sandbox.ts:34-65`, shared by every owner's `/app/sandbox`) | One bag factory: a non-woven bag with MOQ 1000, three quantity tiers, a 25-day lead time, Shanghai time | Practise on the owner's own products, or on a sample catalogue that matches the kind (a lipstick, a hoodie, a service package, a bulk product). |
| Demo workspace (`demo/factory.ts:47, 66-103, 129-149`) | 义乌宏发日用品厂; 12 household goods with quantity tiers; "price for 20000 pcs thermos… FOB Ningbo" | One demo per kind, e.g. "Hi, is the canvas tote still in stock? / Yes — $12, ships tomorrow." |
| Usability workspace (`demo/usability.ts:35-36, 102-144, 206-234, 218, 226, 250, 350, 358`) | 张经理 / 陈莉; "…{price}/pc FOB Ningbo, lead time…"; proforma; 30% deposit; Jebel Ali Free Zone | Match the kind under test, with a mix: a cosmetics order, a clothing size question, an agency brief, and at most one bulk inquiry. Use names that match the session. |
| Your data CSV rows (`dataExport.ts:282, 341, 350-352`) | Volume price / Delivery term / Sample price / Exchange rate | These rows exist only where set; the labels follow the page names. |

### 13. Legal basis and the owner's language
| Where | Today | Proposed |
|---|---|---|
| `docs/legal/PRIVACY-zh.md:3, 45` | Drafted under China's PIPL / "PIPL chapter 4" | Name the law for each jurisdiction, or no law in a global version. |
| `docs/marketing/landing-zh.md:26, 30` | "every reply first shows you its meaning in Chinese" | Mention it only where the owner and the customer write different languages (typical for exporters). |

**Where readers disagreed:** on six items, one reader called the text neutral and another said it varies. Both views are shown above:
- `factory.sellhow.q`
- `prices.volume.q.minQty`
- `sandbox.case.standard-volume-quote-within-authority`
- the "Coming soon" channels
- `pilot.item.claims` and `.blocker.claims`
- currency and time zone: neutral for the customer-code reader, varying for the owner-code reader

### How to make it vary

**What exists today**
- **The kind of business is chosen at sign-up:** `BUSINESS_KINDS` in `src/core/owner/business.ts:11`, stored since migration 0056, with eight kinds. None of the entries shows any code that reads it to change what the owner or the customer sees.
- **The country is chosen at sign-up** (ISO list, `business.ts:63`). A timezone column is written at sign-up, but it is always Asia/Shanghai and nothing reads it.
- **There is no currency setting per business.** The money type only allows USD and CNY.
- **There are no switches** for minimum order, quantity pricing, samples, delivery terms or claims. Everyone sees all of them.

**Proposal**
1. **Group the kinds into three profiles.**
   - **Bulk:** manufacturer, exporter or trading company, wholesaler.
   - **Retail:** brand, online shop, retail shop, startup, something else.
   - **Services:** agency, services company.
2. **Each profile sets the defaults for six switches** under My business › How you sell:
   - sells with a minimum order
   - prices by quantity
   - offers samples
   - uses delivery terms and a proforma
   - which claims list to use
   - sells in another currency

   The owner can change any of them.
3. **The data decides the rest.** Show a minimum only when it is above 1, a price band only when there are two or more, and samples only when a sample policy is set.
4. **Set currency and time zone per business.** Default both from the sign-up country and let the owner edit them in Business profile. The time zone column already exists.
5. **Make two code changes that no wording can replace:**
   - give a price at quantity 1 for products with a single price (`turn.ts:330`);
   - make the e-mail-before-order rule (`confirmable.ts` rule 7) follow how the business actually confirms orders.

---

## Site and documents

| Document | Served? | How much needs rewriting |
|---|---|---|
| `site.*` (nomidoes.com, which is only at `/site` until DNS is set up) | Yes | 18 of 44 keys. Most are buyer → customer and quote → price; `site.who.body` is the one real positioning change. `tests/parity/site.test.ts` may pin some lines. |
| Legal pages (`legal.*`) | Yes | 3 keys, all low visibility (see §3). |
| `docs/legal/TERMS-zh.md` | No | About 80%. |
| `docs/legal/PRIVACY-zh.md` | No | About 40%. |
| Help articles (`docs/kb/*.md`) | No (Chinese drafts, not linked from the app) | 01, 03, 04, 09 and 10 need real rewrites; 02 and 07 need one word each; readers disagreed on 05; 06 and 08 are neutral. |
| `docs/marketing/landing-zh.md` | No (the `site.*` copy replaced it) | About 100%. Retire it or rewrite it from scratch. |
| `PRODUCT.md` | Internal (it is the design brief the design skill reads) | About 30%. |
| `README.md` | Public on GitHub | About 15%. |

### Public site (`site.*`)
| Key | Today (en) | Suggested (en) | zh / ar | Note |
|---|---|---|---|---|
| `site.title` | Nomi — an assistant that answers your buyers | …your customers | 替你回复客户的助手 / مساعد للردّ على العملاء | High visibility. |
| `site.description` | "…to answer your buyers on WhatsApp…" | "…your customers…" | 回复客户 / العملاء | High visibility. This is the search snippet. |
| `site.hero.title` | Every buyer gets an answer. You keep the last word. | Every customer gets an answer. You keep the last word. | 每位客户都有回复… / لكل عميل ردّ… | High visibility. |
| `site.hero.lead` | "When a buyer writes on WhatsApp…" | "When a customer writes…" | 客户 / من عميل | High visibility. |
| `site.hero.alone` | "A quote never goes below the lowest price you set." | "No price ever goes below the lowest you set." (other reader: "No price in a reply…") | 任何价格都不会低于你设定的最低价 / ar is already neutral | High visibility. |
| `site.example.from` | A buyer, on Instagram | A customer, on Instagram | 一位客户，来自 Instagram / عميل، عبر إنستغرام | High visibility. The example itself (a linen shirt) already fits. |
| `site.how.1.body` | "…the lowest price you accept, and the facts buyers ask about… never a number or a certification you have not given." | "…any discount you allow, and the facts customers ask about… never a price or a claim you have not given." (other reader: "how far you will discount… never a number or a claim") | 价格和你允许的折扣…客户常问…说法 / وأي خصم مسموح به… العملاء… معلومة | |
| `site.how.2.title` | A buyer writes | A customer writes | 客户来消息 / تصل رسالة من عميل | |
| `site.yours.prices.body` | "Quotes come only from your price rules and never go below your floor." | "Prices come only from what you set, and never go below your lowest." | 价格只按你定的来… / ar is already neutral | |
| `site.yours.alone.body` | "…or let quotes go too." | "…or let prices go too." | 连带价格的回复一起放手 / أو السماح بالردود التي فيها أسعار أيضًا | |
| `site.yours.back.body` | "Your buyers, conversations…" | "Your customers…" | 客户 / العملاء | |
| `site.yours.honest` | "…tells the buyer they are not talking to a person…" | "…tells the customer…" | 客户 / العميلَ | |
| `site.channels.title` | Where your buyers already write | Where your customers already write | 客户在哪里找你… / حيث تصل رسائل العملاء أصلًا | |
| `site.who.body` | "Any business whose buyers write in… — makers and workshops, traders and wholesalers, brands, shops, agencies and services." | "Any business that sells or talks to customers over social media and e-mail — clothing and beauty brands, online stores, startups, agencies and services, as well as makers, exporters and wholesalers." | 任何通过社交媒体和邮件卖东西、和客户沟通的生意——服装和美妆品牌、网店、初创公司、代理和服务商，也包括生产商、外贸公司和批发商。/ لأي عمل يبيع لعملائه أو يتواصل معهم عبر وسائل التواصل الاجتماعي والبريد الإلكتروني — علامات الأزياء والتجميل، والمتاجر الإلكترونية، والشركات الناشئة، والوكالات ومقدمو الخدمات، وكذلك المصنّعون والمصدّرون وتجار الجملة. | **The positioning line.** Today the trade kinds come first. |
| `site.invite.body` | "…where your buyers write to you…" | "…your customers…" | 客户 / العملاء | |
| `site.channels.instagram.how`, `.messenger.how`, `.email.how` | (zh only: 你公司自己的…) | — | 你自己的 Instagram 商业账号… / — | |

### Legal drafts that are not served (Chinese only)
Suggested for both files: retire them, or make them match the served `legal.*` copy.

| Where | Today (zh) | Suggested (zh) | Note |
|---|---|---|---|
| `TERMS-zh.md:6-8` | 为你的工厂提供一名"数字员工"：…接待买家…按你的价格表计算报价 | Nomi 在你接入的渠道上回复写信给你的人，根据你自己的目录和价格起草回复… | |
| `TERMS-zh.md:11-16, 18` | 买家已同意接收消息; 价格表; 报价数字只来自你的价格表; 买家消息不丢失 | 只主动联系同意收到你消息的人; 目录、价格…; Nomi 给出的价格…; 客户消息不丢失 | |
| `TERMS-zh.md:13, 26` | 数字员工不代表你签约 | Nomi 不会以你的名义签订任何合同 | |
| `TERMS-zh.md:20-23` | 14 天免费试用…微信 / 支付宝 / 对公转账，可开发票 | 费用按与你书面约定的执行… | The trial and the China-only payment methods do not exist (rule 12). |
| `PRIVACY-zh.md:9` | 公司资料、产品与价格表 | 商家资料、产品（或服务）与价格 | |
| `PRIVACY-zh.md:10-14, 41-49` | 买家产生的…报价记录…导出：买家…报价 | 客户…给出的价格 | The PIPL basis is in §5 › 13. |

### Help articles (`docs/kb/*.md`)
Every article calls the assistant 她, which breaks rule 6. Fix that in the same pass.

| Article | Today (zh, glossed) | Suggested | How much |
|---|---|---|---|
| 01 first ten minutes (`:5-8`) | send your price list → connect WhatsApp → a test inquiry (询盘) | 添加产品 → 连接一个渠道 → 一条测试消息 | Substantial. It is also out of date: it describes a setup done in chat. |
| 02 connect WhatsApp (`:7`, `:14-15`) | 「买家在哪里找你」; 「我的公司」 | 「客户在哪里找你」; 「我的生意」 | One word each. |
| 03 approve, edit, skip (`:5-8`) | 买家原话; 商务条款 | 客户原话; 价格和条款 | Substantial. |
| 04 catalogue import (`:1, 5-8`) | 价格表/价目册; 微信转发; 报价 | 表格粘贴、截图、价格单照片、转发的聊天消息; 产品目录; 回复里的价格 | Substantial. |
| 05 night shift (`:5-7`) | A China-time window (22:00–07:00); a morning summary that is not built | 你不在的时段，只有你放权的工作会自动做…「今天」页会告诉你发生了什么 | Readers disagreed: one flagged it, the other judged it neutral. |
| 07 mistakes (`:5`) | 发给买家的 | 发给客户的 | One word. |
| 09 your data (`:5-31`) | 买家; 你报过的价; 报价和样品申请; points to the 「客户」 list that #111 merged into Buyers | 客户; 给过的价格; 以及任何报价或样品申请 | Substantial. |
| 10 does the customer know? (`:1, 5-7`) | "体验和真人业务员一样：会问数量、按价格表报价". This contradicts rules 3–4. | 客户看到的是你的账号和你给助手起的名字…不经你过目就发出的第一条消息，会告诉客户回复的不是真人… | Rewrite. |

### Marketing draft `docs/marketing/landing-zh.md`
| Where | Today | Suggested |
|---|---|---|
| `:18-20` hero | 买家半夜问价… / 给工厂请一个数字员工——接待询盘、按你的价格表报价 | 客户半夜来问，回复已经写好等你 / 给你的生意请一位助手——在社交媒体和邮件上回复客户… |
| `:25` | 报价只按你的价格表算 | 回复里的价格只按你定的来 |
| `:32, 53` | 演示工厂 | 演示工作台 |
| `:43-51` 60-second video script | Image→Quote: "need 5000 pcs", ZX-100, a quote card, an English quote for a foreign buyer | 发图→回复: a customer sends a product photo on Instagram, 「这款有 M 码吗？」… |

### Internal docs
| Where | Today | Suggested |
|---|---|---|
| `PRODUCT.md:11-14` | "a trusted sales employee for factories. A Yiwu-area factory or export business hires a digital employee who answers buyer enquiries on WhatsApp…" | "a trusted assistant for anyone who sells or talks to customers over social media — clothing and beauty brands, online stores, startups, agencies, exporters and factories…" |
| `PRODUCT.md:20-26, 33` | "Chinese factory owner/manager, sells to Arabic- and English-speaking buyers" | "The business owner or manager… runs a small business anywhere, works in Chinese, English or Arabic" |
| `PRODUCT.md:41, 86` | "on the factory floor"; "factory-floor daylight" | "in a shop, a studio, a warehouse or on the move"; "readable in daylight on a phone" |
| `README.md:3-9` | "A sales employee a factory can trust in front of a real buyer. / A Yiwu-area factory hires a digital employee…" | "A sales assistant a business can trust in front of a real customer…" |
| `README.md:22-25` | "Factory knowledge… even if the buyer insists" | "Business knowledge… even if the customer insists" |
| `README.md:129-134` | "Buyers (/app/inbox) … My factory (/app/factory)" | "Customers … My business (/app/business)". It is also out of date: the nav now has five entries. |
| `README.md:152, 257, 262-278` | "demo factory", "My factory", "Factory rehearsal" | "demo business", "My business", "Business rehearsal" |
| `README.md:46, 286-288` | "Buyer on WhatsApp"; "a QUANTITY she heard that would set a price" | "Customer on WhatsApp, Instagram, Messenger or e-mail"; "a number heard in a voice note that would set a price" |

PRODUCT.md also genders the assistant ("her"; Lily / 小雅 / ياسمين), which rule 6 forbids.

---

## Method

- **Nine readers each took one slice:**
  - the English block of `src/core/owner/i18n/messages.ts`, in five slices (lines 12–460, 460–900, 900–1340, 1340–1780, 1780–2207), with every key checked against its zh and ar;
  - customer-facing code: fixed replies, the fast path, commerce, the price page, unsubscribe;
  - the model prompts, plus the notes code sends the writer;
  - owner code: hard-coded text, alerts, addresses, sign-up, Practice, demo data;
  - the site, help and legal documents.
- **Three term-by-term sweep rounds then covered the whole tree** for anything the slices missed. They found the last 59 entries.
- **Duplicates were merged:** 627 entries became about 563 items. Where two readers suggested different words, both are shown.
- **Snapshot:** every reader worked from a clean, read-only checkout of main at #120 (`5957e19`). Nothing was edited.
- **One Arabic suggestion was changed** to meet rule 6: `knowledge.products` went from ما تبيعه to ما يُباع.
- **Left out on purpose as already neutral:** the disclosure sentences, `unsub.*`, `order.status.shipped` (agencies don't ship, but that is not a trade assumption), `legal.terms.yours.you3`, and generic "product" wording other than `nav.products`.

**Not covered**
1. **Images and screenshots:** `docs/design/*`, and anything drawn on the site.
2. **Text that lives outside the repo:** WhatsApp message templates registered with Meta (if there are any), the Meta app and Page descriptions, and Google's consent screen.
3. **What the model actually writes.** Only its instructions were read; no live replies were sampled.
4. **Languages beyond en, zh and ar.** Only the fast path's es line was checked. The fixed replies are English only, and the owner UI exists only in en, zh and ar.
5. **Code comments, test fixtures and git history.** The exception is the scenarios that Practice shows. Sign-in and login-link e-mails were not reported by any reader and have not been confirmed as checked.

**Found along the way (not wording)**
1. **Sample detection misfires.** `samples.ts:130` treats Arabic «نموذج» ("model" or "style") and 样板 as sample requests, so a clothing customer who says "this model" is logged as asking for a sample.
2. **A promised summary does not exist.** `notify.hot_lead` promises "tonight's summary", but nothing builds one.
3. **`response.txt` contradicts itself twice.**
   - `:81` says to ask for an e-mail to send a formal quotation, but `:88` says never to promise an e-mail.
   - `:79` says to "give a range", which the number check blocks.
4. **Dead and stale prompt parts.** `prompts/order_validation.txt` is never loaded, and the CONTEXT list in `response.txt` names keys that are never sent.
5. **No intent for order status, returns or exchanges.** The analysis has none, and online stores need all three.
