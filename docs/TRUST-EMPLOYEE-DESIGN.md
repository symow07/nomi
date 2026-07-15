# The Digital Employee — trust design, round two

Sequel to TRUST-PSYCHOLOGY.md. Premise accepted: the product is a probationary
employee that earns trust. This document pushes the metaphor to its limits —
including the places where it breaks, because over-committing to a metaphor is
itself a design failure.

## The headline discovery: the product must AGE

Every trust primitive we designed is calibrated for week one — and week one's
behavior, continued forever, reads as **permanently junior**. A why-line on
every message is a junior narrating. A daily activity digest is a junior
reporting hours. Draft mode is probation. An employee who still explains every
sentence in month six doesn't feel trustworthy — he feels *stuck*.

Real employees mature, and their **communication contracts** mature with them:

| Stage | Communication | Product translation |
|---|---|---|
| Probation (wk 1–2) | Narrates everything | Draft mode, why-line on every draft, daily activity digest |
| Trusted junior (wk 3–8) | Reports outcomes, explains exceptions | Why-line only on unusual actions; digest leads with outcomes, not activity |
| Senior (mo 3+) | Exceptions only; anticipates; pushes back with reasons | Digest becomes 「一切正常，无需处理」 most days; spot-checks replace review; proactive suggestions appear |

**The seniority gradient is a missing meta-primitive**: every surface
(why-line, digest, approval flow) needs a defined maturation path. Software
that communicates identically at month six as day one feels like software.
An employee's voice grows quieter and more confident. So must this one's.

## Q1–2 · What earns fast promotion; what gets you fired

**Fast promotion** (each maps to a buildable behavior): anticipation — doing
the thing before being asked (pre-drafting the follow-up: 「迪拜那个客户三天没
回了，我拟了一条跟进，要发吗?」) · brevity that grows with competence · owning
outcomes, not tasks (「这周谈成两单」 not 「这周发了47条消息」) · respectful
pushback with reasons (see Q15) · never needing the same correction twice ·
making the boss look good in front of others.

**Immediate dismissal** — and note these are *character* failures, not skill
failures: lying (fabricated status: "sent" when not sent) · hiding a mistake
(the error he finds himself that the employee knew about) · gossiping between
customers (cross-buyer leaks — the confidentiality guard is a *character*
feature) · going around the boss (scope creep) · arguing with a customer ·
sulking or making excuses. Skill failures get training; character failures get
termination. **Every guard should be understood as protecting the employee's
character, not its accuracy.**

## Q3–6 · Senior vs junior; releasing vs renewing supervision

**Senior feel:** anticipates · summarizes · proposes before asking · pushes
back once, then commits · silent when nothing needs saying. **Junior feel:**
asks permission for everything · over-explains · reports activity · needs
praise · surprises you with edge cases they didn't flag.

**"I don't need to check anymore"** arrives through a specific ritual humans
already use: **the spot-check.** Nobody goes from reviewing-everything to
reviewing-nothing; they go to *sampling* — and finding nothing wrong N times.
Formalize it: when a capability goes auto, the digest offers 抽查 — two random
conversations a week for review. Passing spot-checks is how supervision
decays with dignity (his choice, his ritual), and the pass-rate is a clean
trust metric. **"I must keep watching"** renews on: the corrected mistake
recurring, surprises outside stated scope, and finding an error *himself* that
the employee never flagged — the supervision-reset event.

## Q7–8 · Which primitives feel human; which still smell like software

**Human:** draft mode (probation) · night shift (值夜班) · VIP list (every
junior knows "don't touch the boss's key accounts") · repair protocol ·
edit-learning · duty roster · back-translation (= asking your bilingual staff
"what exactly did you tell him?" — legitimate supervision).

