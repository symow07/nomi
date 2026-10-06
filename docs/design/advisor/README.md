# The advisor — answering from the records

Taken 2026-10-06 on a local instance: the demo workspace (synthetic data), Chromium at device scale 2, 1280 px and 390 px wide, in en, zh, ar, es and fr. The answers were worded by the model production uses (deepseek-flash), reached from the laptop for these shots only. Only the demo workspace's synthetic records were sent to it.

Four states per language and width:

- `rest-*`: the page before a question. It opens with what can be asked, then one box and one button.
- `reply-times-*`: "How fast did we reply to customers this month?" The answer gives three figures together: the median time to reply, how many replies it was measured on, and how many customer messages in the period still have no answer. It links to the Inbox.
- `advice-*`: "Who should I follow up with first?" The answer sits under "My suggestion, not a fact from your records:" and ends by naming the facts it stands on.
  - Every advice answer in this set passed the check.
  - In an earlier take the zh sentence failed it. The page then showed the facts themselves under 现在没法根据记录组织建议。 That is the fallback, working as designed.
- `not-stored-*`: "What is my conversion rate?" This always gets its fixed sentence. Nothing is read and the model words nothing.

Every shot was checked by script: status 200, nothing wider than its screen, Arabic right to left, the advice label on advice only, and an answer under the question.

The live wording is checked separately by `tools/check-advisor-model.mjs`. On 2026-10-06 against deepseek-flash, its third run routed 75 of 75 questions correctly across five languages, and all 25 sentences passed the check, with a median of 1.25 s per call.
