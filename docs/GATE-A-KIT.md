# Gate A 执行包 — 第一个真实老板，一周试点

One page. Everything in order. Existing docs are linked, not repeated.

## 0 · 硬前提（Gate A 无法绕过这些）
Gate A needs the LIVE loop — the demo's wow moment is real vision + real
WhatsApp, and the pilot week is real traffic. So the order is fixed:

1. **git remote + push**（今天，5分钟——所有提交仍只在这台机器上）
2. **凑齐钥匙**：360dialog sandbox key · ANTHROPIC_API_KEY · 独立 PostgreSQL
   的 `DATABASE_URL`（yiwuflow_app 运行角色）+ `MIGRATE_DATABASE_URL`（管理角色，
   见 POSTGRES-MIGRATION-RUNBOOK.md）· `openssl rand -hex 32` → CREDENTIAL_KEY ·
   一个隧道/主机
3. **跑一遍 [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md)**（<30分钟，8步）
   — 全绿才有资格演示

## 1 · 冷演示（找老板前，自己先跑三遍）
Script: [DEMO-SCRIPT.md](DEMO-SCRIPT.md)。20秒主打时刻 + 3个备用看点 +
收尾问题（你现在半夜的询盘，是谁在回？）。

**演示前检查单：**
- [ ] 两台手机满电：买家机（发图）+ 老板机（收审批卡）
- [ ] 演示工厂数据在线（seeded：12产品/6买家/5对话/信任历史）
- [ ] 发一张帆布袋照片走通全链路（认出 ZX-100 → 报价卡）——当天早上验一次
- [ ] 手机勿扰模式关掉；网络用热点，不赌现场 WiFi
- [ ] 失败预案：链路断了就翻 对话回看 + 今日总结 + 员工档案（全是真数据）

**成功标准（spec）**：对方掏手机拍，或者问「多少钱」。
两者都没有 → 记下让他皱眉的那一秒，那就是下一个要修的东西。

## 2 · 试点周（7天，一天一个信任节拍）
Product side is already sequenced (first-week journey, core/trust/journey.ts):
Day1 介绍+职责表+第一条审批 · Day2 第一次修改被记住 · Day3 第一个夜班早报 ·
Day4 第一次抽查 · Day5 老买家记忆 · Day6 进度更新 · Day7 员工周报。

**你每天要做的只有三件：**
1. 早上看一眼他的今日总结截图（他授权转发）
2. 他每次卡住/困惑/惊喜——按观察模板记原话（见下）
3. 晚上 10 分钟：把当天记录转进 pilot_log

## 3 · 观察与记录（这个 log 就是 M5 findings 的全部来源）
Shadow template（背下来或抄在手机备忘录）：`OBSERVATION_TEMPLATE_ZH`
in [src/pilot/log.ts](../src/pilot/log.ts) —— 只记录，不解释、不辩护、不教他。

**当晚转录（每条30秒，Supabase SQL editor 或 MCP）：**
```sql
insert into pilot_log (business_id, at, owner_label, surface, kind, event,
  owner_expected, what_happened, owner_quote, severity, trust_impact,
  suggested_fix, blocks_launch)
values ($pilot_biz, '2026-07-21 09:15+08', '王老板', '审批卡',
  'hesitated_before_approval', '盯着卡片12秒才点发送',
  '', '', '这个英文我又看不懂发的对不对', 2, -1,
  '', false);
```
kind 用 19 个枚举之一（log.ts）。周末跑 `renderTriage()` 出优先级清单 →
逐条填进 [M5-PILOT-FINDINGS.md](M5-PILOT-FINDINGS.md)（模板已就位）。

## 4 · 一周结束的判定
- **过 Gate A**：老板还在用（不是你求他用），且 log 里没有未修的 blocker
- **M5 exit（可稍晚）**：他自己主动给某项工作放权（晋升）
- 无论过没过：pilot_log → triage → 修复清单，就是下一个开发周期的全部输入

## 我这边随叫随到的事
观察记录发我 → 我转录+triage+修复；连接卡住 → 按 M3 健康卡的提示走，
不行发我 `channels.last_error`；任何 owner 文案他读着别扭 → 原话发我，当天改。