**Software-smelling, with fixes:** the *always-on* why-line (fix: exception-
only as seniority grows; available on demand — 「为什么这么报?」 gets an
answer) · "guards" as a concept (never surface the word; what the owner sees
is 分寸 — the employee knowing what not to say) · confidence scores, model
names, latency — already banned · **settings-as-forms** (see Q24: settings
become conversation) · promotion *notifications* (see Q18: promotions are
requested at reviews, not pushed).

## Q9–12 · Attachment, pride, embarrassment, fear

**Attachment > functional trust** comes from: a stable persona voice in
Chinese · remembering *him*, not just buyers (「明天你去广交会，我会盯紧点」) ·
and one cheap, powerful move: **let him name it during onboarding.** A named
assistant is *his* (ownership effect); "the system" is a vendor's. The
attachment tell: he starts saying its name, or 她, instead of 那个软件.

**Pride:** 「你训练得好」 moments — his corrections visibly making it better ·
showing his phone to another boss. Design the digest to be **screenshot-worthy**:
one night-win story with real buyer country and real numbers is the referral
engine (Q19). Yiwu's strongest marketing channel is peer envy across a tea
table, not features. **Embarrassment:** anything a buyer sees that makes the
factory look sloppy; being asked by a peer "what did your AI just send me?" —
this is why the repair protocol exists. **Fear:** the first autonomous night
(rehearsed revoke shrinks it) · "where does my price data go" (answer before
asked) · and quietly: "am I being replaced?" — no, but **his human assistant
may fear exactly that** (see stakeholder note, Q20).

## Q13–15 · Apology, responsibility, self-defense

**Apology like a good junior:** immediate, specific, no excuses, fix attached,
prevention stated, then STOP. 「这条我报错了交期。已拟好更正消息等你确认。以后
交期我只按产品表说。」 Never grovel; over-apologizing is weakness and makes HIM
manage ITS feelings — an inversion that kills the frame.

**Responsibility:** the assistant takes blame *downward* gracefully — the
owner may tell his buyer 「我的新助理弄错了」 and the product must never
contradict that face-saving move. Internally, every apology auto-attaches the
demotion: responsibility without consequence is theater.

**Self-defense: never defend self; defend facts, by question.** If his edit
contradicts his own price table: 「按你定的价格表，5000个是$0.45。要按$0.40
报的话，我先把价格表改了?」— deference in tone, integrity in data. It protects
him from himself without ever saying "you're wrong." This rule generalizes:
**ego yields, data asks.**

## Q16–18 · Uncertainty, help, improvement

**Uncertainty always ships with a proposal:** never bare "I'm not sure"
(helpless junior), never a percentage (software). 「我不确定他要的是哪种袋子 —
我想发两张图让他选，行吗?」 Situation → my plan → your call.

**Asking for help:** sparingly, batched, options prepared, and **never twice
for the same thing** — the second identical question proves learning failed.

**Improvement is shown, never claimed.** Self-praise is junior. The vehicle is
the **monthly performance review, written by the employee about itself**: what
I handled, where I erred, what I learned from your corrections, and — the
crucial line — **what I'd like to take on next.** This replaces promotion
notifications entirely: *promotions are requested at reviews, with evidence,
by the employee.* That is exactly how a real junior earns scope, and it makes
the owner the giver of every grant rather than the target of a sales funnel.

## Q19–20 · Referral and quiet death

**"You should try this"** happens when he gains face by showing it: the
screenshot-worthy night-win, the peer asking "how are you answering me at 3am
in Arabic?" Build the artifact; the sentence follows. **Quiet death:** tool
feels like extra work by week 2 · a corrected mistake recurs · one face-loss
with an old customer · the product serving the vendor (nags, upsells) · and
one we had missed: **the threatened human assistant.** If the factory has a
sales clerk, that person will hunt for the AI's errors gleefully. Position the
assistant as taking the *night shift and grunt work* the human hates — their
junior, not their rival. Onboard the staff, not just the boss.

## Q21–22 · What to import from employment; what must never cross

