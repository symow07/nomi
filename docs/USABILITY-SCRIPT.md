# 可用性测试脚本 · Usability script

五个任务，四十分钟。中文在前，因为主持人是用中文念的。English follows.

**这份脚本的目的不是证明产品好用。** 是找出哪一步会卡住。参与者卡住 = 脚本成功。

---

## 给主持人的规则

1. **不要帮忙。** 参与者问"这个按哪里"，你回答："你觉得应该按哪里？" 然后等。
2. **不要解释。** 如果你需要解释才能让人完成，那就是一条结果。
3. **数到十再开口。** 沉默很难熬，但沉默里才有观察。
4. **念任务，不念路径。** 说"找出哪位买家在等你回复"，不要说"打开买家页面"。
5. **记时间，也记停顿。** 停在哪一屏，比总共花多久更有用。
6. **一次只测一个人。** 两个人会互相提示。

开场白，逐字念：

> 我们在测这个产品，不是在测你。哪里卡住都是产品的问题，不是你的问题。
> 请你一边做一边说出你在想什么——你在找什么、你觉得按下去会发生什么。
> 做不出来也完全没关系，那正是我们需要知道的。

---

## 开始前的准备

工作台里要有真实的样子，不能是空的：

- 至少 **60 个对话**（这样才测得到窗口的问题）
- 其中 **一个交给了员工、已经回过、很久没动** —— 这是 A9 修的那一类
- 至少 **一条等你批准的草稿**
- 至少 **三个产品，其中一个有价格档位**
- **昨天**要有活动，这样"结果"页才有东西看
- Instagram **未连接**
- 参与者用自己的手机，或者 390px 宽的浏览器窗口

### 两条命令，把工作台准备好

在这台电脑上跑一个本地实例（不碰线上），再把测试用的工作台铺上去：

```bash
bash .claude/skills/run-nomi/smoke.sh
MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node tools/seed-usability.mjs
```

第二条会把上面的清单逐项核对一遍，全部打勾才算准备好。参与者在 390px 宽的
浏览器窗口打开 http://127.0.0.1:8787/login ，点「我有进入密码」，输入 `smoke-code`。

本地实例和线上的三处差别，主持人要知道：

- 「等你」里会有两条：交给陈莉的那条（任务一），和等你批准的草稿（任务二）。
  任务一照原话念，成功标准不变。
- 任务二按下「发送」后看到的是「已保存。消息通道还没打开，所以没有发给买家。」
  本地没有接通道，这句就是确认。
- 任务五点「连接」不会真的跳到 Instagram（本地没有配置 Meta）。找到渠道页、
  按下去，就算完成。

---

## 五个任务

### 任务一 · 找出哪位买家在等你回复

> 「现在有一位买家在等你，别人都不等。把他找出来，告诉我他是谁。」

| | |
|---|---|
| 成功 | 打开了那个交给员工的对话 |
| 观察 | 先点哪个菜单？「买家」还是「客户」？犹豫多久？ |
| 会怎么错 | 在「客户」和「买家」之间来回；以为列表就是全部；往下滑找 |
| 这在测 | 两个列表同一件事（F6），以及 A9 修好了没有 |

### 任务二 · 批准一条回复

> 「她写好了一条回复在等你。看一下，然后让它发出去。」

| | |
|---|---|
| 成功 | 按了发送，看到了确认 |
| 观察 | 有没有往上滚去看买家原话？还是直接就批了？ |
| 会怎么错 | 看不到买家问的是什么（草稿在上面，对话在下面 F7）；不确定按下去会不会真的发出去 |
| 这在测 | 对话页的顺序，和「发送」这个词够不够明确 |

### 任务三 · 改一个产品的价格

> 「这个产品你想涨价。去改。」

| | |
|---|---|
| 成功 | 改了并保存 |
| 观察 | 走「我的生意 → 产品」还是去「价格底线」？分得清两者吗？ |
| 会怎么错 | 把「价格底线」当成改价的地方；找不到「我的生意」里的产品 |
| 这在测 | 「我的生意」这个抽屉，和产品/价格限制的命名 |

### 任务四 · 看昨天的结果

> 「昨天她做了些什么？找出来。」

| | |
|---|---|
| 成功 | 打开了「结果」页 |
| 观察 | **有没有找到入口？** 这一题修好之前是找不到的（CC-05） |
| 会怎么错 | 在「今天」里找；放弃；问你 |
| 这在测 | C 改动（把「结果」放上「今天」）有没有用 |

### 任务五 · 连接 Instagram

> 「你想让买家也能从 Instagram 找到你。去把它接上。」

| | |
|---|---|
| 成功 | 找到了渠道页并开始连接 |
| 观察 | 去「设置」还是「我的生意」？看到只有 WhatsApp 时什么反应？ |
| 会怎么错 | 找不到渠道页；以为产品不支持 Instagram（CC-11） |
| 这在测 | 「设置」独立成菜单项有没有帮助，以及只显示 WhatsApp 的那张卡 |

