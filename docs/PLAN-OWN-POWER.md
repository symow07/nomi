# Plan — she answers on her own power; a model is the fallback

Decided with the owner on 2026-09-19. His words, in short: the product has no
meaning if an outside model is the engine behind every message. She should
analyse and answer from her own understanding and memory, and call a model —
Anthropic, OpenAI or DeepSeek, whichever is configured — only for a question
she has never seen.

## Where it stands today (read from the code, 2026-09-19)

**Already hers — no model involved:** prices and quotes (`computeQuote`), every
guard, "where is my order?" (from the order's row), a question the owner already
taught her (the owner's answer, word for word), a bare yes/no to her own
question, and every fixed sentence (hand-over, order confirmation, stand-in).

**Still a model, on every turn:** understanding the message. `analyzer.analyze`
runs before everything except the yes/no fast path — even when her own rules
then answer. And wording any reply the paths above do not cover. Two more
things found while reading: the analyser is handed no conversation history
(`recentMessages: []`), and every reply the owner approved or edited is
recorded but never reused.

## Three layers

1. **Her own understanding.** A small multilingual embedding model running
   inside the app (no GPU): language, quantity and product by rules and search,
   intent by nearest labelled example. Every analysis a model has already done
   is a free training example. Low confidence falls through to layer 3.
2. **Her own memory of answers.** Every reply the owner approved becomes a
   reusable answer for a similar question about the same product. **A number is
   never reused** — prices change — it is refilled from today's quote engine,
   and the same guards run. The page says where an answer came from. A
   correction overwrites the memory.
3. **A model, any provider, as the fallback.** Only for a genuinely new
   question. `Analyzer` and `ReplyWriter` are already ports. What it writes and
   she approves goes into layer 2, so a business uses it less every week.

Not planned: hosting a large model ourselves. At this volume it costs more than
the API, is weaker in Arabic and Chinese, and is one more thing to keep alive.

## Starting from their history, and an interview

**Import what the business already said**, once, when it joins — a batch of
hours, not a month; the month is the probation that already exists. What each
channel allows (checked against Meta's documentation on 2026-09-19):

| Channel | What can be read |
|---|---|
| E-mail (Gmail, Outlook) | The whole sent folder. The richest source. |
| Instagram, Messenger | Only the 20 most recent messages of each conversation. |
| WhatsApp | Nothing through the API. The owner exports chats from the phone and uploads them. |
| WeChat | Nothing. |

It yields question-and-answer pairs (seeding layer 2), a style profile (filling
each assistant's "how they should sound" note), and facts and discount habits
**as suggestions she confirms** — never adopted silently, because old chats hold
old prices.

**An opening interview**, about a dozen questions tailored to the kind of
business chosen at sign-up, and best driven by gaps the history shows ("in March
you said 30 days, in June 45 — which is right today?"). It covers negotiation:
the lowest price for a first order, when a discount is given, what she must
never promise, when to hand over. Answers go straight into what she knows and
the price rules.

## What can honestly be promised about their data

"It never leaves their device" cannot be true: she must answer at 3 a.m. and a
closed laptop has no address; the messages already pass through Meta and
Google; and analysing history with an outside model sends that history to it.
What can be built and said truthfully, in order:

1. Most messages never reach any model company (layers 1 and 2).
2. When the fallback is used, the buyer's name, phone and e-mail are removed first.
3. We cannot browse a business's data: tenant isolation (exists, tested), a log
   of any operator access, export and delete on demand.
4. Later, for larger clients: an edition that runs on their own server.

## Order of work — each ships on its own

| # | Milestone | State |
|---|---|---|
| N1 | Measure who answered each turn and what it cost | ✅ built 2026-09-19 (0060) |
| N2a | Her own understanding by RULES, in shadow beside the model | ✅ built 2026-09-19 (0061) |
| N2b | Make the shadow agree: product and stage first; embeddings only where rules cannot | next |
| N3 | E-mail history import and the style profile | |
| N4 | The interview, driven by gaps in the history | |
| N5 | The reply memory | |
| N6 | Provider-neutral fallback, with identities removed | |

### N1 · as built

Every turn now records who worded the reply (`turns.answer_path`), how many
model calls it made and their tokens, and whether the analyser's call bought
anything (`analyser_avoidable`: her own rules answered from what she already
had). The operator reads it with `tools/answer-paths.mjs`; the owner sees one
sentence on Results — how many replies came straight from her rules and
teaching. One tested sum feeds both. A first run over the twelve rehearsal
scenarios (synthetic, not real traffic): 5 of 14 replies were hers, and the two
turns where the guards failed twice made six model calls and sent none of the
model's words.

### N2a · as built

A finding first: the rules that decide a turn use only FOUR things from a
model's analysis — the product, the quantity, the stage, and whether it is a
complaint — plus the language to answer in. So her own understanding
(`src/core/conversation/understand.ts`) is rules, not a model: language by
script and small words, a quantity as a number beside a unit (a price, a size
or a duration is not one; a weight only when it is asked for), the product as a
clear leader in the search she already runs, a complaint by its words unless it
asks about a case that has not happened, and the stage from what is known.
`null` always means "I cannot tell".

It runs in SHADOW: computed beside the model's analysis on every analysed
turn, compared field by field, stored on `turns.own_understanding`, and read by
nothing that decides a turn. `tools/answer-paths.mjs` prints the agreement.

Two scoreboards, and they disagree — which is the point of measuring:

- Against the 20 hand-labelled scenarios: language, product, complaint and
  stage agree on all 20; quantity on 17 — the three misses ("the same volume
  again") need MEMORY of the conversation, not better rules. These rules were
  tuned on this set, so it flatters them.
- Against the twelve-scenario rehearsal, through the real product search:
  language, quantity and complaint 100%, **product 46%, stage 23%**, right
  about everything on 3 of 13 turns. Part of that is the rehearsal's scripted
  analyser answering the same product whatever was asked; part is real. Nothing
  may stop asking a model on this evidence. N2b starts from the disagreeing
  rows, and real traffic (once a model is analysing again) is the judge.
