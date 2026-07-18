# M4 — The Cold Demo (义乌宏发日用品厂, demo company)

Single source of truth for the storyline is `renderDemoScript()` in
[src/demo/factory.ts](../src/demo/factory.ts); this file adds the operator
notes. The demo company is seeded in the live DB (business id
`de300000-…-0000000000b1`, all ids fixed — reseeding is idempotent).

## The moment (20 seconds)
1. From the buyer phone: send a photo of a canvas bag, caption `need 5000 pcs`.
2. Owner phone pushes: `Fatima 发来产品图，等你审批`.
3. Open the approval card: 认出了：帆布袋（ZX-100）, quote card computed
   from the price table (5,000 pcs tier), draft + 〔意思是〕back-translation.
4. Tap 发送 — the buyer receives the English quote immediately.
5. Closing line: **图是它认的，价是按你价格表算的，发不发你说了算。**

## Backup beats (10s each)
- 对话回看: Ahmed (阿联酋), 20,000 thermos at $2.10 — mid-negotiation.
- 今日总结: last night's 夜班 handled a new Russian buyer.
- 一键收回: instant pause, back to probation.

## Closing question
「你现在半夜的询盘，是谁在回？」

## Exit criterion (spec)
They film it or ask "how much?" — anything less, note what confused them
and fix the moment, not the pitch.
