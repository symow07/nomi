# Trust Psychology — designing for "它可以处理这个了" ("it can handle this now")

Companion to TRUST-PLAYBOOK.md. That doc is the schedule; this is the
psychology underneath it. Perspective: trust designer, not engineer.

## The three corrections to our own framing

Before the 20 answers, three places where the previous thinking was wrong or
incomplete — found by inhabiting the owner instead of the system:

**1. Trust doesn't grow on streaks. It jumps on vivid moments.** Streak
counters model trust as accumulation; real owners make trust *leaps* on single
memorable events — the Arabic draft that beat his translation app, the AI
catching a detail he missed, the first order that arrived while he slept.
Design engineered vivid moments, not just counters. The counters are for us;
the moments are for him.

**2. Perceived risk ≠ actual risk, and quoting is the proof.** Quoting FEELS
like the most dangerous capability — it's money. But in this system it is the
SAFEST: prices come from his own table via arithmetic, guarded twice. The
free-text chat is where the model actually improvises. The psychologist's job
is to transfer the true risk model to him: **frame quotes as a calculator, not
as AI.** «报价是按你的价格表算出来的 — 机器算数，不会猜。» Render quote drafts
as an invoice-style card, visually distinct from chat prose. If he believes
"quote = calculator", night-quote autonomy can arrive at day 7, not day 14.
The blocker was never risk; it was risk *perception*.

**3. The scariest failure isn't error — it's surprise.** Trust collapses when
something happens he didn't know COULD happen, even if the message itself was
good. An auto-sent message in a scope he didn't realize was auto is worse than
an edited draft. Consent clarity — always knowing exactly what the employee is
allowed to do right now — is a trust primitive of its own (the "job sheet",
Q18), and scope may never widen implicitly.

## 1 · The 30-day emotional journey

**Day 0 — defensive skepticism plus quiet hope.** He agreed because he's
losing overnight GCC leads, not because he believes. Vigilance high,
expectation low. Under-promise: 「前两周它是试用期员工，每句话你先看。」

**Days 1–3 — vigilant inspection, net-negative utility.** Reading every draft
is MORE work than replying himself — for messages he could handle. So
probation must start on conversations he's WORST at: Arabic, English,
overnight. Keep the AI entirely away from Chinese-language and known-customer
chats at first. The early value must be things he *cannot do*, not things he
can.

**Days 4–7 — attention relaxing (the invisible first trust event).** He
starts approving without fully reading. Measurable: **approval latency
dropping below plausible reading time = rubber-stamping = ready for a
promotion offer.** This is the single best trust proxy in the system and it
falls out of the `drafts` timestamps for free.

**Days 8–14 — the promotion arc: pride, then one anxious night, then
relief.** He flipped the switch himself (pride: *his* training made this
employee good). The digest on the morning after the first autonomous night is
the most important artifact in the product. It must be flawless.

**Days 15–30 — normalization, and the boredom paradox.** "It's boring" = trust
achieved. But bored trust is churn-vulnerable to a single error unless the
digest keeps attributing wins («这单是它夜里谈下来的» — this order, it closed
overnight). Attribution converts boredom into quiet pride.

## 2–3 · Exact moments trust rises / collapses