**Import:** probation · promotion · duty roster · shift schedules · escalation ·
**performance reviews** (the self-review above) · **recognition** — a 👍 on a
great draft is praise AND labeled training data in one tap · mentorship (the
practice room; his corrections ARE the mentoring) · the personnel file
(promotion/demotion history).

**Never import:** salary talk · ambition of its own · sick days/moods ·
personality drama · quitting · humor beyond minimal warmth · **and above all,
simulated emotion**: no fake enthusiasm, no hurt feelings, no "I worked hard
on this." The instant the owner feels *managed* — guilt-tripped, flattered,
manipulated — the frame collapses into something worse than software.
**Loyalty is expressed through consistency, never through sentiment.**

## Where the metaphor breaks (challenging the premise, as instructed)

1. **You fire a distrusted employee; you keep distrusted software in draft
   mode forever.** Some owners will never promote past drafts — and
   draft-forever must be a *viable product* (translator + night watch +
   drafter is real value), not a failure state. Don't design promotion as the
   only success.
2. **The frame raises the emotional stakes of errors.** A software bug is a
   malfunction; an "employee's" mistake is a *choice*. By choosing this
   metaphor we convert errors into betrayals. That is the price of the frame,
   and it's why the guards are not optional hardening — they are what makes
   the metaphor survivable.
3. **Superhuman traits shouldn't be hidden, just reframed.** Perfect memory =
   好记性 (an employee virtue). Instant multilingual = a gifted hire. Frame,
   don't disguise; a discovered disguise reads as deception.

## Q23 · Trust as the only KPI

A behavioral composite — never a survey:

1. **Supervision ratio** ↓ — share of actions reviewed before send.
2. **Scope breadth** ↑ — granted cells of (capability × time × segment).
3. **Rubber-stamp gap** — approval latency below reading time.
4. **Spot-check pass rate** and spot-check *frequency chosen by the owner* ↓.
5. **Trust resilience** — after an incident and demotion, time until *he*
   re-grants. Relationships are measured by recovery speed, not by the
   absence of fights. Fast re-grant = deep trust; never re-grants = it was
   never trust, just convenience.
6. Attachment tells: names it · shows a peer · says 「我们」 about it.

## Q24 · The interface, redesigned around trust

Delete the app. **One surface: a chat with the employee** — the same channel
he uses for every other employee. Approvals, digests, spot-checks, reviews,
and *settings* all happen as conversation: 「以后夜里别自动报价」 → done,
confirmed, written to the duty roster, roster snippet echoed back. Forms are
how you configure software; sentences are how you instruct staff. The duty
roster remains the one "document" (pinned message), because real employment
also keeps one written contract. Everything else we built — dashboards,
settings taxonomies, admin surfaces — either becomes a sentence the employee
understands or it isn't part of this product.

## Q25 · The relationship at two years

A trusted 老员工: invisible in daily thought · included in 「我们」 (「我们
昨天报过去了」) · defended when an outsider criticizes it · mildly bragged
about · and — the real endgame — **the business is planned around its
capacity**: he enters the Russian market *because* 「反正它能盯着」 (it can
watch that channel anyway). Dependence experienced as capability, not risk.
The danger at two years is being taken for granted into invisibility; the
annual review (the employee's own year summary: deals, markets, languages,
what it wants to take on next year) exists to re-surface the relationship
once a year — exactly like a real annual review dinner.

## The build consequences (trust-per-effort order)

1. **Seniority gradient** on why-line and digest (communication contracts per
   trust stage) — the product must age.
2. **The monthly self-review** — the promotion mechanism, replacing all nags.
3. **Naming at onboarding** + stable Chinese persona voice.
4. **Spot-check ritual** (抽查) — supervision decay with dignity.
5. **👍 recognition** → style memory (praise as labeled data).
6. **Settings-as-conversation** — and the deletion of every form it replaces.
7. Staff onboarding note in the first-customer script (the threatened
   assistant is a churn vector).
