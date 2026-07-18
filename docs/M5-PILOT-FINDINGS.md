# M5 Pilot Findings — Gate A backlog

**Status: AWAITING REAL-OWNER EVIDENCE. Every item below is a placeholder
category, not a finding. Nothing here may be marked resolved, prioritized, or
acted on until it carries an actual observation from the Gate A pilot.**

Capture flow: shadow the owner with `OBSERVATION_TEMPLATE_ZH`
([src/pilot/log.ts](../src/pilot/log.ts)) → transcribe into `pilot_log`
(migration 0012) as structured entries → `renderTriage()` orders the open
items → each fix links back to its entry, its test, and its commit.

## Finding template (copy per observation)

```
### F-___ (awaiting real-owner evidence)
- Observation:
- Evidence (what we saw, verbatim owner quote if any):
- Severity: 1 / 2 / 3        Trust impact: -2 … +2
- Affected surface:
- Proposed change:
- Test to add:
- Resolution:                Commit:
```

## Placeholder categories to watch for (from the trust design docs)

| Category | Why we expect it | Watch during |
|---|---|---|
| 审批卡 hesitation | First-draft approval is the scariest tap | Day 1 |
| Term confusion (审批/抽查/晋升) | Vocabulary is locked but untested on a real 45+ owner | Days 1–2 |
| Back-translation trust | Does 〔意思是〕 actually convince him to tap 发送? | Days 1–3 |
| Notification fatigue or missed push | Push/digest split is designed, not validated | Days 2–5 |
| Night-shift anxiety | First morning after 夜班 is the trust hinge | Day 3 |
| Edit syntax friction | 改+text vs plain text — does he just type? | Days 1–4 |
| Authority misunderstanding | Does he know confirm_order is always his? | Any |
| Chinese naturalness | Any line that reads translated, not written | Any |

None of the above are findings. Do not invent pilot findings.