**Rises:** first back-translated Arabic draft he verifies and finds *better*
than his translation app · first shown guard refusal ("I didn't promise CE —
you never told me you have it") · the AI catching something HE missed ("the
buyer mentioned 20,000 units in his third message") · clean first-night
digest · a buyer complimenting response speed · the AI going quiet the moment
he enters a conversation (presence suppression *felt*) · a self-demotion
announced before he noticed the problem.

**Collapses:** wrong commitment reaching a buyer (× 5 if an old customer) ·
**scope surprise** (auto-send where he expected draft — even a good message) ·
repeating a mistake he already corrected · double-send / approve-but-no-send ·
generic template smell in front of a buyer who knows the factory · anything
suggesting his prices leaked.

## 4–5 · "Understands my business" vs "I must keep checking"

**Understands:** uses HIS words for products (aliases mined from his own price
list); knows MOQ without asking; remembers a buyer across conversations
(「这是上个月问牛皮纸袋的迪拜客户」); respects Ramadan/CNY rhythms; greets a
returning buyer by history. **Cross-conversation memory creates "understands
my business" more than any single clever reply.**

**Keep checking:** the AI asking what the buyer already said (fragment/context
loss); tone lurching between messages; tiny factual slips (wrong color
option — harmless but vigilance-renewing); and the killer: **a corrected
mistake recurring.** An employee who doesn't learn from corrections never
leaves probation. (See missing primitive #1.)

## 6–8 · Primitive audit

**Strongest:** draft mode (consent) · night shift (stakes-matched autonomy) ·
deterministic quoting + guards (drafts are consistently *right*) · one-tap
revoke (felt control; fear shrinks when the exit is rehearsed) · VIP list
(protects the sacred).

**Weak or risky:** the why-line dies if it exceeds one line — accountability,
not homework · auto-promotion *nagging* would be car-salesman energy: offers
must be rare, evidence-first, and never repeat after a "no" · anything that
surfaces AI-ness (model names, confidence scores, latency) subtracts trust —
delete from every owner surface.

**Missing entirely:**
1. **Edit-learning made visible** — his corrections must change tomorrow's
   drafts, and the change must be *acknowledged*: 「你上次改过这种说法，我记住
   了。」 Mechanism: recent approved/edited pairs from `training_examples`
   injected as few-shot style memory per business. Without this, trust
   formation stops dead at day 5. **This is the #1 missing feature in the
   entire product.**
2. **Buyer memory surfaced** — the returning-customer line on every draft.
3. **The job sheet** — current scope, always one tap away, written as a duty
   roster (Q18). Kills scope surprise.
4. **The repair protocol** — when an error reaches a buyer: instant owner
   alert, pre-drafted correction+apology for HIS approval, self-demotion of
   the capability, and the face-saving frame: 「我的新助理弄错了」 ("my new
   assistant made a mistake") is a culturally available, dignity-preserving
   move. Blame the assistant; the assistant can take it.
5. **Confidentiality guard** — the model must never reference one buyer's
   prices/terms to another. Price-discrimination exposure between his buyers
   is a fatal, currently unguarded error class. (Deterministic: quote data is
   loaded per-conversation only; add a check that outbound never contains
   another conversation's quote figures.)
6. **The practice room** — he can roleplay as a buyer anytime ("interview your
   employee"). Zero-risk trust calories, also the demo, also the debugger.

## 9–10 · The trust ledger (0–100, loss-averse ~5:1)

Increases: clean approved draft +0.5 · unedited day +1 · shown guard refusal
+2 · self-demotion handled well +2 · clean night shift +3 · buyer praise +3 ·
caught-what-he-missed +4 · first attributed order +8.
Decreases: template smell −2 · harmless factual slip −3 · **repeat of a
corrected mistake −8** · scope surprise −15 · wrong commitment to a new buyer
−25 · **the same to a 老客户 −60 (usually fatal)** · price leak between buyers
−70 · data-to-competitor suspicion −80. Idle decay: a week without visible
value −2 (fading relevance is churn too).

## 11–12 · The two fast routes

**To night quotes:** the calculator reframe (correction #2) + the rubber-stamp
signal (approval latency) + rehearsed revoke. With those three, offer night
quotes on ~day 7: 「报价是算出来的，不是它编的。夜里让它按你的价格表报，早上你
看每一单?」

**From night quotes to strangers:** this is the WRONG frontier to worry
about — strangers are the LOWEST-stakes buyers and are already the training
ground. The real final frontier is **daytime + 老客户**. Autonomy therefore
expands on three axes — time-of-day, capability, customer segment — and the
natural sequence is: new buyers at night → new buyers always → all-except-VIP →
(possibly never) VIPs. Segment-based promotion ("all new inquiries are yours
now") is how "customers I've never met" happens: as a *category grant*, the way
he'd give a junior the walk-in customers.

## 13–15 · Permanent human control · recoverable vs fatal

**Permanently his, even with a perfect AI:** the final order-confirmation tap
(one tap per order: negligible cost, enormous felt control, clean liability) ·
VIP first-contact · changing prices/floors · disputes and complaints ·
prepayment/money movement · commitments about products that don't exist yet.
Psychologically this is a feature, not a limit: "the assistant does the grind,
the boss makes the calls" preserves the identity of a man whose self-image *is*
the deal-maker. A product that threatens that identity gets quietly abandoned
even while working.

**Recoverable:** wrong tone, over-asking, harmless slips caught in draft, even
a modest price error to a NEW buyer if the repair protocol runs fast and the
gesture is generous. **Fatal:** embarrassment before an old customer · leaking
one buyer's terms to another · crossed conversations (sending to the wrong
person) · the corrected mistake that returns · scope surprise with a bad
outcome. Note the pattern: fatal errors are relationship errors, not
money errors. Money can be refunded; face cannot.

## 16–18 · The three surfaces

**Digest (≤10 seconds, first-person, an employee's report):** line 1 = 一切正常
or the ONE thing needing him · numbers strip (接待/合格/报价/订单) · one
highlighted story with buyer name+country · max 3 pending taps · footer: what's
on duty today (the current job sheet in one line). No graphs, no links out,
reply-to-act.

**Approval card:** buyer context line (name · country · new/returning · last
product) → buyer's message translated → draft + 中文 back-translation →
why-line (≤1 line) → 发送 / 改一下 / 不回. **Edits by voice note** — a
45-year-old speaks corrections, he doesn't type them. Quote drafts render as an
invoice card, not prose (the calculator reframe made visual).

**Autonomy settings = 工作职责表 (the job sheet):** a duty roster, not
settings. Rows = capabilities, columns = when (夜班/全天) and who (新客户/
除了VIP/全部), each cell 自动 or 先给我看, with one plain-consequence line
underneath («开启后：夜里新客户询价，它会按你的价格表直接报价»). Below: the
employee record — every promotion and demotion with dates, like a personnel
file. And the big red 全部收回.

## 19 · Excitement instead of fear

Pride of authorship («你训练得好» — his judgment made it good) · attributed
wins in the digest · rehearsed reversibility (practice the revoke during
onboarding — a door you've walked through isn't scary) · the job-sheet
contract (no surprise = no dread) · and never, ever nagging. Excitement is
the digest showing money that arrived without his labor. Everything else is
decoration.

## 20 · If the product were designed purely around trust

It becomes a **probation-management system that happens to employ an AI**:
employment metaphor end-to-end (job sheet, night shifts, performance reports,
personnel file); risk-shaped visual language (calculator cards for computed
things, chat bubbles for composed things); three-axis authority
(time/capability/segment); corrections that visibly teach and are verbally
acknowledged; repair protocols with face-saving blame; vivid-moment
engineering over streak accounting; and the permanent guarantee that the final
tap on money is his. Deleted from every owner surface: the word AI, model
names, confidence numbers, latency stats, feature tours, promotion nags.

The engine we built stays — but it becomes the employee's *competence*, not
the product. **The product is the probation.**