---

## 结果表

一位参与者一张表。**「卡住」比「秒数」重要。**

| 任务 | 完成 | 秒数 | 走错几步 | 卡在哪一屏 | 原话 |
|---|---|---|---|---|---|
| 1 找出等你的买家 | ☐ 自己 ☐ 提示后 ☐ 没做到 | | | | |
| 2 批准回复 | ☐ 自己 ☐ 提示后 ☐ 没做到 | | | | |
| 3 改价格 | ☐ 自己 ☐ 提示后 ☐ 没做到 | | | | |
| 4 看结果 | ☐ 自己 ☐ 提示后 ☐ 没做到 | | | | |
| 5 连 Instagram | ☐ 自己 ☐ 提示后 ☐ 没做到 | | | | |

**「走错几步」** = 打开了又退出来的页面数。这是这张表里最有用的一列：它直接说明东西放错了地方。

测完问三句：

1. 哪一步最烦？
2. 有没有哪个词你看不懂是什么意思？
3. 如果明天就用它做生意，你最担心什么？

---

## 怎么读这张表

- **三个人里有两个在同一屏卡住** → 那是结构问题，改 IA。
- **三个人都完成了但都绕了路** → 那是命名问题，改文案。
- **有人说「我以为这个是……」** → 照他的话改标签，不要照你的想法。

一个人做不出来不算数据。**三个人做不出同一件事才算。**

---
---

# English

Five tasks, forty minutes. The Chinese above is the version that gets read
aloud; this is for whoever writes up the results.

**The goal is not to show the product works.** It is to find where someone
gets stuck. A stuck participant is a successful session.

## Rules for the facilitator

1. **Do not help.** "Where do I click?" is answered with "Where do you think?"
   and then silence.
2. **Do not explain.** If it needs explaining to be done, that is the finding.
3. **Count to ten before speaking.**
4. **Read the task, never the path.** "Find the buyer waiting on you", never
   "open the Buyers page".
5. **Record time, and record pauses.** Which screen they stalled on is worth
   more than the total.
6. **One person at a time.**

## Before you start

The workspace must look real: **60+ conversations**, one of them **handed to a
staff member, already replied to, long idle** (the A9 case); at least one
**draft awaiting approval**; three products, one with price tiers; activity
**yesterday** so Results has something to show; Instagram **not connected**;
their own phone or a 390px window.

**Two commands prepare it**, on this machine, against a local instance that
never touches production:

```bash
bash .claude/skills/run-nomi/smoke.sh
MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node tools/seed-usability.mjs
```

The second checks the list above line by line and says "Ready" only when
every line holds. The participant opens http://127.0.0.1:8787/login in a
390px window, taps "I have an access code", and enters `smoke-code`.

Three things a local instance does differently, for the facilitator:

- Waiting lists two: the conversation handed to 陈莉 (task one) and the draft
  awaiting approval (task two). Read task one as written; success is unchanged.
- After Send in task two the notice reads "Saved. Messaging is not switched
  on yet, so nothing went to the buyer." No channel is connected locally; that
  line is the confirmation.
- Connect in task five does not reach Instagram (no Meta configuration
  locally). Finding Channels and pressing it is the success.

## The five

| # | Task, as spoken | Success | What it tests |
|---|---|---|---|
| 1 | "One buyer is waiting on you and the others are not. Find him." | opens the handed conversation | two lists for one idea (F6); whether A9 holds |
| 2 | "She has written a reply. Look at it, then let it go." | sends, sees confirmation | does the conversation page let them read the question first (F7) |
| 3 | "You want to raise this product's price. Go and change it." | edits and saves | the My-business drawer; Products vs Price limits |
| 4 | "What did she do yesterday? Find out." | opens Results | **whether there is a door at all** (CC-05) |
| 5 | "You want buyers to reach you on Instagram too. Connect it." | finds Channels, starts connecting | Setup as its own entry; the WhatsApp-only card (CC-11) |

## Results table

One per participant. **"Stuck" matters more than seconds.**

| Task | Done | Seconds | Wrong turns | Screen they stalled on | What they said |
|---|---|---|---|---|---|
| 1 | ☐ alone ☐ after a nudge ☐ not done | | | | |
| 2 | ☐ alone ☐ after a nudge ☐ not done | | | | |
| 3 | ☐ alone ☐ after a nudge ☐ not done | | | | |
| 4 | ☐ alone ☐ after a nudge ☐ not done | | | | |
| 5 | ☐ alone ☐ after a nudge ☐ not done | | | | |

**Wrong turns** = pages opened and backed out of. It is the most useful column
here: it says directly that something is in the wrong place.

Three questions at the end: which step was most annoying · was there a word
you did not understand · if you ran your business on this tomorrow, what would
worry you most.

## Reading it

- **Two of three stall on the same screen** → structural. Change the IA.
- **All three finish but all three detour** → naming. Change the words.
- **"I thought this was…"** → relabel it in their words, not yours.

One person failing is not data. **Three people failing the same task is.**
