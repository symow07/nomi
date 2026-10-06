# Native review — reworded UI strings (zh, ar)

**Not a gate.** Nothing here blocks sending, autonomy or deploys. The only strings
whose review gates anything are the disclosure sentences
(`DISCLOSURE_NATIVE_REVIEW` in `src/core/conversation/disclosure.ts`); these are
listed separately there and are NOT in this file.

**Why these changed (2026-09-23).** The assistant has no pronouns anywhere in the
product: copy uses the name the owner confirmed (`{name}`), or "your assistant"
/ 你的助手 / مساعدك until there is one. In Arabic, in the same pass, the owner is
no longer addressed in the feminine — nor in the masculine: buttons use the
verbal noun, sentences a noun phrase, the passive or «يمكن / يُرجى». The unvowelled
suffix ـك stays (it is not gender-marked in writing). Buyer-facing pages
(`legal.*`, `unsub.*`) follow the same rule for the buyer.

**How to review.** For each line: does the new string say what the English says,
in natural language an owner would use, with nothing that genders the assistant
or the reader? Mark a line by editing it in `src/core/owner/i18n/messages.ts`
and noting the key in the PR. `{name}` renders as the confirmed name or the
fallback phrase — read it both ways.

Reviewer: ______  Date: ______


## 中文 — 227 strings

### `factory.next.first_success`

- en: Send {name}'s first reply to a buyer
- before: 发出她给买家的第一条回复
- **after: 发出给买家的第一条回复**

### `activation.action.confirm`

- en: Let {name} answer the people on your list? Every reply is written for you and waits for your OK — you send it. You can stop at any time.
- before: 让{name}回复名单上的人？每条回复她都先写好等你点头，还是你发出去。你随时可以叫停。
- **after: 让{name}回复名单上的人？每条回复都会先写好，等你点头，还是由你发出去。你随时可以叫停。**

### `activation.stop.what`

- en: Stopping means nothing further is sent. Your buyers, conversations and everything you taught stay exactly as they are, and you can start again whenever you want.
- before: 停下之后她不会再发任何消息。买家、对话、你教过她的东西都原样留着，你随时可以再开始。
- **after: 停下之后不会再发任何消息。买家、对话和你教过的东西都原样留着，你随时可以再开始。**

### `activation.stillDrafts`

- en: Going live does not change who decides: {name} still writes, you still send.
- before: 上线不改变谁做主：还是她写，你发。
- **after: 上线不改变谁做主：还是{name}写，你发。**

### `allowlist.note`

- en: Only these numbers can receive anything from {name}. Anyone else who writes still reaches you — they just will not get an answer.
- before: 只有这些号码能收到{name}的消息。别人来找你还是能找到你，只是她不回。
- **after: 只有这些号码能收到{name}的消息。别人来找你还是能找到你，只是不会收到回复。**

### `allowlist.remove.confirm`

- en: Remove {who}? {name} will stop answering them. Nothing else changes.
- before: 把{who}移出名单？{name}就不再回他了。别的都不变。
- **after: 把{who}移出名单？{name}就不再回复对方了。别的都不变。**

### `allowlist.flash.removed`

- en: {who} removed. {name} will not message them.
- before: 已把{who}移出。{name}不会再发消息给他。
- **after: 已把{who}移出。{name}不会再给对方发消息。**

### `factory.ready.title`

- en: Before {name} talks to real buyers
- before: 让她见真买家之前
- **after: 让{name}见真买家之前**

### `factory.ready.practice`

- en: Practise with {name}
- before: 和她练一练
- **after: 和{name}练一练**

### `factory.rehearsal.none`

- en: Every product checked has a price {name} can quote and something you have taught.
- before: 她查过的每个产品都有能报的价，也都有你教过的内容。
- **after: 查过的每个产品都有能报的价，也都有你教过的内容。**

### `factory.rehearsal.no_price`

- en: No price is set, so {name} cannot quote these:
- before: 这些还没定价，她报不了价：
- **after: 这些还没定价，报不了价：**

### `factory.rehearsal.no_price_at_moq`

- en: Your prices do not cover your own smallest order, so {name} cannot quote these:
- before: 你的价格表没覆盖自己的起订量，这些她报不了价：
- **after: 你的价格表没覆盖自己的起订量，这些报不了价：**

### `factory.rehearsal.floor_above_price`

- en: Your lowest acceptable price is above your own list price, so {name} refuses instead of quoting at a loss:
- before: 你的最低价高过自己的标价，这些她宁可不报也不亏本报：
- **after: 你的最低价高过自己的标价，这些宁可不报，也不亏本报：**

### `factory.rehearsal.nothing_taught`

- en: You have not taught {name} anything about these beyond the price:
- before: 除了价格，这些你还没教过她任何内容：
- **after: 除了价格，这些你还没教过任何内容：**

### `factory.rehearsal.claim_not_authorised`

- en: If a buyer asks whether you are certified, {name} will not confirm anything — you have authorised nothing yet.
- before: 买家问你有没有认证，她不会给任何确认——你还一个都没授权。
- **after: 买家问你有没有认证，{name}不会给任何确认——你还一个都没授权。**

### `factory.sell.allPriced`

- en: {name} can quote every one of them.
- before: 每一个{name}都能报价。
- **after: {name}每一个都能报价。**

### `factory.promise.ceiling`

- en: {name} never discounts more than {ceil}%.
- before: 她最多让{ceil}%。
- **after: 最多让{ceil}%。**

### `factory.promise.ceilingVaries`

- en: {name} never discounts more than {ceil}% — less on some products.
- before: 她最多让{ceil}%，有些产品还更少。
- **after: 最多让{ceil}%，有些产品还更少。**

### `factory.promise.ask`

- en: Above {ask}% off, you are asked before the price goes out.
- before: 让到{ask}%以上，她会先问你再报价。
- **after: 让到{ask}%以上，会先问你再报价。**

### `factory.promise.askVaries`

- en: Above {ask}% off, you are asked before the price goes out — sooner on some products.
- before: 让到{ask}%以上，她会先问你再报价；有些产品更早就问。
- **after: 让到{ask}%以上，会先问你再报价；有些产品更早就问。**

### `factory.promise.never`

- en: Anything you have not confirmed here, {name} will not say — even if a buyer insists.
- before: 你没有在这里确认过的，她不会说，买家追问也不会。
- **after: 你没有在这里确认过的，{name}不会说，买家追问也不会。**

### `factory.promise.more`

- en: Teach {name} more
- before: 再教她一些
- **after: 再多教一些**

### `factory.reach.nextReady`

- en: This number is connected. Once you start {name} below, buyers who message it reach {name}.
- before: 号码已连接。在下面让{name}开始，之后发到这个号码的消息她才会收到。
- **after: 号码已连接。在下面让{name}开始，之后发到这个号码的消息才会有人接。**

### `header.stage`

- en: Probation · you're mentoring {name}
- before: 试用期 · 你在带她
- **after: 试用期 · 你在带{name}**

### `data.export.subject.teaching`

- en: What you taught
- before: 你教给她的
- **after: 你教过的内容**

### `data.export.configLead`

- en: The part nobody wants to type twice: your floors and discounts, the terms you sell on, and every fact you taught.
- before: 这部分没人愿意再输一遍：你的底价和折扣、你的销售条件，以及你教给她的每一条。
- **after: 这部分没人愿意再输一遍：你的底价和折扣、你的销售条件，以及你教过的每一条。**

### `data.deletion.lead`

- en: Everything this workspace holds — buyers, messages, products, orders, everything you taught — removed for good.
- before: 这个工作台里的一切——买家、消息、产品、订单、你教她的东西——永久删除。
- **after: 这个工作台里的一切——买家、消息、产品、订单、你教过的东西——永久删除。**

### `data.deletion.byHand`

- en: This is not a button that erases. A person receives the request and does it by hand, and you can take it back until they have. Nothing here can delete anything on its own.
- before: 这不是一个按下去就清空的按钮。有人收到请求后手动处理；在他做之前，你随时可以撤回。这里没有任何东西会自己删掉记录。
- **after: 这不是一个按下去就清空的按钮。有人收到请求后手动处理；在处理完成之前，你随时可以撤回。这里没有任何东西会自己删掉记录。**

### `ops.activity.handled`

- en: Buyers answered
- before: 她聊过的买家
- **after: 聊过的买家**

### `her.knows.title`

- en: What {name} knows
- before: 她知道什么
- **after: {name}知道什么**

### `her.knows.count`

- en: Things learned from you
- before: 你教给她的内容
- **after: 你教过的内容**

### `her.knows.none`

- en: Nothing has been taught yet. Start with the facts buyers ask about most.
- before: 还没教过她任何东西。先教她买家最常问的那些。
- **after: 还什么都没教过。先教买家最常问的那些。**

### `her.handles.title`

- en: What {name} handles alone
- before: 她可以自己处理的
- **after: {name}可以自己处理的**

### `her.handles.alone`

- en: Handled without you
- before: 她自己处理
- **after: 自己处理**

### `her.teach.title`

- en: What {name} still needs from you
- before: 她还需要你教的
- **after: 还需要你教的**

### `her.teach.none`

- en: Nothing waiting — everything was answered from what you taught.
- before: 没有待办——你教过的内容够她回答了。
- **after: 没有待办——你教过的内容够回答了。**

### `her.teach.unasked`

- en: No buyer has asked anything yet. Teach {name} what they ask about most.
- before: 还没有买家问过她。先教她买家最常问的那些。
- **after: 还没有买家来问过。先教买家最常问的那些。**

### `her.teach.go`

- en: Teach {name}
- before: 教她
- **after: 去教**

### `buyers.badge.review`

- en: Review {name}'s reply
- before: 看看她的回复
- **after: 看看这条回复**

### `buyers.review.title`

- en: Review {name}'s reply
- before: 看看她的回复
- **after: 看看{name}的回复**

### `buyers.review.intro`

- en: {name} wrote this for {buyer}. Send it, change it, or skip it.
- before: 这是她为{buyer}写的。可以直接发、改一改，或者不回。
- **after: 这是写给{buyer}的回复。可以直接发、改一改，或者不回。**

### `buyers.knew.title`

- en: What {name} used to answer
- before: 她用到的内容
- **after: 回答时用到的内容**

### `analytics.section.employee`

- en: {name}'s work
- before: {name}工作总结
- **after: {name}的工作总结**

### `analytics.employee.own`

- en: {own} of {replies} replies came straight from your rules and what you taught. The rest were written fresh.
- before: {replies}条回复里，{hers}条直接来自你定的规矩和你教过的内容，其余是她现写的。
- **after: {replies}条回复里，{own}条直接来自你定的规矩和你教过的内容，其余是现写的。**

### `channel.connect.configured`

- en: Your WhatsApp number is set up. Connect it and buyers’ messages reach {name}. Nothing is sent until you switch {name} on.
- before: 你的 WhatsApp 号码已经设置好了。连接后，买家的消息会到{name}这里；在你开启之前，她不会发出任何消息。
- **after: 你的 WhatsApp 号码已经设置好了。连接后，买家的消息会到{name}这里；在你开启之前，不会发出任何消息。**

### `channel.flash.connected`

- en: Connected. Buyers’ messages now reach {name}. Nothing is sent until you switch {name} on.
- before: 已连接。买家的消息会到{name}这里，在你开启之前她不会发送任何消息。
- **after: 已连接。买家的消息会到{name}这里，在你开启之前不会发送任何消息。**

### `product.teach`

- en: Teach {name} your products
- before: 教她认产品
- **after: 教{name}认产品**

### `product.detail.aliasesTitle`

- en: What buyers call it
- before: 买家怎么称呼它
- **after: 买家的叫法**

### `employee.growth.empty`

- en: Just getting started — your corrections and spot-checks will show up here.
- before: 还在起步，改她的稿、抽查她的活，都会记在这里。
- **after: 还在起步，你改的稿、做的抽查，都会记在这里。**

### `insight.quotedNoReply`

- en: {buyer} has not answered since you priced their order.
- before: 给{buyer}报完价之后，他就没再回话了。
- **after: 给{buyer}报完价之后，对方就没再回话了。**

### `insight.productsNoPrice`

- en: {count} products have no price yet, so {name} cannot quote them.
- before: {count}个产品还没有价格，问到她只能先记着。
- **after: {count}个产品还没有价格，买家问到也只能先记着。**

### `proof.owner.none`

- en: You can send this buyer a page showing where the price came from.
- before: 你可以给这个买家一个网页，让他看到价格是怎么来的。
- **after: 你可以给这个买家一个网页，让对方看到价格是怎么来的。**

### `forbidden.intro`

- en: Add anything you never want {name} to say to a buyer. A reply that contains one is never sent: it is written again without it, and if that cannot be done, it comes to you instead.
- before: 把你不想让{name}对买家说的话加进来。回复里出现这些词就绝不会发出去：她会重写一遍，写不好就转给你。
- **after: 把你不想让{name}对买家说的话加进来。回复里出现这些词就绝不会发出去：会重写一遍，写不好就转给你。**

### `employee.actions.note`

- en: Once granted, it is handled without you; you can revoke anytime. Confirming orders always waits for you.
- before: 放权后这类事她自己做，随时可以收回。确认订单永远等你。
- **after: 放权后这类事由{name}自己做，随时可以收回。确认订单永远等你。**

### `spotcheck.title`

- en: Check {name}'s work
- before: 看看她做的
- **after: 看看{name}做的**

### `spotcheck.fix`

- en: Tell {name} how to say it
- before: 教她该怎么说
- **after: 告诉{name}该怎么说**

### `spotcheck.flash.ok`

- en: Noted — that one was right.
- before: 记下了——这条她回对了。
- **after: 记下了——这条回对了。**

### `spotcheck.flash.problem`

- en: Noted. This kind of thing will wait for you.
- before: 记下了。这类事她以后先等你。
- **after: 记下了。这类事以后先等你。**

### `spotcheck.flash.fixed`

- en: Saved. It will be said your way from now on.
- before: 记下了。以后她照你说的讲。
- **after: 记下了。以后照你说的讲。**

### `employee.actions.empty`

- en: Nothing to grant or revoke yet. As {name} does more and passes spot-checks, "Grant" appears here.
- before: 还没有可以放权或收回的职责。她做得多、抽查过了，这里会出现「放权」。
- **after: 还没有可以放权或收回的职责。做得多了、抽查也通过了，这里会出现「放权」。**

### `autonomy.intro`

- en: Your choice, from day one. Whatever you choose: no order is confirmed without you, prices only come from your price rules, and anything your rules hold still waits for you.
- before: 从第一天起就由你决定。无论选哪一档：没有你，她不会确认订单；价格只按你定的价格规矩来；你的规矩要求先问你的，照样先问你。
- **after: 从第一天起就由你决定。无论选哪一档：没有你，订单不会被确认；价格只按你定的价格规矩来；你的规矩要求先问你的，照样先问你。**

### `autonomy.disclosure`

- en: One thing to know before you choose: when {name} replies without you, the first message in a conversation tells your buyer they are not talking to a person, and offers them someone from your team. A reply you send yourself carries no such line — you sent it.
- before: 选之前先知道一件事：她不经你过目就回复时，一段对话里的第一条消息会告诉买家她不是真人，并可以帮买家转给你的同事。你自己发出去的回复不带这句话——那是你发的。
- **after: 选之前先知道一件事：不经你过目就回复时，一段对话里的第一条消息会告诉买家，回复的不是真人，并可以帮买家转给你的同事。你自己发出去的回复不带这句话——那是你发的。**

### `autonomy.needsName`

- en: Whatever you choose here, every reply keeps coming to you first until you confirm the name in Getting ready — a message sent without you gives your buyer that name, and you should read it first.
- before: 无论这里选哪一档，在你到“准备上线”里确认她的名字之前，她都会把每条回复先给你看——不经你发出的消息会把这个名字告诉买家，你应该先看过。
- **after: 无论这里选哪一档，在你到“准备上线”里确认名字之前，每条回复都会先给你看——不经你发出的消息会把这个名字告诉买家，你应该先看过。**

### `autonomy.notReleased`

- en: Not yet available. The line that tells a buyer they are not talking to a person has not been read by a native speaker of every language used, and nothing goes out without you until it has.
- before: 暂时还不能开。她发给买家、说明自己是什么的那句话，还没有请每一种她会写的语言的母语者看过；在看过之前，什么都不会不经你发出。
- **after: 暂时还不能开。向买家说明身份的那句话，还没有请每一种回复语言的母语者看过；在看过之前，什么都不会不经你发出。**

### `autonomy.flash.notReleased`

- en: Not yet — the line that tells a buyer they are not talking to a person is still being checked in every language used.
- before: 还不行——她发给买家、说明自己是什么的那句话，还在逐语言核对。
- **after: 还不行——向买家说明身份的那句话，还在逐语言核对。**

### `autonomy.level.waits.note`

- en: Every reply is written for you; nothing goes out until you press Send.
- before: 每条回复她都写好，你点发送才发出去。
- **after: 每条回复都会先写好，你点发送才发出去。**

### `autonomy.level.talks`

- en: {name} talks without me; prices wait for me
- before: 聊天她自己来，报价先给我看
- **after: 聊天自己来，报价先给我看**

### `autonomy.level.sells`

- en: {name} also quotes and negotiates without me
- before: 报价和议价她也自己来
- **after: 报价和议价也自己来**

### `employee.flash.promoted`

- en: Granted — this is handled without you now; revoke anytime.
- before: 已放权，这类事她可以自己做了，随时可以收回。
- **after: 已放权，这类事{name}现在可以自己做了，随时可以收回。**

### `conv.file.nameHint`

- en: The name their channel showed, or what you call them. Empty shows them as "{buyer}".
- before: 渠道显示的名字，或你对他的称呼。留空则显示为"{buyer}"。
- **after: 渠道显示的名字，或你对这位买家的称呼。留空则显示为"{buyer}"。**

### `inbox.draft.held.identity_denial`

- en: {name} tried to claim to be a person to this buyer. That was stopped and never sent. This is a plain stand-in for you to send, change or skip.
- before: {name}想告诉这位买家她是真人。这已经被拦下，没有发出去。这是一句稳妥的替代回复，你可以发、改，或者不回。
- **after: {name}想告诉这位买家自己是真人。这已经被拦下，没有发出去。这是一句稳妥的替代回复，你可以发、改，或者不回。**

### `herwords.taught_answer`

- en: Your saved answer contains {terms}, which you told {name} never to say, so it was not sent.
- before: 你保存的回答里有{terms}，这是你不让{name}说的，所以她没有发。
- **after: 你保存的回答里有{terms}，这是你不让{name}说的，所以没有发出。**

### `herwords.order_status`

- en: The order update contains {terms}, which you told {name} never to say, so it was not sent.
- before: 订单进度里有{terms}，这是你不让{name}说的，所以她没有发。
- **after: 订单进度里有{terms}，这是你不让{name}说的，所以没有发出。**

### `inbox.action.revoke.note`

- en: Skip drops this one reply. The red button changes what {name} may do alone from now on.
- before: “不回”只是这一条不发。红色那个是以后她都不能自己做了。
- **after: “不回”只是这一条不发。红色那个是以后这类事{name}都要先问你。**

### `closures.intro`

- en: Tell {name} the days you are shut. No buyer is promised a delivery date that runs through them — {name} says the dates cannot be promised, and never invents a later one.
- before: 把停工的日子告诉 {name}。交期要是跨过这几天，她不会给买家承诺日期——她会说这个日期不能保证，也不会自己往后编一个。
- **after: 把停工的日子告诉 {name}。交期要是跨过这几天，就不会给买家承诺日期——只会说这个日期不能保证，也不会自己往后编一个。**

### `closures.empty`

- en: You have not told {name} about any closure, so your usual lead time is quoted all year.
- before: 你还没告诉 {name} 哪些天停工，所以她全年都按平常的交期报。
- **after: 你还没告诉 {name} 哪些天停工，所以全年都按平常的交期报。**

### `closures.add.shown`

- en: Buyers see this name, with the dates, when told why a date cannot be promised.
- before: 她跟买家解释为什么定不了交期时，买家会看到这个名字和日期。
- **after: 解释为什么定不了交期时，买家会看到这个名字和日期。**

### `samples.intro`

- en: Nearly every buyer asks for one. Tell {name} what a sample costs and whether it comes off the first order, and {name} can answer. Until you do, nothing is said about samples.
- before: 几乎每个买家都会问。告诉 {name} 一个样品多少钱、能不能从第一单里扣，她就能回答。你没说之前，她一个字都不会讲。
- **after: 几乎每个买家都会问。告诉 {name} 一个样品多少钱、能不能从第一单里扣，就能回答。你没说之前，关于样品一个字都不会讲。**

### `samples.empty`

- en: You have not told {name} anything about samples, so that question goes unanswered.
- before: 你还没跟 {name} 说过样品的事，所以她不会回答这个问题。
- **after: 你还没跟 {name} 说过样品的事，所以这个问题不会回答。**

### `samples.asked.unstated`

- en: You have not told {name} what a sample costs, so the question was not answered.
- before: 你还没告诉 {name} 样品多少钱，所以她没有回答。
- **after: 你还没告诉 {name} 样品多少钱，所以没有回答。**

### `order.update.intro`

- en: You set this. {name} tells a buyer what you recorded and the day you recorded it — never a delivery date worked out from it.
- before: 这个由你来定。{name} 只会把你记的这一步和记的日子告诉买家——她不会拿这个去推交货日期。
- **after: 这个由你来定。{name} 只会把你记的这一步和记的日子告诉买家——不会拿这个去推交货日期。**

### `people.ownerOnly.rest`

- en: Replying, taking over, recording an order, teaching {name} a fact — that is the job, and it is everyone’s.
- before: 回消息、接过对话、记订单、教她一件事——这是本职，谁都能做。
- **after: 回消息、接过对话、记订单、教{name}一件事——这是本职，谁都能做。**

### `people.flash.removed`

- en: Removed. The conversations they held still say it was them.
- before: 移除了。他管过的对话上还是写着他。
- **after: 移除了。之前管过的对话上仍然显示这个人。**

### `assistants.intro`

- en: Give each one a name, a job and the channels to answer on. Any channel nobody else was given goes to {who}. What you sell, what you taught and your price limits are shared by every one.
- before: 给每一位起个名字、定个岗位，再分给他们各自负责的渠道。没人负责的渠道都归{who}。你卖什么、你教过的、你的价格底线，大家共用。
- **after: 给每一位起个名字、定个岗位，再分好各自负责的渠道。没人负责的渠道都归{who}。你卖什么、你教过的、你的价格底线，大家共用。**

### `assistants.archive.confirm`

- en: Remove {who}? Conversations {who} was answering go to whoever answers that channel now. Nothing is erased.
- before: 移除{who}？他们正在回的对话会交给现在负责那个渠道的人。什么都不会被删掉。
- **after: 移除{who}？{who}正在回的对话会交给现在负责那个渠道的人。什么都不会被删掉。**

### `assistants.flash.archived`

- en: Removed. Those conversations stay in your records.
- before: 已移除。他们的对话记录都还在。
- **after: 已移除。对话记录都还在。**

### `assistants.flash.name_missing`

- en: Type a name first.
- before: 给他们起个名字。
- **after: 起个名字吧。**

### `product.flash.addedNeedRules`

- en: Added {added} products, {withPrice} with a price. Tell {name} your price rules and quoting can start.
- before: 加了 {added} 个产品，其中 {withPrice} 个有价格。把你的价格底线告诉{name}，她就能报价了。
- **after: 加了 {added} 个产品，其中 {withPrice} 个有价格。把你的价格底线告诉{name}，就能报价了。**

### `practice.scripted.proves`

- en: What this proves: {name} will not quote below your floor, will not claim a certification you have not confirmed, will not invent a number you never taught, and hands over when a buyer asks for a person.
- before: 这些能说明：{name}不会报到你底价以下，不会说你没确认过的认证，不会编你没教过的数字，买家要找真人时她会转给你。
- **after: 这些能说明：{name}不会报到你底价以下，不会说你没确认过的认证，不会编你没教过的数字，买家要找真人时会转给你。**

### `practice.scripted.notproves`

- en: What it does not prove: how a reply to YOUR buyer is worded, or whether WhatsApp delivers it. For that, practise live below once your business is connected.
- before: 这些说明不了：她给你的买家会怎么措辞，WhatsApp会不会送到。那要等你的账号连上以后，在下面实时练。
- **after: 这些说明不了：给你的买家回复时会怎么措辞，WhatsApp会不会送到。那要等你的账号连上以后，在下面实时练。**

### `sandbox.case.auto-qualify-grant-sends`

- en: An approved question is answered without you
- before: 你放权过的问题她自己回答
- **after: 你放权过的问题，不用等你就会回答**

### `sandbox.case.identity-bare-no-never-reaches-the-buyer`

- en: A bare “no” to “are you a bot?” is stopped
- before: 买家问她是什么，只回“不是”会被拦下
- **after: 买家问是不是真人，光回一句“是”会被拦下**

### `sandbox.case.identity-honest-answer-and-handoff-passes`

- en: An honest answer, with a person offered
- before: 她如实回答，并转给同事
- **after: 如实回答，并转给同事**

### `sandbox.case.identity-honest-answer-chinese-passes`

- en: An honest answer in Chinese
- before: 她用中文如实回答
- **after: 用中文如实回答**

### `sandbox.inv.heldTurnNeverAutoSends`

- en: Waited for you when your rules said to
- before: 你的规则要她等你时，她等了
- **after: 你的规则要求先等你时，确实等了**

### `nav.knowledge`

- en: What {name} knows
- before: 她知道的
- **after: {name}知道的**

### `knowledge.title`

- en: What {name} knows
- before: 她知道的
- **after: {name}知道的**

### `knowledge.intro`

- en: Teach the facts about your products and business. {name} answers buyers from what you teach — and never states a number or a certification you haven't given.
- before: 把产品和公司的信息教给{name}。她只用你教的内容回答买家——绝不会说出你没给过的数字或认证。
- **after: 把产品和公司的信息教给{name}。只用你教的内容回答买家——绝不会说出你没给过的数字或认证。**

### `knowledge.teach.add`

- en: Teach
- before: 教她
- **after: 教**

### `knowledge.cert.confirmOn`

- en: Turn on {key} for all {n} of your products? {name} will be able to state it to any buyer.
- before: 给全部{n}个产品都打开{key}？她就可以对任何买家说这个了。
- **after: 给全部{n}个产品都打开{key}？之后对任何买家都可以说这个了。**

### `knowledge.cert.confirmOff`

- en: Turn off {key} for all {n} of your products? {name} will stop confirming it to anyone.
- before: 给全部{n}个产品都关掉{key}？她对谁都不会再确认这个了。
- **after: 给全部{n}个产品都关掉{key}？之后对谁都不会再确认这个了。**

### `knowledge.taught.title`

- en: What {name} knows about this product
- before: 她知道这个产品的什么
- **after: 关于这个产品，{name}知道的**

### `knowledge.gap.teach`

- en: Teach the answer
- before: 教她回答
- **after: 教这个答案**

### `prices.lede`

- en: These are the only numbers {name} will ever negotiate inside — never below what you set here, whatever a buyer says.
- before: {name}只会在这几个数字之间谈。你定的底线以下，买家怎么说她都不会松口。
- **after: {name}只会在这几个数字之间谈。你定的底线以下，买家怎么说都不会松口。**

### `prices.q.maxDiscount`

- en: What is the most that may ever come off, even with your OK? (%)
- before: 就算你同意，她最多能让多少？（%）
- **after: 就算你同意，最多能让多少？（%）**

### `prices.q.askAbove`

- en: Above how much off should you be asked first? (%)
- before: 让到多少以上，她要先问你？（%）
- **after: 让到多少以上，要先问你？（%）**

### `prices.stated`

- en: Never below {floor}. Up to {ask}% off is decided without you; above that you are asked first. Never more than {max}% off.
- before: 不低于 {floor}。让 {ask}% 以内她自己定，超过就先问你。最多让 {max}%。
- **after: 不低于 {floor}。让 {ask}% 以内自己定，超过就先问你。最多让 {max}%。**

### `prices.error.ask_above_max`

- en: This is higher than the most that may ever come off, so you would never be asked. Lower it, or raise the most that may come off.
- before: 这个比她最多能让的还高，那你永远不会被问到。要么调低，要么把她最多能让的调高。
- **after: 这个比最多能让的还高，那你永远不会被问到。要么调低，要么把最多能让的调高。**

### `prices.volume.sub`

- en: {name} never invents a discount. Only what you write here comes off, and never more than the most you allow above.
- before: {name}不会自己想出折扣。只有你写在这里的，她才会让，而且绝不超过上面你定的上限。
- **after: {name}不会自己想出折扣。只有你写在这里的才会让，而且绝不超过上面你定的上限。**

### `prices.volume.none`

- en: You have not written one, so no discount is ever offered — your price is quoted as it stands.
- before: 你还没写，所以她从不让价——按你的价原样报。
- **after: 你还没写，所以从不让价——按你的价原样报。**

### `prices.flash.volumeRemoved`

- en: Stopped. That will not be offered any more.
- before: 停了。她不会再给这个。
- **after: 停了。不会再给这个优惠。**

### `factory.prices.title`

- en: What {name} may never go below
- before: 她绝不能低于的价
- **after: 绝不能低于的价**

### `pilot.blocker.priceRules`

- en: Tell {name} the least you would ever accept, and how much may come off.
- before: 告诉{name}你最低能接受多少，以及她可以让多少。
- **after: 告诉{name}你最低能接受多少，以及最多可以让多少。**

### `pilot.assistant.hint`

- en: Every reply is signed with this name, so a buyer reads it each time. You can change it later on the team page.
- before: 她用这个名字署名，买家每次收到回复都会看到。以后可以在团队页面改。
- **after: 回复会用这个名字署名，买家每次收到回复都会看到。以后可以在团队页面改。**

### `takeover.reason.media_unreadable`

- en: something the buyer sent that could not be opened
- before: 买家发来的东西她打不开
- **after: 买家发来的东西打不开**

### `unheard.title`

- en: A voice message that could not be heard
- before: 有条语音她没听清
- **after: 有条语音没听清**

### `unheard.why.not_configured`

- en: This installation cannot listen to voice messages yet.
- before: 她还不会听语音。
- **after: 这里还不能听语音。**

### `unheard.why.unsupported_format`

- en: The voice message came in a form that cannot be opened.
- before: 这条语音的格式她打不开。
- **after: 这条语音的格式打不开。**

### `unreadable.title`

- en: Something that could not be opened
- before: 有样东西她打不开
- **after: 有样东西打不开**

### `unreadable.why`

- en: {name} answers typed messages, photos and voice messages. Anything else comes to you.
- before: 她能回复文字、图片和语音，其他的都会交给你。
- **after: 能回复的是文字、图片和语音，其他的都会交给你。**

### `unlisted.why`

- en: While you try {name} with a few buyers, only the numbers you added are written to.
- before: 你让{name}先跟几个买家试的时候，她只给你加进来的号码发消息。
- **after: 你让{name}先跟几个买家试的时候，只会给你加进来的号码发消息。**

### `unlisted.do`

- en: Reply yourself, or add the number in My business and hand it back to {name}
- before: 自己回复，或者到“我的公司”把号码加上，再交回给她
- **after: 自己回复，或者到“我的公司”把号码加上，再交回给{name}**

### `voice.notHeard`

- en: The words could not be made out.
- before: 她没听清里面的话。
- **after: 没听清里面的话。**

### `voice.flash.corrected`

- en: Saved. Your words will be used.
- before: 已保存，她会用你写的这句。
- **after: 已保存，以后会用你写的这句。**

### `voice.flash.answering`

- en: {name} has taken this back and is answering your words.
- before: 她接回去了，正在按你写的这句回复。
- **after: 已经接回去，正在按你写的这句回复。**

### `takeover.flash.handed`

- en: Handed to {name}. It is on their list now.
- before: 已转给{name}，现在在他们的列表里。
- **after: 已转给{name}，接下来由{name}处理。**

### `unsure.why`

- en: It may have reached them, or it may not. Nothing here can tell, so nothing was sent again — sending it twice would be worse than asking you. Read it and decide.
- before: 他可能收到了，也可能没有。这里查不出来，所以没有再发一次——发两遍比来问你更糟。你看一下再决定。
- **after: 对方可能收到了，也可能没有。这里查不出来，所以没有再发一次——发两遍比来问你更糟。你看一下再决定。**

### `unsure.again`

- en: They did not get it — send it
- before: 他没收到——发出去
- **after: 对方没收到——发出去**

### `refused.none`

- en: Every message prepared reached its buyer.
- before: 她准备的每条消息都送到了买家手上。
- **after: 准备好的每条消息都送到了买家手上。**

### `refused.what.handed_off`

- en: You had taken this conversation over, so {name} stayed quiet.
- before: 这个对话你接手了，所以她没出声。
- **after: 这个对话你接手了，所以没出声。**

### `refused.do.handed_off`

- en: Reply yourself, or hand it back to {name} when you are done.
- before: 你自己回，或者聊完了交还给她。
- **after: 你自己回，或者聊完了交还给{name}。**

### `refused.what.paused`

- en: {name} is paused, so the reply was held.
- before: 她被停住了，回复先留着。
- **after: {name}被停住了，回复先留着。**

### `refused.why.paused`

- en: You stopped {name}, or the limit you set for the day was reached.
- before: 你把她停了，或者她到了你设的当天上限。
- **after: 你让{name}停下了，或者已经到了你设的当天上限。**

### `refused.do.paused`

- en: Start {name} again when you are ready.
- before: 你想好了再让她开始。
- **after: 你想好了再让{name}开始。**

### `refused.do.window_closed`

- en: Message this buyer from your own phone. Once they answer, {name} can continue.
- before: 你用自己手机给他发一句。他一回，{name}就能接着聊。
- **after: 你用自己手机给对方发一句。对方一回，{name}就能接着聊。**

### `refused.do.window_needs_owner`

- en: Message this buyer from your own phone for now.
- before: 先用你自己手机给他发一句。
- **after: 先用你自己手机给对方发一句。**

### `refused.do.subject_missing`

- en: Open the message, write the subject you want them to see, and send it again.
- before: 打开这条消息，把你想让他看到的标题写上，再发一次。
- **after: 打开这条消息，把你想让对方看到的标题写上，再发一次。**

### `refused.why.outreach_unchecked`

- en: We could not check whether they may be written to, and nothing goes out unchecked.
- before: 我们没能确认他是否可以联系，没确认过的一律不发。
- **after: 我们没能确认能不能联系对方，没确认过的一律不发。**

### `refused.do.outreach_unchecked`

- en: Open their row on Buyers you may write to. If it reads that you can write to them, send it again.
- before: 去"可以联系的客户"里看看他那一行。上面写着可以写给他，就再发一次。
- **after: 去"可以联系的客户"里看看这个人那一行。上面写着可以联系，就再发一次。**

### `refused.do.not_activated`

- en: Start {name} in My business when you are ready.
- before: 想好了就在「我的公司」里让她开始。
- **after: 想好了就在「我的公司」里让{name}开始。**

### `refused.do.not_allowlisted`

- en: Add this number in My business, or leave it — nothing will be sent to it.
- before: 在「我的公司」里加上这个号码；不加也行，就不会发给他。
- **after: 在「我的公司」里加上这个号码；不加也行，就不会发到这个号码。**

### `refused.what.daily_ceiling`

- en: Today’s message limit was reached.
- before: 她到了今天的条数上限。
- **after: 今天的条数上限到了。**

### `refused.why.silenced`

- en: We paused sending while we check something. This was not you, and nothing was lost.
- before: 我们在查一件事，先把她的发送停了。不是你操作的，消息也都还在。
- **after: 我们在查一件事，先把发送停了。不是你操作的，消息也都还在。**

### `refused.do.silenced`

- en: Reply yourself meanwhile — you are not paused. We will tell you when {name} is back.
- before: 这段时间你自己回，你没被停。她一恢复我们就告诉你。
- **after: 这段时间你自己回，你没被停。恢复发送时我们会告诉你。**

### `today.budget.near`

- en: {name} has used {pct}% of the daily limit.
- before: {name}今天已经用掉了给她设的额度的{pct}%。
- **after: {name}今天已经用掉了设定额度的{pct}%。**

### `today.budget.thenStops`

- en: At 100%, answering stops until tomorrow.
- before: 到100%她就停下来，明天再答。
- **after: 到100%就停下来，明天再答。**

### `today.budget.thenKeeps`

- en: At 100%, answering carries on — nothing is stopped.
- before: 到100%她照常答，什么都不会停。
- **after: 到100%也照常答，什么都不会停。**

### `runbook.deploy.codeUnstable`

- en: OWNER_ACCESS_CODE is not set, so a new login code is generated every time this deploys and the owner is locked out until someone reads it from the logs. Set it in the host.
- before: 没有设置 OWNER_ACCESS_CODE，每次部署都会生成新的登录码，到时候进不去，只能从日志里翻。请在主机上固定它。
- **after: 没有设置 OWNER_ACCESS_CODE，每次部署都会生成新的登录码，到时候进不去，只能从日志里翻。请在主机上把这个值固定下来。**

### `runbook.deploy.credentialKeyUnstable`

- en: CREDENTIAL_KEY is not set, so a new encryption key is generated every time this deploys. When that happens the stored WhatsApp credentials can never be decrypted again and every owner session is dropped. Set it in the host before switching the channel on.
- before: 没有设置 CREDENTIAL_KEY，每次部署都会生成新的加密密钥。一旦发生，已保存的 WhatsApp 凭据将永远无法解密，所有登录状态也会失效。开通渠道之前，请先在主机上固定它。
- **after: 没有设置 CREDENTIAL_KEY，每次部署都会生成新的加密密钥。一旦发生，已保存的 WhatsApp 凭据将永远无法解密，所有登录状态也会失效。开通渠道之前，请先在主机上把这个值固定下来。**

### `meta.blocker.not_started`

- en: {name} has not been started yet — nothing is sent or received until you do.
- before: 还没让她开始——在你让她开始之前，不会收发任何消息。
- **after: 还没开始——在你让{name}开始之前，不会收发任何消息。**

### `contacts.add.channel`

- en: How you reach them
- before: 怎么联系他
- **after: 怎么联系对方**

### `contacts.add.name`

- en: Their name
- before: 他的名字
- **after: 对方的名字**

### `contacts.add.company`

- en: Their company
- before: 他的公司
- **after: 对方的公司**

### `contacts.source.inbound`

- en: Wrote to you
- before: 他先来找你
- **after: 对方先来找你**

### `contacts.evidence.inbound_message`

- en: They wrote to you first
- before: 他先来找过你
- **after: 对方先来找过你**

### `contacts.evidence.replied_to_email`

- en: They answered your e-mail
- before: 他回复过你的邮件
- **after: 对方回复过你的邮件**

### `contacts.consent.none`

- en: You have not said you may write to them
- before: 你还没说过可以联系他
- **after: 你还没说过可以联系对方**

### `contacts.attest.button`

- en: I may write to them
- before: 我可以联系他
- **after: 我可以联系对方**

### `contacts.attest.hint`

- en: Only if they gave you their card or asked you to stay in touch. Whoever says so is recorded.
- before: 只有他给过你名片、或请你保持联系时才这样标。谁标的会记下来。
- **after: 只有对方给过你名片、或请你保持联系时才这样标。谁标的会记下来。**

### `contacts.suppress.button`

- en: Never write to them again
- before: 以后再也不联系他
- **after: 以后再也不联系对方**

### `contacts.suppress.hint`

- en: This cannot be undone, and nothing here will write to them again.
- before: 这一步不能撤销，之后这里不会再给他发任何东西。
- **after: 这一步不能撤销，之后这里不会再给对方发任何东西。**

### `contacts.reason.unsubscribed`

- en: They asked you to stop
- before: 他请你别再联系
- **after: 对方请你别再联系**

### `contacts.reason.complained`

- en: They reported it as unwanted
- before: 他投诉说不想收到
- **after: 对方投诉说不想收到**

### `contacts.flash.attested`

- en: Noted. You may write to them.
- before: 记下了，可以联系他。
- **after: 记下了，可以联系对方。**

### `contacts.flash.suppressed`

- en: Noted. Nothing here will write to them again.
- before: 记下了，以后这里不会再给他发东西。
- **after: 记下了，以后这里不会再给对方发东西。**

### `connect.mail.read.tick`

- en: Also let {name} read and answer buyers' e-mails in this mailbox.
- before: 也让{name}读这个邮箱里买家的来信，这样她才能回。
- **after: 也让{name}读这个邮箱里买家的来信，这样才能回复。**

### `connect.mail.offDomain`

- en: This address is not on {domain}, the domain you set up, so nothing is sent from it until they match.
- before: 这个地址不在你设置的域名 {domain} 上，两者一致之前不会从它发出任何邮件。
- **after: 这个地址不在你设置的域名 {domain} 上，两者一致之前不会从这个地址发出任何邮件。**

### `connect.smtp.what`

- en: Set up by whoever runs this installation. Nothing to press here; ask them to change it.
- before: 由管理这个安装的人设置。这里没有可按的；要改就找他们。
- **after: 由管理这个安装的人设置。这里没有可按的；要改就找管理的人。**

### `connect.flash.app_refused`

- en: Google or Microsoft refused this installation, not you. Whoever runs it needs to renew its app secret; connecting again will not help until then.
- before: Google 或微软拒绝的是这个安装，不是你。需要管理它的人更新应用密钥；在那之前，再点连接也没用。
- **after: Google 或微软拒绝的是这个安装，不是你。需要管理这个安装的人更新应用密钥；在那之前，再点连接也没用。**

### `prospects.intro`

- en: Search for people who buy what you make. Nothing here writes to anyone: people you add join your list with nothing on file saying you may write to them, and their row says so.
- before: 搜索会买你产品的人。这里不会给任何人发东西：你加进来的人进入名单时，没有任何记录说你可以联系他，他那一行会写明。
- **after: 搜索会买你产品的人。这里不会给任何人发东西：你加进来的人进入名单时，没有任何记录说你可以联系对方，名单里那一行会写明。**

### `prospects.add.hint`

- en: Adding someone finds their work address and uses one credit.
- before: 加一个人会查他的工作邮箱，用掉一个额度。
- **after: 加一个人会查对方的工作邮箱，用掉一个额度。**

### `prospects.flash.saved`

- en: Saved. The key is kept locked, and only its fingerprint is shown.
- before: 存下了。密钥锁着保存，只显示它的指纹。
- **after: 存下了。密钥锁着保存，只显示密钥的指纹。**

### `prospects.flash.added`

- en: Added to your list. Nothing on file says you may write to them yet.
- before: 加到名单了。现在还没有记录说你可以联系他。
- **after: 加到名单了。现在还没有记录说你可以联系对方。**

### `prospects.flash.exists`

- en: They are already on your list.
- before: 他已经在你的名单上了。
- **after: 对方已经在你的名单上了。**

### `prospects.flash.not_found`

- en: Apollo has no work address for them, so nobody was added.
- before: Apollo 没有他的工作邮箱，所以没有加人。
- **after: Apollo 没有这个人的工作邮箱，所以没有加人。**

### `contacts.lookup.button`

- en: Look up their company (1 credit)
- before: 查他的公司（1 个额度）
- **after: 查对方的公司（1 个额度）**

### `seq.enroll.button`

- en: Start sending to them
- before: 开始发给他
- **after: 开始发给对方**

### `seq.enroll.none`

- en: Nobody on your list can be written to right now. Their row on your list says why.
- before: 你名单上现在没有可以联系的人。他们那一行写着原因。
- **after: 你名单上现在没有可以联系的人。每个人那一行都写着原因。**

### `seq.enrolment.stop`

- en: Stop for them
- before: 对他停下
- **after: 对这个人停下**

### `seq.enrolment.awaiting`

- en: E-mail {n} is ready to go. Their answer would arrive in your own inbox, not here, so look there first: if they wrote back, stop it for them. If nobody sends it, it stops on {date}.
- before: 第 {n} 封可以发了。他回信会到你自己的邮箱，不会到这里，所以先去邮箱看一眼：他回了，就对他停下。没人放行的话，{date} 就停下。
- **after: 第 {n} 封可以发了。对方回信会到你自己的邮箱，不会到这里，所以先去邮箱看一眼：对方回了，就对这个人停下。没人放行的话，{date} 就停下。**

### `seq.archive.hint`

- en: Taking it out of use stops it for everyone still receiving it. It stays here to read.
- before: 停用后，还在收的人都会停下。它仍留在这里可以看。
- **after: 停用后，还在收的人都会停下。内容仍留在这里可以看。**

### `seq.stop.replied`

- en: They answered — a person takes it from here
- before: 他回复了——接下来由人来接
- **after: 对方回复了——接下来由人来接**

### `seq.stop.unsubscribed`

- en: They asked you to stop
- before: 他请你别再联系
- **after: 对方请你别再联系**

### `seq.stop.complained`

- en: They reported it as unwanted
- before: 他投诉说不想收到
- **after: 对方投诉说不想收到**

### `seq.stop.no_consent`

- en: Nothing on file says you may write to them any more
- before: 已经没有记录说可以联系他
- **after: 已经没有记录说可以联系对方**

### `seq.stop.cap`

- en: Your daily limit held it back for a week
- before: 每日上限让它等了一个星期
- **after: 每日上限让这封等了一个星期**

### `seq.flash.already`

- en: They are already receiving it.
- before: 他已经在收了。
- **after: 对方已经在收了。**

### `seq.flash.stopped`

- en: Stopped for them.
- before: 对他停下了。
- **after: 已对这个人停下。**

### `reach.window`

- en: After a buyer writes, you have {hours} hours to answer them freely.
- before: 他来找你之后，你有 {hours} 小时可以随便回。
- **after: 对方来找你之后，你有 {hours} 小时可以随便回。**

### `reach.notHere`

- en: Not set up here yet — nothing can be sent on this one.
- before: 这边还没接上——这条路她还发不出去。
- **after: 这边还没接上——这条路还发不出去。**

### `connect.meta.flash.connectedNoIg`

- en: Connected: {page}. It has no Instagram account linked — link one in Instagram's settings and connect again to answer there too.
- before: 已连接：{page}。它没有关联 Instagram 账号——在 Instagram 设置里关联后再连接一次，就也能在那里回复。
- **after: 已连接：{page}。这个主页没有关联 Instagram 账号——在 Instagram 设置里关联后再连接一次，就也能在那里回复。**

### `refused.what.channel_cannot_initiate`

- en: {name} did not write first on this one.
- before: 这条路上她没有先开口。
- **after: 这条路上没有先开口。**

### `refused.do.channel_cannot_initiate`

- en: Wait for the buyer to write to you, or open your connections to see what each one allows.
- before: 等他来找你；想看每条路能做什么，就去连接那一页。
- **after: 等对方来找你；想看每条路能做什么，就去连接那一页。**

### `refused.what.outreach_not_enabled`

- en: {name} did not write to this buyer first.
- before: 她没有先去找他。
- **after: 没有先去找对方。**

### `refused.why.outreach_not_enabled`

- en: You have not said {name} may write first on this one.
- before: 你还没说过这条路上她可以先开口。
- **after: 你还没说过这条路上可以先开口。**

### `refused.what.suppressed`

- en: Nothing went to this buyer.
- before: 什么都没发给他。
- **after: 什么都没发给对方。**

### `refused.why.suppressed`

- en: They asked you to stop, and that does not expire.
- before: 他请你别再联系了，这一条不会过期。
- **after: 对方请你别再联系了，这一条不会过期。**

### `refused.do.suppressed`

- en: Leave them be — {name} will still answer if they write to you.
- before: 就别打扰他了——他要是来找你，她照样回。
- **after: 就别打扰对方了——对方要是来找你，照样会回。**

### `refused.what.no_consent`

- en: {name} did not write to this buyer first.
- before: 她没有先去找他。
- **after: 没有先去找对方。**

### `refused.why.no_consent`

- en: There is nothing on file saying you may.
- before: 记录上没有写你凭什么可以联系他。
- **after: 记录上没有写你凭什么可以联系对方。**

### `refused.do.no_consent`

- en: Add how you know them in your contacts, then send again.
- before: 在联系人那里补上你怎么认识他的，然后再发一次。
- **after: 在联系人那里补上你怎么认识对方的，然后再发一次。**

### `refused.what.outreach_ceiling`

- en: {name} stopped writing first for today.
- before: 今天她先开口的次数用完了。
- **after: 今天先开口的次数用完了。**

### `refused.do.outreach_ceiling`

- en: It clears tomorrow, and {name} still replies to everyone who writes.
- before: 明天就恢复；来找她的人，她还是照回。
- **after: 明天就恢复；有人来找，照样都会回。**

### `domain.none`

- en: {name} sends from no address of yours yet.
- before: 她还没有你的发件地址。
- **after: 还没有用你的任何地址发过信。**

### `legal.privacy.who.mail`

- en: If the business connected a mailbox, the mail provider it uses (Google or Microsoft) carries the e-mail.
- before: 如果商家连接了邮箱，则由它使用的邮件服务商（Google 或 Microsoft）传递邮件。
- **after: 如果商家连接了邮箱，则由商家使用的邮件服务商（Google 或 Microsoft）传递邮件。**

### `legal.privacy.howLong.body`

- en: For as long as the business uses Nomi, so it can see what was agreed with you — a price, an order, a sample. Ask, and it is removed sooner.
- before: 商家使用 Nomi 期间一直保存，这样它能查到和你谈定的内容——价格、订单、样品。你提出要求，就会提前删除。
- **after: 商家使用 Nomi 期间一直保存，这样商家能查到和你谈定的内容——价格、订单、样品。你提出要求，就会提前删除。**

### `legal.deletion.revoked`

- en: Removing Nomi from your Meta account settings stops new messages from reaching it. It does not remove what was already kept — ask for that here.
- before: 在你的 Meta 账号设置里移除 Nomi，会让新消息不再送达它，但不会删除已保存的内容——已保存的内容请在这里提出删除。
- **after: 在你的 Meta 账号设置里移除 Nomi，会让新消息不再送达 Nomi，但不会删除已保存的内容——已保存的内容请在这里提出删除。**

### `legal.terms.service.body`

- en: Nomi answers the people who write to your business on the channels you connect — Instagram, Facebook Messenger, WhatsApp and e-mail — drafts replies from your own catalogue and prices, and keeps the record of what was said. By default every reply waits for a person at your business to approve it; what may be sent without that approval is your decision, and you can take it back at any time.
- before: Nomi 在你接入的渠道——Instagram、Facebook Messenger、WhatsApp 和邮件——上回复写信给你的人，根据你自己的目录和价格起草回复，并保存往来记录。默认每条回复都要等你这边的人批准后才发出；允许它自己发什么，由你决定，随时可以收回。
- **after: Nomi 在你接入的渠道——Instagram、Facebook Messenger、WhatsApp 和邮件——上回复写信给你的人，根据你自己的目录和价格起草回复，并保存往来记录。默认每条回复都要等你这边的人批准后才发出；允许 Nomi 自己发什么，由你决定，随时可以收回。**

### `legal.terms.yours.you2`

- en: The catalogue, prices and facts you give Nomi are yours and are true; Nomi says nothing about your business that you did not put in.
- before: 你交给 Nomi 的目录、价格和事实由你提供并保证真实；你没有写进去的，它不会替你说。
- **after: 你交给 Nomi 的目录、价格和事实由你提供并保证真实；你没有写进去的，Nomi 不会替你说。**

### `legal.terms.ours.we1`

- en: A price Nomi quotes comes from your own price list and is never below the floor you set.
- before: 它报出的价格只来自你自己的价格表，永远不低于你设定的底价。
- **after: Nomi 报出的价格只来自你自己的价格表，永远不低于你设定的底价。**

### `legal.terms.ours.we3`

- en: When Nomi cannot answer, that is said plainly and the message is held for you; nothing is dropped in silence.
- before: 它答不了的时候会说明并把消息留给你，不会悄悄丢掉。
- **after: Nomi 答不了的时候会说明并把消息留给你，不会悄悄丢掉。**

### `legal.terms.ours.we4`

- en: Everything Nomi sends is on the record, so you can see what was said and by whom.
- before: 它发出的每条消息都有记录，谁说了什么随时可查。
- **after: Nomi 发出的每条消息都有记录，谁说了什么随时可查。**

### `domain.ready`

- en: Ready to send from
- before: 可以用它发信了
- **after: 可以用这个地址发信了**

### `contacts.canWrite`

- en: {name} can write to them first.
- before: 她可以先去找他。
- **after: 可以先去联系对方。**

### `outreach.on`

- en: {name} may write first here
- before: 这条路上她可以先开口
- **after: 这条路上可以先开口**

### `outreach.off`

- en: {name} does not write first here
- before: 这条路上她不先开口
- **after: 这条路上不先开口**

### `outreach.turnOn`

- en: Let {name} write first
- before: 让她先开口
- **after: 让{name}先开口**

### `outreach.warn.whatsapp`

- en: If {name} writes first to someone who never asked to hear from you, WhatsApp can take this number away for good. There is no softer way to say it.
- before: 如果她先去找一个从没说过想收到你消息的人，WhatsApp 可以把这个号永久收走。这话没有更轻的说法。
- **after: 如果先去找一个从没说过想收到你消息的人，WhatsApp 可以把这个号永久收走。这话没有更轻的说法。**

### `outreach.flash.on`

- en: {name} may now write first there.
- before: 这条路上她可以先开口了。
- **after: 这条路上现在可以先开口了。**

### `outreach.flash.off`

- en: {name} will not write first there.
- before: 这条路上她不会先开口了。
- **after: 这条路上不会再先开口了。**

### `people.ownerOnly.outreach`

- en: Letting {name} write to someone first
- before: 让她先去联系某个人
- **after: 让{name}先去联系某个人**

### `reach.instead.comment_to_dm`

- en: A buyer comments on something you posted, and {name} answers them privately.
- before: 他在你发的东西下面留言，她就能私下回他。
- **after: 买家在你发的内容下面留言，{name}私下回复对方。**

### `reach.instead.click_to_whatsapp`

- en: A buyer taps an advert of yours and it opens WhatsApp, with you.
- before: 他点了你的广告，就直接开到 WhatsApp 上找你。
- **after: 买家点了你的广告，就直接开到 WhatsApp 上找你。**

### `reach.instead.buyer_writes_first`

- en: A buyer writes first, and {name} answers the usual way.
- before: 他先来找你，她照常回。
- **after: 买家先来找你，{name}照常回。**

### `contacts.write.button`

- en: Write to them
- before: 给他写一封
- **after: 给对方写一封**

### `contacts.write.hint`

- en: This is the first thing they hear from you. It goes out in your name, it carries a line they can use to ask you to stop, and it counts towards the most you said you would send in a day.
- before: 这是他第一次听到你。以你的名义发出去，里面会带上一句"不想再收到"的办法，也算进你说过的一天最多几次里。
- **after: 这是对方第一次收到你的消息。以你的名义发出去，里面会带上一句"不想再收到"的办法，也算进你说过的一天最多几次里。**

### `contacts.flash.queued`

- en: On its way. You will find it on their conversation.
- before: 在路上了。到他那条对话里能看到。
- **after: 在路上了。到那条对话里能看到。**


## العربية — 851 strings

### `buyers.all.link`

- en: Everyone you have talked to
- before: كل من تحدثت إليهم
- **after: كل المشترين حتى الآن**

### `factory.lede`

- en: The things {name} needs to know about your business.
- before: ما تحتاج {name} معرفته عن عملك.
- **after: ما يلزم {name} معرفته عن عملك.**

### `factory.next.profile`

- en: Tell {name} about your business
- before: عرّف {name} على شركتك
- **after: تعريف {name} بشركتك**

### `factory.next.products`

- en: Add what you sell
- before: أضف ما تبيعه
- **after: إضافة منتجاتك**

### `factory.next.channels`

- en: Connect WhatsApp so buyers can reach you
- before: اربط واتساب ليصل إليك المشترون
- **after: ربط واتساب ليصل إليك المشترون**

### `factory.next.first_success`

- en: Send {name}'s first reply to a buyer
- before: أرسل أول رد لها إلى مشترٍ
- **after: إرسال أول ردّ إلى مشترٍ**

### `activation.can`

- en: {name} can start talking to real buyers whenever you say so.
- before: تستطيع {name} أن تبدأ محادثة مشترين حقيقيين متى قررت.
- **after: بإمكان {name} بدء الحديث مع مشترين حقيقيين بقرار منك.**

### `activation.action.activate`

- en: Let {name} start
- before: دع {name} تبدأ
- **after: تشغيل {name}**

### `activation.action.confirm`

- en: Let {name} answer the people on your list? Every reply is written for you and waits for your OK — you send it. You can stop at any time.
- before: أتدع {name} تردّ على من في قائمتك؟ تكتب كل رد وتنتظر موافقتك — وأنت من يرسل. تستطيع إيقافها في أي وقت.
- **after: بدء ردود {name} على من في قائمتك؟ كل ردّ يُكتب وينتظر موافقتك — والإرسال بيدك. ويمكن الإيقاف في أي وقت.**

### `activation.action.deactivate`

- en: Stop messaging
- before: أوقف المراسلة
- **after: إيقاف المراسلة**

### `activation.action.deactivateConfirm`

- en: Stop {name} messaging buyers? Nothing is deleted, and you can start again whenever you want.
- before: أتوقف مراسلة {name} للمشترين؟ لا يُحذف شيء، وتستطيع البدء من جديد متى شئت.
- **after: إيقاف مراسلة {name} للمشترين؟ لا يُحذف شيء، ويمكن البدء من جديد في أي وقت.**

### `activation.stop.what`

- en: Stopping means nothing further is sent. Your buyers, conversations and everything you taught stay exactly as they are, and you can start again whenever you want.
- before: الإيقاف يعني أنها لن ترسل شيئاً بعد ذلك. يبقى المشترون والمحادثات وكل ما علّمتها كما هو، وتستطيع البدء من جديد متى شئت.
- **after: الإيقاف يعني ألّا يُرسَل أي شيء بعد ذلك. يبقى المشترون والمحادثات وكل ما أُضيف إلى معرفة {name} كما هو، ويمكن البدء من جديد في أي وقت.**

### `activation.live.since`

- en: Started {when} by {who}.
- before: بدأها {who} في {when}.
- **after: بدأ التشغيل في {when} على يد {who}.**

### `activation.flash.activated`

- en: {name} can now answer the people on your list. Every reply still waits for your OK.
- before: تستطيع {name} الآن الرد على من في قائمتك. وما زالت تنتظر موافقتك على كل رد.
- **after: بإمكان {name} الآن الردّ على من في قائمتك، وما زال كل ردّ ينتظر موافقتك.**

### `activation.flash.deactivated`

- en: Stopped. {name} will not message anyone until you start again.
- before: تم الإيقاف. لن تراسل {name} أحداً حتى تبدأ من جديد.
- **after: تم الإيقاف. لن تُرسَل أي رسالة من {name} حتى إعادة التشغيل.**

### `activation.cannot`

- en: Before {name} can talk to a real buyer:
- before: قبل أن تحدّث {name} مشترياً حقيقياً:
- **after: قبل حديث {name} مع مشترٍ حقيقي:**

### `activation.stillDrafts`

- en: Going live does not change who decides: {name} still writes, you still send.
- before: التفعيل لا يغيّر من يقرر: هي تكتب وأنت ترسل.
- **after: التفعيل لا يغيّر صاحب القرار: الكتابة من {name}، والإرسال منك.**

### `allowlist.note`

- en: Only these numbers can receive anything from {name}. Anyone else who writes still reaches you — they just will not get an answer.
- before: هذه الأرقام وحدها تتلقّى شيئاً من {name}. من يراسلك غيرهم يصل إليك أنت — هي فقط لن تجيبه.
- **after: هذه الأرقام وحدها تتلقّى شيئاً من {name}. ومن يراسلك غيرهم يصل إليك أنت — لكن بلا ردّ من {name}.**

### `allowlist.none`

- en: Nobody yet. Add your own number first, so you can try {name} on yourself before a buyer does.
- before: لا أحد بعد. أضف رقمك أولاً لتجرّب {name} على نفسك قبل أن يفعل ذلك مشترٍ.
- **after: لا أحد بعد. الأفضل البدء برقمك، لتجربة {name} بنفسك قبل أي مشترٍ.**

### `allowlist.add`

- en: Add to the list
- before: أضف إلى القائمة
- **after: إضافة إلى القائمة**

### `allowlist.remove.confirm`

- en: Remove {who}? {name} will stop answering them. Nothing else changes.
- before: أتزيل {who}؟ ستتوقف {name} عن الرد عليه. لا يتغيّر شيء آخر.
- **after: إزالة {who}؟ سيتوقف ردّ {name} على هذا الرقم. لا يتغيّر شيء آخر.**

### `allowlist.flash.added`

- en: {who} can now receive messages from {name}.
- before: يستطيع {who} الآن تلقّي رسائل من {name}.
- **after: بإمكان {who} الآن تلقّي رسائل من {name}.**

### `allowlist.flash.removed`

- en: {who} removed. {name} will not message them.
- before: أُزيل {who}. لن تراسله {name}.
- **after: أُزيل {who}. لا رسائل من {name} إلى هذا الرقم بعد الآن.**

### `allowlist.flash.invalid`

- en: That number does not look right — start with + and the country code.
- before: هذا الرقم لا يبدو صحيحاً — ابدأ بـ + ورمز الدولة.
- **after: هذا الرقم لا يبدو صحيحاً — يجب أن يبدأ بـ + ورمز الدولة.**

### `activation.blocker.not_ready`

- en: Finish getting {name} ready.
- before: أكمل تجهيز {name}.
- **after: إكمال تجهيز {name}.**

### `activation.blocker.secrets_not_rotated`

- en: Confirm you have changed your keys.
- before: أكّد أنك غيّرت مفاتيحك.
- **after: تأكيد تغيير مفاتيحك.**

### `activation.blocker.no_allowlist`

- en: Add at least one number {name} may message — start with your own.
- before: أضف رقماً واحداً على الأقل يجوز لـ {name} مراسلته — ابدأ برقمك.
- **after: إضافة رقم واحد على الأقل يجوز لـ {name} مراسلته — والأفضل البدء برقمك.**

### `activation.blocker.no_channel`

- en: Connect WhatsApp.
- before: اربط واتساب.
- **after: ربط واتساب.**

### `activation.blocker.assistant_not_named`

- en: Confirm the name buyers will see.
- before: أكّدي الاسم الذي سيراه المشترون.
- **after: تأكيد الاسم الذي سيراه المشترون.**

### `factory.ready.title`

- en: Before {name} talks to real buyers
- before: قبل أن تحدّث مشترين حقيقيين
- **after: قبل الحديث مع مشترين حقيقيين**

### `factory.ready.q`

- en: Is {name} ready?
- before: هل {name} جاهزة؟
- **after: هل اكتمل تجهيز {name}؟**

### `factory.ready.note`

- en: Nothing here switches messaging on. You decide when {name} starts.
- before: لا شيء هنا يشغّل المراسلة. أنت من يقرر متى تبدأ {name}.
- **after: لا شيء هنا يشغّل المراسلة. موعد بدء {name} قرارك.**

### `factory.ready.practice`

- en: Practise with {name}
- before: تمرّن معها
- **after: التمرّن مع {name}**

### `factory.ready.live`

- en: {name} is talking to real buyers.
- before: {name} تحدّث مشترين حقيقيين.
- **after: {name} على تواصل مع مشترين حقيقيين.**

### `factory.ready.more`

- en: Go through the whole list
- before: اطّلع على القائمة كاملة
- **after: الاطّلاع على القائمة كاملة**

### `factory.rehearsal.title`

- en: What {name} cannot answer yet
- before: ما لا تستطيع {name} الإجابة عنه بعد
- **after: ما لا يمكن لـ {name} الإجابة عنه بعد**

### `factory.rehearsal.lede`

- en: Buyers ask these. Until you fill them in, {name} passes the question to you.
- before: المشترون يسألون عن هذه. ما لم تُكملها، تُحوّل {name} السؤال إليك.
- **after: المشترون يسألون عن هذه. وإلى أن تُستكمل، يُحوَّل السؤال إليك.**

### `factory.rehearsal.none`

- en: Every product checked has a price {name} can quote and something you have taught.
- before: كل منتج فحصته له سعر تستطيع عرضه، ولديها ما علّمته إياها عنه.
- **after: كل منتج جرى فحصه له سعر يمكن عرضه، ومعلومات مضافة عنه.**

### `factory.rehearsal.scopeAll`

- en: Checked all {n} of your products.
- before: فحصت منتجاتك الـ{n} كلها.
- **after: جرى فحص منتجاتك الـ{n} كلها.**

### `factory.rehearsal.scopeSome`

- en: Checked {n} of your {total} products.
- before: فحصت {n} من أصل {total} من منتجاتك.
- **after: جرى فحص {n} من أصل {total} من منتجاتك.**

### `factory.rehearsal.no_price`

- en: No price is set, so {name} cannot quote these:
- before: لا سعر محدّد لهذه، فلا تستطيع عرض سعر لها:
- **after: لا سعر محدّد لهذه، فلا يمكن عرض سعر لها:**

### `factory.rehearsal.no_price_at_moq`

- en: Your prices do not cover your own smallest order, so {name} cannot quote these:
- before: أسعارك لا تغطي أصغر طلب لديك، فلا تستطيع عرض سعر لهذه:
- **after: أسعارك لا تغطي أصغر طلب لديك، فلا يمكن عرض سعر لهذه:**

### `factory.rehearsal.floor_above_price`

- en: Your lowest acceptable price is above your own list price, so {name} refuses instead of quoting at a loss:
- before: أدنى سعر تقبله أعلى من سعر قائمتك، فتمتنع عن هذه بدل أن تعرض بخسارة:
- **after: أدنى سعر مقبول لديك أعلى من سعر قائمتك، فيُرفض عرض هذه بدل البيع بخسارة:**

### `factory.rehearsal.nothing_taught`

- en: You have not taught {name} anything about these beyond the price:
- before: لم تعلّمها عن هذه شيئًا غير السعر:
- **after: لا معلومات عن هذه غير السعر:**

### `factory.rehearsal.answer_withheld`

- en: What you taught cannot be said as it stands — a number in it has no source, or it names an approval you have not authorised:
- before: ما علّمتها إياه لا يُقال كما هو — فيه رقم بلا مصدر، أو يذكر اعتمادًا لم تأذن به:
- **after: ما أُضيف من معلومات لا يمكن قوله كما هو — فيه رقم بلا مصدر، أو يذكر اعتمادًا بلا إذن منك:**

### `factory.rehearsal.claim_not_authorised`

- en: If a buyer asks whether you are certified, {name} will not confirm anything — you have authorised nothing yet.
- before: إذا سأل مشترٍ هل لديك اعتمادات، لن تؤكّد شيئًا — لم تأذن بأي منها بعد.
- **after: إذا سأل مشترٍ هل لديك اعتمادات، فلن يُؤكَّد شيء — لا إذن منك بأي منها بعد.**

### `factory.about.empty`

- en: {name} has nothing to tell buyers about you yet.
- before: لا تملك {name} ما تقوله للمشترين عنك بعد.
- **after: ليس لدى {name} ما يُقال للمشترين عنك بعد.**

### `factory.sell.title`

- en: What you sell
- before: ما تبيعه
- **after: ما تبيعه شركتك**

### `factory.sell.empty`

- en: {name} has nothing to quote yet.
- before: لا تملك {name} ما تسعّره بعد.
- **after: ليس لدى {name} ما يمكن تسعيره بعد.**

### `factory.sell.needPrice`

- en: {n} still need a price before {name} can quote them.
- before: {n} ما زالت بلا سعر، ولا تستطيع {name} تسعيرها.
- **after: {n} ما زالت بلا سعر، فلا يمكن لـ {name} تسعيرها.**

### `factory.sell.allPriced`

- en: {name} can quote every one of them.
- before: تستطيع {name} تسعير كل واحد منها.
- **after: بإمكان {name} تسعيرها كلها.**

### `factory.sell.more`

- en: See your products
- before: اعرض منتجاتك
- **after: عرض منتجاتك**

### `factory.promise.title`

- en: What you promise buyers
- before: ما تعد به المشترين
- **after: وعودك للمشترين**

### `factory.promise.q`

- en: What should {name} never get wrong?
- before: ما الذي يجب ألّا تخطئ فيه {name} أبداً؟
- **after: ما الذي لا يُسمح لـ {name} بالخطأ فيه أبداً؟**

### `factory.promise.certsOn`

- en: {name} may state these to a buyer.
- before: تستطيع {name} ذكر هذه للمشتري.
- **after: يجوز لـ {name} ذكر هذه للمشتري.**

### `factory.promise.none`

- en: You have not confirmed anything {name} may claim about your goods.
- before: لم تؤكّد بعد ما يجوز لـ {name} قوله عن بضاعتك.
- **after: لا تأكيد منك بعد لأي شيء يجوز لـ {name} قوله عن بضاعتك.**

### `factory.promise.floor`

- en: {name} never quotes below {price}.
- before: لا تنزل {name} بالسعر تحت {price}.
- **after: لا سعر من {name} تحت {price} أبداً.**

### `factory.promise.ceiling`

- en: {name} never discounts more than {ceil}%.
- before: لا تخصم أكثر من {ceil}%.
- **after: لا خصم فوق {ceil}% أبداً.**

### `factory.promise.floorRange`

- en: {name} never quotes below your floor for a product — {low} to {high} across your catalogue.
- before: لا تنزل {name} تحت سعر الأرضية لكل منتج — من {low} إلى {high} في قائمتك.
- **after: لا سعر من {name} تحت الحدّ الأدنى لكل منتج — من {low} إلى {high} في قائمتك.**

### `factory.promise.ceilingVaries`

- en: {name} never discounts more than {ceil}% — less on some products.
- before: لا تخصم أكثر من {ceil}%، وأقل في بعض المنتجات.
- **after: لا خصم فوق {ceil}%، وأقل من ذلك في بعض المنتجات.**

### `factory.promise.ask`

- en: Above {ask}% off, you are asked before the price goes out.
- before: فوق خصم {ask}%، تسألك قبل إرسال السعر.
- **after: فوق خصم {ask}%، يُطلب رأيك قبل إرسال السعر.**

### `factory.promise.askVaries`

- en: Above {ask}% off, you are asked before the price goes out — sooner on some products.
- before: فوق خصم {ask}%، تسألك قبل إرسال السعر — وقبل ذلك في بعض المنتجات.
- **after: فوق خصم {ask}%، يُطلب رأيك قبل إرسال السعر — وقبل ذلك في بعض المنتجات.**

### `factory.promise.never`

- en: Anything you have not confirmed here, {name} will not say — even if a buyer insists.
- before: ما لم تؤكّده هنا لن تقوله، مهما ألحّ المشتري.
- **after: ما لم يُؤكَّد هنا لا يُقال، مهما ألحّ المشتري.**

### `factory.promise.more`

- en: Teach {name} more
- before: علّمها المزيد
- **after: إضافة المزيد**

### `channel.state.not_connected.hint`

- en: {name} cannot receive or answer a buyer.
- before: لا تستطيع {name} استقبال المشتري ولا الرد عليه.
- **after: لا يمكن لـ {name} استقبال رسائل المشترين ولا الرد عليها.**

### `channel.state.ready.hint`

- en: Ready — you decide when {name} starts.
- before: جاهز — أنت من يقرر متى تبدأ {name}.
- **after: جاهز — وموعد بدء {name} قرارك.**

### `channel.state.active.hint`

- en: {name} is handling conversations.
- before: تتولّى {name} المحادثات.
- **after: المحادثات في عهدة {name}.**

### `channel.state.paused.hint`

- en: Reconnect to continue. Nothing was deleted.
- before: أعِد الربط للمتابعة. لم يُحذف شيء.
- **after: يلزم إعادة الربط للمتابعة. لم يُحذف شيء.**

### `factory.reach.nextConnected`

- en: Buyers who message this number reach {name}.
- before: من يراسل هذا الرقم تصله {name}.
- **after: رسائل هذا الرقم تصل إلى {name}.**

### `factory.reach.nextReady`

- en: This number is connected. Once you start {name} below, buyers who message it reach {name}.
- before: هذا الرقم مربوط. شغّلي {name} بالأسفل، عندها تصلها رسائل من يراسل هذا الرقم.
- **after: هذا الرقم مربوط. بعد التشغيل من الأسفل، تصل رسائل من يراسل هذا الرقم إلى {name}.**

### `factory.reach.nextNot`

- en: Until this is connected, {name} cannot receive or answer a buyer.
- before: قبل الربط لا تستطيع {name} استقبال المشتري ولا الرد عليه.
- **after: قبل الربط لا يمكن لـ {name} استقبال رسائل المشترين ولا الرد عليها.**

### `factory.reach.noAlerts`

- en: Add your own number to be alerted when {name} needs you.
- before: أضف رقمك لتصلك التنبيهات حين تحتاجك {name}.
- **after: إضافة رقمك لتصلك التنبيهات عند حاجة {name} إليك.**

### `header.stage`

- en: Probation · you're mentoring {name}
- before: فترة تجربة · أنت تدرّبها
- **after: فترة تجربة · بإشرافك**

### `login.brandTagline`

- en: Your digital employee's workspace
- before: مساحة عمل موظفتك الرقمية
- **after: مساحة عمل مساعدك**

### `login.error`

- en: Wrong code, please try again.
- before: رمز غير صحيح، حاول مجددًا.
- **after: رمز غير صحيح، يُرجى المحاولة مجددًا.**

### `error.notfound.body`

- en: The address you opened does not belong to anything in your workspace. It may have been mistyped, or it may be an old link.
- before: العنوان الذي فتحتِه لا يقابله شيء في مساحة عملكِ. ربما كُتب خطأً، أو أنه رابط قديم.
- **after: العنوان المطلوب لا يقابله شيء في مساحة عملك. ربما كُتب خطأً، أو أنه رابط قديم.**

### `error.crash.body`

- en: Nothing you did caused this, and nothing you had already sent was lost. Try again in a moment. If it keeps happening, write to us and quote the reference below.
- before: لا شيء مما فعلتِه سبّب هذا، ولم يضِع شيء كنتِ قد أرسلتِه. حاولي مرة أخرى بعد قليل. وإن تكرّر الأمر فاكتبي إلينا واذكري الرقم أدناه.
- **after: لم يحدث هذا بسبب أي إجراء منك، ولم يضِع شيء مما أُرسل. يُرجى المحاولة بعد قليل. وإن تكرّر الأمر، يُرجى مراسلتنا مع ذكر الرقم أدناه.**

### `login.locked`

- en: Too many wrong tries. Wait fifteen minutes, then try again.
- before: محاولات خاطئة كثيرة. انتظر خمس عشرة دقيقة ثم حاول مرة أخرى.
- **after: محاولات خاطئة كثيرة. يُرجى الانتظار خمس عشرة دقيقة ثم المحاولة مرة أخرى.**

### `login.slow`

- en: Too many tries from here. Wait a little, then try again.
- before: محاولات كثيرة من هنا. انتظر قليلاً ثم حاول مرة أخرى.
- **after: محاولات كثيرة من هنا. يُرجى الانتظار قليلاً ثم المحاولة مرة أخرى.**

### `login.codeSubmit`

- en: Enter with the code
- before: ادخل بالرمز
- **after: الدخول بالرمز**

### `login.toSignup`

- en: New here? Set up your business
- before: جديد هنا؟ أنشئ مساحة عمل لشركتك
- **after: أول مرة هنا؟ إنشاء مساحة عمل لشركتك**

### `signup.title`

- en: Set up your business
- before: أنشئ مساحة عمل لشركتك
- **after: إنشاء مساحة عمل لشركتك**

### `signup.lead`

- en: One workspace for your business. You sign in with your own e-mail and password.
- before: مساحة عمل واحدة لشركتك. تدخل إليها ببريدك الإلكتروني وكلمة مرورك.
- **after: مساحة عمل واحدة لشركتك، والدخول إليها ببريدك الإلكتروني وكلمة مرورك.**

### `signup.pick`

- en: Choose…
- before: اختر…
- **after: اختيار…**

### `signup.sells`

- en: What do you sell or do?
- before: ماذا تبيعون أو ماذا تقدّمون؟
- **after: ما الذي تبيعه شركتك أو تقدّمه؟**

### `signup.problem.kind_missing`

- en: Choose the kind of business.
- before: اختر نوع الشركة.
- **after: يُرجى اختيار نوع الشركة.**

### `signup.problem.sells_missing`

- en: Say in one line what you sell or do.
- before: اكتب في سطر واحد ماذا تبيعون أو تقدّمون.
- **after: يُرجى كتابة ما تبيعه شركتك أو تقدّمه في سطر واحد.**

### `signup.problem.country_missing`

- en: Choose your country.
- before: اختر بلدك.
- **after: يُرجى اختيار البلد.**

### `signup.problem.website_invalid`

- en: That does not look like a web address. Leave it empty if you have none.
- before: هذا لا يبدو عنوان موقع. اتركه فارغًا إن لم يكن لديك موقع.
- **after: هذا لا يبدو عنوان موقع. يمكن ترك الحقل فارغًا إن لم يكن هناك موقع.**

### `signup.problem.team_size_missing`

- en: Choose how many people work with you.
- before: اختر عدد من يعملون معك.
- **after: يُرجى اختيار عدد من يعملون معك.**

### `business.kind.invalid`

- en: Check the kind, the country and the web address.
- before: راجع النوع والبلد وعنوان الموقع.
- **after: يُرجى مراجعة النوع والبلد وعنوان الموقع.**

### `signup.password`

- en: Choose a password
- before: اختر كلمة مرور
- **after: اختيار كلمة مرور**

### `signup.inviteHint`

- en: It is in the link you were sent.
- before: تجده في الرابط الذي أُرسل إليك.
- **after: موجود في الرابط الذي أُرسل إليك.**

### `signup.submit`

- en: Create my workspace
- before: أنشئ مساحة عملي
- **after: إنشاء مساحة عملي**

### `signup.toLogin`

- en: Already set up? Sign in
- before: لديك مساحة عمل؟ سجّل الدخول
- **after: لديك مساحة عمل؟ تسجيل الدخول**

### `signup.closedContact`

- en: Write to {email} and we will set one up with you.
- before: اكتب إلى {email} وسننشئ واحدة معك.
- **after: يُرجى الكتابة إلى {email} وسننشئ واحدة معك.**

### `signup.problem.factory_missing`

- en: Tell us what your business is called.
- before: أخبرنا باسم شركتك.
- **after: يُرجى ذكر اسم شركتك.**

### `signup.problem.name_missing`

- en: Tell us your name.
- before: أخبرنا باسمك.
- **after: يُرجى ذكر اسمك.**

### `signup.problem.password_short`

- en: Use at least {n} characters.
- before: استخدم {n} أحرف على الأقل.
- **after: يلزم {n} أحرف على الأقل.**

### `signup.problem.password_is_email`

- en: Choose something other than your e-mail.
- before: اختر شيئاً غير بريدك الإلكتروني.
- **after: يجب أن تختلف كلمة المرور عن بريدك الإلكتروني.**

### `signup.problem.invite_missing`

- en: Paste the invitation code from your link.
- before: الصق رمز الدعوة من الرابط الذي وصلك.
- **after: يُرجى لصق رمز الدعوة من الرابط الذي وصلك.**

### `signup.error.email_taken`

- en: That e-mail already has a workspace. Sign in instead.
- before: هذا البريد لديه مساحة عمل بالفعل. سجّل الدخول بدلاً من ذلك.
- **after: هذا البريد لديه مساحة عمل بالفعل. يُرجى تسجيل الدخول بدلاً من ذلك.**

### `signup.error.invite_not_open`

- en: That invitation has been used or has run out. Ask for a new one.
- before: هذه الدعوة استُخدمت أو انتهت مدتها. اطلب دعوة جديدة.
- **after: هذه الدعوة استُخدمت أو انتهت مدتها. يُرجى طلب دعوة جديدة.**

### `signup.error.failed`

- en: That did not go through. Try again in a minute.
- before: لم يتم ذلك. حاول مرة أخرى بعد دقيقة.
- **after: لم يتم ذلك. يُرجى المحاولة بعد دقيقة.**

### `signup.error.slow`

- en: Too many tries from here. Wait a little, then try again.
- before: محاولات كثيرة من هنا. انتظر قليلاً ثم حاول مرة أخرى.
- **after: محاولات كثيرة من هنا. يُرجى الانتظار قليلاً ثم المحاولة مرة أخرى.**

### `signup.welcome`

- en: Your workspace is ready. Start by telling {name} about your business.
- before: مساحة عملك جاهزة. ابدأ بإخبار {name} عن شركتك.
- **after: مساحة عملك جاهزة. البداية: تعريف {name} بشركتك.**

### `verify.title`

- en: Enter your code
- before: أدخل الرمز
- **after: إدخال الرمز**

### `verify.resend`

- en: Send me a new code
- before: أرسل لي رمزًا جديدًا
- **after: إرسال رمز جديد**

### `verify.back`

- en: Start again
- before: ابدأ من جديد
- **after: البدء من جديد**

### `verify.error.wrong`

- en: That is not the code. Check the latest e-mail and try again.
- before: هذا ليس الرمز. راجع أحدث رسالة ثم حاول مرة أخرى.
- **after: هذا ليس الرمز. يُرجى مراجعة أحدث رسالة ثم المحاولة مرة أخرى.**

### `verify.error.expired`

- en: That code has run out. Ask for a new one below.
- before: انتهت مدة هذا الرمز. اطلب رمزًا جديدًا بالأسفل.
- **after: انتهت مدة هذا الرمز. يمكن طلب رمز جديد بالأسفل.**

### `verify.error.spent`

- en: Too many tries on that code. Ask for a new one below.
- before: محاولات كثيرة على هذا الرمز. اطلب رمزًا جديدًا بالأسفل.
- **after: محاولات كثيرة على هذا الرمز. يمكن طلب رمز جديد بالأسفل.**

### `verify.error.gone`

- en: That code is no longer good. Ask for a new one below, or start again.
- before: هذا الرمز لم يعد صالحًا. اطلب رمزًا جديدًا بالأسفل أو ابدأ من جديد.
- **after: هذا الرمز لم يعد صالحًا. يمكن طلب رمز جديد بالأسفل أو البدء من جديد.**

### `verify.error.slow`

- en: Too many codes were asked for. Wait an hour, then try again.
- before: طُلبت رموز كثيرة. انتظر ساعة ثم حاول مرة أخرى.
- **after: طُلبت رموز كثيرة. يُرجى الانتظار ساعة ثم المحاولة مرة أخرى.**

### `verify.error.mail`

- en: We could not send the e-mail. Try again in a minute.
- before: تعذّر إرسال الرسالة. حاول مرة أخرى بعد دقيقة.
- **after: تعذّر إرسال الرسالة. يُرجى المحاولة بعد دقيقة.**

### `otp.mail.body`

- en: Your code is {code}.

It works for 10 minutes and only once. If you did not ask for it, you can ignore this e-mail: nothing happens without the code.
- before: رمزك هو {code}.

يصلح لمدة 10 دقائق ولمرة واحدة فقط. إن لم تطلبه فتجاهل هذه الرسالة: لا يحدث شيء بدون الرمز.
- **after: رمزك هو {code}.

يصلح لمدة 10 دقائق ولمرة واحدة فقط. إن لم يكن الطلب منك، فيمكن تجاهل هذه الرسالة: لا يحدث شيء بدون الرمز.**

### `data.export.title`

- en: Take a copy
- before: خذي نسخة
- **after: تنزيل نسخة**

### `data.export.lead`

- en: One file per kind, in the format a spreadsheet opens. Everything here is yours — what you typed in, and what buyers wrote to you.
- before: ملف لكل نوع، بصيغة يفتحها أي برنامج جداول. كل ما هنا لكِ — ما أدخلتِه، وما كتبه إليكِ المشترون.
- **after: ملف لكل نوع، بصيغة يفتحها أي برنامج جداول. كل ما هنا ملكك — ما أُدخل من بياناتك، وما كتبه إليك المشترون.**

### `data.export.limit`

- en: Each file holds up to {n} rows, newest last. If yours is longer, write to us and we will send the rest.
- before: كل ملف يسع {n} سطرًا، الأحدث في آخره. إن كان سجلّكِ أطول فاكتبي إلينا ونرسل لكِ البقية.
- **after: كل ملف يسع {n} سطرًا، الأحدث في آخره. إن كان سجلّك أطول، يمكن مراسلتنا لنرسل لك البقية.**

### `data.export.subject.quotes`

- en: Prices you quoted
- before: الأسعار التي عرضتِها
- **after: الأسعار المعروضة**

### `data.export.subject.teaching`

- en: What you taught
- before: ما علّمتِها إياه
- **after: ما أُضيف إلى معرفة {name}**

### `data.export.configTitle`

- en: What you set up
- before: ما أعددتِه
- **after: إعداداتك**

### `data.export.configLead`

- en: The part nobody wants to type twice: your floors and discounts, the terms you sell on, and every fact you taught.
- before: الجزء الذي لا يودّ أحد إدخاله مرتين: حدودك الدنيا وخصوماتك، وشروط بيعك، وكل ما علّمتِها إياه.
- **after: الجزء الذي لا يودّ أحد إدخاله مرتين: حدودك الدنيا وخصوماتك، وشروط بيعك، وكل ما أُضيف إلى معرفة {name}.**

### `data.export.flash.tooMany`

- en: That is a lot of files at once. Wait a minute and take the next one.
- before: هذه ملفات كثيرة دفعة واحدة. انتظري دقيقة ثم خذي التالي.
- **after: هذه ملفات كثيرة دفعة واحدة. يمكن تنزيل التالي بعد دقيقة.**

### `data.deletion.lead`

- en: Everything this workspace holds — buyers, messages, products, orders, everything you taught — removed for good.
- before: كل ما تحتفظ به مساحة العمل هذه — المشترون والرسائل والمنتجات والطلبات وما علّمتِها إياه — يُحذف نهائيًا.
- **after: كل ما تحتفظ به مساحة العمل هذه — المشترون والرسائل والمنتجات والطلبات وما أُضيف إلى معرفة {name} — يُحذف نهائيًا.**

### `data.deletion.byHand`

- en: This is not a button that erases. A person receives the request and does it by hand, and you can take it back until they have. Nothing here can delete anything on its own.
- before: هذا ليس زرًّا يمحو. يستلم شخص الطلب وينفّذه يدويًا، ويمكنكِ التراجع إلى أن ينفّذه. لا شيء هنا يحذف أي سجل من تلقاء نفسه.
- **after: هذا ليس زرًّا يمحو. يستلم شخص الطلب وينفّذه يدويًا، ويمكنك التراجع إلى حين تنفيذه. لا شيء هنا يحذف أي سجل من تلقاء نفسه.**

### `data.deletion.ownerOnly`

- en: Only the owner can ask for this.
- before: صاحبة العمل وحدها من تطلب هذا.
- **after: هذا الطلب متاح لحساب المالك فقط.**

### `data.deletion.typeName`

- en: Type {name} to confirm
- before: اكتبي {name} للتأكيد
- **after: للتأكيد، يُرجى كتابة {name}**

### `data.deletion.why`

- en: Anything you want us to know (optional)
- before: أي شيء تودّين إخبارنا به (اختياري)
- **after: ملاحظات لنا (اختياري)**

### `data.deletion.ask`

- en: Ask for everything to be deleted
- before: اطلبي حذف كل شيء
- **after: طلب حذف كل شيء**

### `data.deletion.confirm`

- en: This asks for every record in this workspace to be deleted. Continue?
- before: هذا يطلب حذف كل سجل في مساحة العمل هذه. أتريدين المتابعة؟
- **after: هذا يطلب حذف كل سجل في مساحة العمل هذه. متابعة؟**

### `data.deletion.pending`

- en: You asked for everything to be deleted on {date}. Nobody has acted on it yet.
- before: طلبتِ حذف كل شيء في {date}. لم ينفّذه أحد بعد.
- **after: طُلب حذف كل شيء في {date}. لم ينفّذه أحد بعد.**

### `data.deletion.withdraw`

- en: Take that back
- before: تراجعي عن ذلك
- **after: التراجع عن الطلب**

### `data.deletion.history`

- en: What you have asked for
- before: ما طلبتِه
- **after: طلباتك**

### `data.flash.asked`

- en: Asked. A person will do it by hand; you can take it back until they have.
- before: تم الطلب. سينفّذه شخص يدويًا، ويمكنكِ التراجع إلى أن يفعل.
- **after: تم الطلب. سينفّذه شخص يدويًا، ويمكنك التراجع إلى حين تنفيذه.**

### `data.flash.already_open`

- en: You have already asked. It is still waiting.
- before: سبق أن طلبتِ، وما زال الطلب في الانتظار.
- **after: الطلب موجود مسبقًا، وما زال في الانتظار.**

### `data.flash.not_open`

- en: That one is not waiting any more. Look at the page again.
- before: هذا الطلب لم يعد في الانتظار. انظري إلى الصفحة مرة أخرى.
- **after: هذا الطلب لم يعد في الانتظار. يُرجى تحديث الصفحة.**

### `data.flash.failed`

- en: That did not go through. Try again in a minute.
- before: لم تنجح العملية. حاولي بعد دقيقة.
- **after: لم تنجح العملية. يُرجى المحاولة بعد دقيقة.**

### `account.email`

- en: You sign in as {email}.
- before: تدخل باستخدام {email}.
- **after: حساب الدخول: {email}.**

### `account.codeOnly`

- en: You sign in with an access code, so there is no password to change here.
- before: تدخل برمز دخول، لذلك لا توجد كلمة مرور لتغييرها هنا.
- **after: الدخول برمز دخول، لذلك لا توجد كلمة مرور لتغييرها هنا.**

### `account.save`

- en: Change password
- before: غيّر كلمة المرور
- **after: تغيير كلمة المرور**

### `account.flash.short`

- en: Use at least {n} characters.
- before: استخدم {n} أحرف على الأقل.
- **after: يلزم {n} أحرف على الأقل.**

### `account.flash.failed`

- en: That did not go through. Try again in a minute.
- before: لم يتم ذلك. حاول مرة أخرى بعد دقيقة.
- **after: لم يتم ذلك. يُرجى المحاولة بعد دقيقة.**

### `ops.attention.allClear`

- en: You're all caught up
- before: أنجزت كل شيء
- **after: كل شيء منجز**

### `ops.card.blocked`

- en: Did not reach the buyer
- before: لم تصل إلى المشتري
- **after: رسائل لم تصل إلى المشتري**

### `ops.card.yours`

- en: You are handling these
- before: أنت تتولّاها
- **after: في عهدتك**

### `ops.activity.title`

- en: What {name} did
- before: ما أنجزته {name}
- **after: عمل {name}**

### `ops.activity.handled`

- en: Buyers answered
- before: مشترون تحدثت إليهم
- **after: مشترون تمّ الردّ عليهم**

### `ops.activity.corrections`

- en: Replies you corrected
- before: ردود قمت بتصحيحها
- **after: تصحيحاتك للردود**

### `today.calm.body`

- en: {name} is looking after your buyers. Nothing needs you right now.
- before: {name} تعتني بمشتريك. لا شيء يحتاجك الآن.
- **after: مشتروك في عهدة {name}. لا شيء يحتاجك الآن.**

### `today.stepIn.title`

- en: How often you stepped in
- before: كم مرة تدخّلت
- **after: مرات تدخّلك**

### `today.stepIn.why`

- en: Why you stepped in
- before: لماذا تدخّلت
- **after: أسباب تدخّلك**

### `today.stepIn.none`

- en: You did not need to step in.
- before: لم تحتج إلى التدخّل.
- **after: لم يلزم أي تدخّل منك.**

### `today.learning.title`

- en: {name} is learning from your corrections
- before: {name} تتعلّم من تصحيحاتك
- **after: {name}: التعلّم من تصحيحاتك**

### `her.knows.title`

- en: What {name} knows
- before: ما تعرفه
- **after: معرفة {name}**

### `her.knows.count`

- en: Things learned from you
- before: أشياء تعلّمتها منك
- **after: ما أُضيف منك**

### `her.knows.none`

- en: Nothing has been taught yet. Start with the facts buyers ask about most.
- before: لم تتعلّم شيئاً بعد. علّمها ما يسأل عنه المشترون أكثر.
- **after: لم يُضف شيء بعد. البداية الأنسب: ما يسأل عنه المشترون أكثر.**

### `her.knows.corrected`

- en: You corrected
- before: صحّحت لها
- **after: تصحيحاتك**

### `her.handles.title`

- en: What {name} handles alone
- before: ما تتولّاه بنفسها
- **after: ما يُنجز دون انتظارك**

### `her.handles.alone`

- en: Handled without you
- before: تتولّاه بنفسها
- **after: يُنجز دون انتظارك**

### `her.handles.waits`

- en: Waits for you
- before: تنتظر موافقتك
- **after: بانتظار موافقتك**

### `her.handles.always`

- en: Always waits for you
- before: تنتظر موافقتك دائماً
- **after: بانتظار موافقتك دائماً**

### `her.recent.needed`

- en: Needed your help
- before: احتاجت إليك
- **after: استلزم تدخّلك**

### `her.teach.title`

- en: What {name} still needs from you
- before: ما تحتاج أن تعلّمها إياه
- **after: ما يلزم إضافته بعد**

### `her.teach.none`

- en: Nothing waiting — everything was answered from what you taught.
- before: لا شيء ينتظر — أجابت عن كل شيء ممّا علّمتها.
- **after: لا شيء ينتظر — جاءت كل الإجابات ممّا أُضيف من معلومات.**

### `her.teach.unasked`

- en: No buyer has asked anything yet. Teach {name} what they ask about most.
- before: لم يسألها أي مشترٍ شيئاً بعد. علّمها ما يسألون عنه أكثر.
- **after: لم تصل أي أسئلة من المشترين بعد. البداية الأنسب: ما يسألون عنه أكثر.**

### `her.teach.go`

- en: Teach {name}
- before: علّمها
- **after: تعليم {name}**

### `buyers.group.yours`

- en: You are handling
- before: أنت تتولّاها
- **after: في عهدتك**

### `buyers.group.hers`

- en: {name} is handling
- before: {name} تتولّاها
- **after: في عهدة {name}**

### `buyers.badge.review`

- en: Review {name}'s reply
- before: راجِع ردّها
- **after: مراجعة ردّ {name}**

### `buyers.badge.yours`

- en: You are replying
- before: أنت تردّ
- **after: الردّ بيدك**

### `buyers.review.title`

- en: Review {name}'s reply
- before: راجِع ردّها
- **after: مراجعة ردّ {name}**

### `buyers.review.intro`

- en: {name} wrote this for {buyer}. Send it, change it, or skip it.
- before: كتبت هذا لـ {buyer}. أرسله أو عدّله أو تجاهله.
- **after: مسودة من {name} لـ {buyer}. يمكن إرسالها أو تعديلها أو تجاهلها.**

### `buyers.knew.title`

- en: What {name} used to answer
- before: ما استندت إليه
- **after: مصادر الإجابة**

### `analytics.employee.own`

- en: {own} of {replies} replies came straight from your rules and what you taught. The rest were written fresh.
- before: من أصل {replies} ردًّا، جاء {hers} مباشرةً من قواعدكِ وممّا علّمتِها، والباقي كتبته من جديد.
- **after: من أصل {replies} ردًّا، جاء {own} مباشرةً من قواعدك وممّا أُضيف إلى معرفة {name}، والباقي كُتب من جديد.**

### `channel.whatsapp.desc`

- en: Buyers message this number; {name} writes the reply and you decide what goes out
- before: يراسل المشترون هذا الرقم؛ تكتب {name} الرد وأنت تقرر ما يُرسَل
- **after: ردود {name} على رسائل هذا الرقم لا تُرسَل إلا بقرار منك**

### `channel.action.connectNumber`

- en: Connect this number
- before: اربط هذا الرقم
- **after: ربط هذا الرقم**

### `channel.connect.configured`

- en: Your WhatsApp number is set up. Connect it and buyers’ messages reach {name}. Nothing is sent until you switch {name} on.
- before: رقم واتساب الخاص بك جاهز. اربطه لتصل رسائل المشترين إلى {name}، ولن ترسل شيئًا حتى تشغّلها أنت.
- **after: رقم واتساب الخاص بك جاهز. بعد ربطه، تصل رسائل المشترين إلى {name}، ولا يُرسَل شيء قبل التشغيل منك.**

### `channel.soon.note`

- en: Which do you want first? Tell us and we will prioritize it.
- before: أيها تريد أولًا؟ أخبرنا وسنعطيه الأولوية.
- **after: أيها أهمّ لك؟ يسعدنا معرفة ذلك لنعطيه الأولوية.**

### `channel.problem.disconnected.what`

- en: You disconnected WhatsApp.
- before: أوقفت اتصال واتساب.
- **after: أُوقف اتصال واتساب.**

### `channel.problem.disconnected.doing`

- en: {name} cannot receive or send messages.
- before: {name} لا تستقبل أو ترسل رسائل.
- **after: رسائل {name} متوقفة: لا استقبال ولا إرسال.**

### `channel.problem.disconnected.youDo`

- en: To resume, tap Reconnect — about two minutes.
- before: لاستئناف العمل، اضغط إعادة الاتصال — دقيقتان.
- **after: للاستئناف: زر «إعادة الاتصال» — دقيقتان تقريبًا.**

### `channel.problem.needs_relogin.doing`

- en: {name} cannot receive messages right now.
- before: {name} لا تستقبل رسائل حاليًا.
- **after: لا تصل رسائل إلى {name} حاليًا.**

### `channel.problem.needs_relogin.youDo`

- en: Tap Reconnect — about two minutes.
- before: اضغط إعادة الاتصال — دقيقتان.
- **after: الحل: زر «إعادة الاتصال» — دقيقتان تقريبًا.**

### `channel.flash.disconnected`

- en: Disconnected. {name} will not receive new messages; tap Reconnect to resume.
- before: تم قطع الاتصال. {name} لن تستقبل رسائل جديدة؛ اضغط إعادة الاتصال للاستئناف.
- **after: تم قطع الاتصال. لن تصل رسائل جديدة إلى {name}؛ ويمكن الاستئناف بزر «إعادة الاتصال».**

### `channel.flash.reconnected`

- en: Reconnected. {name} is handling customers again.
- before: تمت إعادة الاتصال. {name} تستقبل العملاء من جديد.
- **after: تمت إعادة الاتصال. رسائل العملاء تصل إلى {name} من جديد.**

### `channel.flash.test_ok`

- en: Connection is good — ready for customers.
- before: الاتصال جيد — جاهزة لاستقبال العملاء.
- **after: الاتصال جيد — جاهز لاستقبال العملاء.**

### `channel.flash.test_not_connected`

- en: Not connected yet — tap Connect and follow the steps.
- before: غير متصل بعد — اضغط اتصال واتبع الخطوات.
- **after: غير متصل بعد — البداية بزر «اتصال» ثم اتباع الخطوات.**

### `channel.flash.connected`

- en: Connected. Buyers’ messages now reach {name}. Nothing is sent until you switch {name} on.
- before: تم الربط. تصل رسائل المشترين الآن إلى {name}، ولن ترسل شيئًا حتى تشغّلها.
- **after: تم الربط. تصل رسائل المشترين الآن إلى {name}، ولا يُرسَل شيء قبل التشغيل منك.**

### `channel.flash.already_connected`

- en: This number was connected before. Tap Reconnect to use it again.
- before: رُبط هذا الرقم من قبل. اضغط إعادة الاتصال لاستخدامه مجددًا.
- **after: رُبط هذا الرقم من قبل. لاستخدامه مجددًا: زر «إعادة الاتصال».**

### `channel.flash.number_taken`

- en: This number is already connected to another business, so it was not connected here. Ask your setup contact.
- before: هذا الرقم مربوط بنشاط تجاري آخر، لذلك لم يُربط هنا. تواصل مع من ساعدك في الإعداد.
- **after: هذا الرقم مربوط بنشاط تجاري آخر، لذلك لم يُربط هنا. يُرجى التواصل مع من ساعدك في الإعداد.**

### `channel.flash.not_configured`

- en: No WhatsApp number has been set up yet. Ask your setup contact.
- before: لم يُعدّ رقم واتساب بعد. تواصل مع من ساعدك في الإعداد.
- **after: لم يُعدّ رقم واتساب بعد. يُرجى التواصل مع من ساعدك في الإعداد.**

### `channel.connect.intro`

- en: Once connected, {name} sees the messages buyers send to your WhatsApp and drafts replies — you decide what goes out.
- before: بعد الربط، ترى {name} رسائل المشترين على واتساب وتكتب الردود — وأنت من يقرر ما يُرسَل.
- **after: بعد الربط، تصل إلى {name} رسائل المشترين على واتساب وتُكتب الردود — والقرار في ما يُرسَل لك.**

### `channel.connect.step1`

- en: Tell us the WhatsApp number you use with customers
- before: أخبرنا برقم واتساب الذي تستخدمه مع العملاء
- **after: إبلاغنا برقم واتساب المستخدم مع العملاء**

### `channel.connect.step3`

- en: We send one test message, then you are ready
- before: تُرسَل رسالة اختبار واحدة ثم تبدأ الاستقبال
- **after: تُرسَل رسالة اختبار واحدة ثم يبدأ الاستقبال**

### `channel.connect.note`

- en: We help with the first connection; after that, switching on/off, testing, and disconnecting are all on this page, managed by you. You never see or handle any password or setup.
- before: نساعدك في الربط الأول؛ بعدها التبديل والاختبار وقطع الاتصال كلها في هذه الصفحة تديرها بنفسك. لن ترى أو تتعامل مع أي كلمة مرور أو إعداد.
- **after: نساعدك في الربط الأول؛ بعدها التشغيل والإيقاف والاختبار وقطع الاتصال كلها في هذه الصفحة وتحت إدارتك. لا كلمات مرور ولا إعدادات عليك التعامل معها.**

### `product.teach`

- en: Teach {name} your products
- before: علّمها المنتجات
- **after: تعليم {name} المنتجات**

### `product.status.learned`

- en: Learned
- before: تعلّمته
- **after: تمّ التعلّم**

### `product.list.needLimits`

- en: {n} products have a price but no price limits yet, so {name} cannot quote them.
- before: {n} من المنتجات لها سعر ولكن بلا حدود أسعار بعد، لذلك لا تستطيع {name} تسعيرها.
- **after: {n} من المنتجات لها سعر ولكن بلا حدود أسعار بعد، لذلك لا يمكن لـ {name} تسعيرها.**

### `product.list.needLimits.link`

- en: Set your price limits
- before: حدّد حدود أسعارك
- **after: تحديد حدود أسعارك**

### `product.flash.addedReady`

- en: Added {added} products. {ready} are ready for {name} to quote.
- before: تمت إضافة {added} من المنتجات. {ready} منها جاهزة لتسعّرها {name}.
- **after: تمت إضافة {added} من المنتجات. {ready} منها جاهزة لتسعير {name}.**

### `prices.inherited.line`

- en: Uses your answer for everything: never below {floor}.
- before: تستخدم جوابك عن كل شيء: لا أقل من {floor} أبدًا.
- **after: يسري جوابك عن كل شيء: لا أقل من {floor} أبدًا.**

### `prices.inherited.own`

- en: Give this one its own answer
- before: أعطِ هذا المنتج جوابًا خاصًا به
- **after: جواب خاص بهذا المنتج**

### `prices.flash.savedActivated`

- en: Saved. {n} products are now ready for {name} to quote.
- before: تم الحفظ. أصبح {n} من المنتجات جاهزًا لتسعّره {name}.
- **after: تم الحفظ. أصبح {n} من المنتجات جاهزًا لتسعير {name}.**

### `product.list.empty.body`

- en: Send your price list and {name} can quote at your prices.
- before: أرسل قائمة أسعارك وتستطيع {name} التسعير بأسعارك.
- **after: بعد إرسال قائمة أسعارك، يمكن لـ {name} التسعير بأسعارك.**

### `product.list.empty.cta`

- en: Upload your catalog to start
- before: ارفع قائمتك للبدء
- **after: رفع قائمتك للبدء**

### `product.detail.addPrice`

- en: Add a price
- before: أضف سعرًا
- **after: إضافة سعر**

### `product.detail.aliasesNote`

- en: {name} recognizes all of these when buyers ask.
- before: تتعرّف {name} على كل هذه عند سؤال المشترين.
- **after: كل هذه الأسماء معروفة لدى {name} عند سؤال المشترين.**

### `employee.growth.learned_edit`

- en: Learned a correction ({cap})
- before: تعلّمت تصحيحًا ({cap})
- **after: تعلُّم تصحيح ({cap})**

### `insight.quotedNoReply`

- en: {buyer} has not answered since you priced their order.
- before: لم يردّ {buyer} منذ أن سعّرت طلبه.
- **after: لا ردّ من {buyer} منذ تسعير الطلب.**

### `insight.promotionReady`

- en: {name} has earned {cap} without supervision.
- before: أتقنت {name} «{cap}» ويمكنها تولّيها بنفسها.
- **after: «{cap}»: جاهزة للترقية لدى {name}.**

### `insight.productsNoPrice`

- en: {count} products have no price yet, so {name} cannot quote them.
- before: {count} منتجات بلا سعر، فلا تستطيع تسعيرها.
- **after: {count} منتجات بلا سعر، فلا يمكن تسعيرها.**

### `insight.action.review_drafts`

- en: Review
- before: راجع
- **after: مراجعة**

### `insight.action.follow_up`

- en: Follow up
- before: تابِع
- **after: متابعة**

### `insight.action.consider_promotion`

- en: Take a look
- before: ألقِ نظرة
- **after: إلقاء نظرة**

### `insight.action.fix_catalog`

- en: Add prices
- before: أضف الأسعار
- **after: إضافة الأسعار**

### `insight.action.settle_uncertain`

- en: Look at them
- before: انظري فيها
- **after: التحقّق منها**

### `insight.followUpsWaiting`

- en: {count} follow-up e-mails are waiting for you to check your inbox.
- before: {count} رسائل متابعة تنتظر أن تنظري في بريدكِ أولًا.
- **after: {count} رسائل متابعة بانتظار مراجعة بريدك أولًا.**

### `insight.action.confirm_follow_ups`

- en: Check them
- before: انظري فيها
- **after: التحقّق منها**

### `proof.owner.none`

- en: You can send this buyer a page showing where the price came from.
- before: يمكنك أن ترسل لهذا المشتري صفحة تبيّن من أين جاء السعر.
- **after: يمكن إرسال صفحة لهذا المشتري تبيّن مصدر السعر.**

### `proof.owner.issue`

- en: Make a link
- before: أنشئ رابطًا
- **after: إنشاء رابط**

### `proof.owner.revoke`

- en: Turn it off
- before: أوقفه
- **after: إيقاف الرابط**

### `proof.owner.flash.issued`

- en: Link ready. Paste it to the buyer.
- before: الرابط جاهز. أرسله إلى المشتري.
- **after: الرابط جاهز. يمكن إرساله إلى المشتري الآن.**

### `forbidden.title`

- en: Words {name} must never use
- before: كلمات لا يجوز أن تقولها {name} أبدًا
- **after: كلمات لا تُقال في ردود {name} أبدًا**

### `forbidden.intro`

- en: Add anything you never want {name} to say to a buyer. A reply that contains one is never sent: it is written again without it, and if that cannot be done, it comes to you instead.
- before: أضف ما لا تريد أن تقوله {name} للمشتري. أي ردّ يحتوي عليه لا يُرسَل أبدًا: تكتبه من جديد بدونه، وإن لم تستطع يصلك أنت.
- **after: يمكن هنا إضافة كل ما يجب ألّا يصل إلى المشتري في ردود {name}. الردّ الذي يحتوي على شيء منها لا يُرسَل أبدًا: تُعاد كتابته بدونه، وإن تعذّر ذلك يصلك أنت.**

### `forbidden.add.button`

- en: Add
- before: أضف
- **after: إضافة**

### `forbidden.remove`

- en: Remove
- before: احذف
- **after: حذف**

### `forbidden.empty`

- en: You have not added any yet.
- before: لم تضف شيئًا بعد.
- **after: لا شيء مُضاف بعد.**

### `forbidden.floor.body`

- en: {name} will never curse or insult a buyer. You cannot switch this off, and you do not need to add it.
- before: لن تشتم {name} مشتريًا أو تسيء إليه أبدًا. لا يمكن إيقاف ذلك، ولا تحتاج إلى إضافته.
- **after: لا شتائم ولا إساءة لأي مشترٍ في ردود {name} أبدًا. هذا لا يمكن إيقافه، ولا حاجة إلى إضافته.**

### `forbidden.flash.added`

- en: Added. {name} will not say it.
- before: أُضيفت. لن تقولها {name}.
- **after: أُضيفت. لن تُقال في ردود {name}.**

### `forbidden.flash.empty`

- en: Type a word first.
- before: اكتب كلمة أولاً.
- **after: يلزم كتابة كلمة أولاً.**

### `demote.why.serious_spot_check`

- en: you found something seriously wrong
- before: وجدت خطأً جسيمًا
- **after: ظهر في الفحص خطأ جسيم**

### `demote.why.failed_spot_check`

- en: you had to correct me twice
- before: صحّحتني مرتين
- **after: احتجتُ إلى التصحيح مرتين**

### `employee.promo.done`

- en: Already handling customers.
- before: تستقبل العملاء بالفعل.
- **after: استقبال العملاء قائم بالفعل.**

### `employee.actions.note`

- en: Once granted, it is handled without you; you can revoke anytime. Confirming orders always waits for you.
- before: بعد المنح تتولاها بنفسها؛ يمكنك السحب في أي وقت. تأكيد الطلبات ينتظرك دائمًا.
- **after: بعد المنح يُنجز هذا دون انتظارك؛ ويمكنك السحب في أي وقت. تأكيد الطلبات ينتظرك دائمًا.**

### `spotcheck.title`

- en: Check {name}'s work
- before: راجع عملها
- **after: مراجعة عمل {name}**

### `spotcheck.intro`

- en: Have a look at what {name} sent. Not a test — you just say whether it was right.
- before: ألقِ نظرة على ما أرسلته {name}. ليس اختبارًا — تقول فقط إن كان الردّ صحيحًا.
- **after: نظرة على ما أُرسل من {name}. ليس اختبارًا — المطلوب فقط: هل كان الردّ صحيحًا؟**

### `spotcheck.sheReplied`

- en: {name} replied
- before: ردّت {name}
- **after: ردّ {name}**

### `spotcheck.fix`

- en: Tell {name} how to say it
- before: علّمها كيف تقولها
- **after: الصيغة الصحيحة**

### `spotcheck.fixPlaceholder`

- en: What should have been said?
- before: ماذا كان ينبغي أن تقول؟
- **after: ما الردّ الصحيح؟**

### `spotcheck.fixSave`

- en: Save this
- before: احفظ هذا
- **after: حفظ**

### `spotcheck.flash.ok`

- en: Noted — that one was right.
- before: سُجّل — كان ردّها صحيحًا.
- **after: سُجّل — الردّ كان صحيحًا.**

### `spotcheck.flash.problem`

- en: Noted. This kind of thing will wait for you.
- before: سُجّل. ستنتظرك في مثل هذه الحالات.
- **after: سُجّل. هذا النوع من الحالات سينتظرك من الآن.**

### `spotcheck.flash.fixed`

- en: Saved. It will be said your way from now on.
- before: حُفظ. ستقولها بطريقتك من الآن.
- **after: حُفظ. من الآن تُستخدم صيغتك.**

### `spotcheck.flash.gone`

- en: You have already answered that one.
- before: لقد أجبت عن هذه بالفعل.
- **after: سبقت الإجابة عن هذه.**

### `employee.actions.empty`

- en: Nothing to grant or revoke yet. As {name} does more and passes spot-checks, "Grant" appears here.
- before: لا شيء للمنح أو السحب بعد. مع مزيد من العمل واجتياز الفحوص، سيظهر «منح» هنا.
- **after: لا شيء للمنح أو السحب بعد. مع مزيد من العمل واجتياز الفحوص، يظهر «منح» هنا.**

### `autonomy.title`

- en: How much {name} does alone
- before: كم تفعل {name} بمفردها
- **after: مدى استقلالية {name}**

### `autonomy.intro`

- en: Your choice, from day one. Whatever you choose: no order is confirmed without you, prices only come from your price rules, and anything your rules hold still waits for you.
- before: القرار قراركِ من اليوم الأول. ومهما اخترتِ: لا تؤكّد طلبًا من دونكِ، والأسعار من قواعد أسعاركِ فقط، وما تطلب قواعدكِ عرضه عليكِ يبقى ينتظركِ.
- **after: القرار لك من اليوم الأول. ومهما كان الاختيار: لا يُؤكَّد طلب من دونك، والأسعار من قواعد أسعارك فقط، وما تحجزه قواعدك يبقى بانتظارك.**

### `autonomy.disclosure`

- en: One thing to know before you choose: when {name} replies without you, the first message in a conversation tells your buyer they are not talking to a person, and offers them someone from your team. A reply you send yourself carries no such line — you sent it.
- before: قبل أن تختاري، اعلمي هذا: حين تردّ من دونكِ، تُخبر أولُ رسالة في المحادثة المشتري أنها ليست إنسانًا، مع عرض التحدث مع شخص من فريقكِ. أما الرد الذي ترسلينه بنفسكِ فلا يحمل هذه الجملة — لأنكِ أنتِ من أرسلَه.
- **after: قبل الاختيار، معلومة مهمة: في الردود التي تُرسَل من دونك، تُخبر أولُ رسالة في المحادثة المشتري بأن الردّ ليس من إنسان، مع عرض التحدث مع شخص من فريقك. أما الردّ المُرسَل منك فلا يحمل هذه الجملة — لأنه منك.**

### `autonomy.needsName`

- en: Whatever you choose here, every reply keeps coming to you first until you confirm the name in Getting ready — a message sent without you gives your buyer that name, and you should read it first.
- before: مهما اخترتِ هنا، ستظل تعرض عليكِ كل ردّ إلى أن تؤكّدي اسمها في صفحة التجهيز — فالرسالة التي تُرسَل من دونكِ تعطي المشتري هذا الاسم، ومن حقّكِ أن تقرئيه أولًا.
- **after: مهما كان الاختيار هنا، سيبقى كل ردّ معروضًا عليك إلى حين تأكيد اسم {name} في صفحة التجهيز — فالرسالة المُرسَلة من دونك تحمل هذا الاسم إلى المشتري، ومن حقك قراءته أولًا.**

### `autonomy.notReleased`

- en: Not yet available. The line that tells a buyer they are not talking to a person has not been read by a native speaker of every language used, and nothing goes out without you until it has.
- before: غير متاح بعد. الجملة التي ترسلها للمشتري لتقول ما هي لم يقرأها بعد متحدث أصلي بكل لغة تكتب بها، ولا يخرج شيء من دونكِ قبل ذلك.
- **after: غير متاح بعد. جملة التعريف التي تُرسَل للمشتري لم يراجعها بعد متحدث أصلي بكل لغات الردود، ولا يخرج شيء من دونك قبل ذلك.**

### `autonomy.flash.notReleased`

- en: Not yet — the line that tells a buyer they are not talking to a person is still being checked in every language used.
- before: ليس بعد — الجملة التي ترسلها للمشتري لتقول ما هي ما زالت قيد المراجعة بكل لغة تكتب بها.
- **after: ليس بعد — جملة التعريف التي تُرسَل للمشتري ما زالت قيد المراجعة بكل لغات الردود.**

### `autonomy.level.waits.note`

- en: Every reply is written for you; nothing goes out until you press Send.
- before: تكتب كل ردّ، ولا يخرج شيء قبل أن تضغطي إرسال.
- **after: كل ردّ يُكتب، ولا يخرج شيء قبل الضغط على «إرسال».**

### `autonomy.level.talks`

- en: {name} talks without me; prices wait for me
- before: تتحدّث بمفردها، والأسعار تنتظرني
- **after: المحادثة دون انتظاري، والأسعار تنتظرني**

### `autonomy.level.talks.note`

- en: Greetings, questions, recommendations and follow-ups go out by themselves. A reply that states a price waits for you.
- before: التحيات والأسئلة والتوصيات والمتابعات تخرج من تلقاء نفسها. الردّ الذي يذكر سعرًا ينتظركِ.
- **after: التحيات والأسئلة والتوصيات والمتابعات تخرج من تلقاء نفسها. الردّ الذي يذكر سعرًا ينتظرك.**

### `autonomy.level.sells`

- en: {name} also quotes and negotiates without me
- before: تسعّر وتفاوض بمفردها أيضًا
- **after: التسعير والتفاوض أيضًا دون انتظاري**

### `autonomy.level.sells.note`

- en: Inside your price rules: never below your floor, and a discount above your ask line still comes to you.
- before: ضمن قواعد أسعاركِ: لا تنزل عن حدّكِ الأدنى أبدًا، والخصم فوق خطّكِ يعود إليكِ.
- **after: ضمن قواعد أسعارك: لا سعر تحت حدّك الأدنى أبدًا، والخصم فوق خطّك يعود إليك.**

### `autonomy.mixed`

- en: Right now it is a mix — see the list below.
- before: الوضع الآن مزيج — انظري القائمة أدناه.
- **after: الوضع الآن مزيج — التفاصيل في القائمة أدناه.**

### `autonomy.flash.saved`

- en: Saved. {name} works this way from the next message.
- before: تم الحفظ. تعمل {name} هكذا من الرسالة التالية.
- **after: تم الحفظ. يسري هذا على عمل {name} من الرسالة التالية.**

### `autonomy.hint`

- en: Tired of approving replies like this? Choose how much {name} does alone.
- before: تعبتِ من الموافقة على كل ردّ؟ اختاري كم تفعل {name} بمفردها.
- **after: هل الموافقة على كل ردّ متعبة؟ يمكن اختيار مدى استقلالية {name}.**

### `employee.flash.promoted`

- en: Granted — this is handled without you now; revoke anytime.
- before: تم المنح — تتولاها بنفسها الآن؛ يمكنك السحب في أي وقت.
- **after: تم المنح — يُنجز هذا الآن دون انتظارك؛ ويمكنك السحب في أي وقت.**

### `employee.flash.revoked`

- en: Revoked — this waits for your OK from now on.
- before: تم السحب — ستنتظر موافقتك من الآن.
- **after: تم السحب — هذا ينتظر موافقتك من الآن.**

### `inbox.filter.pending`

- en: Needs you
- before: تحتاج إليك
- **after: بحاجة إليك**

### `inbox.empty.setup`

- en: Set up your business so buyers can reach you
- before: جهّز شركتك ليصل إليك المشترون
- **after: تجهيز شركتك ليصل إليك المشترون**

### `inbox.empty.noneBody`

- en: Messages from buyers show up here. Share your WhatsApp number with buyers first.
- before: تظهر رسائل المشترين هنا. شارك رقم واتساب مع المشترين أولًا.
- **after: تظهر رسائل المشترين هنا. الخطوة الأولى: مشاركة رقم واتساب مع المشترين.**

### `conv.search.placeholder`

- en: Find a buyer or product…
- before: ابحث عن مشترٍ أو منتج…
- **after: البحث عن مشترٍ أو منتج…**

### `conv.empty.noneBody`

- en: Buyers appear here after they message you on WhatsApp, so you remember every one.
- before: يظهر المشترون هنا بعد مراسلتك على واتساب لتتذكر كل عميل.
- **after: يظهر المشترون هنا بعد أول رسالة على واتساب، فلا يُنسى أي عميل.**

### `conv.empty.noMatchBody`

- en: Try another name or product.
- before: جرّب اسمًا أو منتجًا آخر.
- **after: يمكن تجربة اسم أو منتج آخر.**

### `conv.by.you`

- en: You
- before: أنتِ
- **after: أنت**

### `conv.file.products`

- en: Products of interest
- before: منتجات مهتم بها
- **after: المنتجات محلّ الاهتمام**

### `conv.file.nameHint`

- en: The name their channel showed, or what you call them. Empty shows them as "{buyer}".
- before: الاسم كما أظهرته قناته، أو ما تناديه به. فارغًا يظهر كـ«{buyer}».
- **after: الاسم كما ظهر في القناة، أو أي اسم آخر مفضّل. إن تُرك فارغًا، يظهر «{buyer}».**

### `conv.flash.nameCleared`

- en: Name cleared — they show as "{buyer}" again.
- before: مُسح الاسم — يظهر كـ«{buyer}» من جديد.
- **after: مُسح الاسم — عاد العرض باسم «{buyer}».**

### `conv.tl.reply`

- en: {name} replied: {text}
- before: ردّت {name}: {text}
- **after: ردّ {name}: {text}**

### `conv.tl.quote`

- en: {name} quoted: {detail}
- before: عرض {name}: {detail}
- **after: عرض سعر من {name}: {detail}**

### `conv.tl.owner_approved`

- en: You approved sending
- before: أكّدت الإرسال
- **after: موافقتك على الإرسال**

### `conv.tl.owner_edited`

- en: You edited, then sent
- before: عدّلت ثم أرسلت
- **after: تعديل منك ثم إرسال**

### `conv.tl.owner_skipped`

- en: You chose not to reply
- before: اخترت عدم الرد
- **after: قرارك: عدم الرد**

### `conv.ctx.corrections`

- en: You corrected
- before: صحّحت
- **after: تصحيحاتك**

### `conv.needCardCta`

- en: Handle it
- before: عالجها
- **after: معالجة**

### `notify.hot_lead`

- en: Big-buyer signal — {name} is following up. Details in tonight's summary.
- before: إشارة مشترٍ كبير — {name} تتابع الأمر. التفاصيل في ملخص الليلة.
- **after: إشارة مشترٍ كبير — والمتابعة في عهدة {name}. التفاصيل في ملخص الليلة.**

### `notify.handoff`

- en: {name} paused — a buyer wants to talk to a person. The conversation is waiting for you.
- before: أوقفت {name} الرد — يريد مشترٍ التحدث مع شخص. الأمر بانتظارك.
- **after: توقّف ردّ {name} — مشترٍ يطلب التحدث مع شخص. الأمر بانتظارك.**

### `settings.alerts.desc`

- en: Where {name} messages you — a big buyer or a handoff. Your own WhatsApp.
- before: حيث تراسلك {name} — مشترٍ كبير أو تحويل. رقم واتساب الخاص بك.
- **after: الرقم الذي تصلك عليه رسائل {name} — عن مشترٍ كبير أو تحويل. رقم واتساب الخاص بك.**

### `settings.flash.invalid`

- en: That number looks off — use international format (+country code…).
- before: الرقم غير صحيح — استخدم الصيغة الدولية (+رمز الدولة…).
- **after: الرقم غير صحيح — يُرجى استخدام الصيغة الدولية (+رمز الدولة…).**

### `settings.categories.empty`

- en: Add products and their categories appear here.
- before: أضف منتجات لتظهر فئاتها هنا.
- **after: تظهر هنا فئات المنتجات بعد إضافتها.**

### `settings.err.tooLong`

- en: Too long — keep it under {n} characters.
- before: طويل جداً — أبقه تحت {n} حرفاً.
- **after: طويل جدًا — الحد الأقصى {n} حرفًا.**

### `settings.err.emailShape`

- en: That does not look like an e-mail address — check for a missing @.
- before: لا يبدو هذا بريداً إلكترونياً — تأكد من وجود @.
- **after: لا يبدو هذا بريدًا إلكترونيًا — يُرجى التأكد من وجود @.**

### `settings.err.phoneShape`

- en: Start with + and the country code, like +8657985001234.
- before: ابدأ بـ + ورمز الدولة، مثل ‎+8657985001234.
- **after: يلزم البدء بـ + ورمز الدولة، مثل ‎+8657985001234.**

### `settings.flash.profileFix`

- en: Nothing was lost — fix the marked field and save again.
- before: لم يضِع شيء — صحّح الحقل المعلَّم واحفظ مرة أخرى.
- **after: لم يضِع شيء — يُرجى تصحيح الحقل المعلَّم والحفظ مرة أخرى.**

### `inbox.draft.held.quantity_heard_not_typed`

- en: {name} heard this quantity in a voice note, so the price waits for you to check it.
- before: سمعت {name} هذه الكمية في رسالة صوتية، لذا ينتظر السعر أن تتحقق منه.
- **after: وصلت هذه الكمية إلى {name} في رسالة صوتية، لذا ينتظر السعر تحقّقك منه.**

### `inbox.draft.held.discount_needs_owner`

- en: This discount is past the line where you asked to be asked first.
- before: هذا الخصم تجاوز الحدّ الذي طلبت أن تُسأل عنده أولًا.
- **after: هذا الخصم تجاوز الحدّ الذي يلزم عنده سؤالك أولًا.**

### `inbox.draft.held.contradicts_history`

- en: This price is higher than the one this buyer already has. If you send it, it becomes the price {name} quotes from now on.
- before: هذا السعر أعلى من السعر الذي لدى هذا المشتري. إن أرسلته، يصبح السعر الذي تعرضه {name} من الآن.
- **after: هذا السعر أعلى من السعر الذي لدى هذا المشتري. عند إرساله، يصبح هذا السعر المعتمد في عروض {name} من الآن.**

### `inbox.draft.held.guards_failed_twice`

- en: {name} could not write this reply within your rules, twice. This is a plain stand-in for you to send, change or skip.
- before: لم تستطع {name} كتابة هذا الرد ضمن قواعدك مرتين. هذا رد بديل بسيط يمكنك إرساله أو تعديله أو تجاهله.
- **after: تعذّر على {name} كتابة هذا الرد ضمن قواعدك مرتين. هذا رد بديل بسيط يمكن إرساله أو تعديله أو تجاهله.**

### `inbox.draft.held.identity_denial`

- en: {name} tried to claim to be a person to this buyer. That was stopped and never sent. This is a plain stand-in for you to send, change or skip.
- before: حاولت {name} أن تقول لهذا المشتري إنها إنسان. أُوقف ذلك ولم يُرسَل. هذا رد بديل بسيط يمكنك إرساله أو تعديله أو تجاهله.
- **after: كان في ردّ {name} على هذا المشتري ادّعاءٌ بأنّ المحادثة مع إنسان. أُوقف ذلك ولم يُرسَل. هذا رد بديل بسيط يمكن إرساله أو تعديله أو تجاهله.**

### `inbox.draft.held.disclosure_sent`

- en: They have already been told: {name} sent them the line saying they are not talking to a person, and offered them someone from your team. So this reply cannot be sent as it stands — change it first, or skip it.
- before: وصلت الإجابة بالفعل: أرسلت {name} إلى المشتري الجملة التي تقول ما هي، مع عرض التحدث مع شخص من فريقكِ. لذلك لا يمكن إرسال هذا الرد كما هو — غيّريه أولًا، أو تجاهليه.
- **after: وصلت الإجابة بالفعل: أُرسلت إلى المشتري الجملة التي توضّح طبيعة {name}، مع عرض التحدث مع شخص من فريقك. لذلك لا يمكن إرسال هذا الرد بصيغته الحالية — يلزم تعديله أولًا، أو تجاهله.**

### `inbox.draft.held.words`

- en: Stopped by: {terms}
- before: أوقفها: {terms}
- **after: أُوقف بسبب: {terms}**

### `herwords.title`

- en: Your own words had a word you forbade
- before: في كلماتك أنت كلمة منعتها
- **after: في كلماتك أنت كلمة من قائمة الممنوعات**

### `herwords.taught_answer`

- en: Your saved answer contains {terms}, which you told {name} never to say, so it was not sent.
- before: إجابتك المحفوظة تحتوي على {terms}، وقد طلبت من {name} ألّا تقولها أبدًا، لذلك لم ترسلها.
- **after: إجابتك المحفوظة تحتوي على {terms} من الكلمات الممنوعة على {name}، لذلك لم تُرسَل.**

### `herwords.order_status`

- en: The order update contains {terms}, which you told {name} never to say, so it was not sent.
- before: تحديث الطلب يحتوي على {terms}، وقد طلبت من {name} ألّا تقولها أبدًا، لذلك لم ترسله.
- **after: تحديث الطلب يحتوي على {terms} من الكلمات الممنوعة على {name}، لذلك لم يُرسَل.**

### `herwords.action.taught_answer`

- en: Fix the saved answer
- before: أصلح الإجابة المحفوظة
- **after: إصلاح الإجابة المحفوظة**

### `herwords.action.order_status`

- en: Check your list
- before: راجع قائمتك
- **after: مراجعة قائمتك**

### `inbox.action.revoke`

- en: Stop doing this alone
- before: لا تفعلها بنفسها
- **after: إيقاف التصرّف دون انتظارك**

### `inbox.action.revoke.confirm`

- en: Stop {name} doing “{cap}” alone? Every future one will wait for you, not just this reply.
- before: أتمنع {name} من «{cap}» بنفسها؟ لن يقتصر ذلك على هذا الرد — كل رد لاحق سينتظرك.
- **after: منع {name} من «{cap}» دون انتظارك؟ لن يقتصر ذلك على هذا الرد — كل رد لاحق سينتظرك.**

### `inbox.action.revoke.note`

- en: Skip drops this one reply. The red button changes what {name} may do alone from now on.
- before: «تجاهل» يترك هذا الرد فقط. الزر الأحمر يغيّر ما يجوز لها فعله بنفسها من الآن.
- **after: «تجاهل» يترك هذا الرد فقط. الزر الأحمر يغيّر ما يجوز لـ {name} فعله دون انتظارك من الآن.**

### `inbox.action.editLabel`

- en: Edit before sending (write what you want to say)
- before: عدّل قبل الإرسال (اكتب ما تريد قوله)
- **after: التعديل قبل الإرسال (النص كما يجب أن يصل)**

### `inbox.action.editPlaceholder`

- en: Rewrite as you like…
- before: أعد الصياغة كما تريد…
- **after: إعادة الصياغة بحرية…**

### `inbox.blocked.not_activated`

- en: Not sent — messaging is switched off. Start {name} in My business and send it again.
- before: لم يُرسَل — المراسلة مُطفأة. شغّل {name} من «شركتي» ثم أعد الإرسال.
- **after: لم يُرسَل — المراسلة مُطفأة. يلزم تشغيل {name} من «شركتي» ثم إعادة الإرسال.**

### `inbox.blocked.not_allowlisted`

- en: Not sent — this buyer is not on your list yet. Add their number in My business first.
- before: لم يُرسَل — هذا المشتري ليس في قائمتك بعد. أضف رقمه من «شركتي» أولاً.
- **after: لم يُرسَل — هذا المشتري ليس في قائمتك بعد. يلزم إضافة الرقم من «شركتي» أولًا.**

### `inbox.blocked.window_closed`

- en: Not sent — you can’t message this buyer right now. As soon as they reply, you can continue.
- before: لم يُرسَل — لا يمكن مراسلة هذا المشتري الآن. حين يردّ يمكنك المتابعة.
- **after: لم يُرسَل — لا يمكن مراسلة هذا المشتري الآن. فور وصول ردّ من المشتري تصبح المتابعة ممكنة.**

### `inbox.flash.unknown`

- en: Didn't catch that — use Send, Edit, or Skip.
- before: لم أفهم — استخدم إرسال أو تعديل أو تجاهل.
- **after: لم أفهم — يُرجى استخدام «إرسال» أو «تعديل» أو «تجاهل».**

### `product.detail.imageMatchBig`

- en: Recognizable by photo — {name} identifies this when buyers send a picture
- before: يُميَّز بالصورة — تتعرّف {name} عليه عند إرسال المشتري صورة
- **after: يُميَّز بالصورة — بإمكان {name} التعرّف عليه عند إرسال المشتري صورة**

### `product.add.intro`

- en: Paste your price list — one product per line, messy is fine.
- before: الصق قائمة أسعارك — منتج في كل سطر، لا بأس بالفوضى.
- **after: يُرجى لصق قائمة أسعارك — منتج في كل سطر، لا بأس بالفوضى.**

### `product.add.placeholder`

- en: Paste products and prices here…
- before: الصق المنتجات والأسعار هنا…
- **after: لصق المنتجات والأسعار هنا…**

### `product.add.submit`

- en: See what {name} recognizes
- before: شاهد ما تعرّفت عليه
- **after: إلقاء نظرة على ما تم التعرّف عليه**

### `product.add.photoTitle`

- en: Or photograph the page
- before: أو صوّر الصفحة
- **after: أو تصوير الصفحة**

### `product.add.photoIntro`

- en: Point your camera at a printed price list. {name} reads the lines, and shows you each line beside the product read from it.
- before: وجّه الكاميرا إلى قائمة أسعار مطبوعة. تقرأ {name} السطور، وتضع كل سطر بجانب المنتج الذي قرأته منه.
- **after: يُرجى توجيه الكاميرا إلى قائمة أسعار مطبوعة. وبعد قراءة {name} للسطور، يظهر كل سطر بجانب المنتج المستخرَج منه.**

### `product.add.photoButton`

- en: Take a photo
- before: التقط صورة
- **after: التقاط صورة**

### `product.review.fromLine`

- en: Read from:
- before: قرأته من هذا السطر:
- **after: من هذا السطر:**

### `product.photo.refusedTitle`

- en: {name} could not read this page
- before: لم تستطع قراءة هذه الصفحة
- **after: تعذّرت قراءة هذه الصفحة**

### `product.photo.refused.unreadable`

- en: Nothing on the page came out clearly enough to read, so nothing was added. Try again in better light, with the page flat.
- before: لم يظهر شيء في الصفحة بوضوح كافٍ للقراءة، فلم يُضف شيء. جرّب في إضاءة أفضل والورقة مسطّحة.
- **after: لم يظهر شيء في الصفحة بوضوح كافٍ للقراءة، فلم يُضف شيء. يُرجى المحاولة مجددًا في إضاءة أفضل والورقة مسطّحة.**

### `product.photo.refused.no_lines`

- en: The page was read, but no line on it looks like a product with a price. If this is a price list, paste the text instead.
- before: قرأت الصفحة، لكن لا سطر فيها يبدو منتجًا بسعر. إن كانت قائمة أسعار، فالصق نصها.
- **after: قُرئت الصفحة، لكن لا سطر فيها يبدو منتجًا بسعر. إن كانت قائمة أسعار، فيُرجى لصق نصها.**

### `product.photo.refused.not_configured`

- en: Reading photos is not switched on here. Paste your price list as text instead — that works now.
- before: قراءة الصور غير مفعّلة هنا. الصق قائمة أسعارك نصًا — هذا الطريق يعمل الآن.
- **after: قراءة الصور غير مفعّلة هنا. يمكن لصق قائمة الأسعار نصًا — هذا الطريق يعمل الآن.**

### `product.photo.refused.too_large`

- en: That photo is too large to read. Take it again at a smaller size, or paste the text instead.
- before: هذه الصورة أكبر من أن تُقرأ. التقطها بحجم أصغر، أو الصق النص.
- **after: هذه الصورة أكبر من أن تُقرأ. يمكن التقاطها بحجم أصغر، أو لصق النص.**

### `product.photo.refused.not_a_photo`

- en: That file is not a photo. Take a photo of the page, or paste the text instead.
- before: هذا الملف ليس صورة. التقط صورة للصفحة، أو الصق النص.
- **after: هذا الملف ليس صورة. يمكن التقاط صورة للصفحة، أو لصق النص.**

### `product.photo.refused.upload_failed`

- en: The photo did not arrive in one piece, so nothing was added. Send it again.
- before: لم تصل الصورة كاملة، فلم يُضف شيء. أرسلها مرة أخرى.
- **after: لم تصل الصورة كاملة، فلم يُضف شيء. يُرجى إرسالها مرة أخرى.**

### `product.photo.retake`

- en: Take another photo
- before: التقط صورة أخرى
- **after: التقاط صورة أخرى**

### `product.photo.pasteInstead`

- en: Paste the text instead
- before: الصق النص بدلًا من ذلك
- **after: لصق النص بدلًا من ذلك**

### `product.review.recognized`

- en: Recognized {count} products
- before: تعرّفت على {count} منتجًا
- **after: تم التعرّف على {count} منتجًا**

### `product.review.tryAgain`

- en: try a different format
- before: جرّب صيغة أخرى
- **after: يمكن تجربة صيغة أخرى**

### `product.review.repaste`

- en: Paste again
- before: الصق من جديد
- **after: لصق من جديد**

### `product.review.changedHint`

- en: Each ticked one changes when you confirm. Untick any the page does not really say.
- before: كل ما عليه علامة يتغيّر عند التأكيد. أزل العلامة عمّا لا تقوله الصفحة فعلًا.
- **after: كل ما عليه علامة يتغيّر عند التأكيد. يُرجى إزالة العلامة عمّا لا تقوله الصفحة فعلًا.**

### `product.review.held.matches_several`

- en: More than one of your products answers to this line, so none was picked. Change the right one on its own page.
- before: أكثر من منتج لديك يطابق هذا السطر، فلم يُختر أيٌّ منها. غيّر المنتج الصحيح من صفحته.
- **after: أكثر من منتج لديك يطابق هذا السطر، فلم يُختر أيٌّ منها. يمكن تغيير المنتج الصحيح من صفحته.**

### `product.review.held.other_currency`

- en: The page prices this in a different currency from your catalogue. Change it on the product’s own page.
- before: الصفحة تسعّر هذا بعملة غير عملة قائمتك. غيّره من صفحة المنتج.
- **after: الصفحة تسعّر هذا بعملة غير عملة قائمتك. يمكن تغييره من صفحة المنتج.**

### `product.review.held.below_floor`

- en: The page’s price is below the least you said you would accept for this product, so it is not changed.
- before: سعر الصفحة أقل من أدنى سعر قلت إنك تقبله لهذا المنتج، فلن يتغيّر.
- **after: سعر الصفحة أقل من أدنى سعر مقبول لديك لهذا المنتج، فلن يتغيّر.**

### `product.review.openProduct`

- en: Open the product
- before: افتح المنتج
- **after: فتح المنتج**

### `product.review.nothingToChange`

- en: Everything on this page is already in your catalogue as it says.
- before: كل ما في هذه الصفحة موجود في قائمتك كما هو.
- **after: كل ما في هذه الصفحة مطابق لما في قائمتك.**

### `rate.title`

- en: The exchange rate you will honour
- before: سعر الصرف الذي تعتمدينه
- **after: سعر الصرف المعتمد لديك**

### `rate.intro`

- en: Buyers pay in dollars. When you want to see what that is in ￥, {name} uses the rate you set here — never a rate from anywhere else.
- before: المشترون يدفعون بالدولار. حين تريدين رؤية المبلغ باليوان، تستخدم {name} السعر الذي تحدّدينه هنا — لا سعرًا من أي مكان آخر.
- **after: المشترون يدفعون بالدولار. ولرؤية المبلغ باليوان، يعتمد حساب {name} على السعر المحدَّد هنا وحده — لا على سعر من أي مكان آخر.**

### `rate.setOn`

- en: You set this on {date}
- before: حدّدتِه في {date}
- **after: حُدِّد في {date}**

### `rate.empty`

- en: You have not set a rate yet, so nothing is shown in ￥.
- before: لم تحدّدي سعرًا بعد، فلا يظهر شيء باليوان.
- **after: لم يُحدَّد سعر بعد، فلا يظهر شيء باليوان.**

### `rate.add.button`

- en: Set this rate
- before: اعتمدي هذا السعر
- **after: اعتماد هذا السعر**

### `rate.history.title`

- en: What you set before
- before: ما حدّدتِه سابقًا
- **after: الأسعار السابقة**

### `rate.at`

- en: at the rate you set on {date}
- before: بالسعر الذي حدّدتِه في {date}
- **after: بالسعر المحدَّد في {date}**

### `rate.flash.set`

- en: Saved. {name} will use $1 = ￥{rate} until you change it.
- before: حُفظ. ستستخدم {name} ‏$1 = ￥{rate} حتى تغيّريه.
- **after: حُفظ. السعر المعتمد لدى {name}: ‏$1 = ￥{rate}، حتى تغييره.**

### `rate.flash.missing`

- en: Type the rate first.
- before: اكتبي السعر أولًا.
- **after: يُرجى كتابة السعر أولًا.**

### `rate.flash.failed`

- en: That did not save. Try once more.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `closures.intro`

- en: Tell {name} the days you are shut. No buyer is promised a delivery date that runs through them — {name} says the dates cannot be promised, and never invents a later one.
- before: أخبري {name} بأيام الإغلاق. لن تَعِد مشتريًا بموعد تسليم يمرّ خلالها — تقول إن الموعد لا يمكن ضمانه، ولا تخترع موعدًا لاحقًا أبدًا.
- **after: أيام الإغلاق المسجّلة هنا تصل إلى {name}. لا وعد لمشترٍ بموعد تسليم يمرّ خلالها — بل توضيح أن الموعد لا يمكن ضمانه، ولا اختلاق لموعد لاحق أبدًا.**

### `closures.empty`

- en: You have not told {name} about any closure, so your usual lead time is quoted all year.
- before: لم تُخبري {name} بأي إغلاق، فهي تعطي مدّتك المعتادة طوال السنة.
- **after: لم يُسجَّل أي إغلاق لدى {name}، فالعرض بمدّتك المعتادة طوال السنة.**

### `closures.add.shown`

- en: Buyers see this name, with the dates, when told why a date cannot be promised.
- before: يرى المشترون هذا الاسم مع التواريخ حين تشرح لماذا لا تستطيع تحديد موعد.
- **after: يرى المشترون هذا الاسم مع التواريخ عند توضيح سبب تعذّر تحديد موعد.**

### `closures.add.button`

- en: Add these days
- before: أضيفي هذه الأيام
- **after: إضافة هذه الأيام**

### `closures.blocked.action`

- en: Check your closure dates
- before: راجعي تواريخ الإغلاق
- **after: مراجعة تواريخ الإغلاق**

### `closures.flash.added`

- en: Added. {name} will not promise a date that runs through {label}.
- before: أُضيف. لن تَعِد {name} بموعد يمرّ خلال {label}.
- **after: أُضيف. لا وعد من {name} بموعد يمرّ خلال {label}.**

### `closures.flash.label_missing`

- en: Give it a name first.
- before: سمِّيه أولًا.
- **after: يُرجى تسميته أولًا.**

### `closures.flash.from_missing`

- en: Add the first day you are closed.
- before: أضيفي أول يوم إغلاق.
- **after: يُرجى إضافة أول يوم إغلاق.**

### `closures.flash.to_missing`

- en: Add the last day you are closed.
- before: أضيفي آخر يوم إغلاق.
- **after: يُرجى إضافة آخر يوم إغلاق.**

### `closures.flash.not_a_date`

- en: Those dates did not come through. Try again.
- before: لم تصل التواريخ. حاولي مجددًا.
- **after: لم تصل التواريخ. يُرجى المحاولة مجددًا.**

### `closures.flash.failed`

- en: That did not save. Try once more.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `samples.intro`

- en: Nearly every buyer asks for one. Tell {name} what a sample costs and whether it comes off the first order, and {name} can answer. Until you do, nothing is said about samples.
- before: يسأل عنها كل مشترٍ تقريبًا. أخبري {name} كم تكلّف العيّنة وهل تُخصم من الطلب الأول، فتستطيع الإجابة. قبل ذلك لا تقول شيئًا عن العيّنات.
- **after: يسأل عنها كل مشترٍ تقريبًا. بعد تحديد سعر العيّنة وهل تُخصم من الطلب الأول، يصبح بإمكان {name} الإجابة. وقبل ذلك لا كلام عن العيّنات.**

### `samples.setOn`

- en: You set this on {date}
- before: حدّدتِه في {date}
- **after: حُدِّد في {date}**

### `samples.empty`

- en: You have not told {name} anything about samples, so that question goes unanswered.
- before: لم تُخبري {name} شيئًا عن العيّنات، فلن تجيب على هذا السؤال.
- **after: لا معلومات لدى {name} عن العيّنات، فلا إجابة عن هذا السؤال.**

### `samples.flash.saved`

- en: Saved. {name} can answer sample questions now.
- before: حُفظ. تستطيع {name} الآن الإجابة عن أسئلة العيّنات.
- **after: حُفظ. بإمكان {name} الآن الإجابة عن أسئلة العيّنات.**

### `samples.flash.price_missing`

- en: Type what a sample costs. Zero means free.
- before: اكتبي كم تكلّف العيّنة. صفر يعني مجانًا.
- **after: يُرجى كتابة سعر العيّنة. صفر يعني مجانًا.**

### `samples.flash.failed`

- en: That did not save. Try once more.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `samples.requests.asked`

- en: Asked {when}
- before: سأل {when}
- **after: طُلبت {when}**

### `samples.requests.address.placeholder`

- en: Paste the address the buyer gave you
- before: الصقي العنوان الذي أعطاكِ إياه المشتري
- **after: لصق العنوان الذي قدّمه المشتري**

### `samples.requests.address.save`

- en: Save the address
- before: احفظي العنوان
- **after: حفظ العنوان**

### `samples.requests.open`

- en: Open the conversation
- before: افتحي المحادثة
- **after: فتح المحادثة**

### `samples.asked.unstated`

- en: You have not told {name} what a sample costs, so the question was not answered.
- before: لم تُخبري {name} كم تكلّف العيّنة، فلم تُجب.
- **after: لا سعر للعيّنة لدى {name}، فلم تُرسَل إجابة.**

### `samples.asked.action`

- en: Tell {name} about samples
- before: أخبريها عن العيّنات
- **after: إضافة معلومات العيّنات**

### `order.update.intro`

- en: You set this. {name} tells a buyer what you recorded and the day you recorded it — never a delivery date worked out from it.
- before: أنتِ من تحدّدين هذا. تخبر {name} المشتري بما سجّلتِه وباليوم الذي سجّلتِه فيه — ولا تستنتج منه موعد تسليم أبدًا.
- **after: التحديد لك. يصل إلى المشتري عبر {name} ما سُجّل وتاريخ تسجيله — ولا يُستنتج منه موعد تسليم أبدًا.**

### `order.update.tracking.placeholder`

- en: Paste it from the courier
- before: الصقيه من شركة الشحن
- **after: يُلصق من شركة الشحن**

### `order.update.note.placeholder`

- en: Not sent to the buyer
- before: لا تُرسل إلى المشتري
- **after: غير مرئية للمشتري**

### `order.update.save`

- en: Record this
- before: سجّلي هذا
- **after: تسجيل هذا**

### `order.history.title`

- en: What you recorded
- before: ما سجّلتِه
- **after: ما سُجِّل**

### `order.invoice.intro`

- en: Every figure here is copied from the order. Copy it into your own paperwork.
- before: كل رقم هنا منقول من الطلب. انسخيه إلى أوراقك.
- **after: كل رقم هنا منقول من الطلب. يمكن نسخه إلى أوراقك.**

### `order.invoice.noTerms`

- en: No proforma yet. You have not stated your payment terms and delivery term, and none are made up for you.
- before: لا توجد فاتورة مبدئية بعد. لم تحدّدي شروط الدفع وشرط التسليم، ولن يُختلق شيء نيابةً عنكِ.
- **after: لا توجد فاتورة مبدئية بعد. لم تُحدَّد شروط الدفع وشرط التسليم، ولن يُختلق شيء نيابةً عنك.**

### `order.invoice.sampleMismatch`

- en: This buyer paid {amount} for a sample, which you said comes off the first order. It is in another currency, so it is not deducted here — take it off yourself.
- before: دفع هذا المشتري {amount} مقابل عيّنة، وقلتِ إنها تُخصم من أول طلب. العملة مختلفة، فلم تُخصم هنا — اخصميها بنفسكِ.
- **after: دفع هذا المشتري {amount} مقابل عيّنة، والمسجَّل أنها تُخصم من أول طلب. العملة مختلفة، فلم تُخصم هنا — يلزم خصمها يدويًا.**

### `terms.title`

- en: Your terms on a proforma
- before: شروطكِ في الفاتورة المبدئية
- **after: شروطك في الفاتورة المبدئية**

### `terms.intro`

- en: What goes on a proforma when a buyer confirms. {name} never makes these up: until you state them, no proforma is shown.
- before: ما يُكتب في الفاتورة المبدئية عندما يؤكد المشتري. لا تختلق {name} هذه الشروط أبدًا: حتى تحدّديها، لا تظهر فاتورة مبدئية.
- **after: ما يُكتب في الفاتورة المبدئية عندما يؤكد المشتري. لا تُختلق هذه الشروط في ردود {name} أبدًا: قبل تحديدها، لا تظهر فاتورة مبدئية.**

### `terms.none`

- en: Not stated yet. {name} shows no proforma until you do.
- before: لم تُحدَّد بعد. لن تُظهر {name} فاتورة مبدئية حتى تحدّديها.
- **after: لم تُحدَّد بعد. لا فاتورة مبدئية في ردود {name} قبل تحديدها.**

### `terms.setOn`

- en: You set these on {date}
- before: حدّدتِها في {date}
- **after: حُدِّدت في {date}**

### `terms.payment.label`

- en: Payment terms, in your words
- before: شروط الدفع، بكلماتكِ
- **after: شروط الدفع، بكلماتك**

### `terms.incoterm.hint`

- en: This goes on your proformas, and {name} may mention it to buyers.
- before: يُكتب في فواتيركِ المبدئية، ويمكن لـ{name} ذكره للمشترين.
- **after: يُكتب في فواتيرك المبدئية، ويمكن لـ{name} ذكره للمشترين.**

### `terms.save`

- en: Save terms
- before: احفظي الشروط
- **after: حفظ الشروط**

### `terms.flash.payment_missing`

- en: Write your payment terms first.
- before: اكتبي شروط الدفع أولًا.
- **after: يُرجى كتابة شروط الدفع أولًا.**

### `terms.flash.payment_too_long`

- en: That is longer than a payment term. Keep it to one line.
- before: هذا أطول من شرط دفع. اجعليه سطرًا واحدًا.
- **after: هذا أطول من شرط دفع. يكفي سطر واحد.**

### `terms.flash.incoterm_invalid`

- en: Choose a delivery term from the list.
- before: اختاري شرط تسليم من القائمة.
- **after: يُرجى اختيار شرط تسليم من القائمة.**

### `order.flash.failed`

- en: That did not save. Try once more.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `order.open`

- en: Open the order
- before: افتحي الطلب
- **after: فتح الطلب**

### `people.intro`

- en: Everyone here can log in with their own code, reply to a buyer, take a conversation over and hand it back. You see who is holding what.
- before: لكل شخص هنا رمز دخول خاص به، يستطيع الرد على مشترٍ وتسلّم محادثة وإعادتها. وترين من يتولّى ماذا.
- **after: لكل شخص هنا رمز دخول خاص، مع إمكانية الرد على مشترٍ وتسلّم محادثة وإعادتها. ويظهر هنا من يتولّى ماذا.**

### `people.owner`

- en: You
- before: أنتِ
- **after: أنت**

### `people.remove.confirm`

- en: Remove {who}? They are signed out now and their code stops working.
- before: هل تريد إزالة {who}؟ سيتم تسجيل خروجه الآن ويتوقف رمز دخوله عن العمل.
- **after: إزالة {who}؟ يُسجَّل الخروج الآن ويتوقف رمز الدخول عن العمل.**

### `people.add.label`

- en: Their name
- before: اسمه
- **after: الاسم**

### `people.add.button`

- en: Add them
- before: أضيفيه
- **after: إضافة**

### `people.issued.title`

- en: Give this code to {name}
- before: أعطي هذا الرمز لـ {name}
- **after: هذا الرمز لـ {name}**

### `people.issued.once`

- en: This is the only time it is shown. If it is lost, remove them and add them again.
- before: يُعرض هذه المرة فقط. إن ضاع، أزيليه وأضيفيه من جديد.
- **after: يُعرض هذه المرة فقط. إن ضاع، تلزم الإزالة ثم الإضافة من جديد.**

### `people.ownerOnly.title`

- en: Only you can do these
- before: هذه لكِ وحدك
- **after: هذه لك وحدك**

### `people.ownerOnly.capability_grant`

- en: Decide what {name} may do without asking
- before: تحديد ما تفعله {name} دون سؤال
- **after: تحديد ما يجوز لـ {name} فعله دون سؤال**

### `people.ownerOnly.rest`

- en: Replying, taking over, recording an order, teaching {name} a fact — that is the job, and it is everyone’s.
- before: الرد، وتسلّم محادثة، وتسجيل طلب، وتعليمها معلومة — هذا هو العمل، وهو للجميع.
- **after: الرد، وتسلّم محادثة، وتسجيل طلب، وتعليم {name} معلومة — هذا صلب العمل، والجميع شركاء فيه.**

### `people.flash.added`

- en: {name} can log in now. Give them the code above.
- before: يستطيع {name} الدخول الآن. أعطيه الرمز أعلاه.
- **after: بإمكان {name} الدخول الآن. يُرجى تسليم الرمز أعلاه.**

### `people.flash.removed`

- en: Removed. The conversations they held still say it was them.
- before: أُزيل. والمحادثات التي تولّاها ما زالت تحمل اسمه.
- **after: أُزيل. ويبقى الاسم على المحادثات التي سبق تولّيها.**

### `people.flash.name_missing`

- en: Type their name first.
- before: اكتبي اسمه أولًا.
- **after: يُرجى كتابة الاسم أولًا.**

### `people.flash.failed`

- en: That did not save. Try once more.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `assistants.title`

- en: Who answers your buyers
- before: من يردّ على مشتريكِ
- **after: فريق الرد على مشتريك**

### `assistants.intro`

- en: Give each one a name, a job and the channels to answer on. Any channel nobody else was given goes to {who}. What you sell, what you taught and your price limits are shared by every one.
- before: امنحي كل واحد اسمًا ووظيفة والقنوات التي يردّ عليها. وكل قناة لم تُعطَ لأحد تذهب إلى {who}. ما تبيعينه وما علّمتِه وحدود أسعاركِ مشتركة بين الجميع.
- **after: يُرجى تحديد اسم ووظيفة وقنوات ردّ لكل مساعد. وكل قناة لم تُعطَ لأحد تذهب إلى {who}. المنتجات وما أُضيف إلى المعرفة وحدود أسعارك مشتركة بين الجميع.**

### `assistants.default`

- en: Answers everything else
- before: يردّ على كل ما تبقّى
- **after: الردّ على كل ما تبقّى**

### `assistants.answersOn`

- en: Answers on {channels}
- before: يردّ على: {channels}
- **after: الردّ على: {channels}**

### `assistants.noChannels`

- en: No channels yet. Answers nothing until you give one.
- before: لا قنوات بعد. لن يردّ حتى تعطيه قناة.
- **after: لا قنوات بعد، ولا ردود قبل تحديد قناة.**

### `assistants.add.summary`

- en: Add another one
- before: إضافة واحد آخر
- **after: إضافة مساعد آخر**

### `assistants.field.note`

- en: The tone to use (optional)
- before: كيف يتكلّم (اختياري)
- **after: أسلوب الكلام (اختياري)**

### `assistants.field.note.hint`

- en: A sentence or two, in your own words. It changes the tone only: prices, dates and facts still come from what you set.
- before: جملة أو جملتان بكلماتكِ. يغيّر النبرة فقط: الأسعار والمواعيد والحقائق تبقى كما حدّدتِها.
- **after: جملة أو جملتان بكلماتك. التأثير على النبرة فقط: الأسعار والمواعيد والحقائق تبقى كما حُدِّدت.**

### `assistants.channels.label`

- en: Answers on
- before: يردّ على
- **after: الردّ على**

### `assistants.archive.confirm`

- en: Remove {who}? Conversations {who} was answering go to whoever answers that channel now. Nothing is erased.
- before: إزالة {who}؟ المحادثات التي كان يردّ عليها تنتقل إلى من يردّ على تلك القناة الآن. لا يُمحى شيء.
- **after: إزالة {who}؟ تنتقل محادثات {who} بحسب توزيع القنوات الحالي. لا يُمحى شيء.**

### `assistants.flash.added`

- en: {who} is on the team.
- before: انضمّ {who} إلى الفريق.
- **after: {who} في الفريق الآن.**

### `assistants.flash.archived`

- en: Removed. Those conversations stay in your records.
- before: تمت الإزالة. محادثاته باقية في سجلاتكِ.
- **after: تمت الإزالة. المحادثات باقية في سجلاتك.**

### `assistants.flash.channel_taken`

- en: One of those channels already belongs to another one. A channel has one answerer.
- before: إحدى هذه القنوات تخصّ مساعدًا آخر. لكل قناة من يردّ عليها واحد فقط.
- **after: إحدى هذه القنوات تخصّ مساعدًا آخر. لكل قناة جهة ردّ واحدة فقط.**

### `assistants.flash.name_missing`

- en: Type a name first.
- before: اختاري له اسمًا.
- **after: يُرجى اختيار اسم.**

### `assistants.flash.is_default`

- en: Someone always has to answer, so the main one stays.
- before: لا بدّ أن يردّ أحد دائمًا، لذلك يبقى الرئيسي.
- **after: لا بدّ من وجود ردّ دائمًا، لذلك يبقى المساعد الرئيسي.**

### `conv.answeredBy`

- en: Answered by {who}
- before: يردّ عليها {who}
- **after: الردّ: {who}**

### `conv.assistant.flash.changed`

- en: {who} answers this buyer from now on.
- before: من الآن يردّ {who} على هذا المشتري.
- **after: من الآن الردّ على هذا المشتري في عهدة {who}.**

### `conv.assistant.flash.same`

- en: {who} already answers this buyer.
- before: {who} يردّ على هذا المشتري أصلًا.
- **after: الردّ على هذا المشتري في عهدة {who} أصلًا.**

### `staff.notAllowed`

- en: Only the owner can do that.
- before: هذا لصاحبة العمل وحدها.
- **after: هذا مقصور على مالك الحساب.**

### `staff.ownerDecides`

- en: The owner decides this.
- before: هذا قرار صاحبة العمل.
- **after: القرار هنا لمالك الحساب.**

### `people.held.owner`

- en: The owner
- before: صاحبة العمل
- **after: مالك الحساب**

### `people.holding`

- en: Held by {who}
- before: يتولّاها {who}
- **after: في عهدة {who}**

### `insight.monthChange.inquiries.up`

- en: More buyers wrote to you this month: {from} last month, {to} this month.
- before: كتب إليكِ مشترون أكثر هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **after: كتب إليك مشترون أكثر هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

### `insight.monthChange.inquiries.down`

- en: Fewer buyers wrote to you this month: {from} last month, {to} this month.
- before: كتب إليكِ مشترون أقل هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **after: كتب إليك مشترون أقل هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

### `insight.monthChange.quotes.up`

- en: {name} quoted more this month: {from} last month, {to} this month.
- before: سعّرت {name} أكثر هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **after: عروض أسعار أكثر من {name} هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

### `insight.monthChange.quotes.down`

- en: {name} quoted less this month: {from} last month, {to} this month.
- before: سعّرت {name} أقل هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **after: عروض أسعار أقل من {name} هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

### `insight.action.seeBuyers`

- en: See the buyers
- before: شاهدي المشترين
- **after: إلقاء نظرة على المشترين**

### `product.flash.addedNeedPrice`

- en: Added {added} products. They need a price before {name} can quote them.
- before: أُضيف {added} منتجًا. تحتاج سعرًا قبل أن تعرضها {name}.
- **after: أُضيف {added} منتجًا. يلزمها سعر قبل عرضها في ردود {name}.**

### `product.flash.addedNeedRules`

- en: Added {added} products, {withPrice} with a price. Tell {name} your price rules and quoting can start.
- before: أُضيف {added} منتجًا، منها {withPrice} بسعر. أخبر {name} بحدود أسعارك لتبدأ العرض.
- **after: أُضيف {added} منتجًا، منها {withPrice} بسعر. بعد تحديد حدود أسعارك يصبح بإمكان {name} عرضها.**

### `practice.scripted.intro`

- en: These run {name} against situations that have gone wrong for other businesses. Nothing here touches your buyers.
- before: تختبر {name} في مواقف أخطأت فيها شركات أخرى. لا شيء هنا يمسّ مشتريك.
- **after: هذه الفحوص تضع {name} في مواقف أخطأت فيها شركات أخرى. لا شيء هنا يمسّ مشتريك.**

### `practice.scripted.proves`

- en: What this proves: {name} will not quote below your floor, will not claim a certification you have not confirmed, will not invent a number you never taught, and hands over when a buyer asks for a person.
- before: ما تثبته: لن تسعّر {name} تحت أرضيتك، ولن تدّعي شهادة لم تؤكّدها، ولن تخترع رقماً لم تعلّمها إياه، وتحوّل إليك حين يطلب المشتري شخصاً.
- **after: ما يثبته ذلك: لا تسعير من {name} تحت حدّك الأدنى، ولا ادّعاء لشهادة غير مؤكَّدة، ولا اختلاق لرقم لم يُضف إلى معرفة {name}، والتحويل إليك حين يطلب المشتري شخصًا.**

### `practice.scripted.notproves`

- en: What it does not prove: how a reply to YOUR buyer is worded, or whether WhatsApp delivers it. For that, practise live below once your business is connected.
- before: ما لا تثبته: كيف تصيغ ردّاً لمشتريك أنت، ولا هل يوصله واتساب. لذلك تمرّن مباشرة بالأسفل بعد ربط حسابك.
- **after: ما لا يثبته: صياغة ردّ {name} لمشتريك أنت، ولا وصوله عبر واتساب. لذلك يمكن التدريب مباشرة بالأسفل بعد ربط حسابك.**

### `sandbox.intro`

- en: Play the buyer. Watch how {name} replies — and approve or change anything before it would ever go out.
- before: العب دور المشتري وشاهد كيف تردّ {name} — ويمكنك الموافقة أو التعديل قبل أن تُرسَل فعلياً.
- **after: هنا يمكن لعب دور المشتري ومتابعة ردود {name} — والموافقة أو التعديل قبل أن يُرسَل أي شيء فعليًا.**

### `sandbox.empty`

- en: No messages yet. Send one as the buyer to begin.
- before: لا توجد رسائل بعد. أرسل واحدة بصفتك المشتري للبدء.
- **after: لا توجد رسائل بعد. للبدء، يُرجى إرسال رسالة بصفتك المشتري.**

### `sandbox.composer.label`

- en: Send a message as the buyer
- before: أرسل رسالة بصفتك المشتري
- **after: إرسال رسالة بصفتك المشتري**

### `sandbox.composer.placeholder`

- en: Type what a buyer might say…
- before: اكتب ما قد يقوله المشتري…
- **after: ما قد يقوله المشتري…**

### `sandbox.composer.image`

- en: Treat as a photo
- before: اعتبرها صورة
- **after: اعتبارها صورة**

### `sandbox.scenario.label`

- en: Try a situation
- before: جرّب موقفاً
- **after: تجربة موقف**

### `sandbox.scenario.none`

- en: Choose a situation…
- before: اختر موقفاً…
- **after: اختيار موقف…**

### `sandbox.case.discount-above-ask-line-waits-for-owner`

- en: A discount big enough that you are asked first
- before: خصم كبير بما يكفي لتسألك أولًا
- **after: خصم كبير يستلزم سؤالك أولًا**

### `sandbox.case.unsupported-ce-fda-claim-is-blocked`

- en: A certification you never gave is blocked
- before: شهادة لم تمنحها يتم حجبها
- **after: شهادة غير معتمدة منك تُحجب**

### `sandbox.case.unsupported-refund-guarantee-is-blocked`

- en: A refund promise you never made is removed
- before: وعد باسترداد المال لم تقطعه يُحذف
- **after: وعد باسترداد المال لم يصدر عنك يُحذف**

### `sandbox.case.unsupported-ddp-incoterm-is-blocked`

- en: A delivery term you never approved is blocked
- before: شرط تسليم لم توافق عليه يُحجب
- **after: شرط تسليم غير معتمد منك يُحجب**

### `sandbox.case.allowed-incoterm-claim-passes`

- en: A delivery term you did approve goes out
- before: شرط تسليم وافقت عليه يُرسل
- **after: شرط تسليم معتمد منك يُرسَل**

### `sandbox.case.unknown-product-yields-no-quote`

- en: Buyer asks about something you don't make
- before: المشتري يسأل عن منتج لا تصنعه
- **after: المشتري يسأل عن منتج ليس من منتجاتك**

### `sandbox.case.low-confidence-match-asks-to-confirm`

- en: An unclear match asks the buyer to confirm
- before: تطابق غير واضح يسأل المشتري ليؤكد
- **after: تطابق غير واضح يستدعي تأكيد المشتري**

### `sandbox.case.auto-qualify-grant-sends`

- en: An approved question is answered without you
- before: سؤال سمحت به يُجاب دون تدخّلك
- **after: سؤال مسموح به يُجاب دون تدخّلك**

### `sandbox.case.knowledge-spec-answered-with-sourced-numbers`

- en: A specification you taught is answered exactly
- before: مواصفة علّمتها يتم الرد بها بدقة
- **after: مواصفة مضافة إلى المعرفة تُذكر بدقة**

### `sandbox.case.knowledge-untaught-number-is-blocked`

- en: A number you never taught is not stated
- before: رقم لم تعلّمه لا يُذكر
- **after: رقم غير مضاف إلى المعرفة لا يُذكر**

### `sandbox.case.knowledge-cert-in-answer-blocked-unless-authorised`

- en: A certification stays blocked until you allow it
- before: الشهادة تبقى محجوبة حتى تسمح بها
- **after: الشهادة تبقى محجوبة حتى السماح بها**

### `sandbox.case.knowledge-authorised-cert-answer-passes`

- en: Once you allow it, the taught answer goes out
- before: بعد سماحك، تُرسل الإجابة المعلَّمة كما هي
- **after: بعد سماحك، تُرسل الإجابة المعلَّمة دون تغيير**

### `sandbox.case.identity-denial-english-is-blocked`

- en: Claiming to be a person is blocked (English)
- before: ادّعاء أنها إنسان مرفوض (بالإنجليزية)
- **after: ادّعاء صفة الإنسان مرفوض (بالإنجليزية)**

### `sandbox.case.identity-denial-chinese-is-blocked`

- en: Claiming to be a person is blocked (Chinese)
- before: ادّعاء أنها إنسان مرفوض (بالصينية)
- **after: ادّعاء صفة الإنسان مرفوض (بالصينية)**

### `sandbox.case.identity-denial-arabic-is-blocked`

- en: Claiming to be a person is blocked (Arabic)
- before: ادّعاء أنها إنسان مرفوض (بالعربية)
- **after: ادّعاء صفة الإنسان مرفوض (بالعربية)**

### `sandbox.case.identity-denial-arabizi-is-blocked`

- en: Claiming to be a person is blocked (Arabic in Latin letters)
- before: ادّعاء أنها إنسان مرفوض (بالعربية بحروف لاتينية)
- **after: ادّعاء صفة الإنسان مرفوض (بالعربية بحروف لاتينية)**

### `sandbox.case.identity-honest-answer-and-handoff-passes`

- en: An honest answer, with a person offered
- before: تجيب بصدق وتعرض التحويل إلى شخص
- **after: إجابة صادقة مع عرض التحويل إلى شخص**

### `sandbox.case.identity-honest-answer-chinese-passes`

- en: An honest answer in Chinese
- before: تجيب بصدق بالصينية
- **after: إجابة صادقة بالصينية**

### `sandbox.reset`

- en: Start over
- before: ابدأ من جديد
- **after: البدء من جديد**

### `sandbox.trust.none`

- en: Send a message to see the trust check.
- before: أرسل رسالة لرؤية فحص الثقة.
- **after: يظهر فحص الثقة بعد إرسال رسالة.**

### `sandbox.inv.priceFloorRespected`

- en: Never priced below your floor
- before: لا تُسعّر أبداً دون الحد الأدنى
- **after: لا تسعير أبدًا دون الحد الأدنى**

### `sandbox.inv.allowedClaimPasses`

- en: Approved wording kept
- before: تحتفظ بالصياغة المعتمدة
- **after: الاحتفاظ بالصياغة المعتمدة**

### `sandbox.inv.escalatesToHuman`

- en: Handed the conversation to a person
- before: تُحوّل المحادثة إلى شخص حقيقي
- **after: تحويل المحادثة إلى شخص حقيقي**

### `sandbox.inv.noQuoteForUnknownProduct`

- en: No price for products you don't carry
- before: لا سعر لمنتجات لا تبيعها
- **after: لا سعر لمنتجات خارج قائمتك**

### `sandbox.inv.requiresProductConfirmation`

- en: Confirms the product before closing
- before: تؤكد المنتج قبل الإغلاق
- **after: تأكيد المنتج قبل الإغلاق**

### `sandbox.inv.imageRequiresConfirmation`

- en: Confirms a photo match before closing
- before: تؤكد مطابقة الصورة قبل الإغلاق
- **after: تأكيد مطابقة الصورة قبل الإغلاق**

### `sandbox.inv.respectsAutonomy`

- en: Followed your approval settings
- before: تتبع إعدادات موافقتك
- **after: اتّباع إعدادات موافقتك**

### `sandbox.inv.noSilentCapabilityEscalation`

- en: Never sent without permission
- before: لا تُرسل أبداً دون إذن
- **after: لا إرسال أبدًا دون إذن**

### `sandbox.inv.heldTurnNeverAutoSends`

- en: Waited for you when your rules said to
- before: انتظرتك حين طلبت قواعدك ذلك
- **after: انتظار موافقتك حين تطلب قواعدك ذلك**

### `nav.knowledge`

- en: What {name} knows
- before: ما تعرفه
- **after: معرفة {name}**

### `knowledge.title`

- en: What {name} knows
- before: ما تعرفه
- **after: معرفة {name}**

### `knowledge.intro`

- en: Teach the facts about your products and business. {name} answers buyers from what you teach — and never states a number or a certification you haven't given.
- before: علّم {name} حقائق منتجاتك وشركتك. تجيب المشترين مما تعلّمه هنا — ولا تذكر أبداً رقماً أو شهادة لم تمنحها إياها.
- **after: هنا تُضاف حقائق منتجاتك وشركتك إلى معرفة {name}. الإجابات للمشترين من هذه المعرفة فقط — ولا ذكر أبدًا لرقم أو شهادة لم تُضف.**

### `knowledge.empty`

- en: Nothing taught yet.
- before: لم تُعلّم شيئاً بعد.
- **after: لم يُضف شيء بعد.**

### `knowledge.teach`

- en: Teach something new
- before: علّم شيئاً جديداً
- **after: تعليم {name} شيئًا جديدًا**

### `knowledge.teach.content`

- en: The fact or answer
- before: ما يجب أن تعرفه
- **after: المعلومة أو الإجابة**

### `knowledge.teach.add`

- en: Teach
- before: علّم
- **after: تعليم**

### `knowledge.correct`

- en: Correct this…
- before: صحّح هذا…
- **after: تصحيح هذا…**

### `knowledge.cert.scope`

- en: These apply to everything you sell — all {n} of your products, not only this one.
- before: تنطبق هذه على كل ما تبيعه — منتجاتك الـ{n} كلها، لا هذا المنتج وحده.
- **after: تنطبق هذه على كل ما في قائمتك — منتجاتك الـ{n} كلها، لا هذا المنتج وحده.**

### `knowledge.cert.confirmOn`

- en: Turn on {key} for all {n} of your products? {name} will be able to state it to any buyer.
- before: تشغيل {key} لمنتجاتك الـ{n} كلها؟ ستتمكّن من ذكره لأي مشترٍ.
- **after: تشغيل {key} لمنتجاتك الـ{n} كلها؟ بعدها يصبح بإمكان {name} ذكره لأي مشترٍ.**

### `knowledge.cert.confirmOff`

- en: Turn off {key} for all {n} of your products? {name} will stop confirming it to anyone.
- before: إيقاف {key} لمنتجاتك الـ{n} كلها؟ ستتوقّف عن تأكيده لأي أحد.
- **after: إيقاف {key} لمنتجاتك الـ{n} كلها؟ بعدها لا يمكن لـ {name} تأكيده لأي أحد.**

### `knowledge.taught.title`

- en: What {name} knows about this product
- before: ما تعرفه عن هذا المنتج
- **after: معرفة {name} عن هذا المنتج**

### `knowledge.source.owner_confirmed`

- en: You confirmed
- before: أكّدتَه
- **after: بتأكيد منك**

### `knowledge.source.owner_corrected`

- en: You corrected
- before: صحّحتَه
- **after: بتصحيح منك**

### `knowledge.ops.noGaps`

- en: Nothing waiting — every question was answered from what you taught.
- before: لا شيء بانتظارك — كل سؤال أُجيب مما علّمته.
- **after: لا شيء بانتظارك — كل سؤال أُجيب عنه مما أُضيف إلى معرفة {name}.**

### `knowledge.gap.reason.claim_requires_authorization`

- en: Needs a certification you haven't turned on
- before: يحتاج شهادة لم تُفعّلها
- **after: يحتاج شهادة غير مفعّلة**

### `knowledge.gap.reason.product_known_no_knowledge`

- en: Nothing taught for this product yet
- before: لم تُعلّم شيئاً عن هذا المنتج بعد
- **after: لم يُضف شيء عن هذا المنتج بعد**

### `knowledge.gap.teach`

- en: Teach the answer
- before: علّمها الإجابة
- **after: تعليم {name} الإجابة**

### `knowledge.gap.test`

- en: Test in sandbox
- before: جرّب في بيئة التجربة
- **after: الاختبار في بيئة التجربة**

### `pilot.intro`

- en: Everything {name} needs before going live. Most is checked from your real data; the last few you confirm yourself.
- before: كل ما تحتاجه {name} قبل الانطلاق. معظمه يُفحص من بياناتك الحقيقية، والباقي تؤكّده بنفسك.
- **after: كل ما يلزم {name} قبل الانطلاق. معظمه يُفحص من بياناتك الحقيقية، والباقي بتأكيد منك.**

### `pilot.confirmedByOwner`

- en: Confirmed by you
- before: أكّدتَه بنفسك
- **after: بتأكيد منك**

### `prices.lede`

- en: These are the only numbers {name} will ever negotiate inside — never below what you set here, whatever a buyer says.
- before: هذه هي الأرقام الوحيدة التي تتفاوض {name} داخلها. لن تنزل تحت ما تحدّده هنا مهما قال المشتري.
- **after: هذه وحدها الأرقام المتاحة لتفاوض {name}. لا نزول تحت ما يُحدَّد هنا مهما قال المشتري.**

### `prices.q.floor`

- en: What is the least you would ever accept for one of these? (US$)
- before: ما أقل سعر تقبله للقطعة الواحدة؟ (دولار)
- **after: ما أقل سعر مقبول للقطعة الواحدة؟ (دولار)**

### `prices.q.maxDiscount`

- en: What is the most that may ever come off, even with your OK? (%)
- before: ما أقصى خصم يمكنها منحه، حتى بموافقتك؟ (%)
- **after: ما أقصى خصم مسموح لـ {name}، حتى بموافقتك؟ (%)**

### `prices.q.askAbove`

- en: Above how much off should you be asked first? (%)
- before: فوق أي نسبة تخفيض تسألك أولًا؟ (%)
- **after: فوق أي نسبة تخفيض يلزم سؤالك أولًا؟ (%)**

### `prices.save`

- en: Save
- before: احفظ
- **after: حفظ**

### `prices.default.title`

- en: For everything you sell
- before: لكل ما تبيعه
- **after: لكل منتجاتك**

### `prices.default.sub`

- en: Answer once and it covers every product. You can set a different answer for any single product below.
- before: أجب مرة واحدة فتشمل كل المنتجات. ويمكنك تحديد إجابة مختلفة لأي منتج بمفرده أدناه.
- **after: إجابة واحدة تشمل كل المنتجات. ويمكن تحديد إجابة مختلفة لأي منتج بمفرده أدناه.**

### `prices.change`

- en: Change these
- before: غيّرها
- **after: تغيير**

### `prices.stated`

- en: Never below {floor}. Up to {ask}% off is decided without you; above that you are asked first. Never more than {max}% off.
- before: لا أقل من {floor}. حتى {ask}% تقرّر وحدها، وفوق ذلك تسألك أولًا. ولا أكثر من {max}%.
- **after: لا أقل من {floor}. حتى {ask}% القرار لـ {name}، وفوق ذلك يلزم سؤالك أولًا. ولا أكثر من {max}%.**

### `prices.notStated`

- en: You have not said what the least you would accept is, so {name} cannot quote this one.
- before: لم تقل بعد ما أقل سعر تقبله، فلا تستطيع {name} عرض سعر لهذا.
- **after: أقل سعر مقبول لم يُحدَّد بعد، فلا يمكن لـ {name} عرض سعر لهذا.**

### `prices.needing.sub`

- en: {n} products have a price but no limit, so {name} will not quote them.
- before: {n} منتجات لها سعر بلا حدّ، فلن تعرضها {name}.
- **after: {n} منتجات لها سعر بلا حدّ، فلا يمكن لـ {name} عرضها.**

### `prices.flash.savedAndLive`

- en: Saved. {name} can quote it now.
- before: حُفظ. تستطيع {name} عرض سعره الآن.
- **after: حُفظ. بإمكان {name} عرض سعره الآن.**

### `prices.error.missing`

- en: Please answer this one.
- before: من فضلك أجب عن هذا.
- **after: يُرجى الإجابة عن هذا.**

### `prices.error.not_a_number`

- en: Please use numbers only.
- before: أرقام فقط من فضلك.
- **after: يُرجى استخدام الأرقام فقط.**

### `prices.error.pct_out_of_range`

- en: Please use a number between 0 and 100.
- before: من فضلك رقم بين 0 و100.
- **after: يُرجى إدخال رقم بين 0 و100.**

### `prices.error.ask_above_max`

- en: This is higher than the most that may ever come off, so you would never be asked. Lower it, or raise the most that may come off.
- before: هذا أعلى من أقصى خصم يمكنها منحه، فلن تُسأل أبدًا. اخفضه أو ارفع أقصى خصم.
- **after: هذا أعلى من أقصى خصم مسموح لـ {name}، فلن يصل إليك أي سؤال. يلزم خفضه أو رفع أقصى خصم.**

### `prices.error.floor_above_list`

- en: This is above your own listed price, so {name} could never quote it. Lower it, or raise the price.
- before: هذا أعلى من سعرك المعلن، فلن تستطيع {name} عرضه أبدًا. اخفضه أو ارفع السعر.
- **after: هذا أعلى من سعرك المعلن، فلا يمكن لـ {name} عرضه أبدًا. يلزم خفضه أو رفع السعر.**

### `prices.volume.title`

- en: When you will come down on price
- before: متى تنزل في السعر
- **after: متى يُخفَّض السعر**

### `prices.volume.sub`

- en: {name} never invents a discount. Only what you write here comes off, and never more than the most you allow above.
- before: لا تخترع {name} خصمًا. لا تنزل إلا بما تكتبه هنا، ولا تتجاوز أبدًا أقصى ما سمحت به أعلاه.
- **after: لا خصومات مختلَقة في ردود {name}. الخصم يقتصر على ما يُكتب هنا، ولا يتجاوز أبدًا الحد الأقصى المسموح به أعلاه.**

### `prices.volume.none`

- en: You have not written one, so no discount is ever offered — your price is quoted as it stands.
- before: لم تكتب شيئًا، فهي لا تعرض خصمًا أبدًا — تعرض سعرك كما هو.
- **after: لم يُكتب شيء، فلا خصم أبدًا — يُعرض سعرك دون تغيير.**

### `prices.volume.everyProduct`

- en: Everything you sell
- before: كل ما تبيعه
- **after: كل منتجاتك**

### `prices.volume.add`

- en: Add this
- before: أضِف هذا
- **after: إضافة هذا**

### `prices.volume.asksFirst`

- en: This is past the point where you asked to be asked, so {name} checks with you before it goes out.
- before: هذا يتجاوز الحد الذي طلبت أن تُسأل عنده، فتستأذنك {name} قبل أن يخرج.
- **after: هذا يتجاوز الحد الذي يلزم عنده سؤالك، فلا يخرج قبل موافقتك.**

### `prices.volume.remove`

- en: Stop offering this
- before: أوقف هذا العرض
- **after: إيقاف هذا العرض**

### `prices.volume.error.missing`

- en: Please answer this one.
- before: من فضلك أجب عن هذا.
- **after: يُرجى الإجابة عن هذا.**

### `prices.volume.error.not_a_number`

- en: Please use numbers only.
- before: أرقام فقط من فضلك.
- **after: يُرجى استخدام الأرقام فقط.**

### `prices.volume.error.above_max`

- en: This is more than the most you said may ever come off. Lower it, or raise that limit first.
- before: هذا أكثر من أقصى ما قلت إنه قد يُخصم. اخفضه، أو ارفع ذلك الحد أولًا.
- **after: هذا أكثر من أقصى خصم مسموح به. يلزم خفضه، أو رفع ذلك الحد أولًا.**

### `prices.volume.error.no_limits`

- en: Set what you will never go below first — a discount with no floor under it is a number nobody stated.
- before: حدّد أولًا ما لن تنزل تحته — خصم بلا حدٍّ أدنى تحته رقم لم يذكره أحد.
- **after: يلزم أولًا تحديد السعر الأدنى — خصم بلا حدٍّ أدنى تحته رقم لم يذكره أحد.**

### `prices.flash.volumeAdded`

- en: Saved. {name} can offer that now.
- before: حُفظ. تستطيع {name} عرض ذلك الآن.
- **after: حُفظ. بإمكان {name} عرض ذلك الآن.**

### `prices.flash.volumeRemoved`

- en: Stopped. That will not be offered any more.
- before: أُوقف. لن تعرضه بعد الآن.
- **after: أُوقف. لا عرض له بعد الآن.**

### `factory.prices.title`

- en: What {name} may never go below
- before: ما لا تنزل تحته أبدًا
- **after: الحد الذي لا نزول تحته أبدًا**

### `factory.prices.q`

- en: How much can {name} move on price?
- before: كم تستطيع {name} أن تتحرّك في السعر؟
- **after: ما هامش تحرّك {name} في السعر؟**

### `factory.prices.more`

- en: Set your price limits
- before: حدّد حدود أسعارك
- **after: تحديد حدود أسعارك**

### `factory.prices.none`

- en: You have not set any price limits yet, so {name} cannot quote anything.
- before: لم تحدّد أي حدود للأسعار بعد، فلا تستطيع {name} عرض شيء.
- **after: لم تُحدَّد أي حدود للأسعار بعد، فلا يمكن لـ {name} عرض شيء.**

### `factory.prices.all`

- en: Every product you sell has a limit you set.
- before: كل منتج تبيعه له حدّ حدّدته بنفسك.
- **after: لكل منتج من منتجاتك حدّ من تحديدك.**

### `product.edit.title`

- en: Change this product
- before: عدّل هذا المنتج
- **after: تعديل هذا المنتج**

### `product.edit.moq`

- en: Smallest order you will take
- before: أصغر طلب تقبله
- **after: أصغر طلب مقبول**

### `product.edit.unit`

- en: What you count them in
- before: بماذا تعدّها
- **after: وحدة العدّ**

### `product.edit.active`

- en: Offer this to buyers
- before: اعرضه على المشترين
- **after: عرضه على المشترين**

### `product.edit.save`

- en: Save changes
- before: احفظ التعديلات
- **after: حفظ التعديلات**

### `product.edit.error.not_a_number`

- en: Please use numbers only.
- before: أرقام فقط من فضلك.
- **after: يُرجى استخدام الأرقام فقط.**

### `product.edit.error.empty`

- en: Please fill this in.
- before: من فضلك املأ هذا.
- **after: يُرجى ملء هذا الحقل.**

### `product.edit.error.below_floor`

- en: This is below the least you said you would accept, so {name} could not quote it.
- before: هذا أقل مما قلت إنك تقبله، فلن تستطيع {name} عرضه.
- **after: هذا أقل من أدنى سعر مقبول لديك، فلا يمكن لـ {name} عرضه.**

### `pilot.blocker.profile`

- en: Add your business details.
- before: أضف بيانات شركتك.
- **after: يلزم إضافة بيانات شركتك.**

### `pilot.blocker.products`

- en: Add at least one product with a price.
- before: أضف منتجاً واحداً على الأقل بسعر.
- **after: إضافة منتج واحد على الأقل مع سعره.**

### `pilot.blocker.priceRules`

- en: Tell {name} the least you would ever accept, and how much may come off.
- before: أخبر {name} بأقل سعر تقبله، وبكم تستطيع أن تخفّض.
- **after: إخبار {name} بأدنى سعر مقبول، وبمقدار التخفيض المسموح به.**

### `pilot.blocker.knowledge`

- en: Teach at least one fact or answer.
- before: علّم حقيقة أو إجابة واحدة على الأقل.
- **after: إضافة معلومة أو إجابة واحدة على الأقل إلى معرفة {name}.**

### `pilot.blocker.claims`

- en: Turn on the certifications you hold — or confirm you have none.
- before: فعّل الشهادات التي تملكها — أو أكّد أنك لا تملك أياً منها.
- **after: تفعيل الشهادات المتوفّرة لديك — أو تأكيد عدم وجود أي منها.**

### `pilot.blocker.sandbox`

- en: Run the sandbox check below.
- before: شغّل فحص بيئة التجربة أدناه.
- **after: تشغيل فحص بيئة التجربة أدناه.**

### `pilot.open`

- en: Open
- before: افتح
- **after: فتح**

### `pilot.attest.owner_ready`

- en: I'm ready to go live
- before: أنا جاهز للانطلاق
- **after: أؤكّد الاستعداد للانطلاق**

### `pilot.assistant.hint`

- en: Every reply is signed with this name, so a buyer reads it each time. You can change it later on the team page.
- before: توقّع باسمها هذا، فيقرأه المشتري في كل رد. ويمكنكِ تغييره لاحقًا من صفحة الفريق.
- **after: يظهر هذا الاسم في توقيع كل ردّ، فيقرأه المشتري دائمًا. ويمكن تغييره لاحقًا من صفحة الفريق.**

### `pilot.assistant.problem.name_missing`

- en: Type the name buyers should see.
- before: اكتبي الاسم الذي سيراه المشترون.
- **after: يُرجى كتابة الاسم الذي سيراه المشترون.**

### `pilot.validate`

- en: Run sandbox check
- before: شغّل فحص بيئة التجربة
- **after: تشغيل فحص بيئة التجربة**

### `pilot.allReady`

- en: Ready for your first pilot
- before: جاهز لتجربتك الأولى
- **after: كل شيء جاهز لتجربتك الأولى**

### `takeover.status.ai`

- en: {name} is handling this
- before: {name} تتولّى هذه المحادثة
- **after: في عهدة {name}**

### `takeover.status.owner`

- en: You're handling this
- before: أنت تتولّى هذه المحادثة
- **after: في عهدتك**

### `takeover.action.take`

- en: Take over
- before: أتولّى بنفسي
- **after: استلام المحادثة**

### `takeover.action.resume`

- en: Hand back to {name}
- before: أعِدها إلى {name}
- **after: إعادة المحادثة إلى {name}**

### `takeover.replyPlaceholder`

- en: Type your reply to the buyer…
- before: اكتب ردّك للمشتري…
- **after: كتابة الردّ على المشتري…**

### `takeover.reason.audio_unheard`

- en: a voice message that could not be heard
- before: رسالة صوتية لم تتمكّن من سماعها
- **after: رسالة صوتية تعذّر سماعها**

### `takeover.reason.media_unreadable`

- en: something the buyer sent that could not be opened
- before: شيء أرسله المشتري ولم تتمكّن من فتحه
- **after: شيء أرسله المشتري وتعذّر فتحه**

### `unheard.title`

- en: A voice message that could not be heard
- before: رسالة صوتية لم تتمكّن من سماعها
- **after: رسالة صوتية تعذّر سماعها**

### `unheard.what`

- en: {name} received a voice message and could not make out the words, so no reply has gone out.
- before: وصلت {name} رسالة صوتية ولم تتبيّن الكلمات، لذلك لم تردّ.
- **after: وصلت إلى {name} رسالة صوتية تعذّر تبيّن كلماتها، لذلك لم يُرسَل ردّ.**

### `unheard.why.unsupported_format`

- en: The voice message came in a form that cannot be opened.
- before: وصلت الرسالة الصوتية بصيغة لا تستطيع فتحها.
- **after: وصلت الرسالة الصوتية بصيغة يتعذّر فتحها.**

### `unheard.do.not_configured`

- en: Listen to it yourself and reply, or ask your setup contact to turn on voice messages.
- before: استمع إليها بنفسك وردّ، أو اطلب ممّن ساعدك في التجهيز أن يفعّل سماع الرسائل الصوتية.
- **after: يمكن الاستماع إليها مباشرةً والردّ، أو الطلب ممّن ساعدك في التجهيز تفعيل سماع الرسائل الصوتية.**

### `unheard.do.transcription_failed`

- en: Listen to it yourself and reply, or ask the buyer to send it again.
- before: استمع إليها بنفسك وردّ، أو اطلب من المشتري إرسالها مرة أخرى.
- **after: يمكن الاستماع إليها مباشرةً والردّ، أو طلب إرسالها مرة أخرى من المشتري.**

### `unheard.do.unsupported_format`

- en: Listen to it yourself and reply, or ask the buyer to write it instead.
- before: استمع إليها بنفسك وردّ، أو اطلب من المشتري كتابتها بدلاً من ذلك.
- **after: يمكن الاستماع إليها مباشرةً والردّ، أو طلب كتابتها من المشتري بدلاً من ذلك.**

### `unheard.do.no_media`

- en: Ask the buyer to send the voice message again.
- before: اطلب من المشتري إرسال الرسالة الصوتية مرة أخرى.
- **after: يُرجى طلب إرسال الرسالة الصوتية مرة أخرى من المشتري.**

### `unreadable.title`

- en: Something that could not be opened
- before: شيء لم تتمكّن من فتحه
- **after: شيء تعذّر فتحه**

### `unreadable.what`

- en: {what} from the buyer. {name} cannot read it, so no reply has gone out.
- before: {what} من المشتري. لا تستطيع {name} قراءته، لذلك لم تردّ.
- **after: {what} من المشتري. يتعذّر على {name} قراءته، لذلك لم يُرسَل ردّ.**

### `unreadable.why`

- en: {name} answers typed messages, photos and voice messages. Anything else comes to you.
- before: تردّ على الرسائل المكتوبة والصور والرسائل الصوتية. أي شيء آخر يُحال إليك.
- **after: الردّ يشمل الرسائل المكتوبة والصور والرسائل الصوتية. أي شيء آخر يُحال إليك.**

### `unreadable.do`

- en: Open it on your phone and reply to the buyer yourself.
- before: افتحه على هاتفك وردّ على المشتري بنفسك.
- **after: يمكن فتحه على هاتفك والردّ على المشتري مباشرةً.**

### `unlisted.what`

- en: This number is not on your list, so {name} has not replied.
- before: هذا الرقم ليس في قائمتك، لذلك لم تردّ {name}.
- **after: هذا الرقم ليس في قائمتك، لذلك لم يصدر ردّ من {name}.**

### `unlisted.why`

- en: While you try {name} with a few buyers, only the numbers you added are written to.
- before: ما دمت تجرّب {name} مع بضعة مشترين، فهي لا تكتب إلا للأرقام التي أضفتها.
- **after: خلال تجربة {name} مع بضعة مشترين، لا تُرسَل الرسائل إلا إلى الأرقام المضافة إلى قائمتك.**

### `unlisted.do`

- en: Reply yourself, or add the number in My business and hand it back to {name}
- before: ردّ بنفسك، أو أضف الرقم من «شركتي» ثم أعد المحادثة إليها
- **after: الردّ مباشرةً، أو إضافة الرقم من «شركتي» ثم إعادة المحادثة إلى {name}**

### `voice.notHeard`

- en: The words could not be made out.
- before: لم تتبيّن الكلمات.
- **after: لم تتّضح الكلمات.**

### `voice.correct`

- en: Correct what was heard
- before: صحّح ما سمعته
- **after: تصحيح ما سُمع**

### `voice.correctPlaceholder`

- en: Type what the buyer actually said…
- before: اكتب ما قاله المشتري فعلاً…
- **after: كتابة ما قاله المشتري فعلاً…**

### `voice.correctSave`

- en: Save correction
- before: احفظ التصحيح
- **after: حفظ التصحيح**

### `voice.corrected`

- en: Corrected by you
- before: صحّحته أنت
- **after: تصحيح منك**

### `voice.flash.corrected`

- en: Saved. Your words will be used.
- before: تم الحفظ. ستستخدم كلماتك.
- **after: تم الحفظ. ستُعتمد كلماتك.**

### `voice.answerNow`

- en: Answer this now
- before: ردّي على هذا الآن
- **after: الردّ على هذا الآن**

### `voice.flash.answering`

- en: {name} has taken this back and is answering your words.
- before: استعادت المحادثة وتردّ على كلماتك الآن.
- **after: عادت المحادثة إلى {name}، والردّ على كلماتك جارٍ الآن.**

### `takeover.flash.taken_over`

- en: You're handling this now — {name} has paused.
- before: أنت تتولّاها الآن — توقفت {name}.
- **after: المحادثة في عهدتك الآن، وعمل {name} فيها متوقّف.**

### `takeover.flash.ai_owned`

- en: {name} is handling this — take over first.
- before: {name} تتولّاها — تولَّ بنفسك أولاً.
- **after: المحادثة في عهدة {name} — يلزم استلامها أولاً.**

### `takeover.flash.must_take_over`

- en: Take over the conversation before replying.
- before: تولَّ المحادثة قبل الرد.
- **after: يلزم استلام المحادثة قبل الردّ.**

### `takeover.flash.handed`

- en: Handed to {name}. It is on their list now.
- before: أُحيلت إلى {name}، وصارت في قائمته.
- **after: أُحيلت إلى {name}، وصارت الآن في قائمة {name}.**

### `handto.label`

- en: Hand to
- before: أحِل إلى
- **after: إحالة إلى**

### `handto.button`

- en: Hand over
- before: أحِل
- **after: إحالة**

### `runbook.practice.title`

- en: Practice before launch
- before: تدرّب قبل الإطلاق
- **after: التدرّب قبل الإطلاق**

### `runbook.practice.intro`

- en: Rehearse the whole flow in the sandbox — no real buyers involved.
- before: تدرّب على العملية كاملةً في بيئة التجربة — دون مشترين حقيقيين.
- **after: التدرّب على العملية كاملةً في بيئة التجربة — دون مشترين حقيقيين.**

### `runbook.practice.open`

- en: Open the sandbox
- before: افتح بيئة التجربة
- **after: فتح بيئة التجربة**

### `runbook.step.buyer`

- en: Send a buyer question
- before: أرسل سؤال مشترٍ
- **after: إرسال سؤال مشترٍ**

### `runbook.step.draft`

- en: See the drafted reply
- before: اطّلع على الرد المقترح
- **after: الاطّلاع على الردّ المقترح**

### `runbook.step.approve`

- en: Approve or edit it
- before: وافق عليه أو عدّله
- **after: الموافقة عليه أو تعديله**

### `runbook.step.takeover`

- en: Take over the conversation
- before: تولَّ المحادثة
- **after: استلام المحادثة**

### `runbook.step.reply`

- en: Reply as yourself
- before: ردّ بنفسك
- **after: الردّ بنفسك**

### `runbook.step.resume`

- en: Hand it back to {name}
- before: أعِدها إلى {name}
- **after: إعادة المحادثة إلى {name}**

### `runbook.step.teach`

- en: Correct a fact you taught
- before: صحّح معلومة علّمتها
- **after: تصحيح معلومة مضافة**

### `runbook.after.intro`

- en: Once real buyers have talked to {name}, come back and review:
- before: بعد أن يتحدث المشترون الحقيقيون مع {name}، عُد وراجِع:
- **after: بعد حديث مشترين حقيقيين مع {name}، يُرجى العودة لمراجعة:**

### `runbook.after.promotion`

- en: Review what {name} may do alone
- before: راجِع ما يمكن ل{name} فعله بمفردها
- **after: مراجعة ما يمكن لـ {name} فعله دون انتظارك**

### `runbook.after.autonomy`

- en: Review working hours and limits
- before: راجِع ساعات العمل والحدود
- **after: مراجعة ساعات العمل والحدود**

### `runbook.after.gaps`

- en: Review questions still to answer
- before: راجِع الأسئلة التي لم تُجب بعد
- **after: مراجعة الأسئلة التي لم تُجب بعد**

### `unsure.why`

- en: It may have reached them, or it may not. Nothing here can tell, so nothing was sent again — sending it twice would be worse than asking you. Read it and decide.
- before: قد تكون وصلته وقد لا تكون. لا شيء هنا يعرف، فلم تُرسل مرة أخرى — إرسالها مرتين أسوأ من سؤالكِ. اقرئيها ثم قرّري.
- **after: قد تكون وصلت إلى المشتري وقد لا تكون. لا شيء هنا يعرف، فلم تُرسل مرة أخرى — إرسالها مرتين أسوأ من سؤالك. القرار لك بعد قراءتها.**

### `unsure.again`

- en: They did not get it — send it
- before: لم تصله — أرسليها
- **after: لم تصل — إعادة الإرسال**

### `unsure.leave`

- en: Leave it
- before: اتركيها
- **after: تركها على حالها**

### `unsure.flash.left`

- en: Left as it is. Nothing more was sent.
- before: تُركت كما هي. لم يُرسل شيء آخر.
- **after: تُركت على حالها. لم يُرسل شيء آخر.**

### `refused.none`

- en: Every message prepared reached its buyer.
- before: كل رسالة أعدّتها وصلت إلى مشتريها.
- **after: كل رسالة أُعدّت وصلت إلى مشتريها.**

### `refused.what.handed_off`

- en: You had taken this conversation over, so {name} stayed quiet.
- before: كنت قد تولّيت هذه المحادثة، فبقيت صامتة.
- **after: كانت المحادثة في عهدتك، فلم يُرسَل ردّ.**

### `refused.why.handed_off`

- en: While you hold a conversation, {name} never speaks over you.
- before: ما دامت المحادثة بيدك، لا تتحدّث {name} فوقك.
- **after: ما دامت المحادثة في عهدتك، لا ردود من {name} فيها.**

### `refused.do.handed_off`

- en: Reply yourself, or hand it back to {name} when you are done.
- before: ردّ بنفسك، أو أعِدها إليها حين تنتهي.
- **after: الردّ مباشرةً، أو إعادة المحادثة إلى {name} عند الانتهاء.**

### `refused.what.paused`

- en: {name} is paused, so the reply was held.
- before: هي متوقّفة، فاحتُفظ بالردّ.
- **after: {name} في توقّف مؤقت، فاحتُفظ بالردّ.**

### `refused.why.paused`

- en: You stopped {name}, or the limit you set for the day was reached.
- before: أنت أوقفتها، أو بلغت الحدّ الذي وضعته لليوم.
- **after: التوقّف جاء بقرار منك، أو ببلوغ الحدّ اليومي المحدَّد.**

### `refused.do.paused`

- en: Start {name} again when you are ready.
- before: شغّلها من جديد حين تكون مستعدًّا.
- **after: يمكن إعادة تشغيل {name} عند الاستعداد.**

### `refused.do.window_closed`

- en: Message this buyer from your own phone. Once they answer, {name} can continue.
- before: راسِله من هاتفك أنت. وحين يردّ، تستطيع {name} المتابعة.
- **after: يمكن مراسلة هذا المشتري من هاتفك. وبعد وصول ردّ من المشتري، بإمكان {name} المتابعة.**

### `refused.do.window_needs_owner`

- en: Message this buyer from your own phone for now.
- before: راسِله من هاتفك أنت في الوقت الحالي.
- **after: يمكن مراسلة هذا المشتري من هاتفك في الوقت الحالي.**

### `refused.do.media_unsupported`

- en: Send the photo from your own phone, and tell {name} what to say about it.
- before: أرسل الصورة من هاتفك الآن، وأخبر {name} بما تقوله عنها.
- **after: يمكن إرسال الصورة من هاتفك، وإخبار {name} بما يُقال عنها.**

### `refused.do.channel_unavailable`

- en: Nothing is lost — it is still on the conversation. Reply the way you normally do, and tell us which route you expected.
- before: لم يضع شيء — ما زالت في المحادثة. رُدّ بطريقتك المعتادة، وأخبرنا أي مسار توقّعت.
- **after: لم يضع شيء — ما زالت في المحادثة. يمكن الردّ بالطريقة المعتادة، وإخبارنا بالمسار المتوقَّع.**

### `refused.why.subject_missing`

- en: Your buyer sees the subject before they open anything, so {name} will not invent one.
- before: مشتريك يرى العنوان قبل أن يفتح شيئًا، فلن تخترعه {name}.
- **after: يرى المشتري العنوان قبل فتح أي شيء، فلا مجال لعنوان مُختلَق.**

### `refused.do.subject_missing`

- en: Open the message, write the subject you want them to see, and send it again.
- before: افتح الرسالة، اكتب العنوان الذي تريده أن يراه، وأرسلها من جديد.
- **after: يُرجى فتح الرسالة، وكتابة العنوان المطلوب ظهوره للمشتري، ثم إعادة إرسالها.**

### `refused.why.no_unsubscribe`

- en: Every first e-mail has to carry a way for them to stop hearing from you, and this one could not.
- before: كل بريد أول يجب أن يحمل طريقة لإيقاف الرسائل عنه، وهذا لم يستطع.
- **after: كل بريد أول يجب أن يحمل طريقة لإيقاف الرسائل، وهذا البريد تعذّر فيه ذلك.**

### `refused.do.no_unsubscribe`

- en: Check your sending address on Channels. Once it is set up, send it again.
- before: راجع عنوان الإرسال في "القنوات". بعد تهيئته، أرسلها مرة أخرى.
- **after: يُرجى مراجعة عنوان الإرسال في "القنوات"، ثم إعادة الإرسال بعد تهيئته.**

### `refused.why.outreach_unchecked`

- en: We could not check whether they may be written to, and nothing goes out unchecked.
- before: لم نتمكّن من التحقّق ممّا إذا كان يُسمح بمراسلته، ولا يُرسَل شيء دون تحقّق.
- **after: لم نتمكّن من التحقّق من السماح بمراسلة هذا الشخص، ولا يُرسَل شيء دون تحقّق.**

### `refused.do.outreach_unchecked`

- en: Open their row on Buyers you may write to. If it reads that you can write to them, send it again.
- before: افتح سطره في "من يمكنك مراسلته". إذا كان يقول إنه يمكنك مراسلته، أرسلها مرة أخرى.
- **after: يُرجى فتح سطر هذا الشخص في "من يمكن مراسلته". إن كانت المراسلة مسموحة، يمكن إعادة الإرسال.**

### `refused.why.not_activated`

- en: You have not started {name} on WhatsApp.
- before: لم تُشغّل {name} على واتساب بعد.
- **after: لم يبدأ تشغيل {name} على واتساب بعد.**

### `refused.do.not_activated`

- en: Start {name} in My business when you are ready.
- before: شغّلها من «شركتي» حين تكون مستعدًّا.
- **after: يمكن تشغيل {name} من «شركتي» عند الاستعداد.**

### `refused.why.not_allowlisted`

- en: While you are testing, {name} only reaches numbers you have added yourself.
- before: أثناء التجربة، لا تصل {name} إلا إلى أرقام أضفتها بنفسك.
- **after: أثناء التجربة، لا يصل من {name} شيء إلا إلى الأرقام المضافة منك.**

### `refused.do.not_allowlisted`

- en: Add this number in My business, or leave it — nothing will be sent to it.
- before: أضِف هذا الرقم في «شركتي»، أو اتركه — فلن يُرسَل إليه شيء.
- **after: يمكن إضافة هذا الرقم في «شركتي»، أو تركه — فلن يُرسَل إليه شيء.**

### `refused.what.daily_ceiling`

- en: Today’s message limit was reached.
- before: بلغت حدّ الرسائل لليوم.
- **after: اكتمل حدّ الرسائل لهذا اليوم.**

### `refused.do.daily_ceiling`

- en: It clears tomorrow. Reply yourself if it cannot wait.
- before: يعود غدًا. ردّ بنفسك إن كان الأمر لا يحتمل.
- **after: يعود غدًا. ويمكن الردّ مباشرةً إن كان الأمر لا يحتمل الانتظار.**

### `refused.what.silenced`

- en: {name} is paused, so this did not go out.
- before: {name} متوقّفة مؤقتًا، لذلك لم تُرسل هذه الرسالة.
- **after: {name} في توقّف مؤقت، لذلك لم تُرسل هذه الرسالة.**

### `refused.why.silenced`

- en: We paused sending while we check something. This was not you, and nothing was lost.
- before: أوقفنا إرسالها بينما نتحقّق من أمر ما. لم يكن هذا منك، ولم يُفقد شيء.
- **after: أوقفنا الإرسال من {name} مؤقتًا بينما نتحقّق من أمر ما. لم يكن هذا منك، ولم يُفقد شيء.**

### `refused.do.silenced`

- en: Reply yourself meanwhile — you are not paused. We will tell you when {name} is back.
- before: ردّ بنفسك في هذه الأثناء — أنت غير متوقّف. سنخبرك فور عودتها.
- **after: يمكن الردّ مباشرةً في هذه الأثناء — لا توقّف من جهتك. وسنخبرك فور عودة {name}.**

### `product.flash.alreadyHere`

- en: {n} were already in your catalogue, so they were left as they are.
- before: {n} منها موجودة في قائمتك أصلًا، فتُركت كما هي.
- **after: {n} منها موجودة في قائمتك أصلًا، فتُركت على حالها.**

### `product.flash.refused`

- en: {n} were not changed: the new price is below the least you now accept.
- before: لم يتغيّر {n} منها: السعر الجديد أقل من أدنى سعر تقبله الآن.
- **after: لم يتغيّر {n} منها: السعر الجديد أقل من أدنى سعر مقبول الآن.**

### `today.budget.near`

- en: {name} has used {pct}% of the daily limit.
- before: استهلكت {name} {pct}% من الحد اليومي المحدَّد لها.
- **after: بلغ استهلاك {name} {pct}% من الحد اليومي المحدَّد.**

### `today.budget.thenStops`

- en: At 100%, answering stops until tomorrow.
- before: عند 100% تتوقف عن الرد حتى الغد.
- **after: عند 100% يتوقف الردّ حتى الغد.**

### `today.budget.thenKeeps`

- en: At 100%, answering carries on — nothing is stopped.
- before: عند 100% تواصل الرد — لا شيء يتوقف.
- **after: عند 100% يستمر الردّ — لا شيء يتوقف.**

### `today.calm.notLive.go`

- en: See what is left to set up
- before: اطّلع على ما تبقّى لإعداده
- **after: الاطّلاع على ما تبقّى لإعداده**

### `runbook.deploy.codeUnstable`

- en: OWNER_ACCESS_CODE is not set, so a new login code is generated every time this deploys and the owner is locked out until someone reads it from the logs. Set it in the host.
- before: لم يُضبط OWNER_ACCESS_CODE، فيُولَّد رمز دخول جديد مع كل نشر ويبقى المالك خارج المنتج حتى يقرأه أحد من السجلات. اضبطه في المضيف.
- **after: لم يُضبط OWNER_ACCESS_CODE، فيُولَّد رمز دخول جديد مع كل نشر ويبقى المالك خارج المنتج حتى يقرأه أحد من السجلات. يلزم ضبطه في المضيف.**

### `runbook.deploy.credentialKeyUnstable`

- en: CREDENTIAL_KEY is not set, so a new encryption key is generated every time this deploys. When that happens the stored WhatsApp credentials can never be decrypted again and every owner session is dropped. Set it in the host before switching the channel on.
- before: لم يُضبط CREDENTIAL_KEY، فيُولَّد مفتاح تشفير جديد مع كل نشر. عندها يتعذّر فك تشفير بيانات واتساب المحفوظة إلى الأبد وتنتهي كل جلسات المالك. اضبطه في المضيف قبل تشغيل القناة.
- **after: لم يُضبط CREDENTIAL_KEY، فيُولَّد مفتاح تشفير جديد مع كل نشر. عندها يتعذّر فك تشفير بيانات واتساب المحفوظة إلى الأبد وتنتهي كل جلسات المالك. يلزم ضبطه في المضيف قبل تشغيل القناة.**

### `runbook.deploy.unauthoredPriceRules`

- en: {n} price rules were written by the old importer, not by the owner: floor equal to the list price, no discount authority. Nothing rewrites them — ask the owner the three questions and let those answers replace them.
- before: {n} من حدود الأسعار كتبها المستورد القديم لا صاحب الشركة: الحدّ الأدنى مساوٍ لسعر القائمة، وبلا هامش تخفيض. لا شيء يعيد كتابتها — اسأله الأسئلة الثلاثة ودع إجاباته تحلّ محلّها.
- **after: {n} من حدود الأسعار كتبها المستورد القديم لا صاحب الشركة: الحدّ الأدنى مساوٍ لسعر القائمة، وبلا هامش تخفيض. لا شيء يعيد كتابتها — يلزم طرح الأسئلة الثلاثة على صاحب الشركة لتحلّ الإجابات محلّها.**

### `meta.intro`

- en: What still has to be in place before {name} can talk to real buyers. Nothing here switches messaging on.
- before: ما يجب توفّره قبل أن تتحدث {name} مع مشترين حقيقيين. هذه الصفحة لا تُفعّل الرسائل.
- **after: ما يجب توفّره قبل حديث {name} مع مشترين حقيقيين. هذه الصفحة لا تُفعّل الرسائل.**

### `meta.blocker.not_started`

- en: {name} has not been started yet — nothing is sent or received until you do.
- before: لم تبدأ بعد — لا يُرسل ولا يُستقبل شيء حتى تشغّليها.
- **after: لم يبدأ تشغيل {name} بعد — لا يُرسل ولا يُستقبل شيء قبل التشغيل.**

### `meta.notLive`

- en: Not live yet — no customer messages are sent or received.
- before: ليست مباشرة بعد — لا تُرسل أو تُستقبل أي رسائل من العملاء.
- **after: لا تشغيل مباشر بعد — لا تُرسل أو تُستقبل أي رسائل من العملاء.**

### `meta.live`

- en: Live — {name} is talking to real buyers.
- before: مباشرة — {name} تتحدث مع مشترين حقيقيين.
- **after: التشغيل مباشر — {name} على تواصل مع مشترين حقيقيين.**

### `ops.health.ok`

- en: Every reply {name} sent has gone out.
- before: كل ردّ أرسلته {name} قد وصل.
- **after: كل ردّ من {name} قد وصل.**

### `ops.health.whatToDo`

- en: Check the connection on the Channels page; replies resume by themselves once it is healthy.
- before: راجِع الاتصال في صفحة القنوات؛ يستأنف الإرسال بعد أن يعود سليماً.
- **after: يُرجى مراجعة الاتصال في صفحة القنوات؛ يُستأنف الإرسال من تلقاء نفسه بعد أن يعود سليماً.**

### `feedback.reasons`

- en: Why you were needed
- before: لماذا احتاجوا إليك
- **after: أسباب الحاجة إليك**

### `feedback.actions`

- en: What you did
- before: ما قمت به
- **after: إجراءاتك**

### `feedback.action.takeover`

- en: Took over a conversation
- before: تولّيت محادثة
- **after: استلام محادثة**

### `feedback.action.owner_reply`

- en: Replied yourself
- before: ردَدت بنفسك
- **after: ردّ مباشر منك**

### `feedback.action.resume_ai`

- en: Handed back to {name}
- before: أعدتها إلى {name}
- **after: إعادة إلى {name}**

### `feedback.action.draft_resolved`

- en: Reviewed a reply
- before: راجعت ردّاً
- **after: مراجعة ردّ**

### `contacts.title`

- en: Who you may write to
- before: من يمكنكِ مراسلته
- **after: من يمكن مراسلته**

### `contacts.intro`

- en: Everyone here either wrote to you first, or you added them and said how you met. Anyone who asked you to stop is at the bottom, and stays there.
- before: كل من هنا إمّا راسلكِ أولًا، وإمّا أضفتِه بنفسكِ وذكرتِ كيف التقيتما. ومن طلب أن تتوقفي يبقى في الأسفل ولا يعود.
- **after: كل من هنا إمّا راسلك أولًا، وإمّا أُضيف يدويًا مع ذكر مناسبة التعارف. ومن طلب إيقاف المراسلة يبقى في الأسفل ولا يعود.**

### `contacts.empty`

- en: Nobody yet. Add someone whose card you took, or wait for the first buyer to write to you.
- before: لا أحد بعد. أضيفي من أخذتِ بطاقته، أو انتظري أول مشترٍ يراسلكِ.
- **after: لا أحد بعد. يمكن إضافة صاحب بطاقة عمل، أو انتظار أول مشترٍ يراسلك.**

### `contacts.add.title`

- en: Add someone you met
- before: أضيفي شخصًا التقيتِه
- **after: إضافة شخص من معارفك**

### `contacts.add.channel`

- en: How you reach them
- before: كيف تصلين إليه
- **after: وسيلة التواصل**

### `contacts.add.name`

- en: Their name
- before: اسمه
- **after: الاسم**

### `contacts.add.company`

- en: Their company
- before: شركته
- **after: الشركة**

### `contacts.add.button`

- en: Add them
- before: أضيفيه
- **after: إضافة**

### `contacts.source.inbound`

- en: Wrote to you
- before: راسلكِ
- **after: رسالة واردة**

### `contacts.source.manual`

- en: You added them
- before: أنتِ أضفتِه
- **after: إضافة يدوية منك**

### `contacts.evidence.inbound_message`

- en: They wrote to you first
- before: راسلكِ أولًا
- **after: المبادرة بالمراسلة من الطرف الآخر**

### `contacts.evidence.owner_attestation`

- en: You said you may
- before: قلتِ إنه يجوز
- **after: بإقرار منك**

### `contacts.evidence.replied_to_email`

- en: They answered your e-mail
- before: ردّ على بريدك
- **after: جاء ردّ على بريدك**

### `contacts.consent.none`

- en: You have not said you may write to them
- before: لم تقولي بعد إنه يجوز أن تراسليه
- **after: لا إقرار منك بعد بجواز المراسلة**

### `contacts.attest.button`

- en: I may write to them
- before: يجوز أن أراسله
- **after: أُقرّ بجواز المراسلة**

### `contacts.attest.hint`

- en: Only if they gave you their card or asked you to stay in touch. Whoever says so is recorded.
- before: فقط إن أعطاكِ بطاقته أو طلب أن تبقيا على تواصل. ويُسجَّل اسم من قال ذلك.
- **after: فقط في حال تسليم بطاقة العمل أو طلب البقاء على تواصل. ويُسجَّل اسم من يُقرّ بذلك.**

### `contacts.suppress.button`

- en: Never write to them again
- before: لا تراسليه مرة أخرى أبدًا
- **after: إيقاف المراسلة نهائيًا**

### `contacts.suppress.hint`

- en: This cannot be undone, and nothing here will write to them again.
- before: لا رجوع عن هذا، ولن يُرسَل إليه شيء من هنا بعد اليوم.
- **after: لا رجوع عن هذا، ولن يُرسَل شيء من هنا إلى هذا الشخص بعد اليوم.**

### `contacts.reason.unsubscribed`

- en: They asked you to stop
- before: طلب أن تتوقفي
- **after: طلب إيقاف المراسلة**

### `contacts.reason.complained`

- en: They reported it as unwanted
- before: أبلغ أنه غير مرغوب فيه
- **after: بلاغ بأن الرسائل غير مرغوب فيها**

### `contacts.archive`

- en: Take off the list
- before: احذفيه من القائمة
- **after: إزالة من القائمة**

### `contacts.flash.attested`

- en: Noted. You may write to them.
- before: سُجِّل، ويجوز أن تراسليه.
- **after: سُجِّل، والمراسلة جائزة الآن.**

### `contacts.flash.suppressed`

- en: Noted. Nothing here will write to them again.
- before: سُجِّل، ولن يُرسَل إليه شيء من هنا بعد اليوم.
- **after: سُجِّل، ولن يُرسَل شيء من هنا إلى هذا الشخص بعد اليوم.**

### `contacts.flash.archived`

- en: Taken off your list.
- before: حُذف من قائمتكِ.
- **after: تمت الإزالة من قائمتك.**

### `contacts.flash.missing`

- en: Type a phone number or an email address.
- before: اكتبي رقم هاتف أو بريدًا إلكترونيًا.
- **after: يُرجى كتابة رقم هاتف أو بريد إلكتروني.**

### `contacts.flash.failed`

- en: That did not save. Try again.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `nav.prospects`

- en: Find buyers
- before: ابحثي عن مشترين
- **after: البحث عن مشترين**

### `connect.intro`

- en: What each account lets {name} do. Connecting an e-mail account is what lets your first e-mails and follow-ups leave from your own address.
- before: ما يتيحه كل حساب لـ{name}. ربط حساب بريد هو ما يجعل رسائلك الأولى ورسائل المتابعة تخرج من عنوانك أنتِ.
- **after: ما يتيحه كل حساب لـ{name}. ربط حساب بريد يجعل رسائلك الأولى ورسائل المتابعة تخرج من عنوانك أنت.**

### `connect.action.connect`

- en: Connect
- before: اربطي
- **after: ربط**

### `connect.action.reconnect`

- en: Connect again
- before: اربطي مرة أخرى
- **after: إعادة الربط**

### `connect.action.disconnect`

- en: Disconnect
- before: افصلي
- **after: فصل**

### `connect.mail.google.what`

- en: Sends your e-mail from your own Google Workspace address. Tick the box to let {name} read what buyers send there, too.
- before: يرسل بريدك من عنوان Google Workspace الخاص بك. علّمي المربع لتقرأ {name} ما يرسله المشترون إليه أيضًا.
- **after: يرسل بريدك من عنوان Google Workspace الخاص بك. وعند تعليم المربع، بإمكان {name} قراءة ما يرسله المشترون إليه أيضًا.**

### `connect.mail.read.tick`

- en: Also let {name} read and answer buyers' e-mails in this mailbox.
- before: اسمحي لـ {name} أيضًا بقراءة رسائل المشترين في هذا الصندوق، لتتمكن من الردّ عليها.
- **after: السماح لـ {name} أيضًا بقراءة رسائل المشترين في هذا الصندوق، والردّ عليها.**

### `connect.mail.reads`

- en: Also reads new e-mails to {address}, once a minute.
- before: تقرأ أيضًا ما يصل جديدًا إلى {address}، مرة كل دقيقة.
- **after: قراءة ما يصل جديدًا إلى {address} أيضًا، مرة كل دقيقة.**

### `connect.mail.sendsOnly`

- en: Sends only. Connect again with the box ticked to let {name} answer e-mails.
- before: يرسل فقط. اربطيه مرة أخرى مع تعليم المربع لتردّ {name} على البريد.
- **after: يرسل فقط. للسماح بردّ {name} على البريد، يلزم الربط مرة أخرى مع تعليم المربع.**

### `connect.mail.offDomain`

- en: This address is not on {domain}, the domain you set up, so nothing is sent from it until they match.
- before: هذا العنوان ليس على {domain}، النطاق الذي أعددتِه، فلن يُرسل منه شيء حتى يتطابقا.
- **after: هذا العنوان ليس على {domain}، النطاق المُعَدّ، فلن يُرسل منه شيء حتى يتطابقا.**

### `connect.mail.attention`

- en: {address} stopped letting us send. Connect it again.
- before: لم يعد {address} يسمح لنا بالإرسال. اربطيه مرة أخرى.
- **after: لم يعد {address} يسمح لنا بالإرسال. يلزم ربطه مرة أخرى.**

### `connect.mail.outranked`

- en: Connected as {address}, but your e-mail now leaves through your own mail provider instead.
- before: مربوط بـ {address}، لكن بريدكِ يخرج الآن عبر مزوّد البريد الخاص بكِ.
- **after: مربوط بـ {address}، لكن بريدك يخرج الآن عبر مزوّد البريد الخاص بك.**

### `connect.smtp.name`

- en: Your own mail provider
- before: مزوّد البريد الخاص بكِ
- **after: مزوّد البريد الخاص بك**

### `connect.smtp.what`

- en: Set up by whoever runs this installation. Nothing to press here; ask them to change it.
- before: أعدّه من يدير هذا التثبيت. لا شيء تضغطينه هنا؛ اطلبي منه التغيير.
- **after: أعدّه من يدير هذا التثبيت. لا حاجة إلى أي إجراء هنا؛ ويمكن طلب التغيير ممّن يديره.**

### `connect.apollo.add`

- en: Add your key
- before: أضيفي مفتاحك
- **after: إضافة مفتاحك**

### `connect.apollo.open`

- en: Open
- before: افتحي
- **after: فتح**

### `connect.flash.expired`

- en: That took too long, or came from another window. Press Connect again.
- before: استغرق ذلك وقتًا طويلًا، أو جاء من نافذة أخرى. اضغطي اربطي مرة أخرى.
- **after: استغرق ذلك وقتًا طويلًا، أو جاء من نافذة أخرى. يُرجى استخدام زر «ربط» مرة أخرى.**

### `connect.flash.rejected`

- en: That was refused. Press Connect again.
- before: رُفض ذلك. اضغطي اربطي مرة أخرى.
- **after: رُفض ذلك. يُرجى استخدام زر «ربط» مرة أخرى.**

### `connect.flash.app_refused`

- en: Google or Microsoft refused this installation, not you. Whoever runs it needs to renew its app secret; connecting again will not help until then.
- before: رفضت Google أو Microsoft هذا التثبيت، لا أنتِ. على من يديره تجديد سرّ التطبيق؛ ولن يفيد الربط مرة أخرى قبل ذلك.
- **after: رفضت Google أو Microsoft هذا التثبيت، لا أنت. على من يديره تجديد سرّ التطبيق؛ ولن يفيد الربط مرة أخرى قبل ذلك.**

### `connect.flash.missing_scope`

- en: Sending was not allowed. Press Connect again and allow it.
- before: لم يُسمح بالإرسال. اضغطي اربطي مرة أخرى واسمحي به.
- **after: لم يُسمح بالإرسال. يُرجى استخدام زر «ربط» مرة أخرى مع السماح به.**

### `connect.flash.no_refresh_token`

- en: Only short-lived access was given. Press Connect again.
- before: مُنح وصول مؤقت فقط. اضغطي اربطي مرة أخرى.
- **after: مُنح وصول مؤقت فقط. يُرجى استخدام زر «ربط» مرة أخرى.**

### `connect.flash.no_address`

- en: We could not confirm which address this is. Press Connect again.
- before: لم نستطع التأكد من العنوان. اضغطي اربطي مرة أخرى.
- **after: لم نستطع التأكد من العنوان. يُرجى استخدام زر «ربط» مرة أخرى.**

### `connect.flash.unavailable`

- en: Google or Microsoft did not answer. Try again later.
- before: لم تردّ Google أو Microsoft. حاولي لاحقًا.
- **after: لم تردّ Google أو Microsoft. يُرجى المحاولة لاحقًا.**

### `prospects.title`

- en: Find buyers
- before: ابحثي عن مشترين
- **after: البحث عن مشترين**

### `prospects.intro`

- en: Search for people who buy what you make. Nothing here writes to anyone: people you add join your list with nothing on file saying you may write to them, and their row says so.
- before: ابحثي عن أشخاص يشترون ما تصنعينه. لا شيء هنا يراسل أحدًا: من تضيفينه ينضم إلى قائمتك دون أي سجل يسمح بمراسلته، وسطره يقول ذلك.
- **after: البحث عن أشخاص يشترون ما تصنعه شركتك. لا شيء هنا يراسل أحدًا: من يُضاف ينضم إلى قائمتك دون أي سجل يسمح بالمراسلة، ويظهر ذلك في القائمة.**

### `prospects.key.none`

- en: No key yet. Searching uses your own Apollo account, and each work address or company you look up uses one of its credits.
- before: لا يوجد مفتاح بعد. البحث يستخدم حساب Apollo الخاص بك، وكل عنوان عمل أو شركة تبحثين عنها تستهلك رصيدًا واحدًا.
- **after: لا يوجد مفتاح بعد. البحث يستخدم حساب Apollo الخاص بك، وكل عنوان عمل أو شركة يجري البحث عنها تستهلك رصيدًا واحدًا.**

### `prospects.key.save`

- en: Save the key
- before: احفظي المفتاح
- **after: حفظ المفتاح**

### `prospects.key.replace`

- en: Replace the key
- before: استبدلي المفتاح
- **after: استبدال المفتاح**

### `prospects.key.remove`

- en: Remove the key
- before: احذفي المفتاح
- **after: حذف المفتاح**

### `staff.prospects.keyOwner`

- en: The owner adds the Apollo key.
- before: المالكة هي من تضيف مفتاح Apollo.
- **after: إضافة مفتاح Apollo من صلاحية المالك.**

### `prospects.search.button`

- en: Search
- before: ابحثي
- **after: بحث**

### `prospects.results.none`

- en: Nobody matched. Try fewer words.
- before: لم يطابق أحد. جرّبي كلمات أقل.
- **after: لا نتائج مطابقة. يمكن تجربة كلمات أقل.**

### `prospects.add.button`

- en: Add to my list
- before: أضيفيه إلى قائمتي
- **after: إضافة إلى قائمتي**

### `prospects.add.hint`

- en: Adding someone finds their work address and uses one credit.
- before: إضافة شخص تبحث عن عنوان عمله وتستهلك رصيدًا واحدًا.
- **after: إضافة شخص تعني البحث عن عنوان العمل، وتستهلك رصيدًا واحدًا.**

### `prospects.flash.invalid`

- en: That does not look like an Apollo key. Copy it again from Apollo.
- before: هذا لا يبدو مفتاح Apollo. انسخيه مرة أخرى من Apollo.
- **after: هذا لا يبدو مفتاح Apollo. يُرجى نسخه مرة أخرى من Apollo.**

### `prospects.flash.added`

- en: Added to your list. Nothing on file says you may write to them yet.
- before: أُضيف إلى قائمتك. لا يوجد بعد سجل يسمح بمراسلته.
- **after: تمت الإضافة إلى قائمتك. لا يوجد بعد سجل يسمح بالمراسلة.**

### `prospects.flash.exists`

- en: They are already on your list.
- before: إنه في قائمتك بالفعل.
- **after: هذا الشخص في قائمتك بالفعل.**

### `prospects.flash.not_found`

- en: Apollo has no work address for them, so nobody was added.
- before: لا يملك Apollo عنوان عمل له، فلم يُضف أحد.
- **after: لا يملك Apollo عنوان عمل لهذا الشخص، فلم يُضف أحد.**

### `prospects.flash.failed`

- en: That did not save. Try again.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `prospects.noSource.no_key`

- en: Add your Apollo key first.
- before: أضيفي مفتاح Apollo أولًا.
- **after: يلزم إضافة مفتاح Apollo أولًا.**

### `prospects.noSource.unreadable_key`

- en: The key on file can no longer be opened here. Paste it again.
- before: المفتاح المحفوظ لم يعد يُفتح هنا. الصقيه مرة أخرى.
- **after: المفتاح المحفوظ لم يعد يُفتح هنا. يُرجى لصقه مرة أخرى.**

### `prospects.failure.unauthorized`

- en: Apollo did not accept the key. Check it and paste it again.
- before: لم يقبل Apollo المفتاح. تحقّقي منه والصقيه مرة أخرى.
- **after: لم يقبل Apollo المفتاح. يُرجى التحقّق منه ولصقه مرة أخرى.**

### `prospects.failure.rate_limited`

- en: Apollo asked us to slow down. Try again in a minute.
- before: طلب منا Apollo التمهّل. حاولي بعد دقيقة.
- **after: طلب منا Apollo التمهّل. يُرجى المحاولة بعد دقيقة.**

### `prospects.failure.unavailable`

- en: Apollo did not answer. Try again later.
- before: لم يردّ Apollo. حاولي لاحقًا.
- **after: لم يردّ Apollo. يُرجى المحاولة لاحقًا.**

### `contacts.source.apollo`

- en: Found in a search
- before: وُجد في بحث
- **after: من نتائج البحث**

### `contacts.lookup.button`

- en: Look up their company (1 credit)
- before: ابحثي عن شركته (رصيد واحد)
- **after: البحث عن الشركة (رصيد واحد)**

### `seq.intro`

- en: Write a first e-mail and what follows it if nobody answers. Nothing goes out until you approve the words, and it stops by itself the moment they answer, ask you to stop, or the address turns out not to exist.
- before: اكتبي رسالة أولى وما يتبعها إن لم يأتِ رد. لا يخرج شيء قبل أن توافقي على النص، ويتوقف كل شيء وحده لحظة الرد، أو طلب التوقف، أو إذا تبيّن أن العنوان غير موجود.
- **after: كتابة رسالة أولى وما يتبعها إن لم يصل رد. لا يخرج شيء قبل الموافقة على النص، ويتوقف كل شيء من تلقاء نفسه لحظة الرد، أو طلب التوقف، أو إذا تبيّن أن العنوان غير موجود.**

### `seq.list.counts`

- en: {steps} e-mails · {live} receiving · {finished} finished · {stopped} stopped
- before: رسائل: {steps} · يستقبلون: {live} · اكتملت: {finished} · توقفت: {stopped}
- **after: رسائل: {steps} · قيد الاستقبال: {live} · اكتملت: {finished} · توقفت: {stopped}**

### `seq.list.awaiting`

- en: {count} waiting for you
- before: تنتظركِ: {count}
- **after: تنتظرك: {count}**

### `seq.new.title`

- en: Write a new one
- before: اكتبي مجموعة جديدة
- **after: كتابة مجموعة جديدة**

### `seq.new.button`

- en: Start writing
- before: ابدئي الكتابة
- **after: بدء الكتابة**

### `seq.steps.empty`

- en: No e-mails in it yet. Write the first one below.
- before: لا رسائل فيها بعد. اكتبي الأولى أدناه.
- **after: لا رسائل فيها بعد. يمكن كتابة الأولى أدناه.**

### `seq.step.when.next`

- en: Goes after the one before, if they have not answered — days to wait: {days}
- before: تُرسل بعد السابقة إن لم يرد — أيام الانتظار: {days}
- **after: تُرسل بعد السابقة إن لم يصل رد — أيام الانتظار: {days}**

### `seq.step.save`

- en: Save this e-mail
- before: احفظي هذه الرسالة
- **after: حفظ هذه الرسالة**

### `seq.step.add`

- en: Add a follow-up
- before: أضيفي رسالة متابعة
- **after: إضافة رسالة متابعة**

### `seq.step.addButton`

- en: Add it
- before: أضيفيها
- **after: إضافة**

### `seq.frozen.hint`

- en: These are the words that go out. They cannot be changed now — to change them, write a new one.
- before: هذا هو النص الذي يخرج، ولا يمكن تغييره الآن — لتغييره اكتبي مجموعة جديدة.
- **after: هذا النص الذي يخرج، ولا يمكن تغييره الآن — ولتغييره يلزم كتابة مجموعة جديدة.**

### `seq.approve.hint`

- en: Read every e-mail above once more. After you approve, the words cannot be changed, and anyone you add receives exactly these.
- before: اقرئي كل رسالة أعلاه مرة أخرى. بعد الاعتماد لا يمكن تغيير النص، ومن تضيفينه يستقبل هذا النص بعينه.
- **after: يُرجى قراءة كل رسالة أعلاه مرة أخرى. بعد الاعتماد لا يمكن تغيير النص، وكل من يُضاف يستقبل هذا النص بعينه.**

### `seq.approve.button`

- en: Approve these e-mails
- before: اعتمدي هذه الرسائل
- **after: اعتماد هذه الرسائل**

### `staff.seq.approveWaiting`

- en: Waiting for the owner to approve the words.
- before: بانتظار اعتماد المالكة للنص.
- **after: بانتظار اعتماد المالك للنص.**

### `seq.enroll.button`

- en: Start sending to them
- before: ابدئي الإرسال إليه
- **after: بدء الإرسال**

### `seq.enroll.none`

- en: Nobody on your list can be written to right now. Their row on your list says why.
- before: لا أحد في قائمتك يمكن مراسلته الآن. سطره في القائمة يذكر السبب.
- **after: لا أحد في قائمتك يمكن مراسلته الآن. السبب مذكور في سطر كل شخص.**

### `seq.enrolment.thread`

- en: Open the conversation
- before: افتحي المحادثة
- **after: فتح المحادثة**

### `seq.enrolment.stop`

- en: Stop for them
- before: أوقفيها له
- **after: إيقاف الإرسال**

### `seq.enrolment.waitingPill`

- en: Waiting for you
- before: تنتظركِ
- **after: تنتظرك**

### `seq.enrolment.awaiting`

- en: E-mail {n} is ready to go. Their answer would arrive in your own inbox, not here, so look there first: if they wrote back, stop it for them. If nobody sends it, it stops on {date}.
- before: الرسالة {n} جاهزة للإرسال. ردّه يصل إلى بريدكِ أنتِ لا إلى هنا، فانظري هناك أولًا: إن ردّ فأوقفيها له. وإن لم يرسلها أحد، تتوقف في {date}.
- **after: الرسالة {n} جاهزة للإرسال. أي ردّ يصل إلى بريدك أنت لا إلى هنا، فالأفضل النظر هناك أولًا: إن وصل ردّ، يلزم إيقاف الإرسال. وإن لم يرسلها أحد، تتوقف في {date}.**

### `seq.enrolment.confirm`

- en: No answer yet — send it
- before: لم يردّ بعد — أرسليها
- **after: لا ردّ بعد — إرسال**

### `seq.archive.button`

- en: Take out of use
- before: أوقفي الاستخدام
- **after: إيقاف الاستخدام**

### `seq.stop.replied`

- en: They answered — a person takes it from here
- before: ردّ — وشخص يتولى الأمر من هنا
- **after: وصل ردّ — وشخص يتولى الأمر من هنا**

### `seq.stop.unsubscribed`

- en: They asked you to stop
- before: طلب منكِ التوقف
- **after: طلب إيقاف المراسلة**

### `seq.stop.complained`

- en: They reported it as unwanted
- before: أبلغ أنها غير مرغوبة
- **after: بلاغ بأن الرسائل غير مرغوبة**

### `seq.stop.no_consent`

- en: Nothing on file says you may write to them any more
- before: لم يعد في السجل ما يسمح بمراسلته
- **after: لم يعد في السجل ما يسمح بالمراسلة**

### `seq.flash.created`

- en: Started. Write the first e-mail.
- before: بدأنا. اكتبي الرسالة الأولى.
- **after: بدأنا. يمكن الآن كتابة الرسالة الأولى.**

### `seq.flash.full`

- en: Ten e-mails is the most one can hold.
- before: عشر رسائل هي الحد الأقصى للمجموعة.
- **after: الحد الأقصى للمجموعة عشر رسائل.**

### `seq.flash.invalid`

- en: Fill in every part: days to wait, what it is about, and what you want to say.
- before: املئي كل جزء: أيام الانتظار، والموضوع، وما تريدين قوله.
- **after: يلزم ملء كل جزء: أيام الانتظار، والموضوع، والنص المطلوب.**

### `seq.flash.changed`

- en: The e-mails changed while you were reading. Read them again before approving.
- before: تغيّرت الرسائل أثناء قراءتك. اقرئيها مرة أخرى قبل الاعتماد.
- **after: تغيّرت الرسائل أثناء القراءة. يُرجى قراءتها مرة أخرى قبل الاعتماد.**

### `seq.flash.empty`

- en: Write at least one e-mail before approving.
- before: اكتبي رسالة واحدة على الأقل قبل الاعتماد.
- **after: يلزم كتابة رسالة واحدة على الأقل قبل الاعتماد.**

### `seq.flash.already`

- en: They are already receiving it.
- before: إنه يستقبلها بالفعل.
- **after: الإرسال إلى هذا الشخص جارٍ بالفعل.**

### `seq.flash.notApproved`

- en: Approve the e-mails before anyone receives them.
- before: اعتمدي الرسائل قبل أن يستقبلها أحد.
- **after: يلزم اعتماد الرسائل قبل أن يستقبلها أحد.**

### `seq.flash.stopped`

- en: Stopped for them.
- before: أُوقفت له.
- **after: أُوقف الإرسال.**

### `seq.flash.notWaiting`

- en: That e-mail is not waiting any more. Look at the page again.
- before: تلك الرسالة لم تعد تنتظر. أعيدي فتح الصفحة.
- **after: تلك الرسالة لم تعد تنتظر. يُرجى إعادة فتح الصفحة.**

### `seq.flash.failed`

- en: That did not save. Try again.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `reach.intro`

- en: This is what each one allows, not what we prefer. Where it says you cannot write first, that is the rule of the place itself — and going around it is how accounts get closed.
- before: هذا ما تسمح به كل طريقة، لا ما نفضّله نحن. وحيث يقول إنكِ لا تستطيعين المبادرة، فتلك قاعدة المكان نفسه — والالتفاف عليها هو ما تُغلق به الحسابات.
- **after: هذا ما تسمح به كل طريقة، لا ما نفضّله نحن. وحيث لا تُتاح المبادرة، فتلك قاعدة المكان نفسه — والالتفاف عليها سببٌ لإغلاق الحسابات.**

### `reach.cold.open`

- en: You can write first
- before: يمكنكِ المبادرة بالكتابة
- **after: المبادرة بالكتابة متاحة**

### `reach.cold.conditional`

- en: You can write first once these are in place
- before: يمكنكِ المبادرة متى توافرت هذه
- **after: المبادرة متاحة متى توافرت هذه**

### `reach.cold.never`

- en: You cannot write first
- before: لا يمكنكِ المبادرة بالكتابة
- **after: المبادرة بالكتابة غير متاحة**

### `reach.req.business_verification`

- en: WhatsApp has checked your business
- before: واتساب تحقّق من شركتكِ
- **after: واتساب تحقّق من شركتك**

### `reach.req.privacy_policy_url`

- en: A page of your own saying how you handle what buyers tell you
- before: صفحة خاصة بكِ تبيّن كيف تتعاملين مع ما يخبركِ به المشترون
- **after: صفحة خاصة بك تبيّن طريقة التعامل مع ما يخبرك به المشترون**

### `reach.req.verified_sending_domain`

- en: Your own sending address, set up so it is not treated as junk
- before: عنوان إرسال خاص بكِ، مُعدّ بحيث لا يُعامَل كرسائل مزعجة
- **after: عنوان إرسال خاص بك، مُعدّ بحيث لا يُعامَل كرسائل مزعجة**

### `reach.window`

- en: After a buyer writes, you have {hours} hours to answer them freely.
- before: بعد أن يراسلكِ، أمامكِ {hours} ساعة للرد عليه بحرية.
- **after: بعد أول رسالة من المشتري، تُتاح {hours} ساعة للرد بحرية.**

### `reach.notHere`

- en: Not set up here yet — nothing can be sent on this one.
- before: لم تُهيَّأ هنا بعد — لا تستطيع الإرسال عبرها.
- **after: لم تُهيَّأ هنا بعد — لا إرسال من {name} عبرها.**

### `reach.inbound.connect`

- en: Connect this account
- before: اربطي هذا الحساب
- **after: ربط هذا الحساب**

### `reach.inbound.connected`

- en: Connected. {name} answers buyers who write here.
- before: مربوط. ترد {name} على من يكتب هنا.
- **after: مربوط. بإمكان {name} الردّ على من يكتب هنا.**

### `reach.inbound.flash.connected`

- en: Connected. Messages from here now reach you.
- before: تم الربط. الرسائل من هنا تصلكِ الآن.
- **after: تم الربط. الرسائل من هنا تصلك الآن.**

### `reach.inbound.connectMeta`

- en: Connect your Facebook Page and Instagram
- before: اربط صفحتك على فيسبوك وحساب إنستغرام
- **after: ربط صفحتك على فيسبوك وحساب إنستغرام**

### `reach.inbound.noInstagram`

- en: That Page has no Instagram account linked. Link one in Instagram's settings, then connect again.
- before: لا يوجد حساب إنستغرام مرتبط بهذه الصفحة. اربط واحدًا من إعدادات إنستغرام ثم اربط من جديد.
- **after: لا يوجد حساب إنستغرام مرتبط بهذه الصفحة. يمكن ربط حساب من إعدادات إنستغرام ثم إعادة الربط.**

### `reach.inbound.attention`

- en: Meta no longer accepts this connection — connect it again.
- before: لم يعد Meta يقبل هذا الربط — اربط من جديد.
- **after: لم يعد Meta يقبل هذا الربط — يلزم الربط من جديد.**

### `connect.meta.flash.connectedNoIg`

- en: Connected: {page}. It has no Instagram account linked — link one in Instagram's settings and connect again to answer there too.
- before: تم الربط: {page}. لا يوجد حساب إنستغرام مرتبط بها — اربط واحدًا من إعدادات إنستغرام ثم اربط من جديد لترد هناك أيضًا.
- **after: تم الربط: {page}. لا يوجد حساب إنستغرام مرتبط بها — يمكن ربط حساب من إعدادات إنستغرام ثم إعادة الربط للردّ هناك أيضًا.**

### `connect.meta.flash.no_pages`

- en: That Facebook account manages no Page. Create one, or ask the Page's owner to make you an admin, then connect again.
- before: حساب فيسبوك هذا لا يدير أي صفحة. أنشئ واحدة، أو اطلب من مالك الصفحة أن يجعلك مديرًا، ثم اربط من جديد.
- **after: حساب فيسبوك هذا لا يدير أي صفحة. يمكن إنشاء صفحة، أو طلب صلاحية الإدارة من مالك الصفحة، ثم إعادة الربط.**

### `connect.meta.flash.subscribe_failed`

- en: Meta did not let us listen for messages on that Page. Try again; if it keeps failing, the Page may not have messaging.
- before: لم يسمح لنا Meta بتلقي رسائل تلك الصفحة. حاول مرة أخرى؛ وإن استمر الفشل فقد تكون الصفحة بلا ميزة الرسائل.
- **after: لم يسمح لنا Meta بتلقي رسائل تلك الصفحة. يُرجى المحاولة مرة أخرى؛ وإن استمر الفشل فقد تكون الصفحة بلا ميزة الرسائل.**

### `connect.meta.flash.disconnected`

- en: Disconnected. Nothing from that Page or Instagram reaches you until you connect again.
- before: تم الفصل. لا يصلك شيء من تلك الصفحة أو إنستغرام حتى تربط من جديد.
- **after: تم الفصل. لا يصلك شيء من تلك الصفحة أو إنستغرام حتى إعادة الربط.**

### `connect.meta.flash.unavailable`

- en: Meta did not answer. Try again later.
- before: لم يردّ Meta. حاول لاحقًا.
- **after: لم يردّ Meta. يُرجى المحاولة لاحقًا.**

### `connect.meta.choose.body`

- en: Your Facebook account manages more than one Page. Choose the one buyers write to for this business.
- before: حساب فيسبوك الخاص بك يدير أكثر من صفحة. اختر التي يكتب إليها مشترو هذه الشركة.
- **after: حساب فيسبوك الخاص بك يدير أكثر من صفحة. يُرجى اختيار الصفحة التي يكتب إليها مشترو هذه الشركة.**

### `connect.meta.choose.button`

- en: Connect this Page
- before: اربط هذه الصفحة
- **after: ربط هذه الصفحة**

### `refused.what.channel_cannot_initiate`

- en: {name} did not write first on this one.
- before: لم تبادر بالكتابة على هذه الطريقة.
- **after: لم تُرسَل رسالة أولى عبر هذه الطريقة.**

### `refused.do.channel_cannot_initiate`

- en: Wait for the buyer to write to you, or open your connections to see what each one allows.
- before: انتظري أن يراسلكِ، أو افتحي صفحة الاتصالات لترَي ما تسمح به كل طريقة.
- **after: يمكن انتظار رسالة من المشتري، أو فتح صفحة الاتصالات للاطّلاع على ما تسمح به كل طريقة.**

### `refused.what.outreach_not_enabled`

- en: {name} did not write to this buyer first.
- before: لم تراسله أولًا.
- **after: لم تُرسَل رسالة أولى إلى هذا الشخص.**

### `refused.why.outreach_not_enabled`

- en: You have not said {name} may write first on this one.
- before: لم تقولي بعد إنها تستطيع المبادرة على هذه الطريقة.
- **after: لا إذن منك بعد بالمبادرة عبر هذه الطريقة.**

### `refused.do.outreach_not_enabled`

- en: Turn it on in your connections when you are ready.
- before: شغّليها من صفحة الاتصالات متى كنتِ جاهزة.
- **after: يمكن التشغيل من صفحة الاتصالات عند الاستعداد.**

### `refused.what.suppressed`

- en: Nothing went to this buyer.
- before: لم يصله شيء.
- **after: لم يُرسَل شيء إلى هذا الشخص.**

### `refused.why.suppressed`

- en: They asked you to stop, and that does not expire.
- before: طلب أن تتوقفي، وهذا لا ينتهي بمرور الوقت.
- **after: طُلب إيقاف المراسلة، وهذا الطلب لا ينتهي بمرور الوقت.**

### `refused.do.suppressed`

- en: Leave them be — {name} will still answer if they write to you.
- before: اتركيه وشأنه — وستردّ عليه إن راسلكِ هو.
- **after: لا مراسلة بعد الآن — لكن إن وصلت رسالة من هذا الشخص، فسيأتي ردّ من {name}.**

### `refused.what.no_consent`

- en: {name} did not write to this buyer first.
- before: لم تراسله أولًا.
- **after: لم تُرسَل رسالة أولى إلى هذا الشخص.**

### `refused.why.no_consent`

- en: There is nothing on file saying you may.
- before: لا يوجد في السجل ما يقول إنه يجوز لكِ ذلك.
- **after: لا يوجد في السجل ما يقول إن ذلك جائز.**

### `refused.do.no_consent`

- en: Add how you know them in your contacts, then send again.
- before: أضيفي في جهات الاتصال كيف تعرفينه، ثم أرسلي من جديد.
- **after: يمكن إضافة مناسبة التعارف في جهات الاتصال، ثم إعادة الإرسال.**

### `refused.what.outreach_ceiling`

- en: {name} stopped writing first for today.
- before: توقّفت اليوم عن المبادرة بالكتابة.
- **after: توقّفت المبادرة بالكتابة لهذا اليوم.**

### `refused.why.outreach_ceiling`

- en: You set how many conversations {name} may start in a day, and today's are spent.
- before: حدّدتِ عددًا أقصى لمن تبدأ معهم في اليوم، وقد استُنفد.
- **after: للمبادرات اليومية حدّ أقصى محدَّد منك، وقد استُنفد.**

### `refused.do.outreach_ceiling`

- en: It clears tomorrow, and {name} still replies to everyone who writes.
- before: يعود غدًا، وهي ما زالت تردّ على كل من يراسلكِ.
- **after: يعود غدًا، والردّ مستمر على كل من يراسلك.**

### `domain.none`

- en: {name} sends from no address of yours yet.
- before: لا ترسل بعد من عنوان يخصّكِ.
- **after: لا إرسال بعد من عنوان يخصّك.**

### `unsub.body`

- en: Press the button and nothing will be sent to this address again.
- before: اضغط الزر ولن يُرسَل شيء إلى هذا العنوان بعد الآن.
- **after: عند استخدام الزر، لن يُرسَل شيء إلى هذا العنوان بعد الآن.**

### `unsub.button`

- en: Stop sending to me
- before: أوقفوا الإرسال إليّ
- **after: إيقاف الإرسال إليّ**

### `legal.privacy.intro`

- en: Nomi is the assistant a business uses to answer the people who write to it on Instagram, Facebook Messenger, WhatsApp and e-mail. This page says what is kept when you write to a business that uses it, why, and how to have it removed.
- before: Nomi هو المساعد الذي تستخدمه الشركة للرد على من يكتب إليها عبر إنستغرام وفيسبوك ماسنجر وواتساب والبريد الإلكتروني. تشرح هذه الصفحة ما يُحفظ حين تكتب إلى شركة تستخدمه، ولماذا، وكيف تطلب حذفه.
- **after: Nomi مساعدٌ تستخدمه الشركة للرد على من يكتب إليها عبر إنستغرام وفيسبوك ماسنجر وواتساب والبريد الإلكتروني. تشرح هذه الصفحة ما يُحفظ عند الكتابة إلى شركة تستخدمه، ولماذا، وكيفية طلب حذفه.**

### `legal.privacy.kept.body`

- en: When you send a message to a business that uses Nomi, we keep the message, any picture or file you attach, the name shown on your account, the identifier the platform gives us for your account, and the time it arrived. If the business writes to you by e-mail with your consent, your e-mail address and the messages exchanged are kept in the same way.
- before: حين ترسل رسالة إلى شركة تستخدم Nomi، نحفظ الرسالة، وأي صورة أو ملف ترفقه، والاسم الظاهر على حسابك، والمعرّف الذي تعطيه المنصة لحسابك، ووقت وصولها. وإذا راسلتك الشركة بالبريد الإلكتروني بموافقتك، يُحفظ عنوان بريدك والرسائل المتبادلة بالطريقة نفسها.
- **after: عند إرسال رسالة إلى شركة تستخدم Nomi، نحفظ الرسالة، وأي صورة أو ملف مرفق بها، والاسم الظاهر على حسابك، والمعرّف الذي تعطيه المنصة لحسابك، ووقت وصولها. وإذا راسلتك الشركة بالبريد الإلكتروني بموافقتك، يُحفظ عنوان بريدك والرسائل المتبادلة بالطريقة نفسها.**

### `legal.privacy.who.body`

- en: The business you wrote to, and the services it takes to carry and answer your message:
- before: الشركة التي كتبت إليها، والخدمات اللازمة لنقل رسالتك والرد عليها:
- **after: الشركة التي وصلتها رسالتك، والخدمات اللازمة لنقل رسالتك والرد عليها:**

### `legal.privacy.who.ai`

- en: {processor}, whose language service drafts replies from the text of the conversation. Your message is processed there.
- before: {processor}، خدمتها اللغوية تصوغ الردود من نص المحادثة. رسالتكِ تُعالَج هناك.
- **after: {processor}، خدمتها اللغوية تصوغ الردود من نص المحادثة. رسالتك تُعالَج هناك.**

### `legal.privacy.howLong.body`

- en: For as long as the business uses Nomi, so it can see what was agreed with you — a price, an order, a sample. Ask, and it is removed sooner.
- before: ما دامت الشركة تستخدم Nomi، لتتمكن من الرجوع إلى ما اتُّفق عليه معك: سعر أو طلب أو عيّنة. اطلب الحذف، فيُحذف قبل ذلك.
- **after: ما دامت الشركة تستخدم Nomi، لتتمكن من الرجوع إلى ما اتُّفق عليه معك: سعر أو طلب أو عيّنة. وعند طلب الحذف، يُحذف قبل ذلك.**

### `legal.privacy.choices.body`

- en: You can ask for a copy of what is kept about you, or ask for it to be removed. Every e-mail the business sends carries a link that stops further mail.
- before: يمكنك طلب نسخة مما هو محفوظ عنك، أو طلب حذفه. وكل بريد إلكتروني ترسله الشركة يحمل رابطًا يوقف أي رسائل لاحقة.
- **after: يمكنك طلب نسخة من البيانات المحفوظة عنك، أو طلب حذفها. وكل بريد إلكتروني ترسله الشركة يحمل رابطًا يوقف أي رسائل لاحقة.**

### `legal.privacy.deletionLink`

- en: How to have your data removed
- before: كيف تطلب حذف بياناتك
- **after: كيفية طلب حذف بياناتك**

### `legal.contact.title`

- en: How to reach us
- before: كيف تصل إلينا
- **after: كيفية التواصل معنا**

### `legal.contact.write`

- en: Write to
- before: اكتب إلى
- **after: للمراسلة:**

### `legal.contact.same`

- en: Or send the business a message saying so, from the account you used.
- before: أو أرسل إلى الشركة رسالة بذلك من الحساب نفسه الذي استخدمته.
- **after: أو إرسال رسالة بذلك إلى الشركة من الحساب نفسه المستخدَم في المراسلة.**

### `legal.deletion.step1`

- en: Ask. From the Instagram, Facebook or WhatsApp account you wrote from, send the business a message saying you want your data deleted — or write to the address below from the e-mail address you used.
- before: اطلب. من حساب إنستغرام أو فيسبوك أو واتساب الذي كتبت منه، أرسل إلى الشركة رسالة تقول فيها إنك تريد حذف بياناتك، أو اكتب إلى العنوان أدناه من عنوان البريد الذي استخدمته.
- **after: الطلب: رسالة إلى الشركة من حساب إنستغرام أو فيسبوك أو واتساب الذي جرت منه المراسلة، فيها طلب حذف بياناتك — أو رسالة إلى العنوان أدناه من عنوان البريد المستخدَم في المراسلة.**

### `legal.deletion.step2`

- en: A person at the business receives the request and removes your records by hand — this product deletes nothing on its own. It is done within 30 days, and you are told on the same channel when it is.
- before: يستلم شخص في الشركة طلبكِ ويحذف سجلاتكِ يدويًا — هذا المنتج لا يحذف شيئًا من تلقاء نفسه. يتم ذلك خلال 30 يومًا، وتُبلَّغين على القناة نفسها عند الانتهاء.
- **after: يستلم شخص في الشركة الطلب ويحذف سجلاتك يدويًا — هذا المنتج لا يحذف شيئًا من تلقاء نفسه. يتم ذلك خلال 30 يومًا، ويصل إشعار بالانتهاء على القناة نفسها.**

### `legal.deletion.step3`

- en: What stays: records the business must keep by law, such as an invoice for an order you placed; and the copies Meta itself holds, which you manage in your own Instagram or Facebook settings.
- before: ما يبقى: السجلات التي يلزم الشركة الاحتفاظ بها قانونًا، مثل فاتورة طلب قدّمته؛ والنسخ التي تحتفظ بها Meta نفسها، وتديرها أنت من إعدادات إنستغرام أو فيسبوك الخاصة بك.
- **after: ما يبقى: السجلات التي يلزم الشركة الاحتفاظ بها قانونًا، مثل فاتورة طلب شراء منك؛ والنسخ التي تحتفظ بها Meta نفسها، وإدارتها من إعدادات إنستغرام أو فيسبوك الخاصة بك.**

### `legal.deletion.revoked`

- en: Removing Nomi from your Meta account settings stops new messages from reaching it. It does not remove what was already kept — ask for that here.
- before: إزالة Nomi من إعدادات حساب Meta الخاص بك توقف وصول الرسائل الجديدة إليه، لكنها لا تحذف ما حُفظ من قبل؛ اطلب ذلك هنا.
- **after: إزالة Nomi من إعدادات حساب Meta الخاص بك توقف وصول الرسائل الجديدة إليه، لكنها لا تحذف ما حُفظ من قبل؛ ويمكن طلب ذلك هنا.**

### `legal.terms.service.body`

- en: Nomi answers the people who write to your business on the channels you connect — Instagram, Facebook Messenger, WhatsApp and e-mail — drafts replies from your own catalogue and prices, and keeps the record of what was said. By default every reply waits for a person at your business to approve it; what may be sent without that approval is your decision, and you can take it back at any time.
- before: يرد Nomi على من يكتب إلى شركتك عبر القنوات التي تربطها — إنستغرام وفيسبوك ماسنجر وواتساب والبريد الإلكتروني — ويصوغ الردود من كتالوجك وأسعارك أنت، ويحفظ سجل ما قيل. افتراضيًا ينتظر كل رد موافقة شخص في شركتك؛ وما يجوز له إرساله بنفسه قرارك أنت، ويمكنك سحبه في أي وقت.
- **after: يرد Nomi على من يكتب إلى شركتك عبر القنوات المربوطة — إنستغرام وفيسبوك ماسنجر وواتساب والبريد الإلكتروني — ويصوغ الردود من كتالوجك وأسعارك أنت، ويحفظ سجل ما قيل. افتراضيًا ينتظر كل رد موافقة شخص في شركتك؛ وما يُرسَل دون موافقة مسبقة قرارك أنت، ويمكن سحب ذلك في أي وقت.**

### `legal.terms.yours.title`

- en: What you undertake
- before: ما تتعهد به
- **after: تعهداتك**

### `legal.terms.yours.you1`

- en: You use the channels you connect within their own rules, and you write first only to people who agreed to hear from you.
- before: تستخدم القنوات التي تربطها وفق قواعدها، ولا تراسل أولًا إلا من وافق على أن يسمع منك.
- **after: استخدام القنوات المربوطة وفق قواعدها، وعدم المبادرة بمراسلة أحد إلا من وافق على تلقي رسائل منك.**

### `legal.terms.yours.you2`

- en: The catalogue, prices and facts you give Nomi are yours and are true; Nomi says nothing about your business that you did not put in.
- before: الكتالوج والأسعار والوقائع التي تعطيها لـ Nomi ملكك وصحيحة؛ ولا يقول عن شركتك شيئًا لم تُدخله أنت.
- **after: الكتالوج والأسعار والوقائع المقدَّمة إلى Nomi ملكك وصحيحة؛ ولا يقول Nomi عن شركتك شيئًا لم يُدخَل منك.**

### `legal.terms.yours.you3`

- en: Orders, payments and shipments are confirmed by you. Nomi never concludes a contract in your name.
- before: الطلبات والمدفوعات والشحنات تؤكدها أنت. لا يُبرم Nomi أي عقد باسمك.
- **after: الطلبات والمدفوعات والشحنات يكون تأكيدها منك. لا يُبرم Nomi أي عقد باسمك.**

### `legal.terms.ours.title`

- en: What Nomi undertakes
- before: ما يتعهد به Nomi
- **after: تعهدات Nomi**

### `legal.terms.ours.we1`

- en: A price Nomi quotes comes from your own price list and is never below the floor you set.
- before: السعر الذي يعرضه يأتي من قائمة أسعارك أنت ولا يقل أبدًا عن الحد الأدنى الذي وضعته.
- **after: السعر الذي يعرضه Nomi يأتي من قائمة أسعارك أنت ولا يقل أبدًا عن الحد الأدنى المحدَّد منك.**

### `legal.terms.ours.we3`

- en: When Nomi cannot answer, that is said plainly and the message is held for you; nothing is dropped in silence.
- before: حين لا يستطيع الرد يقول ذلك ويحتفظ بالرسالة لك؛ لا يُسقَط شيء في صمت.
- **after: حين يتعذّر الرد، يُذكر ذلك وتُحفظ الرسالة لك؛ لا يُسقَط شيء في صمت.**

### `legal.terms.ours.we4`

- en: Everything Nomi sends is on the record, so you can see what was said and by whom.
- before: كل ما يرسله مسجّل، فترى ما قيل ومن قاله.
- **after: كل ما يُرسَل مسجّل، فيمكن الاطّلاع على ما قيل ومن قاله.**

### `legal.terms.liability.body`

- en: You are responsible for the business consequences of what you approved. For a fault in Nomi itself, the operator repairs it and tells you plainly what happened; the operator's total liability for any month is capped at what you paid for that month.
- before: أنت مسؤول عن النتائج التجارية لما وافقت عليه. وعن خلل في Nomi نفسه يقوم المشغّل بإصلاحه ويخبرك بوضوح بما حدث؛ ويقتصر مجموع مسؤولية المشغّل عن أي شهر على ما دفعته عن ذلك الشهر.
- **after: المسؤولية عن النتائج التجارية لما حصل على موافقتك تقع عليك. وعن خلل في Nomi نفسه يقوم المشغّل بإصلاحه ويخبرك بوضوح بما حدث؛ ويقتصر مجموع مسؤولية المشغّل عن أي شهر على المبلغ المدفوع منك عن ذلك الشهر.**

### `legal.terms.changes.body`

- en: When these terms change, the date below changes with them, and you are told before a change that narrows what you were promised takes effect.
- before: حين تتغير هذه الشروط يتغير التاريخ أدناه معها، وتُبلَّغ قبل سريان أي تغيير يضيّق ما وُعدت به.
- **after: حين تتغير هذه الشروط يتغير التاريخ أدناه معها، ويصلك إشعار قبل سريان أي تغيير يضيّق الوعود المقدَّمة لك.**

### `domain.intro`

- en: Add these three at whoever holds your domain. Until all three are there, mail from you gets filed as junk — and that damage sticks to the address you have used with buyers for years.
- before: أضيفي هذه الثلاثة عند من يحتفظ بنطاقكِ. وما لم تكتمل، تُصنَّف رسائلكِ كمزعجة — ويلتصق ذلك بالعنوان الذي تستعملينه مع المشترين منذ سنوات.
- **after: يلزم إضافة هذه الثلاثة لدى الجهة التي تحتفظ بنطاقك. وما لم تكتمل، تُصنَّف رسائلك كمزعجة — ويلتصق ذلك بالعنوان المستعمَل مع المشترين منذ سنوات.**

### `domain.record.spf`

- en: Who may send as you
- before: من يجوز له الإرسال باسمكِ
- **after: من يجوز له الإرسال باسمك**

### `domain.record.dkim`

- en: Your signature
- before: توقيعكِ
- **after: توقيعك**

### `domain.check`

- en: Look again
- before: افحصي مرة أخرى
- **after: إعادة الفحص**

### `domain.field.domain`

- en: The address you send from
- before: العنوان الذي ترسلين منه
- **after: عنوان الإرسال**

### `domain.field.selector`

- en: The name on your signature
- before: اسم توقيعكِ
- **after: اسم توقيعك**

### `domain.save`

- en: Save
- before: احفظي
- **after: حفظ**

### `domain.flash.saved`

- en: Saved. Add the three, then look again.
- before: حُفظ. أضيفي الثلاثة ثم افحصي مرة أخرى.
- **after: حُفظ. يلزم إضافة الثلاثة ثم إعادة الفحص.**

### `domain.flash.failed`

- en: That did not save. Try again.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `contacts.canWrite`

- en: {name} can write to them first.
- before: تستطيع أن تراسله أولًا.
- **after: بإمكان {name} المبادرة بمراسلة هذا الشخص.**

### `outreach.on`

- en: {name} may write first here
- before: تستطيع المبادرة هنا
- **after: بإمكان {name} المبادرة هنا**

### `outreach.off`

- en: {name} does not write first here
- before: لا تبادر هنا
- **after: لا مبادرة من {name} هنا**

### `outreach.turnOn`

- en: Let {name} write first
- before: دعيها تبادر بالكتابة
- **after: السماح بالمبادرة بالكتابة**

### `outreach.turnOff`

- en: Stop writing first
- before: أوقفي المبادرة
- **after: إيقاف المبادرة**

### `outreach.warn.whatsapp`

- en: If {name} writes first to someone who never asked to hear from you, WhatsApp can take this number away for good. There is no softer way to say it.
- before: إن بادرت بمراسلة شخص لم يطلب قط أن يصله شيء منكِ، فقد يسحب واتساب هذا الرقم منكِ نهائيًا. ولا توجد صيغة أخفّ من هذه.
- **after: المبادرة بمراسلة شخص لم يطلب قط أن يصله شيء منك قد تدفع واتساب إلى سحب هذا الرقم منك نهائيًا. ولا توجد صيغة أخفّ من هذه.**

### `outreach.flash.on`

- en: {name} may now write first there.
- before: صار بإمكانها المبادرة هناك.
- **after: بإمكان {name} الآن المبادرة هناك.**

### `outreach.flash.off`

- en: {name} will not write first there.
- before: لن تبادر هناك.
- **after: لا مبادرة من {name} هناك بعد الآن.**

### `outreach.flash.failed`

- en: That did not save. Try again.
- before: لم يُحفظ. حاولي مرة أخرى.
- **after: لم يُحفظ. يُرجى المحاولة مرة أخرى.**

### `outreach.cap.hint`

- en: Leave it empty and it stays at {n}.
- before: اتركيه فارغًا ويبقى {n}.
- **after: عند تركه فارغًا يبقى {n}.**

### `outreach.cap.save`

- en: Save
- before: احفظي
- **after: حفظ**

### `people.ownerOnly.outreach`

- en: Letting {name} write to someone first
- before: السماح لها بمراسلة شخص أولًا
- **after: السماح بمراسلة شخص أولًا**

### `reach.instead.comment_to_dm`

- en: A buyer comments on something you posted, and {name} answers them privately.
- before: يعلّق على شيء نشرتِه، فتردّ عليه على انفراد.
- **after: تعليق من المشتري على منشور لك، يليه ردّ من {name} على انفراد.**

### `reach.instead.click_to_whatsapp`

- en: A buyer taps an advert of yours and it opens WhatsApp, with you.
- before: يضغط على إعلان لكِ فيفتح واتساب عندكِ.
- **after: نقرة من المشتري على إعلان لك تفتح واتساب معك مباشرةً.**

### `reach.instead.buyer_writes_first`

- en: A buyer writes first, and {name} answers the usual way.
- before: يراسلكِ أولًا، فتردّ كعادتها.
- **after: المشتري يبادر بالكتابة، فيأتي ردّ {name} كالمعتاد.**

### `contacts.suppress.title`

- en: Never write to {who} again?
- before: ألّا تراسلي {who} مرة أخرى أبدًا؟
- **after: إيقاف مراسلة {who} نهائيًا؟**

### `contacts.write.button`

- en: Write to them
- before: اكتبي إليه
- **after: كتابة رسالة**

### `contacts.write.title`

- en: Write to {who}
- before: اكتبي إلى {who}
- **after: كتابة رسالة إلى {who}**

### `contacts.write.hint`

- en: This is the first thing they hear from you. It goes out in your name, it carries a line they can use to ask you to stop, and it counts towards the most you said you would send in a day.
- before: هذا أول ما يصله منكِ. يخرج باسمكِ، ويحمل سطرًا يستطيع به أن يطلب إيقاف الرسائل، ويُحسب من أكثر عدد قلتِ إنكِ ترسلينه في اليوم.
- **after: هذا أول ما يصل منك. يخرج باسمك، ويحمل سطرًا لطلب إيقاف الرسائل، ويُحسب ضمن الحد الأقصى اليومي المحدَّد منك.**

### `contacts.write.body`

- en: What you want to say
- before: ما تريدين قوله
- **after: النص**

### `contacts.write.send`

- en: Send it
- before: أرسليها
- **after: إرسال**

### `contacts.flash.queued`

- en: On its way. You will find it on their conversation.
- before: في الطريق. ستجدينها في محادثته.
- **after: في الطريق. ستظهر في المحادثة.**

### `contacts.flash.empty`

- en: Write what it is about, and what you want to say.
- before: اكتبي الموضوع وما تريدين قوله.
- **after: يلزم كتابة الموضوع والنص.**

### `contacts.flash.no_channel`

- en: Nothing here can reach that address. Check it, or add them with another one.
- before: لا شيء هنا يصل إلى ذلك العنوان. تحقّقي منه، أو أضيفيه بعنوان آخر.
- **after: لا شيء هنا يصل إلى ذلك العنوان. يُرجى التحقّق منه، أو الإضافة بعنوان آخر.**



## 2026-09-27 — CC-02a: the deletion page, a buyer's deletion request, the deadline alert

**New and rewritten strings, not a pronoun rewording.** `/data-deletion` was rewritten to say what
actually happens (the business records the request, Nomi's operator carries it out within 30 days,
nothing is sent to the buyer by itself); the owner records a buyer's request on the buyer's page;
the operator gets a daily alert as the deadline nears. The entries above for `legal.deletion.*`,
`legal.privacy.howLong.body` and `legal.privacy.choices.body` are superseded by these. Same rules:
nothing genders the reader, the buyer or the assistant; in Arabic, verbal nouns, the passive or
«يمكن / يُرجى». `tests/parity/deletion-page.test.ts` pins the phrases that carry the promises, so
a reviewed rewording may need that file's markers updated in the same commit.

### 中文 — 53 strings

#### `data.buyers.title`

- en: Buyers who asked to be deleted
- **zh: 要求删除数据的买家**

#### `data.buyers.lead`

- en: Each is recorded on the buyer's own page. Nomi's operator carries it out by hand within 30 days of it being recorded. When it shows as done, tell the buyer — Nomi does not write to them about it.
- **zh: 每一条都在该买家自己的页面上记录。Nomi 的运营方在记录后 30 天内由人手动执行。显示为已完成时，请告诉买家——Nomi 不会就此联系对方。**

#### `data.buyers.none`

- en: No buyer has asked yet.
- **zh: 还没有买家提出过。**

#### `data.buyers.due`

- en: Asked {asked} · to be done by {due}
- **zh: {asked} 提出 · 须在 {due} 前完成**

#### `data.buyers.done`

- en: Asked {asked} · done {done}
- **zh: {asked} 提出 · {done} 完成**

#### `data.buyers.asked`

- en: Asked {asked}
- **zh: {asked} 提出**

#### `notify.deletion_due.subject`

- en: Nomi: data deletions are due
- **zh: Nomi：有数据删除要求到期**

#### `notify.deletion_due`

- en: Deletion requests to carry out within 7 days, or already late: {n}.
- **zh: 7 天内必须执行、或已经逾期的删除要求：{n} 条。**

#### `notify.deletion_due.soon`

- en: · {business} — {what} — asked {asked}, due by {due}
- **zh: · {business} — {what} — {asked} 提出，须在 {due} 前执行**

#### `notify.deletion_due.late`

- en: · {business} — {what} — asked {asked}, late since {due}
- **zh: · {business} — {what} — {asked} 提出，自 {due} 起已逾期**

#### `notify.deletion_due.more`

- en: · and {n} more
- **zh: · 另有 {n} 条**

#### `notify.deletion_due.how`

- en: Carry each out as the data deletion runbook says. Until a request is marked done, the business sees it as waiting.
- **zh: 请按数据删除操作手册逐一执行。标记为已完成之前，商家看到的一直是“等待中”。**

#### `conv.deletion.title`

- en: Deleting this buyer's data
- **zh: 删除这位买家的数据**

#### `conv.deletion.lead`

- en: If this buyer asks for their data to be deleted, record it here. Nomi's operator carries it out by hand within 30 days, and it shows here when it is done.
- **zh: 如果这位买家要求删除自己的数据，就在这里记录。Nomi 的运营方会在 30 天内由人手动执行，完成后这里会显示。**

#### `conv.deletion.ask`

- en: Ask for this buyer's data to be deleted
- **zh: 要求删除这位买家的数据**

#### `conv.deletion.erased`

- en: Deleted: who they are on every channel, every message to or from them, the replies, quotes and sample requests prepared for them, notes about their conversations, and the conversations themselves, except what an order needs.
- **zh: 会删除：对方在各个渠道上的身份、双方往来的每一条消息、为对方准备的回复、报价和样品申请、关于这些对话的备注，以及对话本身（订单需要的部分除外）。**

#### `conv.deletion.kept`

- en: Kept: orders they placed, without their contact details or messages; if they asked not to be written to, a note of that address so it is never written to again; and the record of this request.
- **zh: 会保留：对方下过的订单，但不再关联联系方式和消息；如果对方要求过不再联系，保留那个地址的一条记录，确保以后不会再发；以及这次要求本身的记录。**

#### `conv.deletion.tell`

- en: When it is done, it shows here and on Your data. Tell the buyer then — Nomi does not write to them about it.
- **zh: 完成后，这里和「你的数据」页都会显示。到时请你告诉买家——Nomi 不会就此联系对方。**

#### `conv.deletion.note`

- en: How and when did they ask?
- **zh: 买家是怎么、在什么时候提出的？**

#### `conv.deletion.noteHint`

- en: For example: on WhatsApp, 27 September. Kept with the request.
- **zh: 比如：9 月 27 日在 WhatsApp 上提出。会和这条要求一起保存。**

#### `conv.deletion.submit`

- en: Ask for deletion
- **zh: 要求删除**

#### `conv.deletion.open`

- en: Deletion asked for on {asked} — to be carried out by {due}.
- **zh: 已在 {asked} 要求删除——须在 {due} 前执行。**

#### `conv.deletion.takeBack`

- en: Until then it can be taken back, on Your data.
- **zh: 在那之前可以撤回，在「你的数据」页操作。**

#### `conv.deletion.done`

- en: This buyer's data was deleted on {date}.
- **zh: 这位买家的数据已在 {date} 删除。**

#### `conv.deletion.refused`

- en: The deletion asked for on {date} was not carried out.
- **zh: {date} 提出的删除要求没有执行。**

#### `conv.deletion.flash.asked`

- en: Recorded. Nomi's operator carries it out within 30 days, and it shows here when it is done.
- **zh: 已记录。Nomi 的运营方会在 30 天内执行，完成后这里会显示。**

#### `conv.deletion.flash.already_open`

- en: Already asked for, and still waiting. Nothing new was recorded.
- **zh: 已经提出过，还在等待执行。这次没有新记录。**

#### `conv.deletion.flash.note_missing`

- en: Nothing was recorded: say how and when the buyer asked.
- **zh: 没有记录：请写明买家是怎么、在什么时候提出的。**

#### `conv.deletion.flash.note_long`

- en: Nothing was recorded: the note is up to {n} characters.
- **zh: 没有记录：备注最多 {n} 个字。**

#### `legal.deletion.title`

- en: Delete your data
- **zh: 删除你的数据**

#### `legal.deletion.intro`

- en: If you wrote to a business that uses Nomi, you can ask for what it keeps about you through Nomi to be deleted. This page says how that works, what is deleted, and what is kept.
- **zh: 如果你曾写信给使用 Nomi 的商家，可以要求删除该商家通过 Nomi 保存的关于你的内容。这一页说明怎么做、会删除什么、会保留什么。**

#### `legal.deletion.how.title`

- en: How it works
- **zh: 怎么做**

#### `legal.deletion.step1`

- en: You ask the business. Send it a message from the Instagram, Facebook or WhatsApp account you wrote from, or an e-mail from the address you used, saying you want your data deleted.
- **zh: 向商家提出。用你当时写信的 Instagram、Facebook 或 WhatsApp 账号给商家发消息，或用你当时使用的邮箱给商家发邮件，说明你要删除数据。**

#### `legal.deletion.viaUs`

- en: You can also write to us at the address below, and we pass your request on to the business.
- **zh: 也可以写信到下面的地址，我们会把你的要求转给商家。**

#### `legal.deletion.step2`

- en: The business records your request in Nomi.
- **zh: 商家在 Nomi 里记录你的要求。**

#### `legal.deletion.step3`

- en: Nomi's operator, who runs the service for the business, carries out the deletion by hand, within 30 days of the business recording the request.
- **zh: Nomi 的运营方（为商家提供这项服务的一方）在商家记录要求后的 30 天内，由人手动执行删除。**

#### `legal.deletion.step4`

- en: When it is done, the business sees it marked as done in Nomi, and can tell you. Nomi does not write to you about it.
- **zh: 完成后，商家会在 Nomi 里看到这条要求已完成，可以告诉你。Nomi 不会就此另外联系你。**

#### `legal.deletion.erased.title`

- en: What is deleted
- **zh: 会删除的**

#### `legal.deletion.erased.identity`

- en: Who you are on every channel: the name the business saw, your phone number, your e-mail address and your account identifiers.
- **zh: 你在各个渠道上的身份：商家看到的名字、你的电话号码、邮箱地址和账号标识。**

#### `legal.deletion.erased.messages`

- en: Every message between you and the business.
- **zh: 你和商家之间往来的每一条消息。**

#### `legal.deletion.erased.prepared`

- en: Replies, quotes and sample requests prepared for you.
- **zh: 为你准备的回复、报价和样品申请。**

#### `legal.deletion.erased.notes`

- en: Notes and signals about your conversations.
- **zh: 关于你的对话的备注和标记。**

#### `legal.deletion.erased.conversations`

- en: The conversations themselves, except what is needed to keep an order you placed.
- **zh: 对话本身——为保留你下过的订单所必需的部分除外。**

#### `legal.deletion.kept.title`

- en: What is kept
- **zh: 会保留的**

#### `legal.deletion.kept.orders`

- en: Orders you placed — the items, the prices and how each order went — without your contact details or your messages. The business may be required by law to keep them.
- **zh: 你下过的订单——商品、价格和每笔订单的进展——但不再关联你的联系方式和消息。商家可能依法必须保留这些订单。**

#### `legal.deletion.kept.doNotContact`

- en: If you asked not to be written to, a note of that address, so it is never written to again.
- **zh: 如果你要求过不再联系你，会保留那个地址的一条记录，确保以后不会再向这个地址发送任何内容。**

#### `legal.deletion.kept.record`

- en: A record that you asked, and when it was done.
- **zh: 一条记录：你提出过删除要求，以及何时完成。**

#### `legal.deletion.kept.meta`

- en: The copies Meta itself holds, which you manage in your own Instagram or Facebook settings.
- **zh: Meta 自己保存的副本，那部分在你自己的 Instagram 或 Facebook 设置里管理。**

#### `legal.deletion.kept.elsewhere`

- en: Anything the business keeps outside Nomi, such as e-mails in its own mailbox. Deleting those is up to the business; ask it.
- **zh: 商家在 Nomi 之外自己保存的内容，比如商家自己邮箱里的邮件。这些由商家删除，请向商家提出。**

#### `legal.deletion.kept.backups`

- en: Copies inside backups of the whole service. A backup is not changed to remove one person; your data leaves it when that backup is deleted.
- **zh: 整个服务的备份里的副本。备份不会为删除某一个人而修改；你的数据会随该备份被删除而消失。**

#### `legal.updated.privacy`

- en: Last updated 27 September 2026.
- **zh: 最后更新：2026 年 9 月 27 日。**

#### `legal.privacy.howLong.body`

- en: Until the business asks for its records to be deleted, or you ask for yours. They are kept so the business can see what was agreed with you — a price, an order, a sample. What a deletion removes, and what it keeps, is on the deletion page.
- **zh: 保存到商家要求删除自己的记录、或你要求删除你的记录为止。保存是为了让商家能查到和你谈定的内容——价格、订单、样品。删除会去掉什么、保留什么，见删除页面。**

#### `legal.privacy.choices.body`

- en: You can ask the business for a copy of what is kept about you, or ask for it to be deleted as the deletion page describes. Every e-mail the business sends carries a link that stops further mail.
- **zh: 你可以向商家索取一份关于你的保存内容，也可以按删除页面所说要求删除。商家发出的每封邮件都带有一个停止再发的链接。**

### العربية — 53 strings

#### `data.buyers.title`

- en: Buyers who asked to be deleted
- **ar: طلبات حذف بيانات المشترين**

#### `data.buyers.lead`

- en: Each is recorded on the buyer's own page. Nomi's operator carries it out by hand within 30 days of it being recorded. When it shows as done, tell the buyer — Nomi does not write to them about it.
- **ar: يُسجَّل كل طلب في صفحة المشتري. ينفّذه مشغّل Nomi يدويًا خلال 30 يومًا من تسجيله. وعند ظهوره منفَّذًا، يُرجى إبلاغ المشتري، فـNomi لا يراسل المشتري بهذا الشأن.**

#### `data.buyers.none`

- en: No buyer has asked yet.
- **ar: لا طلبات من المشترين حتى الآن.**

#### `data.buyers.due`

- en: Asked {asked} · to be done by {due}
- **ar: طُلب في {asked} · التنفيذ قبل {due}**

#### `data.buyers.done`

- en: Asked {asked} · done {done}
- **ar: طُلب في {asked} · نُفِّذ في {done}**

#### `data.buyers.asked`

- en: Asked {asked}
- **ar: طُلب في {asked}**

#### `notify.deletion_due.subject`

- en: Nomi: data deletions are due
- **ar: Nomi: طلبات حذف بيانات حان موعدها**

#### `notify.deletion_due`

- en: Deletion requests to carry out within 7 days, or already late: {n}.
- **ar: طلبات حذف يلزم تنفيذها خلال 7 أيام، أو تأخّر تنفيذها: {n}.**

#### `notify.deletion_due.soon`

- en: · {business} — {what} — asked {asked}, due by {due}
- **ar: · {business} — {what} — طُلب في {asked}، والتنفيذ قبل {due}**

#### `notify.deletion_due.late`

- en: · {business} — {what} — asked {asked}, late since {due}
- **ar: · {business} — {what} — طُلب في {asked}، ومتأخر منذ {due}**

#### `notify.deletion_due.more`

- en: · and {n} more
- **ar: · و{n} غيرها**

#### `notify.deletion_due.how`

- en: Carry each out as the data deletion runbook says. Until a request is marked done, the business sees it as waiting.
- **ar: يُرجى تنفيذ كل طلب وفق دليل حذف البيانات. وإلى أن يُعلَّم الطلب منفَّذًا، يظهر للشركة في الانتظار.**

#### `conv.deletion.title`

- en: Deleting this buyer's data
- **ar: حذف بيانات هذا المشتري**

#### `conv.deletion.lead`

- en: If this buyer asks for their data to be deleted, record it here. Nomi's operator carries it out by hand within 30 days, and it shows here when it is done.
- **ar: عند طلب حذف بيانات هذا المشتري، يُسجَّل الطلب هنا. ينفّذ مشغّل Nomi الحذف يدويًا خلال 30 يومًا، ويظهر هنا عند التنفيذ.**

#### `conv.deletion.ask`

- en: Ask for this buyer's data to be deleted
- **ar: طلب حذف بيانات هذا المشتري**

#### `conv.deletion.erased`

- en: Deleted: who they are on every channel, every message to or from them, the replies, quotes and sample requests prepared for them, notes about their conversations, and the conversations themselves, except what an order needs.
- **ar: يُحذف: الهوية على كل قناة، وكل رسالة متبادلة، والردود والعروض وطلبات العيّنات المُعدّة، والملاحظات عن المحادثات، والمحادثات نفسها إلا ما يلزم لطلب شراء.**

#### `conv.deletion.kept`

- en: Kept: orders they placed, without their contact details or messages; if they asked not to be written to, a note of that address so it is never written to again; and the record of this request.
- **ar: يبقى: طلبات الشراء المقدَّمة، دون بيانات التواصل ودون الرسائل؛ وملاحظة بالعنوان إن سبق طلب عدم المراسلة، كي لا تُرسَل إليه أي رسالة بعد ذلك؛ وسجلّ هذا الطلب.**

#### `conv.deletion.tell`

- en: When it is done, it shows here and on Your data. Tell the buyer then — Nomi does not write to them about it.
- **ar: عند التنفيذ يظهر ذلك هنا وفي صفحة «بياناتك». عندها يُرجى إبلاغ المشتري، فـNomi لا يراسل المشتري بهذا الشأن.**

#### `conv.deletion.note`

- en: How and when did they ask?
- **ar: كيف ومتى جاء الطلب من المشتري؟**

#### `conv.deletion.noteHint`

- en: For example: on WhatsApp, 27 September. Kept with the request.
- **ar: مثلًا: عبر واتساب في 27 سبتمبر. تُحفظ الملاحظة مع الطلب.**

#### `conv.deletion.submit`

- en: Ask for deletion
- **ar: طلب الحذف**

#### `conv.deletion.open`

- en: Deletion asked for on {asked} — to be carried out by {due}.
- **ar: طُلب الحذف في {asked} — والتنفيذ قبل {due}.**

#### `conv.deletion.takeBack`

- en: Until then it can be taken back, on Your data.
- **ar: حتى ذلك الحين يمكن التراجع عن الطلب من صفحة «بياناتك».**

#### `conv.deletion.done`

- en: This buyer's data was deleted on {date}.
- **ar: حُذفت بيانات هذا المشتري في {date}.**

#### `conv.deletion.refused`

- en: The deletion asked for on {date} was not carried out.
- **ar: لم يُنفَّذ طلب الحذف المقدَّم في {date}.**

#### `conv.deletion.flash.asked`

- en: Recorded. Nomi's operator carries it out within 30 days, and it shows here when it is done.
- **ar: سُجّل الطلب. ينفّذه مشغّل Nomi خلال 30 يومًا، ويظهر هنا عند التنفيذ.**

#### `conv.deletion.flash.already_open`

- en: Already asked for, and still waiting. Nothing new was recorded.
- **ar: الطلب موجود مسبقًا وما زال في الانتظار. لم يُسجَّل شيء جديد.**

#### `conv.deletion.flash.note_missing`

- en: Nothing was recorded: say how and when the buyer asked.
- **ar: لم يُسجَّل شيء: يُرجى ذكر كيف ومتى جاء الطلب من المشتري.**

#### `conv.deletion.flash.note_long`

- en: Nothing was recorded: the note is up to {n} characters.
- **ar: لم يُسجَّل شيء: الملاحظة حتى {n} حرفًا.**

#### `legal.deletion.title`

- en: Delete your data
- **ar: حذف بياناتك**

#### `legal.deletion.intro`

- en: If you wrote to a business that uses Nomi, you can ask for what it keeps about you through Nomi to be deleted. This page says how that works, what is deleted, and what is kept.
- **ar: عند مراسلة شركة تستخدم Nomi، يمكنك طلب حذف ما تحتفظ به تلك الشركة عنك عبر Nomi. تشرح هذه الصفحة طريقة ذلك، وما يُحذف، وما يبقى.**

#### `legal.deletion.how.title`

- en: How it works
- **ar: طريقة الطلب**

#### `legal.deletion.step1`

- en: You ask the business. Send it a message from the Instagram, Facebook or WhatsApp account you wrote from, or an e-mail from the address you used, saying you want your data deleted.
- **ar: الطلب من الشركة: رسالة إليها من حساب إنستغرام أو فيسبوك أو واتساب الذي جرت منه المراسلة، أو بريد إلكتروني من العنوان المستخدَم فيها، فيها طلب حذف بياناتك.**

#### `legal.deletion.viaUs`

- en: You can also write to us at the address below, and we pass your request on to the business.
- **ar: ويمكن أيضًا الكتابة إلينا على العنوان أدناه، فنُحيل الطلب إلى الشركة.**

#### `legal.deletion.step2`

- en: The business records your request in Nomi.
- **ar: تسجّل الشركة الطلب في Nomi.**

#### `legal.deletion.step3`

- en: Nomi's operator, who runs the service for the business, carries out the deletion by hand, within 30 days of the business recording the request.
- **ar: ينفّذ مشغّل Nomi، أي الجهة التي تقدّم الخدمة للشركة، الحذفَ يدويًا خلال 30 يومًا من تسجيل الشركة للطلب.**

#### `legal.deletion.step4`

- en: When it is done, the business sees it marked as done in Nomi, and can tell you. Nomi does not write to you about it.
- **ar: بعد التنفيذ، يظهر الطلب في Nomi لدى الشركة على أنه منفَّذ، ويمكنها إبلاغك بذلك. لا يراسلك Nomi بهذا الشأن.**

#### `legal.deletion.erased.title`

- en: What is deleted
- **ar: ما يُحذف**

#### `legal.deletion.erased.identity`

- en: Who you are on every channel: the name the business saw, your phone number, your e-mail address and your account identifiers.
- **ar: هويتك على كل قناة: الاسم الذي ظهر للشركة، ورقم هاتفك، وعنوان بريدك، ومعرّفات حساباتك.**

#### `legal.deletion.erased.messages`

- en: Every message between you and the business.
- **ar: كل رسالة متبادلة بينك وبين الشركة.**

#### `legal.deletion.erased.prepared`

- en: Replies, quotes and sample requests prepared for you.
- **ar: الردود والعروض وطلبات العيّنات المُعدّة لك.**

#### `legal.deletion.erased.notes`

- en: Notes and signals about your conversations.
- **ar: الملاحظات والإشارات المتعلقة بمحادثاتك.**

#### `legal.deletion.erased.conversations`

- en: The conversations themselves, except what is needed to keep an order you placed.
- **ar: المحادثات نفسها، إلا ما يلزم للاحتفاظ بطلب شراء مقدَّم منك.**

#### `legal.deletion.kept.title`

- en: What is kept
- **ar: ما يبقى**

#### `legal.deletion.kept.orders`

- en: Orders you placed — the items, the prices and how each order went — without your contact details or your messages. The business may be required by law to keep them.
- **ar: طلبات الشراء المقدَّمة منك — الأصناف والأسعار ومسار كل طلب — دون بيانات التواصل معك ودون رسائلك. قد يُلزِم القانون الشركة بالاحتفاظ بها.**

#### `legal.deletion.kept.doNotContact`

- en: If you asked not to be written to, a note of that address, so it is never written to again.
- **ar: إن سبق طلب عدم المراسلة، تبقى ملاحظة بذلك العنوان، كي لا تُرسَل إليه أي رسالة بعد ذلك.**

#### `legal.deletion.kept.record`

- en: A record that you asked, and when it was done.
- **ar: سجلّ بتقديم الطلب وتاريخ تنفيذه.**

#### `legal.deletion.kept.meta`

- en: The copies Meta itself holds, which you manage in your own Instagram or Facebook settings.
- **ar: النسخ التي تحتفظ بها Meta نفسها، وإدارتها من إعدادات إنستغرام أو فيسبوك الخاصة بك.**

#### `legal.deletion.kept.elsewhere`

- en: Anything the business keeps outside Nomi, such as e-mails in its own mailbox. Deleting those is up to the business; ask it.
- **ar: ما تحتفظ به الشركة خارج Nomi، كرسائل البريد في صندوق بريدها. حذف ذلك بيد الشركة، ويمكن طلبه منها.**

#### `legal.deletion.kept.backups`

- en: Copies inside backups of the whole service. A backup is not changed to remove one person; your data leaves it when that backup is deleted.
- **ar: النسخ الموجودة داخل النسخ الاحتياطية للخدمة كلها. لا تُعدَّل النسخة الاحتياطية لإزالة شخص واحد؛ وتزول بياناتك منها بحذف تلك النسخة.**

#### `legal.updated.privacy`

- en: Last updated 27 September 2026.
- **ar: آخر تحديث: 27 سبتمبر 2026.**

#### `legal.privacy.howLong.body`

- en: Until the business asks for its records to be deleted, or you ask for yours. They are kept so the business can see what was agreed with you — a price, an order, a sample. What a deletion removes, and what it keeps, is on the deletion page.
- **ar: إلى أن تطلب الشركة حذف سجلاتها، أو يُطلب حذف سجلاتك. وتُحفظ لتتمكن الشركة من الرجوع إلى ما اتُّفق عليه معك: سعر أو طلب أو عيّنة. وما يحذفه طلب الحذف وما يُبقيه مبيَّن في صفحة الحذف.**

#### `legal.privacy.choices.body`

- en: You can ask the business for a copy of what is kept about you, or ask for it to be deleted as the deletion page describes. Every e-mail the business sends carries a link that stops further mail.
- **ar: يمكنك طلب نسخة من البيانات المحفوظة عنك من الشركة، أو طلب حذفها كما تصف صفحة الحذف. وكل بريد إلكتروني ترسله الشركة يحمل رابطًا يوقف أي رسائل لاحقة.**

## 2026-09-27 — 0075: a deletion request in chat goes to a person

**New strings, not a pronoun rewording.** A buyer who asks in chat for their data to be deleted is
handed to a person and nothing is sent to them; the conversation page names the reason and shows a
card: nothing was sent, why, and where the request is recorded (`staff.deletionAsked` is the line
a sales assistant sees instead). The `sandbox.case.*` lines name the seven new practice cases. Same
rules: nothing genders the reader, the buyer or the assistant; in Arabic, verbal nouns, the passive
or «يمكن / يُرجى». `tests/parity/deletion-handoff-page.test.ts` renders the card in all three languages.

### 中文 — 13 strings

#### `takeover.reason.deletion_requested`

- en: the buyer asked for their data to be deleted
- **zh: 买家要求删除自己的数据**

#### `deletionAsked.title`

- en: A request to delete their data
- **zh: 删除数据的要求**

#### `deletionAsked.what`

- en: {name} sent nothing: no reply and no receipt. A person answers a request like this.
- **zh: {name}什么都没有发：没有回复，也没有回执。这类要求由人来回复。**

#### `deletionAsked.why`

- en: A deletion is recorded on the buyer's page and carried out by Nomi's operator by hand, so nothing about it is promised in the chat.
- **zh: 删除要在买家的页面上记录，再由 Nomi 的运营方手动执行，所以聊天里不会就删除做任何承诺。**

#### `deletionAsked.do`

- en: Record the request on the buyer's page, then answer them yourself
- **zh: 先在买家的页面记录这条要求，再自己回复对方**

#### `staff.deletionAsked`

- en: The owner records the request on the buyer's page. Answer them yourself.
- **zh: 这条要求由老板在买家的页面记录。请你自己回复对方。**

#### `sandbox.case.deletion-request-en-hands-off-silently`

- en: Buyer asks for their data to be deleted (English)
- **zh: 买家要求删除自己的数据（英文）**

#### `sandbox.case.deletion-request-zh-hands-off-silently`

- en: Buyer asks for their data to be deleted (Chinese)
- **zh: 买家要求删除自己的数据（中文）**

#### `sandbox.case.deletion-request-ar-hands-off-silently`

- en: Buyer asks for their data to be deleted (Arabic)
- **zh: 买家要求删除自己的数据（阿拉伯文）**

#### `sandbox.case.deletion-promise-in-a-reply-is-never-sent`

- en: A reply promising to delete their data is never sent
- **zh: 承诺删除数据的回复绝不会发出**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-en`

- en: Buyer asks to delete a line from the quote (English)
- **zh: 买家要删掉报价里的一行（英文）**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-zh`

- en: Buyer asks to delete a line from the quote (Chinese)
- **zh: 买家要删掉报价里的一行（中文）**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-ar`

- en: Buyer asks to delete a line from the quote (Arabic)
- **zh: 买家要删掉报价里的一行（阿拉伯文）**

### العربية — 13 strings

#### `takeover.reason.deletion_requested`

- en: the buyer asked for their data to be deleted
- **ar: طلب المشتري حذف البيانات**

#### `deletionAsked.title`

- en: A request to delete their data
- **ar: طلب حذف البيانات**

#### `deletionAsked.what`

- en: {name} sent nothing: no reply and no receipt. A person answers a request like this.
- **ar: لم يُرسَل أي شيء من {name}: لا ردّ ولا إشعار بالاستلام. الردّ على طلب كهذا يكون من شخص.**

#### `deletionAsked.why`

- en: A deletion is recorded on the buyer's page and carried out by Nomi's operator by hand, so nothing about it is promised in the chat.
- **ar: يُسجَّل الحذف في صفحة المشتري وينفّذه مشغّل Nomi يدويًا، لذلك لا يُقطَع في المحادثة أي وعد بشأنه.**

#### `deletionAsked.do`

- en: Record the request on the buyer's page, then answer them yourself
- **ar: تسجيل الطلب في صفحة المشتري، ثم الردّ مباشرةً**

#### `staff.deletionAsked`

- en: The owner records the request on the buyer's page. Answer them yourself.
- **ar: تسجيل الطلب في صفحة المشتري من شأن مالك الحساب. يُرجى الردّ مباشرةً.**

#### `sandbox.case.deletion-request-en-hands-off-silently`

- en: Buyer asks for their data to be deleted (English)
- **ar: المشتري يطلب حذف البيانات (إنجليزي)**

#### `sandbox.case.deletion-request-zh-hands-off-silently`

- en: Buyer asks for their data to be deleted (Chinese)
- **ar: المشتري يطلب حذف البيانات (صيني)**

#### `sandbox.case.deletion-request-ar-hands-off-silently`

- en: Buyer asks for their data to be deleted (Arabic)
- **ar: المشتري يطلب حذف البيانات (عربي)**

#### `sandbox.case.deletion-promise-in-a-reply-is-never-sent`

- en: A reply promising to delete their data is never sent
- **ar: ردّ يَعِد بحذف البيانات لا يُرسَل أبدًا**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-en`

- en: Buyer asks to delete a line from the quote (English)
- **ar: المشتري يطلب حذف سطر من عرض السعر (إنجليزي)**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-zh`

- en: Buyer asks to delete a line from the quote (Chinese)
- **ar: المشتري يطلب حذف سطر من عرض السعر (صيني)**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-ar`

- en: Buyer asks to delete a line from the quote (Arabic)
- **ar: المشتري يطلب حذف سطر من عرض السعر (عربي)**


## 2026-09-27 — 0076: a deletion request in chat is written down when it arrives

**New strings, and three rewritten** (`deletionAsked.do`, `staff.deletionAsked`, `conv.deletion.lead`,
which supersede their entries above). The deletion hand-off has its own alert (`notify.deletion_requested`,
by e-mail as well as WhatsApp); the request is noted with the hand-off and waits for the owner's decision
on the buyer's page, on Your data, on Today and in its own Buyers tab. Same rules: nothing genders the
reader, the buyer or the assistant; in Arabic, verbal nouns, the passive or «يمكن / يُرجى».
`tests/parity/deletion-record.test.ts` renders them in all three languages.

### 中文 — 21 strings

#### `notify.deletion_requested`

- en: A buyer asked for their data to be deleted. Nothing was sent to them, and it needs an answer from you. The request is noted on the buyer's page, where you decide what happens next.
- **zh: 有买家要求删除自己的数据。没有给对方发任何东西，这需要你来答复。这条要求已记在买家的页面上，下一步在那里决定。**

#### `notify.deletion_requested.subject`

- en: A buyer asked for their data to be deleted
- **zh: 有买家要求删除自己的数据**

#### `deletionAsked.noted`

- en: Noted on {date}. It waits on the buyer's page, on Your data and on Today until you decide; handing the conversation back does not clear it.
- **zh: 已于 {date} 记下。在你决定之前，这条要求会一直留在买家的页面、「你的数据」和「今天」上；把对话交回也不会清掉这条要求。**

#### `deletionAsked.recorded`

- en: Already recorded as a deletion request. Nomi's operator carries it out by {due}.
- **zh: 已经记录为删除要求。Nomi 的运营方会在 {due} 前执行。**

#### `deletionAsked.do`

- en: Decide on the buyer's page, then answer them yourself
- **zh: 先在买家的页面上做决定，再自己回复对方**

#### `staff.deletionAsked`

- en: The owner decides on the buyer's page. Answer them yourself.
- **zh: 由老板在买家的页面上决定。请你自己回复对方。**

#### `conv.deletion.lead`

- en: When this buyer asks in a message for their data to be deleted, the request is usually noted here as it arrives, for you to decide. If they ask another way, record it here. Nomi's operator carries it out by hand within 30 days, and it shows here when it is done.
- **zh: 这位买家在消息里要求删除自己的数据时，这条要求通常一到就会记在这里，由你决定。如果对方是用别的方式提出的，就在这里记录。Nomi 的运营方会在 30 天内由人手动执行，完成后这里会显示。**

#### `conv.deletion.waiting`

- en: Asked in a message on {date}. Nothing has gone to Nomi's operator yet: you decide.
- **zh: {date} 在消息里提出。还没有交给 Nomi 的运营方：由你决定。**

#### `conv.deletion.record`

- en: Record it as a deletion request
- **zh: 记录为删除要求**

#### `conv.deletion.dismiss`

- en: Not a deletion request
- **zh: 不是删除要求**

#### `conv.deletion.dismissHint`

- en: If it was not a request to delete their data, set it aside. Nothing is deleted, and nothing is sent to them.
- **zh: 如果这其实不是删除数据的要求，就放到一边。不会删除任何东西，也不会给对方发任何消息。**

#### `conv.deletion.flash.recordedAsk`

- en: Recorded, dated from when they asked. Nomi's operator carries it out by {due}, and it shows here when it is done.
- **zh: 已记录，日期按对方提出的时间算。Nomi 的运营方会在 {due} 前执行，完成后这里会显示。**

#### `conv.deletion.flash.dismissed`

- en: Set aside: not a deletion request. Nothing was deleted or sent.
- **zh: 已放到一边：不是删除要求。没有删除任何东西，也没有发出任何消息。**

#### `conv.deletion.flash.not_waiting`

- en: Nothing changed: that request was already decided.
- **zh: 没有改动：这条要求已经处理过了。**

#### `data.ask.state.waiting`

- en: Needs your decision
- **zh: 等你决定**

#### `data.buyers.waiting`

- en: Asked in a message on {asked} · waiting for your decision
- **zh: {asked} 在消息里提出 · 等你决定**

#### `data.buyers.fromChat`

- en: A request made in a message is usually listed here as it arrives, and waits until you decide on the buyer's page.
- **zh: 在消息里提出的要求，通常一到就会列在这里，等你在买家的页面上决定。**

#### `ops.card.deletionAsks`

- en: Asked for their data to be deleted
- **zh: 要求删除数据**

#### `buyers.group.deletion`

- en: Asked for their data to be deleted
- **zh: 要求删除数据的买家**

#### `inbox.filter.deletion`

- en: Deletion requests
- **zh: 删除要求**

#### `inbox.empty.deletion`

- en: No buyer is waiting for your decision about deleting their data.
- **zh: 没有等你决定的删除数据要求。**

### العربية — 21 strings

#### `notify.deletion_requested`

- en: A buyer asked for their data to be deleted. Nothing was sent to them, and it needs an answer from you. The request is noted on the buyer's page, where you decide what happens next.
- **ar: وصل طلب من أحد المشترين بحذف البيانات. لم يُرسَل أي شيء إلى المشتري، والأمر يحتاج إلى ردّ منك. الطلب مسجَّل في صفحة المشتري، وهناك يُتَّخذ القرار التالي.**

#### `notify.deletion_requested.subject`

- en: A buyer asked for their data to be deleted
- **ar: طلب حذف بيانات من أحد المشترين**

#### `deletionAsked.noted`

- en: Noted on {date}. It waits on the buyer's page, on Your data and on Today until you decide; handing the conversation back does not clear it.
- **ar: سُجِّل في {date}. ويبقى في صفحة المشتري وفي «بياناتك» وفي «اليوم» إلى أن يُتَّخذ القرار، ولا تمحوه إعادة المحادثة.**

#### `deletionAsked.recorded`

- en: Already recorded as a deletion request. Nomi's operator carries it out by {due}.
- **ar: سُجِّل بالفعل كطلب حذف، وينفّذه مشغّل Nomi قبل {due}.**

#### `deletionAsked.do`

- en: Decide on the buyer's page, then answer them yourself
- **ar: اتخاذ القرار في صفحة المشتري، ثم الردّ مباشرةً**

#### `staff.deletionAsked`

- en: The owner decides on the buyer's page. Answer them yourself.
- **ar: القرار في صفحة المشتري لمالك الحساب. يُرجى الردّ مباشرةً.**

#### `conv.deletion.lead`

- en: When this buyer asks in a message for their data to be deleted, the request is usually noted here as it arrives, for you to decide. If they ask another way, record it here. Nomi's operator carries it out by hand within 30 days, and it shows here when it is done.
- **ar: عند طلب هذا المشتري في رسالةٍ حذفَ البيانات، يُسجَّل الطلب هنا عادةً فور وصوله ليُتَّخذ القرار بشأنه. وإن جاء الطلب بطريقة أخرى، يُسجَّل هنا. ينفّذ مشغّل Nomi الحذف يدويًا خلال 30 يومًا، ويظهر هنا عند التنفيذ.**

#### `conv.deletion.waiting`

- en: Asked in a message on {date}. Nothing has gone to Nomi's operator yet: you decide.
- **ar: طُلب ذلك في رسالة بتاريخ {date}، ولم يُحَل شيء إلى مشغّل Nomi بعد: القرار لك.**

#### `conv.deletion.record`

- en: Record it as a deletion request
- **ar: تسجيله كطلب حذف**

#### `conv.deletion.dismiss`

- en: Not a deletion request
- **ar: ليس طلب حذف**

#### `conv.deletion.dismissHint`

- en: If it was not a request to delete their data, set it aside. Nothing is deleted, and nothing is sent to them.
- **ar: إن لم يكن طلبًا لحذف البيانات، يمكن تنحيته جانبًا. لا يُحذف شيء، ولا يُرسَل أي شيء إلى المشتري.**

#### `conv.deletion.flash.recordedAsk`

- en: Recorded, dated from when they asked. Nomi's operator carries it out by {due}, and it shows here when it is done.
- **ar: سُجِّل الطلب بتاريخ وروده، وينفّذه مشغّل Nomi قبل {due}، ويظهر هنا عند التنفيذ.**

#### `conv.deletion.flash.dismissed`

- en: Set aside: not a deletion request. Nothing was deleted or sent.
- **ar: نُحِّي الطلب جانبًا: ليس طلب حذف. لم يُحذف شيء ولم يُرسَل شيء.**

#### `conv.deletion.flash.not_waiting`

- en: Nothing changed: that request was already decided.
- **ar: لم يتغيّر شيء: سبق اتخاذ قرار بشأن هذا الطلب.**

#### `data.ask.state.waiting`

- en: Needs your decision
- **ar: بانتظار القرار**

#### `data.buyers.waiting`

- en: Asked in a message on {asked} · waiting for your decision
- **ar: طُلب في رسالة بتاريخ {asked} · بانتظار القرار**

#### `data.buyers.fromChat`

- en: A request made in a message is usually listed here as it arrives, and waits until you decide on the buyer's page.
- **ar: الطلب المقدَّم في رسالة يُدرَج هنا عادةً فور وصوله، ويبقى بانتظار القرار في صفحة المشتري.**

#### `ops.card.deletionAsks`

- en: Asked for their data to be deleted
- **ar: طلبات حذف البيانات**

#### `buyers.group.deletion`

- en: Asked for their data to be deleted
- **ar: طلبات حذف البيانات**

#### `inbox.filter.deletion`

- en: Deletion requests
- **ar: طلبات الحذف**

#### `inbox.empty.deletion`

- en: No buyer is waiting for your decision about deleting their data.
- **ar: لا توجد طلبات حذف بيانات بانتظار القرار.**

## 2026-09-28 — A: Buyers and Customers are one list; the V1 close-out

**New strings, and some rewritten.** Customers merged into Buyers: one list with a search box
and pages (`buyers.search.*`, `buyers.page.*`), and a heading for the group a colleague holds
(`buyers.group.team`). One word for one idea: the buyer's page no longer says "customer"
(`conv.file.title`, `conv.notFound`), and in Arabic the word for a buyer on the rows and in the
transcript is مشترٍ, as in the nav (`common.buyer`, which was عميل, "customer"). The Arabic
Needs-you heading is the tab's own noun phrase (`buyers.group.needsYou`: the verb it had
agreed with the buyers). Same rules: nothing genders the reader, the buyer or the assistant; in
Arabic, verbal nouns, a noun phrase, or «يمكن». `tests/parity/buyers-merge.test.ts` renders them
in all three languages. Removed with Customers, and so not listed: `conv.title`, `conv.back`,
`conv.search.*`, `conv.empty.*`, `conv.lastContact`, `buyers.all.link`, `nav.conversations`.

### 中文 — 15 strings

#### `buyers.tabs`

- en: Which buyers to show
- **zh: 显示哪些买家**

#### `buyers.group.team`

- en: Your team is handling
- **zh: 团队在处理**

#### `buyers.search.label`

- en: Find a buyer
- **zh: 找买家**

#### `buyers.search.placeholder`

- en: Name, number or product
- **zh: 名字、号码或产品**

#### `buyers.search.go`

- en: Find
- **zh: 找**

#### `buyers.search.clear`

- en: Clear
- **zh: 清除**

#### `buyers.search.found`

- en: {n} found for “{q}”
- **zh: 按「{q}」找到 {n} 位**

#### `buyers.search.none`

- en: Nobody found for “{q}”.
- **zh: 没有找到「{q}」。**

#### `buyers.search.noneBody`

- en: Try part of a name, a phone number or a product.
- **zh: 换个名字、号码的一部分或产品再试试。**

#### `buyers.page.nav`

- en: Pages
- **zh: 翻页**

#### `buyers.page.prev`

- en: Previous page
- **zh: 上一页**

#### `buyers.page.next`

- en: Next page
- **zh: 下一页**

#### `buyers.page.position`

- en: {from}–{to} of {total}
- **zh: 第 {from}–{to} 位，共 {total} 位**

#### `conv.file.title`

- en: About this buyer
- before: 客户档案
- **zh: 关于这位买家**

#### `conv.notFound`

- en: Buyer not found
- before: 找不到这位客户
- **zh: 找不到这位买家**

### العربية — 17 strings

#### `buyers.tabs`

- en: Which buyers to show
- **ar: عرض المشترين**

#### `buyers.group.team`

- en: Your team is handling
- **ar: في عهدة فريقك**

#### `buyers.search.label`

- en: Find a buyer
- **ar: البحث عن مشترٍ**

#### `buyers.search.placeholder`

- en: Name, number or product
- **ar: الاسم أو الرقم أو المنتج**

#### `buyers.search.go`

- en: Find
- **ar: بحث**

#### `buyers.search.clear`

- en: Clear
- **ar: مسح**

#### `buyers.search.found`

- en: {n} found for “{q}”
- **ar: نتائج «{q}»: {n}**

#### `buyers.search.none`

- en: Nobody found for “{q}”.
- **ar: لا نتائج لـ«{q}».**

#### `buyers.search.noneBody`

- en: Try part of a name, a phone number or a product.
- **ar: يمكن تجربة جزء من الاسم أو رقم الهاتف أو المنتج.**

#### `buyers.page.nav`

- en: Pages
- **ar: الصفحات**

#### `buyers.page.prev`

- en: Previous page
- **ar: الصفحة السابقة**

#### `buyers.page.next`

- en: Next page
- **ar: الصفحة التالية**

#### `buyers.page.position`

- en: {from}–{to} of {total}
- **ar: {from} إلى {to} من {total}**

#### `conv.file.title`

- en: About this buyer
- before: ملف العميل
- **ar: عن المشتري**

#### `conv.notFound`

- en: Buyer not found
- before: العميل غير موجود
- **ar: المشتري غير موجود**

#### `buyers.group.needsYou`

- en: Needs you
- before: يحتاجون إليك
- **ar: بحاجة إليك**

#### `common.buyer`

- en: Buyer
- before: عميل
- **ar: مشترٍ**

## 2026-09-28 — CC-26: the line a page shows when something new arrives

**New strings.** A conversation, Buyers and Today now learn, while they are open, that something
new arrived — a buyer's message, a reply waiting for review, the conversation changing hands, a
change to the list or to what needs the owner — and say so in one quiet line at the foot of the
page. The whole line is the door to the newest (a tap reloads the page there), so each string is a
door's label: no closing full stop, like every other door. Same rules: nothing genders the reader,
the buyer or the assistant (`{name}` is the conversation's own assistant, or "your assistant" /
你的助手 / مساعدك); in Arabic, noun phrases only. `tests/parity/live-refresh.test.ts` renders them in
all three languages; the screenshots are in `docs/design/live-refresh/`.

### 中文 — 5 strings

#### `live.message`

- en: New message from the buyer
- **zh: 买家发来了新消息**

#### `live.reply`

- en: A new reply from {name} is waiting for you
- **zh: {name}写好了一条新回复，在等你看**

#### `live.changed`

- en: This conversation has changed
- **zh: 这个对话有变化**

#### `live.list`

- en: This list has changed
- **zh: 列表有变化**

#### `live.today`

- en: What needs your attention has changed
- **zh: 需要你处理的事有变化**

### العربية — 5 strings

#### `live.message`

- en: New message from the buyer
- **ar: رسالة جديدة من المشتري**

#### `live.reply`

- en: A new reply from {name} is waiting for you
- **ar: ردّ جديد من {name} بانتظارك**

#### `live.changed`

- en: This conversation has changed
- **ar: تغييرات في هذه المحادثة**

#### `live.list`

- en: This list has changed
- **ar: تغييرات في هذه القائمة**

#### `live.today`

- en: What needs your attention has changed
- **ar: تغييرات فيما يحتاج انتباهك**

## 2026-09-28 — the audit close-out: the skip link, and a question before anything goes (CC-20, CC-29)

**New strings.** One is the skip link every owner page now starts with (CC-20): it takes a keyboard or a
screen reader past the five nav entries to the page. The other eighteen are the questions the product asks
before an action that takes something away — a fact archived, a word or a closure removed, a channel or a
mailbox disconnected, writing first switched on or off, a sequence stopped, a request taken back — or that lets
{name} do something alone (CC-29). Each is read in the browser's own confirm box, so each is a question, short,
and says what goes and whether it comes back. Same rules: nothing genders the reader, the buyer or the assistant
(`{name}` is the name the owner chose, or "your assistant" / 你的助手 / مساعدك); in Arabic, verbal nouns and the
passive only.
`tests/parity/audit-closeout.test.ts` renders them in all three languages.

### 中文 — 19 strings

#### `shell.skip`

- en: Skip to content
- **zh: 跳到正文**

#### `employee.actions.grantConfirm`

- en: Let {name} handle “{cap}” without you? Replies of this kind stop waiting for your OK. You can revoke it at any time.
- **zh: 给「{cap}」放权？这类事{name}会自己做，不再等你点头。你随时可以收回。**

#### `employee.actions.revokeConfirm`

- en: Revoke “{cap}”? From now on, each one waits for your OK.
- **zh: 收回「{cap}」？以后每一条都要等你点头。**

#### `knowledge.archive.confirm`

- en: Archive “{label}”? {name} stops using it with buyers. You can teach it again at any time.
- **zh: 归档「{label}」？{name}回答买家时不再用这一条。你随时可以重新教。**

#### `reach.inbound.disconnectConfirm`

- en: Disconnect {page}? Nothing from that Page or Instagram reaches you until you connect again.
- **zh: 断开{page}？在你重新连接之前，这个主页和 Instagram 的消息都不会到你这里。**

#### `outreach.turnOnConfirm`

- en: Let {name} write first on {channel}? You can stop it here at any time.
- **zh: 让{name}在{channel}上先开口？你随时可以在这里停下。**

#### `outreach.turnOffConfirm`

- en: Stop {name} writing first on {channel}? Nothing new is started there until you allow it again.
- **zh: 让{name}在{channel}上别再先开口？在你重新允许之前，那里不会再先开口。**

#### `seq.enrolment.stopConfirm`

- en: Stop this sequence for {who}? Nothing more from it is sent to them.
- **zh: 对{who}停下这组邮件？后面的邮件都不会再发给对方。**

#### `seq.archive.confirm`

- en: Take this sequence out of use? It stops for everyone still receiving it, and stays here to read.
- **zh: 停用这组邮件？还在收的人都会停下，内容仍留在这里可以看。**

#### `contacts.archive.confirm`

- en: Take {who} off your list? They can be added again later.
- **zh: 把{who}从名单里去掉？以后可以再加回来。**

#### `prospects.key.removeConfirm`

- en: Remove the Apollo key? Searching stops until a key is added again.
- **zh: 删掉 Apollo 密钥？再加密钥之前不能搜索。**

#### `channel.action.disconnectConfirm`

- en: Disconnect WhatsApp? {name} cannot receive or send messages there until you tap Reconnect.
- **zh: 断开 WhatsApp？在你点「重新连接」之前，{name}在那里收不到也发不出消息。**

#### `connect.action.disconnectConfirm`

- en: Disconnect {address}? No e-mail leaves until an account is connected again.
- **zh: 断开{address}？再连接一个账户之前不会发出任何邮件。**

#### `forbidden.removeConfirm`

- en: Remove “{term}” from the words {name} must never use?
- **zh: 把「{term}」从{name}绝对不能说的话里去掉？**

#### `closures.removeConfirm`

- en: Remove “{label}”? {name} may promise dates that run through those days again.
- **zh: 去掉「{label}」？{name}又可能承诺落在那几天里的日期。**

#### `prices.volume.removeConfirm`

- en: Stop offering this discount? It will not be offered to buyers any more.
- **zh: 不再给这个优惠？之后不会再向买家提出。**

#### `data.deletion.withdrawConfirm`

- en: Take back your request to have everything deleted? Nothing will be deleted.
- **zh: 撤回删除全部数据的请求？不会删除任何东西。**

#### `data.buyers.withdrawConfirm`

- en: Take this buyer's request back? Nothing of theirs will be deleted.
- **zh: 撤回这个买家的请求？对方的数据都不会被删除。**

#### `conv.deletion.dismissConfirm`

- en: Set this aside as not a request to delete their data? It stops waiting for your decision.
- **zh: 确定这不是删除数据的要求？这一条之后不再等你决定。**

### العربية — 19 strings

#### `shell.skip`

- en: Skip to content
- **ar: الانتقال إلى المحتوى**

#### `employee.actions.grantConfirm`

- en: Let {name} handle “{cap}” without you? Replies of this kind stop waiting for your OK. You can revoke it at any time.
- **ar: منح «{cap}»؟ بعد المنح يُنجز هذا دون انتظارك، ويمكن السحب في أي وقت.**

#### `employee.actions.revokeConfirm`

- en: Revoke “{cap}”? From now on, each one waits for your OK.
- **ar: سحب «{cap}»؟ من الآن ينتظر كل ردّ من هذا النوع موافقتك.**

#### `knowledge.archive.confirm`

- en: Archive “{label}”? {name} stops using it with buyers. You can teach it again at any time.
- **ar: أرشفة «{label}»؟ يتوقف استخدام ذلك في الردود على المشترين، ويمكن إضافته من جديد في أي وقت.**

#### `reach.inbound.disconnectConfirm`

- en: Disconnect {page}? Nothing from that Page or Instagram reaches you until you connect again.
- **ar: فصل {page}؟ لا يصلك شيء من تلك الصفحة أو إنستغرام حتى إعادة الربط.**

#### `outreach.turnOnConfirm`

- en: Let {name} write first on {channel}? You can stop it here at any time.
- **ar: السماح لـ {name} بالمبادرة بالكتابة على {channel}؟ يمكن الإيقاف من هنا في أي وقت.**

#### `outreach.turnOffConfirm`

- en: Stop {name} writing first on {channel}? Nothing new is started there until you allow it again.
- **ar: إيقاف مبادرة {name} بالكتابة على {channel}؟ لا مبادرة هناك حتى السماح بها من جديد.**

#### `seq.enrolment.stopConfirm`

- en: Stop this sequence for {who}? Nothing more from it is sent to them.
- **ar: إيقاف الإرسال إلى {who}؟ لا تُرسل أي رسالة أخرى من هذه السلسلة.**

#### `seq.archive.confirm`

- en: Take this sequence out of use? It stops for everyone still receiving it, and stays here to read.
- **ar: إيقاف استخدام هذه السلسلة؟ يتوقف الإرسال للجميع، وتبقى هنا للقراءة.**

#### `contacts.archive.confirm`

- en: Take {who} off your list? They can be added again later.
- **ar: إزالة {who} من القائمة؟ يمكن الإضافة إلى القائمة من جديد لاحقًا.**

#### `prospects.key.removeConfirm`

- en: Remove the Apollo key? Searching stops until a key is added again.
- **ar: حذف مفتاح Apollo؟ يتوقف البحث حتى يُضاف مفتاح من جديد.**

#### `channel.action.disconnectConfirm`

- en: Disconnect WhatsApp? {name} cannot receive or send messages there until you tap Reconnect.
- **ar: قطع اتصال واتساب؟ لا تصل رسائل جديدة إلى {name} ولا يُرسل شيء هناك حتى «إعادة الاتصال».**

#### `connect.action.disconnectConfirm`

- en: Disconnect {address}? No e-mail leaves until an account is connected again.
- **ar: فصل {address}؟ لن يخرج أي بريد حتى يُربط حساب من جديد.**

#### `forbidden.removeConfirm`

- en: Remove “{term}” from the words {name} must never use?
- **ar: حذف «{term}» من الكلمات الممنوعة في ردود {name}؟**

#### `closures.removeConfirm`

- en: Remove “{label}”? {name} may promise dates that run through those days again.
- **ar: إزالة «{label}»؟ قد يُذكر من جديد موعد يمرّ خلال تلك الأيام.**

#### `prices.volume.removeConfirm`

- en: Stop offering this discount? It will not be offered to buyers any more.
- **ar: إيقاف هذا العرض؟ لا يُعرض على المشترين بعد الآن.**

#### `data.deletion.withdrawConfirm`

- en: Take back your request to have everything deleted? Nothing will be deleted.
- **ar: التراجع عن طلب حذف كل شيء؟ لن يُحذف شيء.**

#### `data.buyers.withdrawConfirm`

- en: Take this buyer's request back? Nothing of theirs will be deleted.
- **ar: التراجع عن هذا الطلب؟ لن يُحذف شيء من بيانات هذا المشتري.**

#### `conv.deletion.dismissConfirm`

- en: Set this aside as not a request to delete their data? It stops waiting for your decision.
- **ar: تنحية هذا الطلب جانبًا لأنه ليس طلب حذف؟ لن يبقى بانتظار القرار بعد ذلك.**

## 2026-09-28 — 0078: choosing a password from a one-time link

**New strings.** `tools/add-login.mjs` gives a workspace that exists a login and prints a one-time
link; the owner opens it on the door (`/login/set-password`) and chooses the password there. The
page says which account it is for, asks for the new password twice, and — when the link was used,
lapsed or never existed — says one thing for all three. After saving, the sign-in page says the
password is saved, with the e-mail filled in. Same rules: nothing genders the reader; in Arabic,
verbal nouns for the buttons and «يُرجى» / «يمكن» for sentences; the Chinese success line names
the new password instead of 它. `tests/parity/add-login.test.ts` renders the page in all three.

### 中文 — 12 strings

#### `setpw.title`

- en: Choose your password
- **zh: 设置你的密码**

#### `setpw.lead`

- en: For {email}.
- **zh: 账号：{email}**

#### `setpw.password`

- en: New password
- **zh: 新密码**

#### `setpw.repeat`

- en: The same password again
- **zh: 再输入一次**

#### `setpw.submit`

- en: Save my password
- **zh: 保存密码**

#### `setpw.gone`

- en: This link has already been used, or it has expired. Ask whoever sent it for a new one.
- **zh: 这个链接已经用过，或者已经过期。请找发链接给你的人要一个新的。**

#### `setpw.toLogin`

- en: Sign in instead
- **zh: 直接登录**

#### `setpw.problem.short`

- en: At least {n} characters.
- **zh: 至少 {n} 个字符。**

#### `setpw.problem.long`

- en: At most {n} characters.
- **zh: 最多 {n} 个字符。**

#### `setpw.problem.mismatch`

- en: The two passwords are not the same.
- **zh: 两次输入的密码不一样。**

#### `setpw.problem.is_email`

- en: Choose something other than your e-mail address.
- **zh: 密码不能和邮箱地址一样。**

#### `login.passwordSet`

- en: Your password is saved. Sign in with it.
- **zh: 密码已保存，请用新密码登录。**

### العربية — 12 strings

#### `setpw.title`

- en: Choose your password
- **ar: اختيار كلمة المرور**

#### `setpw.lead`

- en: For {email}.
- **ar: للحساب {email}.**

#### `setpw.password`

- en: New password
- **ar: كلمة المرور الجديدة**

#### `setpw.repeat`

- en: The same password again
- **ar: كلمة المرور مرة أخرى**

#### `setpw.submit`

- en: Save my password
- **ar: حفظ كلمة المرور**

#### `setpw.gone`

- en: This link has already been used, or it has expired. Ask whoever sent it for a new one.
- **ar: هذا الرابط مستخدَم من قبل أو انتهت صلاحيته. يُرجى طلب رابط جديد ممّن أرسله.**

#### `setpw.toLogin`

- en: Sign in instead
- **ar: تسجيل الدخول بدلًا من ذلك**

#### `setpw.problem.short`

- en: At least {n} characters.
- **ar: {n} أحرف على الأقل.**

#### `setpw.problem.long`

- en: At most {n} characters.
- **ar: {n} حرفًا على الأكثر.**

#### `setpw.problem.mismatch`

- en: The two passwords are not the same.
- **ar: كلمتا المرور غير متطابقتين.**

#### `setpw.problem.is_email`

- en: Choose something other than your e-mail address.
- **ar: يُرجى اختيار كلمة مرور غير عنوان البريد الإلكتروني.**

#### `login.passwordSet`

- en: Your password is saved. Sign in with it.
- **ar: تم حفظ كلمة المرور. يمكن تسجيل الدخول بها الآن.**

## 2026-09-28 — buyer-facing Arabic: «مساعد آلي», and nobody addressed in a gender

**Changed strings, at the owner's direction.** The assistant is «مساعد آلي» (an automated
assistant) wherever a buyer reads what it is — never «ذكي» ("smart"), a compliment rather than a
kind. And buyer-facing Arabic addresses the buyer in neither gender (rule 6). Every buyer-facing
Arabic string was read (the catalogue's `legal.*`, `unsub.*` and `proof.*`, the disclosure, and
the three fixed replies of the fast path — 103 in all); three changed. The two outside the catalogue
are listed here too, because a buyer reads them. `tests/parity/buyer-arabic.test.ts` holds all of it.

### العربية — 3 strings

#### `legal.privacy.ai` (the privacy page)

- en: Replies here are drafted by an AI assistant, …
- **ar: الردود هنا يصوغها مساعد آلي، وبحسب إعدادات الشركة قد تصلك بعض الردود دون أن يراجعها شخص أولًا. ويمكنك طلب التحدث مع شخص في أي وقت أثناء المحادثة.**

#### the disclosure (`src/core/conversation/disclosure.ts`)

- en: Hi, I'm {name}, {business}'s AI assistant. If you'd like a person from our team, just say so and they'll reply as soon as they can.
- **ar: مرحبًا، أنا {name}، مساعد آلي لدى {business}. للتحدث مع شخص من فريقنا يكفي طلب ذلك، ويصل الرد في أقرب وقت ممكن.**

#### the fast path's "product confirmed" reply (`src/core/conversation/fastpath.ts`)

- en: Great — glad we're on the same page. Now, roughly how many pieces are you looking at?
- **ar: ممتاز، نعم هذا هو المنتج. ما الكمية المطلوبة تقريبًا؟**


## 2026-09-29 → 30 — the roadmap run (#122–#141): every new or changed line

Everything the run added to the zh and ar catalogue, for the native readers to take in one sitting with the screenshots. The design direction's §9 counted about 40 lines for the design pass alone; the run's other features added the rest.

**Not a gate**, except where a line belongs to a disclosure. Those lines live in `src/core/conversation/disclosure.ts`, not here.

A counted sentence is shown once, with each form its language uses: Chinese has one, Arabic six (zero, one, two, few, many, other). `{n}` is the count, `{name}` the assistant's name.

For the Arabic reader to confirm:
- The month names are kept as they are: سبتمبر (readers in the Levant say أيلول).
- Arabic pages keep Western digits.
- Money now reads in the locale's own form, "1.95 US$" (#139).

Reviewer: ______  Date: ______

### 中文 — 278 lines

#### `accounts.after`

- en: After the Page is connected.
- **zh: 连接主页之后。**

#### `accounts.afterReconnect`

- en: After connecting again.
- **zh: 重新连接之后。**

#### `accounts.help`

- en: What to check
- **zh: 要检查什么**

#### `accounts.instagram`

- en: Instagram linked to the Page
- **zh: 和主页关联的 Instagram**

#### `accounts.instagram.bad`

- en: No Instagram professional account is linked to this Page, so Instagram messages cannot arrive.
- **zh: 这个主页没有关联 Instagram 专业账号，所以收不到 Instagram 消息。**

#### `accounts.instagram.done`

- en: Linked: {account}.
- **zh: 已关联：{account}。**

#### `accounts.lead`

- en: Each step is read from Meta, and from the messages received, when this page opens.
- **zh: 打开这个页面时，每一步都从 Meta 和收到的消息里读出来。**

#### `accounts.mark.bad`

- en: needs you
- **zh: 需要你处理**

#### `accounts.mark.done`

- en: done
- **zh: 已完成**

#### `accounts.mark.todo`

- en: not yet
- **zh: 还没有**

#### `accounts.mark.unknown`

- en: could not check
- **zh: 暂时查不到**

#### `accounts.page`

- en: A Facebook Page you manage
- **zh: 你管理的 Facebook 主页**

#### `accounts.page.done`

- en: Connected: {page}.
- **zh: 已连接：{page}。**

#### `accounts.page.todo`

- en: Not connected yet: connect it on the Instagram or Messenger card above.
- **zh: 还没连接：在上面的 Instagram 或 Messenger 卡片里连接。**

#### `accounts.permissions`

- en: Every permission granted
- **zh: 所有权限都已授予**

#### `accounts.permissions.bad`

- en: Meta did not grant: {missing}. Connect again and leave every box ticked.
- **zh: Meta 没有授予：{missing}。请重新连接，并保持所有选项都勾选。**

#### `accounts.permissions.done`

- en: All the permissions asked for were granted.
- **zh: 要求的权限都已授予。**

#### `accounts.subscribed`

- en: The Page sends its messages here
- **zh: 主页把消息发到这里**

#### `accounts.subscribed.bad`

- en: No: the Page is not subscribed, so its messages stay in its own inbox. Connect again.
- **zh: 没有：主页没有订阅，消息只会留在主页那边。请重新连接。**

#### `accounts.test`

- en: A first message from another account
- **zh: 从另一个账号发来的第一条消息**

#### `accounts.test.on`

- en: First on {channel}: {date}.
- **zh: {channel} 第一条：{date}。**

#### `accounts.test.todo`

- en: Send the shop a message from another account; it shows here when it arrives.
- **zh: 用另一个账号给店铺发一条消息，收到后会显示在这里。**

#### `accounts.title`

- en: Your Facebook Page and Instagram
- **zh: 你的 Facebook 主页和 Instagram**

#### `accounts.token`

- en: Meta still accepts the connection
- **zh: Meta 仍然接受这个连接**

#### `accounts.token.bad`

- en: No. Connect again; until then nothing is sent on Instagram or Messenger.
- **zh: 不接受了。请重新连接；在那之前，Instagram 和 Messenger 上什么都发不出去。**

#### `accounts.unknown`

- en: Meta did not answer just now; it is asked again when this page opens.
- **zh: Meta 暂时没有回应；下次打开这个页面时会再查。**

#### `accounts.yes`

- en: Yes.
- **zh: 是的。**

#### `buyers.badge.order`

- en: Order waiting
- **zh: 订单等你确认**

#### `buyers.group.order`

- en: Said yes to an order
- **zh: 确认要下单的客户**

#### `calendar.add`

- en: Add a date
- **zh: 添加日期**

#### `calendar.add.day`

- en: Date
- **zh: 日期**

#### `calendar.add.from`

- en: From
- **zh: 从**

#### `calendar.add.hint`

- en: Leave the times empty for the whole day.
- **zh: 不填时间就是全天。**

#### `calendar.add.save`

- en: Add
- **zh: 添加**

#### `calendar.add.to`

- en: To
- **zh: 到**

#### `calendar.add.what`

- en: What
- **zh: 事项**

#### `calendar.cat.promised`

- en: Promised
- **zh: 答应过的**

#### `calendar.cat.yours`

- en: Your dates
- **zh: 你的日程**

#### `calendar.empty.day`

- en: Nothing is dated this day.
- **zh: 这一天没有日期。**

#### `calendar.empty.month`

- en: Nothing is dated this month.
- **zh: 这个月没有日期。**

#### `calendar.empty.week`

- en: Nothing is dated this week.
- **zh: 这一周没有日期。**

#### `calendar.flash.added`

- en: Added to the calendar.
- **zh: 已加到日程上。**

#### `calendar.flash.day`

- en: Not added: that is not a date.
- **zh: 没有添加：这不是一个日期。**

#### `calendar.flash.notFound`

- en: Nothing was taken off: that date is not on the calendar.
- **zh: 没有移除：日程上没有这一项。**

#### `calendar.flash.order`

- en: Not added: it ends before it starts.
- **zh: 没有添加：结束时间早于开始时间。**

#### `calendar.flash.removed`

- en: Taken off the calendar.
- **zh: 已从日程上移除。**

#### `calendar.flash.time`

- en: Not added: a time is written as 09:30, and an end needs a start.
- **zh: 没有添加：时间写成 09:30，有结束时间就要有开始时间。**

#### `calendar.flash.title`

- en: Not added: a date needs a name, up to 80 characters.
- **zh: 没有添加：需要一个名称，最多 80 个字。**

#### `calendar.kind.closure`

- en: Closed
- **zh: 休息**

#### `calendar.kind.conversation_closed`

- en: Conversation closed
- **zh: 对话结束**

#### `calendar.kind.followup_due`

- en: Follow-up
- **zh: 跟进**

#### `calendar.kind.order_state`

- en: Order
- **zh: 订单**

#### `calendar.kind.own`

- en: Your date
- **zh: 你的日程**

#### `calendar.kind.price_worked_out`

- en: Price worked out
- **zh: 算出报价**

#### `calendar.kind.promise_delivery`

- en: Delivery promised
- **zh: 答应交货**

#### `calendar.kind.promise_follow_up`

- en: Follow-up promised
- **zh: 答应跟进**

#### `calendar.kind.promise_price_end`

- en: Price ends
- **zh: 报价到期**

#### `calendar.kind.reply_due`

- en: Reply due
- **zh: 待回复**

#### `calendar.kind.sample_asked`

- en: Sample asked
- **zh: 要样品**

#### `calendar.kind.sample_handled`

- en: Sample dealt with
- **zh: 样品已处理**

#### `calendar.legend.dashed`

- en: Added by you
- **zh: 你添加的**

#### `calendar.legend.solid`

- en: From a conversation
- **zh: 来自对话**

#### `calendar.line.promise`

- en: “{said}”
- **zh: 「{said}」**

#### `calendar.more`

- en: {n} more
- **zh: 还有 {n} 项**

#### `calendar.move`

- en: Earlier and later
- **zh: 往前和往后**

#### `calendar.next`

- en: Later
- **zh: 往后**

#### `calendar.prev`

- en: Earlier
- **zh: 往前**

#### `calendar.remove`

- en: Remove
- **zh: 移除**

#### `calendar.remove.confirm`

- en: Take “{title}” off the calendar?
- **zh: 把「{title}」从日程上移除？**

#### `calendar.todayDoor`

- en: Today
- **zh: 今天**

#### `calendar.view.day`

- en: Day
- **zh: 日**

#### `calendar.view.list`

- en: List
- **zh: 列表**

#### `calendar.view.month`

- en: Month
- **zh: 月**

#### `calendar.view.week`

- en: Week
- **zh: 周**

#### `calendar.views`

- en: Month, week, day or list
- **zh: 按月、周、日或列表看**

#### `card.asked`

- en: {customer} asked · {channel} · {time}
- **zh: {customer} 在 {channel} 上问 · {time}**

#### `card.checked`

- en: checked twice
- **zh: 两次核对**

#### `card.checked.differs`

- en: read two ways
- **zh: 两种理解**

#### `card.checked.differsOn`

- en: a second, separate reading differed on {fields}
- **zh: 另一套独立的判断在{fields}上不同**

#### `card.checked.same`

- en: a second, separate reading found the same
- **zh: 另一套独立的判断得出相同的结果**

#### `card.closingIn`

- en: {channel} takes replies for {left} more
- **zh: {channel} 还能回复 {left}**

#### `card.closingSoon`

- en: Closing soon
- **zh: 快到期了**

#### `card.customer`

- en: The customer
- **zh: 客户**

#### `card.drafted`

- en: {name} drafted
- **zh: {name} 起草**

#### `card.edit`

- en: Edit
- **zh: 修改**

#### `card.field.complaint`

- en: whether it is a complaint
- **zh: 是否投诉**

#### `card.field.language`

- en: the language
- **zh: 语言**

#### `card.field.phase`

- en: the stage of the sale
- **zh: 销售阶段**

#### `card.field.product`

- en: the product
- **zh: 产品**

#### `card.field.quantity`

- en: the quantity
- **zh: 数量**

#### `card.goes`

- en: goes on {channel}, as written
- **zh: 按原样发到 {channel}**

#### `card.handToMe`

- en: Hand to me
- **zh: 我来回复**

#### `card.intent.complaint`

- en: a complaint
- **zh: 投诉**

#### `card.intent.inquiry`

- en: a question
- **zh: 咨询**

#### `card.intent.order_intent`

- en: ready to order
- **zh: 想下单**

#### `card.intent.out_of_scope`

- en: not about what you sell
- **zh: 与生意无关**

#### `card.intent.price_request`

- en: a price question
- **zh: 问价**

#### `card.intent.product_search`

- en: looking for a product
- **zh: 找产品**

#### `card.intent.unclear`

- en: not clear yet
- **zh: 还不清楚**

#### `card.noReply`

- en: No reply needed
- **zh: 不用回复**

#### `card.reasons`

- en: How {name} read this
- **zh: {name} 是怎么理解的**

#### `card.reasons.count` (counted)

- en: {n} reason / {n} reasons
- **zh: {n} 条依据**

#### `card.reply`

- en: Reply
- **zh: 回复**

#### `card.source.discount`

- en: a discount your rules allow
- **zh: 你的规则允许的折扣**

#### `card.source.lead_time`

- en: the days you need before it ships
- **zh: 你设定的出货前天数**

#### `card.source.minimum`

- en: the smallest quantity you sell
- **zh: 你设定的最少数量**

#### `card.source.price`

- en: your price for {product}
- **zh: 你给{product}定的价**

#### `card.source.priceAny`

- en: your price
- **zh: 你定的价**

#### `card.source.product`

- en: one of your product names
- **zh: 你的产品名之一**

#### `card.source.taught`

- en: something you taught
- **zh: 你教过的内容**

#### `card.source.their_words`

- en: in their own words
- **zh: 对方的原话**

#### `card.source.total`

- en: the total, at your prices
- **zh: 按你的价格算出的总价**

#### `card.source.unsourced`

- en: no source found
- **zh: 找不到出处**

#### `card.sourced`

- en: Every figure has a source
- **zh: 每个数字都有出处**

#### `card.understood`

- en: Understood
- **zh: 理解为**

#### `card.unsourced`

- en: Not every figure has a source
- **zh: 有数字找不到出处**

#### `card.waiting`

- en: Waiting for you
- **zh: 在等你**

#### `card.window`

- en: {channel} takes replies until {time}
- **zh: {time} 前可在 {channel} 回复**

#### `forgot.lead`

- en: Type the e-mail you sign in with. A link to choose a new password goes there; it works for {minutes} minutes.
- **zh: 填写你登录用的邮箱。设置新密码的链接会发到这个邮箱，{minutes} 分钟内有效。**

#### `forgot.mail.body`

- en: A new password was asked for {email} on Nomi.

To choose one, open this link within {minutes} minutes:
{link}

If it was not you, ignore this e-mail: the password stays as it is.
- **zh: 有人为 {email} 申请了新的 Nomi 密码。

请在 {minutes} 分钟内打开下面的链接设置新密码：
{link}

如果不是你申请的，请忽略这封邮件，密码不会改变。**

#### `forgot.mail.subject`

- en: Choose a new password for Nomi
- **zh: 设置你的 Nomi 新密码**

#### `forgot.sent`

- en: If {email} signs in to Nomi, a link to choose a new password is on its way. It works for {minutes} minutes. Nothing arrived? Look in spam, or ask again in a few minutes.
- **zh: 如果 {email} 是 Nomi 的登录邮箱，设置新密码的链接已经发出，{minutes} 分钟内有效。没收到？看看垃圾邮件，或者过几分钟再试。**

#### `forgot.submit`

- en: E-mail me a link
- **zh: 把链接发给我**

#### `forgot.title`

- en: Choose a new password
- **zh: 设置新密码**

#### `help.meta.back`

- en: Channels
- **zh: 渠道**

#### `help.meta.checkLabel`

- en: Check:
- **zh: 检查：**

#### `help.meta.connect.check`

- en: The Channels page says Meta still accepts it. If not, connect again with the same Facebook account.
- **zh: 渠道页面显示 Meta 仍然接受这个连接。如果不接受，用同一个 Facebook 账号重新连接。**

#### `help.meta.connect.title`

- en: Meta still accepts the connection
- **zh: Meta 仍然接受这个连接**

#### `help.meta.connect.why`

- en: A changed password, a removed Page role or a withdrawn permission ends the connection. Then nothing is sent on Instagram or Messenger, and the page says why.
- **zh: 修改密码、移除主页角色或撤回权限都会结束连接。之后 Instagram 和 Messenger 上什么都发不出去，页面会说明原因。**

#### `help.meta.instagram.check`

- en: The Instagram account is a professional account (business or creator), linked to that Page.
- **zh: Instagram 账号是专业账号（商家或创作者），并且和这个主页关联。**

#### `help.meta.instagram.title`

- en: Instagram linked to the Page
- **zh: 和主页关联的 Instagram**

#### `help.meta.instagram.why`

- en: Meta gives an app Instagram messages only for a professional account linked to a Page.
- **zh: Meta 只会把关联了主页的专业账号的 Instagram 消息交给应用。**

#### `help.meta.lead`

- en: What to check at each step, and why. The Channels page shows which steps are done; for where to click, Meta’s own help pages are linked.
- **zh: 每一步要检查什么，以及为什么。渠道页面会显示哪些步骤已完成；具体在哪里点，链接到 Meta 自己的帮助页面。**

#### `help.meta.link.createPage`

- en: Meta’s help: create a Facebook Page
- **zh: Meta 帮助：创建 Facebook 主页**

#### `help.meta.link.linkPage`

- en: Meta’s help: connect Instagram and a Facebook Page
- **zh: Meta 帮助：关联 Instagram 和 Facebook 主页**

#### `help.meta.link.professional`

- en: Meta’s help: set up a professional Instagram account
- **zh: Meta 帮助：设置 Instagram 专业账号**

#### `help.meta.page.check`

- en: The shop has a Facebook Page, and you manage it with full control.
- **zh: 店铺有 Facebook 主页，而且你有完全的管理权限。**

#### `help.meta.page.title`

- en: A Facebook Page you manage
- **zh: 你管理的 Facebook 主页**

#### `help.meta.page.why`

- en: Messenger messages arrive at the Page and replies leave as the Page; Instagram is reached through the Page it is linked to.
- **zh: Messenger 的消息发到主页，回复也以主页的名义发出；Instagram 通过关联的主页连接。**

#### `help.meta.permissions.check`

- en: In the Facebook window that opens when connecting, leave every box ticked.
- **zh: 连接时弹出的 Facebook 窗口里，保持所有选项都勾选。**

#### `help.meta.permissions.title`

- en: Every permission granted
- **zh: 所有权限都已授予**

#### `help.meta.permissions.why`

- en: Each one allows one thing: seeing the Page, receiving and answering Messenger messages, receiving and answering Instagram messages. Without one of them, those messages never arrive.
- **zh: 每项权限对应一件事：看到主页、接收和回复 Messenger 消息、接收和回复 Instagram 消息。少了任何一项，那些消息就永远到不了。**

#### `help.meta.rules.first`

- en: {name} cannot write first on Instagram or Messenger: the customer starts.
- **zh: {name}不能在 Instagram 或 Messenger 上先发消息：要由客户先开始。**

#### `help.meta.rules.media`

- en: Shared posts and mentions in stories come to you, named, and are not answered.
- **zh: 分享的帖子和快拍里的提及会交给你处理，并注明是什么。**

#### `help.meta.rules.title`

- en: What works on Instagram and Messenger
- **zh: Instagram 和 Messenger 上能做什么**

#### `help.meta.rules.window`

- en: {name} can reply for 24 hours after the customer’s last message. After that, reply in the Instagram or Messenger app.
- **zh: 客户最后一条消息后的 24 小时内，{name}可以回复。之后请在 Instagram 或 Messenger 应用里回复。**

#### `help.meta.subscription.check`

- en: Nothing to do: connecting subscribes the Page. If the Channels page says it is not subscribed, connect again.
- **zh: 不需要做什么：连接时会为主页订阅。如果渠道页面显示没有订阅，就重新连接。**

#### `help.meta.subscription.title`

- en: The Page sends its messages here
- **zh: 主页把消息发到这里**

#### `help.meta.subscription.why`

- en: Without it, Meta keeps the messages in the Page’s own inbox and they never reach {name}.
- **zh: 没有订阅，Meta 会把消息留在主页那边，永远到不了{name}这里。**

#### `help.meta.test.check`

- en: From a different account (a friend’s, or a personal one), send the shop a message on Instagram and on Messenger. On Instagram, the setting “Allow access to messages”, under Connected tools in the app’s message settings, must be on.
- **zh: 用另一个账号（朋友的或个人的）在 Instagram 和 Messenger 上给店铺发一条消息。Instagram 里，消息设置中“已连接的工具”下的“允许访问消息”必须打开。**

#### `help.meta.test.title`

- en: A first message from another account
- **zh: 从另一个账号发来的第一条消息**

#### `help.meta.test.why`

- en: It proves the whole road, including the one Instagram setting nobody can read from outside: the first message arriving is the proof.
- **zh: 这能证明整条路是通的，包括那个从外部读不到的 Instagram 设置：第一条消息到了，就证明设置好了。**

#### `help.meta.title`

- en: Connecting a Facebook Page and Instagram
- **zh: 连接 Facebook 主页和 Instagram**

#### `help.meta.whyLabel`

- en: Why:
- **zh: 原因：**

#### `inbox.draft.held.order_waits_for_owner`

- en: This customer said yes to an order that is waiting for you, so every reply waits for you too.
- **zh: 这位客户确认的订单在等你，所以每条回复也先等你。**

#### `inbox.flash.empty`

- en: Nothing went: the reply box was empty.
- **zh: 没有发出：回复框是空的。**

#### `insight.draftsWaiting` (counted)

- en: {n} reply is written and waiting for you. / {n} replies are written and waiting for you.
- **zh: {n}条回复已经写好，等你。**

#### `insight.followUpsWaiting` (counted)

- en: {n} follow-up e-mail is waiting for you to check your inbox. / {n} follow-up e-mails are waiting for you to check your inbox.
- **zh: {n}封跟进邮件在等你先看一眼邮箱。**

#### `insight.productsNoPrice` (counted)

- en: {n} product has no price yet, so {name} cannot quote it. / {n} products have no price yet, so {name} cannot quote them.
- **zh: {n}个产品还没有价格，客户问到也只能先记着。**

#### `insight.uncertainSends` (counted)

- en: {n} message may or may not have reached a customer. / {n} messages may or may not have reached a customer.
- **zh: {n}条消息不确定有没有送到客户手上。**

#### `live.channels`

- en: Something changed on your channels
- **zh: 渠道有变化**

#### `live.notify.ask`

- en: Tell me in this browser when an order waits
- **zh: 有订单等我确认时，在这个浏览器里提醒我**

#### `live.notify.on`

- en: This browser will tell you when an order waits, while Nomi is open in a tab.
- **zh: 只要 Nomi 在某个标签页里开着，这个浏览器会在有订单等你时提醒你。**

#### `login.forgot`

- en: Forgot your password?
- **zh: 忘记密码？**

#### `login.withEmail`

- en: Sign in with your e-mail
- **zh: 用邮箱登录**

#### `nav.conversations`

- en: Conversations
- **zh: 对话**

#### `nav.customers`

- en: Customers
- **zh: 客户**

#### `nav.needsYou` (counted)

- en: {n} customer needs you / {n} customers need you
- **zh: {n} 位客户在等你**

#### `notify.meta_errors`

- en: Workspaces where Meta refused or lost many messages in the last 24 hours: {n}.
- **zh: 过去 24 小时里，Meta 拒收或丢失了大量消息的工作台：{n} 个。**

#### `notify.meta_errors.how`

- en: One app carries every workspace’s Instagram and Messenger, so a workspace sending into errors can get it restricted for all of them. Look at what it sends. Its daily limit is set with tools/send-ceiling.mjs; the emergency switch silences every workspace.
- **zh: 所有工作台的 Instagram 和 Messenger 都走同一个应用，一个工作台不断发出被拒的消息，可能让所有工作台一起被限制。先看看这个工作台在发什么。每天的上限用 tools/send-ceiling.mjs 设置；紧急开关会让所有工作台停止发送。**

#### `notify.meta_errors.line`

- en: · {business} — {failed} of {attempted} refused or lost ({errors})
- **zh: · {business} — {attempted} 条里有 {failed} 条被拒收或丢失（{errors}）**

#### `notify.meta_errors.more`

- en: · and {n} more
- **zh: · 还有 {n} 个**

#### `notify.meta_errors.subject`

- en: Nomi: Meta is refusing messages
- **zh: Nomi：Meta 正在拒收消息**

#### `notify.order_proposed`

- en: A customer said yes to an order. Nothing was confirmed and nothing was sent to them: the order waits for you. Open the conversation to confirm it, or to answer them yourself.
- **zh: 有客户确认要下单。订单还没有确认，也没有给对方发任何消息：订单在等你。打开对话，确认订单，或者自己回复对方。**

#### `notify.order_proposed.subject`

- en: A customer said yes to an order
- **zh: 有客户确认要下单**

#### `order.action.confirm`

- en: Confirm the order
- **zh: 确认订单**

#### `order.action.stepIn`

- en: I'll answer them
- **zh: 我来回复**

#### `order.action.stepIn.note`

- en: Sets the order aside and gives you the conversation. Nothing is sent.
- **zh: 先放下这个订单，对话交给你。不会发出任何消息。**

#### `order.card.email`

- en: E-mail
- **zh: 邮箱**

#### `order.card.intro`

- en: Nothing is confirmed and nothing has been sent. When you confirm, the order is recorded and they are sent the message below.
- **zh: 还没有确认，也没有发出任何消息。你确认后，订单才会记下，并把下面这条消息发给对方。**

#### `order.card.reference`

- en: (its reference, given when you confirm)
- **zh: （确认后生成的订单号）**

#### `order.card.terms`

- en: Payment terms
- **zh: 付款条件**

#### `order.card.title`

- en: They said yes to this order
- **zh: 对方确认了这个订单**

#### `order.card.willSend`

- en: What they will be sent
- **zh: 将发给对方的消息**

#### `order.flash.already_decided`

- en: This order was already decided.
- **zh: 这个订单已经处理过了。**

#### `order.flash.assistant_silenced`

- en: Sending is paused while we look into something, so the order still waits: nothing was recorded or sent.
- **zh: 我们在查一件事，暂时停了发送，订单仍在等你：没有记下，也没有发出。**

#### `order.flash.assistant_stopped`

- en: Sending is stopped on every channel, so the order still waits: nothing was recorded or sent.
- **zh: 所有渠道的发送都已停下，订单仍在等你：没有记下，也没有发出。**

#### `order.flash.confirmed`

- en: Order confirmed. They are being sent the confirmation.
- **zh: 订单已确认，正在把确认消息发给对方。**

#### `order.flash.confirmedNotLive`

- en: Order recorded. Nothing was sent: sending is not switched on here yet.
- **zh: 订单已记下。这里还没开通发送，所以没有发出任何东西。**

#### `order.flash.incomplete`

- en: This order cannot be recorded as it stands: its product or price is no longer there. Answer them yourself.
- **zh: 这个订单无法按原样记下：产品或价格已经不在了。请你自己回复对方。**

#### `order.flash.not_found`

- en: That order is no longer waiting.
- **zh: 这个订单已经不在等待中。**

#### `order.flash.set_aside`

- en: The order is set aside, and the conversation is yours.
- **zh: 订单先放下了，对话交给你。**

#### `pane.label`

- en: Conversations
- **zh: 对话**

#### `panel.act.alone`

- en: {name} replied
- **zh: {name} 回复了**

#### `panel.act.draft_sent`

- en: You sent {name}’s draft
- **zh: 你发出了{name}的草稿**

#### `panel.act.edit_sent`

- en: You sent your version of {name}’s draft
- **zh: 你改过后发出了{name}的草稿**

#### `panel.act.not_reached.assistant`

- en: {name}’s reply didn’t reach them
- **zh: {name}的回复没有送达**

#### `panel.act.not_reached.person`

- en: Your reply didn’t reach them
- **zh: 你的回复没有送达**

#### `panel.act.owner`

- en: You answered yourself
- **zh: 你自己回复了**

#### `panel.act.waiting`

- en: Waiting for you
- **zh: 在等你**

#### `panel.activity`

- en: Activity
- **zh: 动态**

#### `panel.askedAbout`

- en: Asked about
- **zh: 问过**

#### `panel.close`

- en: Close
- **zh: 关闭**

#### `panel.conversations` (counted)

- en: {n} conversation / {n} conversations
- **zh: {n} 段对话**

#### `panel.details`

- en: Their details, their data
- **zh: 联系方式与数据**

#### `panel.firstWrote`

- en: First wrote {date}
- **zh: {date} 第一次来信**

#### `panel.label`

- en: The customer
- **zh: 客户**

#### `panel.now`

- en: now
- **zh: 现在**

#### `panel.onCalendar`

- en: On the calendar
- **zh: 日程上**

#### `panel.onRecord`

- en: On record
- **zh: 记录**

#### `panel.open`

- en: The customer
- **zh: 客户**

#### `panel.order`

- en: Order {reference}
- **zh: 订单 {reference}**

#### `panel.priceDoor`

- en: the conversation
- **zh: 那段对话**

#### `panel.prices`

- en: Prices worked out
- **zh: 算过的价**

#### `panel.promised`

- en: Promised
- **zh: 答应过的事**

#### `panel.sample`

- en: Sample
- **zh: 样品**

#### `panel.sampleAsked`

- en: asked {date}
- **zh: {date} 申请**

#### `panel.sampleHandled`

- en: dealt with {date}
- **zh: {date} 已处理**

#### `panel.times` (counted)

- en: once / {n} times
- **zh: {n} 次**

#### `panel.writesIn`

- en: writes in {language}
- **zh: 用{language}写**

#### `people.flash.renamed`

- en: Saved. Everyone here sees {name} now.
- **zh: 已保存。现在大家看到的是{name}。**

#### `people.name.askThem`

- en: This is your business's name, not a person's. What is the right name here?
- **zh: 这是公司名，不是人名。这里该写什么名字？**

#### `people.name.askYou`

- en: Your name here is your business's name. What should the people here call you?
- **zh: 你在这里的名字就是公司名。同事们该怎么称呼你？**

#### `people.name.save`

- en: Save the name
- **zh: 保存名字**

#### `people.ownerOnly.data_rights`

- en: Record a customer's request to have their data deleted
- **zh: 登记客户删除资料的请求**

#### `product.add.example3`

- en: Rose face serum 50 ml $34.90
- **zh: 玫瑰精华 50 ml $34.90**

#### `product.detail.notFindable`

- en: Customers cannot find this product yet: it has no name their messages can be matched to. Add the names customers use below, and it can be found and quoted.
- **zh: 买家还搜不到这个产品：没有能和买家消息对上的名称。在下面加上买家的叫法，就能被找到并报价。**

#### `product.edit.customerNames`

- en: Add names customers use
- **zh: 添加买家的叫法**

#### `product.edit.customerNames.hint`

- en: One per line. The product is found by any of them; the names already here stay.
- **zh: 每行一个。买家用其中任何一个说法都能找到这个产品；已有的叫法会保留。**

#### `product.edit.error.too_long`

- en: Too long: a name can have at most 120 characters.
- **zh: 太长了：每个名称最多 120 个字符。**

#### `product.edit.error.too_many`

- en: At most 20 names at a time.
- **zh: 一次最多添加 20 个名称。**

#### `product.edit.moq.hint`

- en: Leave it empty if there is no minimum.
- **zh: 没有最低起订量就留空。**

#### `product.edit.name`

- en: Name
- **zh: 名称**

#### `product.edit.nameZh`

- en: Name in Chinese
- **zh: 中文名称**

#### `product.noMinimum`

- en: No minimum
- **zh: 无最低起订量**

#### `product.photo.refused.cut_off`

- en: The page is too long to read in one photo, so nothing was added. Send it as two photos — the top half, then the bottom half.
- **zh: 这一页太长，一张照片读不完，所以什么都没加。请分成两张照片发：上半页一张，下半页一张。**

#### `product.reject.ambiguous_price`

- en: the price can be read two ways — write it like 1250.00
- **zh: 价格有两种读法，请写成 1250.00 这样**

#### `product.reject.not_usd`

- en: only US dollars for now — this line has another currency
- **zh: 目前只认美元，这行是别的货币**

#### `product.reject.several_numbers`

- en: several numbers and none marked as the price — put $ before it
- **zh: 这行有好几个数字，没标出哪个是价格，请在价格前加 $**

#### `product.status.notFindable`

- en: Customers cannot find it yet
- **zh: 买家还搜不到这个产品**

#### `received.shared_post`

- en: A shared post
- **zh: 分享的帖子**

#### `received.story_mention`

- en: A mention in their story
- **zh: 在对方快拍里提到你**

#### `received.story_reply`

- en: A reply to your story
- **zh: 对你快拍的回复**

#### `sandbox.case.order-yes-waits-for-the-owner-in-auto`

- en: A "yes" to an order waits for your tap — nothing is sent
- **zh: 客户确认下单后，订单等你确认——不会发出任何消息**

#### `sandbox.inv.answeredAsUsual`

- en: Answered as usual — nothing to hand over
- **zh: 照常回答，不必交给人**

#### `sandbox.inv.certOnlyIfAuthorized`

- en: Named only the certifications you hold
- **zh: 只提你真有的认证**

#### `sandbox.inv.deletionHandsOffSilently`

- en: A deletion request went to you, and nothing was sent
- **zh: 删除请求交给了你，没有发出任何消息**

#### `sandbox.inv.neverDeniesBeingAi`

- en: Never claimed to be a person
- **zh: 从不自称是真人**

#### `sandbox.inv.noDeletionPromise`

- en: Promised no deletion
- **zh: 没有承诺删除资料**

#### `sandbox.inv.noUnsourcedSpecNumber`

- en: Every figure came from your products, the quote or the customer
- **zh: 每个数字都有出处：你的产品、报价或客户**

#### `sandbox.inv.orderWaitsForOwner`

- en: The order waited for your tap
- **zh: 订单在等你确认**

#### `setup.state.connected`

- en: Connected
- **zh: 已连接**

#### `setup.state.done`

- en: Done
- **zh: 已完成**

#### `setup.state.notAnswered`

- en: Not answered yet
- **zh: 还没选**

#### `setup.state.notConnected`

- en: Nothing connected yet
- **zh: 还没连接**

#### `setup.state.people` (counted)

- en: {n} person / {n} people
- **zh: {n} 人**

#### `setup.state.toDo`

- en: Not finished
- **zh: 还没填完**

#### `today.blocked` (counted)

- en: {n} message did not reach a customer / {n} messages did not reach customers
- **zh: {n} 条消息没送到客户手上**

#### `today.coming.all`

- en: The calendar
- **zh: 日历**

#### `today.coming.none`

- en: Nothing on the calendar in the next seven days.
- **zh: 接下来七天日历上没有安排。**

#### `today.coming.title`

- en: Coming up
- **zh: 接下来**

#### `today.deletion` (counted)

- en: {n} customer asked for their data to be deleted / {n} customers asked for their data to be deleted
- **zh: {n} 位客户要求删除自己的资料**

#### `today.gaps` (counted)

- en: {n} question {name} could not answer / {n} questions {name} could not answer
- **zh: {n} 个{name}答不上来的问题**

#### `today.last.answered` (counted)

- en: {name} answered {n} customer / {name} answered {n} customers
- **zh: {name}回复了 {n} 位客户**

#### `today.last.handed` (counted)

- en: {name} handed {n} customer to you / {name} handed {n} customers to you
- **zh: {name}把 {n} 位客户交给了你**

#### `today.last.none`

- en: Nothing in the last 24 hours yet.
- **zh: 过去 24 小时里还没有动静。**

#### `today.last.sent` (counted)

- en: You sent {n} reply {name} wrote / You sent {n} replies {name} wrote
- **zh: 你发出了 {n} 条{name}写的回复**

#### `today.last.title`

- en: In the last 24 hours
- **zh: 过去 24 小时**

#### `today.last.yourself` (counted)

- en: You answered {n} customer yourself / You answered {n} customers yourself
- **zh: 你亲自回复了 {n} 位客户**

#### `today.needs.all` (counted)

- en: The {n} who needs you / All {n} who need you
- **zh: 全部 {n} 位在等你的客户**

#### `today.needs.none`

- en: No one is waiting for you.
- **zh: 现在没有人在等你。**

#### `today.sending`

- en: Sending:
- **zh: 发送：**

#### `today.sending.on`

- en: on
- **zh: 开着**

#### `today.sending.paused`

- en: paused
- **zh: 已暂停**

#### `today.setup.line`

- en: Setup: {done} of {total} done.
- **zh: 设置：{total} 步里完成了 {done} 步。**

#### `unreadable.open`

- en: Open it
- **zh: 打开看看**

#### `autonomy.level.talks.note` (changed)

- en: Greetings, questions and recommendations go out by themselves. A reply that states a price waits for you.
- before: 打招呼、提问、推荐、跟进会自己发出去。带价格的回复先给你看。
- **zh: 打招呼、提问、推荐会自己发出去。带价格的回复先给你看。**

#### `conv.tl.buyer_text` (changed)

- en: {who}: {text}
- before: 买家：{text}
- **zh: {who}：{text}**

### العربية — 278 lines

#### `accounts.after`

- en: After the Page is connected.
- **ar: بعد ربط الصفحة.**

#### `accounts.afterReconnect`

- en: After connecting again.
- **ar: بعد الربط من جديد.**

#### `accounts.help`

- en: What to check
- **ar: ما يجب التحقق منه**

#### `accounts.instagram`

- en: Instagram linked to the Page
- **ar: Instagram مرتبط بالصفحة**

#### `accounts.instagram.bad`

- en: No Instagram professional account is linked to this Page, so Instagram messages cannot arrive.
- **ar: لا يوجد حساب Instagram احترافي مرتبط بهذه الصفحة، فلا يمكن أن تصل رسائل Instagram.**

#### `accounts.instagram.done`

- en: Linked: {account}.
- **ar: مرتبط: {account}.**

#### `accounts.lead`

- en: Each step is read from Meta, and from the messages received, when this page opens.
- **ar: تُقرأ كل خطوة من Meta ومن الرسائل التي وصلت، عند فتح هذه الصفحة.**

#### `accounts.mark.bad`

- en: needs you
- **ar: بحاجة إلى إجراء**

#### `accounts.mark.done`

- en: done
- **ar: مكتمل**

#### `accounts.mark.todo`

- en: not yet
- **ar: لم يكتمل بعد**

#### `accounts.mark.unknown`

- en: could not check
- **ar: تعذّر التحقق**

#### `accounts.page`

- en: A Facebook Page you manage
- **ar: صفحة Facebook بإدارتك**

#### `accounts.page.done`

- en: Connected: {page}.
- **ar: متصلة: {page}.**

#### `accounts.page.todo`

- en: Not connected yet: connect it on the Instagram or Messenger card above.
- **ar: غير متصلة بعد: يمكن ربطها من بطاقة Instagram أو Messenger أعلاه.**

#### `accounts.permissions`

- en: Every permission granted
- **ar: منح كل الأذونات**

#### `accounts.permissions.bad`

- en: Meta did not grant: {missing}. Connect again and leave every box ticked.
- **ar: لم تمنح Meta: {missing}. يُرجى الربط من جديد مع إبقاء كل الخيارات محددة.**

#### `accounts.permissions.done`

- en: All the permissions asked for were granted.
- **ar: مُنحت كل الأذونات المطلوبة.**

#### `accounts.subscribed`

- en: The Page sends its messages here
- **ar: إرسال الصفحة رسائلها إلى هنا**

#### `accounts.subscribed.bad`

- en: No: the Page is not subscribed, so its messages stay in its own inbox. Connect again.
- **ar: لا: الصفحة غير مشتركة، فتبقى رسائلها في صندوقها الخاص. يُرجى الربط من جديد.**

#### `accounts.test`

- en: A first message from another account
- **ar: أول رسالة من حساب آخر**

#### `accounts.test.on`

- en: First on {channel}: {date}.
- **ar: الأولى على {channel}: {date}.**

#### `accounts.test.todo`

- en: Send the shop a message from another account; it shows here when it arrives.
- **ar: يُرجى إرسال رسالة إلى المتجر من حساب آخر؛ تظهر هنا عند وصولها.**

#### `accounts.title`

- en: Your Facebook Page and Instagram
- **ar: صفحة Facebook وحساب Instagram**

#### `accounts.token`

- en: Meta still accepts the connection
- **ar: قبول Meta للاتصال**

#### `accounts.token.bad`

- en: No. Connect again; until then nothing is sent on Instagram or Messenger.
- **ar: لا. يُرجى الربط من جديد؛ وحتى ذلك الحين لا يُرسل شيء على Instagram أو Messenger.**

#### `accounts.unknown`

- en: Meta did not answer just now; it is asked again when this page opens.
- **ar: لم تُجب Meta الآن؛ يُعاد السؤال عند فتح هذه الصفحة.**

#### `accounts.yes`

- en: Yes.
- **ar: نعم.**

#### `buyers.badge.order`

- en: Order waiting
- **ar: طلب بانتظارك**

#### `buyers.group.order`

- en: Said yes to an order
- **ar: موافقات على طلبات شراء**

#### `calendar.add`

- en: Add a date
- **ar: إضافة موعد**

#### `calendar.add.day`

- en: Date
- **ar: التاريخ**

#### `calendar.add.from`

- en: From
- **ar: من**

#### `calendar.add.hint`

- en: Leave the times empty for the whole day.
- **ar: يُترك الوقت فارغًا ليوم كامل.**

#### `calendar.add.save`

- en: Add
- **ar: إضافة**

#### `calendar.add.to`

- en: To
- **ar: إلى**

#### `calendar.add.what`

- en: What
- **ar: الموعد**

#### `calendar.cat.promised`

- en: Promised
- **ar: الوعود**

#### `calendar.cat.yours`

- en: Your dates
- **ar: المواعيد المضافة**

#### `calendar.empty.day`

- en: Nothing is dated this day.
- **ar: لا مواعيد في هذا اليوم.**

#### `calendar.empty.month`

- en: Nothing is dated this month.
- **ar: لا مواعيد في هذا الشهر.**

#### `calendar.empty.week`

- en: Nothing is dated this week.
- **ar: لا مواعيد في هذا الأسبوع.**

#### `calendar.flash.added`

- en: Added to the calendar.
- **ar: أُضيف إلى التقويم.**

#### `calendar.flash.day`

- en: Not added: that is not a date.
- **ar: لم يُضف شيء: هذا ليس تاريخًا.**

#### `calendar.flash.notFound`

- en: Nothing was taken off: that date is not on the calendar.
- **ar: لم يُزل شيء: هذا الموعد ليس في التقويم.**

#### `calendar.flash.order`

- en: Not added: it ends before it starts.
- **ar: لم يُضف شيء: النهاية قبل البداية.**

#### `calendar.flash.removed`

- en: Taken off the calendar.
- **ar: أُزيل من التقويم.**

#### `calendar.flash.time`

- en: Not added: a time is written as 09:30, and an end needs a start.
- **ar: لم يُضف شيء: يُكتب الوقت هكذا 09:30، ولا نهاية بلا بداية.**

#### `calendar.flash.title`

- en: Not added: a date needs a name, up to 80 characters.
- **ar: لم يُضف شيء: يلزم اسم للموعد لا يزيد على 80 حرفًا.**

#### `calendar.kind.closure`

- en: Closed
- **ar: إغلاق**

#### `calendar.kind.conversation_closed`

- en: Conversation closed
- **ar: أُغلقت المحادثة**

#### `calendar.kind.followup_due`

- en: Follow-up
- **ar: متابعة**

#### `calendar.kind.order_state`

- en: Order
- **ar: طلب**

#### `calendar.kind.own`

- en: Your date
- **ar: موعد مضاف**

#### `calendar.kind.price_worked_out`

- en: Price worked out
- **ar: حُسب السعر**

#### `calendar.kind.promise_delivery`

- en: Delivery promised
- **ar: تسليم موعود**

#### `calendar.kind.promise_follow_up`

- en: Follow-up promised
- **ar: متابعة موعودة**

#### `calendar.kind.promise_price_end`

- en: Price ends
- **ar: ينتهي السعر**

#### `calendar.kind.reply_due`

- en: Reply due
- **ar: موعد الرد**

#### `calendar.kind.sample_asked`

- en: Sample asked
- **ar: طلب عينة**

#### `calendar.kind.sample_handled`

- en: Sample dealt with
- **ar: عولجت العينة**

#### `calendar.legend.dashed`

- en: Added by you
- **ar: أُضيف يدويًا**

#### `calendar.legend.solid`

- en: From a conversation
- **ar: من محادثة**

#### `calendar.line.promise`

- en: “{said}”
- **ar: «{said}»**

#### `calendar.more`

- en: {n} more
- **ar: {n} أخرى**

#### `calendar.move`

- en: Earlier and later
- **ar: السابق واللاحق**

#### `calendar.next`

- en: Later
- **ar: اللاحق**

#### `calendar.prev`

- en: Earlier
- **ar: السابق**

#### `calendar.remove`

- en: Remove
- **ar: إزالة**

#### `calendar.remove.confirm`

- en: Take “{title}” off the calendar?
- **ar: إزالة «{title}» من التقويم؟**

#### `calendar.todayDoor`

- en: Today
- **ar: اليوم**

#### `calendar.view.day`

- en: Day
- **ar: يوم**

#### `calendar.view.list`

- en: List
- **ar: قائمة**

#### `calendar.view.month`

- en: Month
- **ar: شهر**

#### `calendar.view.week`

- en: Week
- **ar: أسبوع**

#### `calendar.views`

- en: Month, week, day or list
- **ar: عرض بالشهر أو الأسبوع أو اليوم أو قائمة**

#### `card.asked`

- en: {customer} asked · {channel} · {time}
- **ar: سؤال من {customer} · {channel} · {time}**

#### `card.checked`

- en: checked twice
- **ar: قراءتان**

#### `card.checked.differs`

- en: read two ways
- **ar: قراءتان مختلفتان**

#### `card.checked.differsOn`

- en: a second, separate reading differed on {fields}
- **ar: اختلفت قراءة ثانية مستقلة في: {fields}**

#### `card.checked.same`

- en: a second, separate reading found the same
- **ar: قراءة ثانية مستقلة وصلت إلى النتيجة نفسها**

#### `card.closingIn`

- en: {channel} takes replies for {left} more
- **ar: يمكن الرد عبر {channel} لمدة {left} أخرى**

#### `card.closingSoon`

- en: Closing soon
- **ar: يقترب موعد الإغلاق**

#### `card.customer`

- en: The customer
- **ar: العميل**

#### `card.drafted`

- en: {name} drafted
- **ar: مسودة من {name}**

#### `card.edit`

- en: Edit
- **ar: تعديل**

#### `card.field.complaint`

- en: whether it is a complaint
- **ar: كونها شكوى**

#### `card.field.language`

- en: the language
- **ar: اللغة**

#### `card.field.phase`

- en: the stage of the sale
- **ar: مرحلة البيع**

#### `card.field.product`

- en: the product
- **ar: المنتج**

#### `card.field.quantity`

- en: the quantity
- **ar: الكمية**

#### `card.goes`

- en: goes on {channel}, as written
- **ar: يُرسل عبر {channel} دون تغيير**

#### `card.handToMe`

- en: Hand to me
- **ar: تولّي الرد**

#### `card.intent.complaint`

- en: a complaint
- **ar: شكوى**

#### `card.intent.inquiry`

- en: a question
- **ar: استفسار**

#### `card.intent.order_intent`

- en: ready to order
- **ar: رغبة في الطلب**

#### `card.intent.out_of_scope`

- en: not about what you sell
- **ar: خارج نطاق النشاط**

#### `card.intent.price_request`

- en: a price question
- **ar: سؤال عن السعر**

#### `card.intent.product_search`

- en: looking for a product
- **ar: البحث عن منتج**

#### `card.intent.unclear`

- en: not clear yet
- **ar: غير واضح بعد**

#### `card.noReply`

- en: No reply needed
- **ar: لا حاجة إلى رد**

#### `card.reasons`

- en: How {name} read this
- **ar: أساس فهم {name} للرسالة**

#### `card.reasons.count` (counted)

- en: {n} reason / {n} reasons
- **ar (zero): لا أسباب**
- **ar (one): سبب واحد**
- **ar (two): سببان**
- **ar (few): {n} أسباب**
- **ar (many): {n} سببًا**
- **ar (other): {n} سبب**

#### `card.reply`

- en: Reply
- **ar: الرد**

#### `card.source.discount`

- en: a discount your rules allow
- **ar: خصم تسمح به القواعد المحددة**

#### `card.source.lead_time`

- en: the days you need before it ships
- **ar: أيام التجهيز المحددة قبل الشحن**

#### `card.source.minimum`

- en: the smallest quantity you sell
- **ar: أقل كمية محددة للبيع**

#### `card.source.price`

- en: your price for {product}
- **ar: سعر {product} في قائمة أسعارك**

#### `card.source.priceAny`

- en: your price
- **ar: من قائمة أسعارك**

#### `card.source.product`

- en: one of your product names
- **ar: من أسماء منتجاتك**

#### `card.source.taught`

- en: something you taught
- **ar: من المعلومات المُضافة**

#### `card.source.their_words`

- en: in their own words
- **ar: الكلمات نفسها في رسالة العميل**

#### `card.source.total`

- en: the total, at your prices
- **ar: الإجمالي وفق أسعارك**

#### `card.source.unsourced`

- en: no source found
- **ar: بلا مصدر معروف**

#### `card.sourced`

- en: Every figure has a source
- **ar: لكل رقم مصدر**

#### `card.understood`

- en: Understood
- **ar: ما فُهم**

#### `card.unsourced`

- en: Not every figure has a source
- **ar: ليس لكل رقم مصدر**

#### `card.waiting`

- en: Waiting for you
- **ar: بانتظارك**

#### `card.window`

- en: {channel} takes replies until {time}
- **ar: يمكن الرد عبر {channel} حتى {time}**

#### `forgot.lead`

- en: Type the e-mail you sign in with. A link to choose a new password goes there; it works for {minutes} minutes.
- **ar: يُرجى كتابة البريد الإلكتروني المستخدم لتسجيل الدخول. يُرسَل إليه رابط لاختيار كلمة مرور جديدة، صالح لمدة {minutes} دقيقة.**

#### `forgot.mail.body`

- en: A new password was asked for {email} on Nomi.

To choose one, open this link within {minutes} minutes:
{link}

If it was not you, ignore this e-mail: the password stays as it is.
- **ar: طُلبت كلمة مرور جديدة للبريد {email} على Nomi.

لاختيارها، يُرجى فتح هذا الرابط خلال {minutes} دقيقة:
{link}

إن لم يكن الطلب منك، يُرجى تجاهل هذه الرسالة، ولن تتغيّر كلمة المرور.**

#### `forgot.mail.subject`

- en: Choose a new password for Nomi
- **ar: اختيار كلمة مرور جديدة لـ Nomi**

#### `forgot.sent`

- en: If {email} signs in to Nomi, a link to choose a new password is on its way. It works for {minutes} minutes. Nothing arrived? Look in spam, or ask again in a few minutes.
- **ar: إن كان {email} مستخدمًا لتسجيل الدخول إلى Nomi، فالرابط لاختيار كلمة مرور جديدة في الطريق، صالح لمدة {minutes} دقيقة. لم يصل شيء؟ يُرجى التحقق من البريد المزعج، أو إعادة الطلب بعد بضع دقائق.**

#### `forgot.submit`

- en: E-mail me a link
- **ar: إرسال الرابط بالبريد**

#### `forgot.title`

- en: Choose a new password
- **ar: اختيار كلمة مرور جديدة**

#### `help.meta.back`

- en: Channels
- **ar: القنوات**

#### `help.meta.checkLabel`

- en: Check:
- **ar: التحقق:**

#### `help.meta.connect.check`

- en: The Channels page says Meta still accepts it. If not, connect again with the same Facebook account.
- **ar: تُظهر صفحة القنوات أن Meta ما زالت تقبل الاتصال. وإلا فيُرجى الربط من جديد بحساب Facebook نفسه.**

#### `help.meta.connect.title`

- en: Meta still accepts the connection
- **ar: قبول Meta للاتصال**

#### `help.meta.connect.why`

- en: A changed password, a removed Page role or a withdrawn permission ends the connection. Then nothing is sent on Instagram or Messenger, and the page says why.
- **ar: تغيير كلمة المرور أو سحب دور في الصفحة أو إلغاء إذن ينهي الاتصال. عندها لا يُرسل شيء على Instagram أو Messenger، وتذكر الصفحة السبب.**

#### `help.meta.instagram.check`

- en: The Instagram account is a professional account (business or creator), linked to that Page.
- **ar: حساب Instagram احترافي (تجاري أو لصانع محتوى) ومرتبط بتلك الصفحة.**

#### `help.meta.instagram.title`

- en: Instagram linked to the Page
- **ar: Instagram مرتبط بالصفحة**

#### `help.meta.instagram.why`

- en: Meta gives an app Instagram messages only for a professional account linked to a Page.
- **ar: لا تُسلّم Meta رسائل Instagram إلى أي تطبيق إلا لحساب احترافي مرتبط بصفحة.**

#### `help.meta.lead`

- en: What to check at each step, and why. The Channels page shows which steps are done; for where to click, Meta’s own help pages are linked.
- **ar: ما يجب التحقق منه في كل خطوة، وسببه. تُظهر صفحة القنوات الخطوات المكتملة؛ ولمعرفة مواضع النقر، روابط إلى صفحات مساعدة Meta نفسها.**

#### `help.meta.link.createPage`

- en: Meta’s help: create a Facebook Page
- **ar: مساعدة Meta: إنشاء صفحة Facebook**

#### `help.meta.link.linkPage`

- en: Meta’s help: connect Instagram and a Facebook Page
- **ar: مساعدة Meta: ربط Instagram بصفحة Facebook**

#### `help.meta.link.professional`

- en: Meta’s help: set up a professional Instagram account
- **ar: مساعدة Meta: إعداد حساب Instagram احترافي**

#### `help.meta.page.check`

- en: The shop has a Facebook Page, and you manage it with full control.
- **ar: للمتجر صفحة على Facebook، وإدارتها الكاملة بيدك.**

#### `help.meta.page.title`

- en: A Facebook Page you manage
- **ar: صفحة Facebook بإدارتك**

#### `help.meta.page.why`

- en: Messenger messages arrive at the Page and replies leave as the Page; Instagram is reached through the Page it is linked to.
- **ar: تصل رسائل Messenger إلى الصفحة وتُرسل الردود باسم الصفحة؛ ويُوصل إلى Instagram عبر الصفحة المرتبط بها.**

#### `help.meta.permissions.check`

- en: In the Facebook window that opens when connecting, leave every box ticked.
- **ar: في نافذة Facebook التي تُفتح عند الربط، يُرجى إبقاء كل الخيارات محددة.**

#### `help.meta.permissions.title`

- en: Every permission granted
- **ar: منح كل الأذونات**

#### `help.meta.permissions.why`

- en: Each one allows one thing: seeing the Page, receiving and answering Messenger messages, receiving and answering Instagram messages. Without one of them, those messages never arrive.
- **ar: كل إذن يتيح أمرًا واحدًا: رؤية الصفحة، واستقبال رسائل Messenger والرد عليها، واستقبال رسائل Instagram والرد عليها. ومن دون أحدها لا تصل تلك الرسائل أبدًا.**

#### `help.meta.rules.first`

- en: {name} cannot write first on Instagram or Messenger: the customer starts.
- **ar: لا يمكن بدء المحادثة على Instagram أو Messenger: البداية من العميل.**

#### `help.meta.rules.media`

- en: Shared posts and mentions in stories come to you, named, and are not answered.
- **ar: تصل المنشورات المشاركة والإشارات في القصص إليك مع اسمها، ولا يُرد عليها.**

#### `help.meta.rules.title`

- en: What works on Instagram and Messenger
- **ar: ما يعمل على Instagram وMessenger**

#### `help.meta.rules.window`

- en: {name} can reply for 24 hours after the customer’s last message. After that, reply in the Instagram or Messenger app.
- **ar: يمكن الرد خلال 24 ساعة من آخر رسالة للعميل. بعد ذلك يكون الرد من تطبيق Instagram أو Messenger.**

#### `help.meta.subscription.check`

- en: Nothing to do: connecting subscribes the Page. If the Channels page says it is not subscribed, connect again.
- **ar: لا شيء مطلوب: الربط يُشرك الصفحة. وإن أظهرت صفحة القنوات أنها غير مشتركة، فيُرجى الربط من جديد.**

#### `help.meta.subscription.title`

- en: The Page sends its messages here
- **ar: إرسال الصفحة رسائلها إلى هنا**

#### `help.meta.subscription.why`

- en: Without it, Meta keeps the messages in the Page’s own inbox and they never reach {name}.
- **ar: من دون الاشتراك تُبقي Meta الرسائل في صندوق الصفحة الخاص، فلا تصل أبدًا إلى {name}.**

#### `help.meta.test.check`

- en: From a different account (a friend’s, or a personal one), send the shop a message on Instagram and on Messenger. On Instagram, the setting “Allow access to messages”, under Connected tools in the app’s message settings, must be on.
- **ar: من حساب آخر، لصديق أو حساب شخصي، يُرجى إرسال رسالة إلى المتجر على Instagram وعلى Messenger. وفي Instagram يجب تفعيل خيار «السماح بالوصول إلى الرسائل» ضمن الأدوات المتصلة في إعدادات الرسائل.**

#### `help.meta.test.title`

- en: A first message from another account
- **ar: أول رسالة من حساب آخر**

#### `help.meta.test.why`

- en: It proves the whole road, including the one Instagram setting nobody can read from outside: the first message arriving is the proof.
- **ar: وصول الرسالة الأولى يُثبت الطريق كله، بما فيه إعداد Instagram الوحيد الذي لا يمكن قراءته من الخارج.**

#### `help.meta.title`

- en: Connecting a Facebook Page and Instagram
- **ar: ربط صفحة Facebook وحساب Instagram**

#### `help.meta.whyLabel`

- en: Why:
- **ar: السبب:**

#### `inbox.draft.held.order_waits_for_owner`

- en: This customer said yes to an order that is waiting for you, so every reply waits for you too.
- **ar: في هذه المحادثة طلب شراء بانتظار قرارك، لذلك ينتظر كل ردّ قرارك أيضًا.**

#### `inbox.flash.empty`

- en: Nothing went: the reply box was empty.
- **ar: لم يُرسل شيء: خانة الرد فارغة.**

#### `insight.draftsWaiting` (counted)

- en: {n} reply is written and waiting for you. / {n} replies are written and waiting for you.
- **ar (zero): لا ردود جاهزة.**
- **ar (one): ردّ واحد جاهز وبانتظارك.**
- **ar (two): ردّان جاهزان وبانتظارك.**
- **ar (few): {n} ردود جاهزة وبانتظارك.**
- **ar (many): {n} ردًّا جاهزًا وبانتظارك.**
- **ar (other): {n} ردّ جاهز وبانتظارك.**

#### `insight.followUpsWaiting` (counted)

- en: {n} follow-up e-mail is waiting for you to check your inbox. / {n} follow-up e-mails are waiting for you to check your inbox.
- **ar (zero): لا رسائل متابعة بالانتظار.**
- **ar (one): رسالة متابعة واحدة بانتظار مراجعة بريدك أولًا.**
- **ar (two): رسالتا متابعة بانتظار مراجعة بريدك أولًا.**
- **ar (few): {n} رسائل متابعة بانتظار مراجعة بريدك أولًا.**
- **ar (many): {n} رسالة متابعة بانتظار مراجعة بريدك أولًا.**
- **ar (other): {n} رسالة متابعة بانتظار مراجعة بريدك أولًا.**

#### `insight.productsNoPrice` (counted)

- en: {n} product has no price yet, so {name} cannot quote it. / {n} products have no price yet, so {name} cannot quote them.
- **ar (zero): لا منتجات بلا سعر.**
- **ar (one): منتج واحد بلا سعر، فلا يمكن تسعيره.**
- **ar (two): منتجان بلا سعر، فلا يمكن تسعيرهما.**
- **ar (few): {n} منتجات بلا سعر، فلا يمكن تسعيرها.**
- **ar (many): {n} منتجًا بلا سعر، فلا يمكن تسعيرها.**
- **ar (other): {n} منتج بلا سعر، فلا يمكن تسعيرها.**

#### `insight.uncertainSends` (counted)

- en: {n} message may or may not have reached a customer. / {n} messages may or may not have reached a customer.
- **ar (zero): لا رسائل غير مؤكدة الوصول.**
- **ar (one): رسالة واحدة قد تكون وصلت العميل وقد لا تكون.**
- **ar (two): رسالتان قد تكونان وصلتا العميل وقد لا تكونان.**
- **ar (few): {n} رسائل قد تكون وصلت العميل وقد لا تكون.**
- **ar (many): {n} رسالةً قد تكون وصلت العميل وقد لا تكون.**
- **ar (other): {n} رسالة قد تكون وصلت العميل وقد لا تكون.**

#### `live.channels`

- en: Something changed on your channels
- **ar: تغيّر شيء في القنوات**

#### `live.notify.ask`

- en: Tell me in this browser when an order waits
- **ar: تنبيه في هذا المتصفح عند وجود طلب بانتظار التأكيد**

#### `live.notify.on`

- en: This browser will tell you when an order waits, while Nomi is open in a tab.
- **ar: سيصل تنبيه في هذا المتصفح عند وجود طلب بانتظار القرار، ما دام Nomi مفتوحًا في إحدى علامات التبويب.**

#### `login.forgot`

- en: Forgot your password?
- **ar: نسيان كلمة المرور؟**

#### `login.withEmail`

- en: Sign in with your e-mail
- **ar: تسجيل الدخول بالبريد الإلكتروني**

#### `nav.conversations`

- en: Conversations
- **ar: المحادثات**

#### `nav.customers`

- en: Customers
- **ar: العملاء**

#### `nav.needsYou` (counted)

- en: {n} customer needs you / {n} customers need you
- **ar (zero): لا توجد محادثات بانتظارك**
- **ar (one): محادثة واحدة بانتظارك**
- **ar (two): محادثتان بانتظارك**
- **ar (few): {n} محادثات بانتظارك**
- **ar (many): {n} محادثةً بانتظارك**
- **ar (other): {n} محادثة بانتظارك**

#### `notify.meta_errors`

- en: Workspaces where Meta refused or lost many messages in the last 24 hours: {n}.
- **ar: مساحات عمل رُفضت فيها أو فُقدت رسائل كثيرة لدى Meta خلال آخر 24 ساعة: {n}.**

#### `notify.meta_errors.how`

- en: One app carries every workspace’s Instagram and Messenger, so a workspace sending into errors can get it restricted for all of them. Look at what it sends. Its daily limit is set with tools/send-ceiling.mjs; the emergency switch silences every workspace.
- **ar: تطبيق واحد يحمل Instagram وMessenger لكل مساحات العمل، فمساحة عمل تستمر في إرسال رسائل مرفوضة قد تتسبب في تقييده للجميع. يُرجى النظر فيما تُرسله. يُضبط الحد اليومي بـ tools/send-ceiling.mjs، ومفتاح الطوارئ يوقف الإرسال في كل مساحات العمل.**

#### `notify.meta_errors.line`

- en: · {business} — {failed} of {attempted} refused or lost ({errors})
- **ar: · {business} — {failed} من {attempted} مرفوضة أو مفقودة ({errors})**

#### `notify.meta_errors.more`

- en: · and {n} more
- **ar: · و{n} غيرها**

#### `notify.meta_errors.subject`

- en: Nomi: Meta is refusing messages
- **ar: Nomi: رسائل مرفوضة لدى Meta**

#### `notify.order_proposed`

- en: A customer said yes to an order. Nothing was confirmed and nothing was sent to them: the order waits for you. Open the conversation to confirm it, or to answer them yourself.
- **ar: وصلت موافقة على طلب شراء من أحد العملاء. لم يُؤكَّد الطلب ولم يُرسَل أي شيء: الطلب بانتظار قرارك. يمكن فتح المحادثة لتأكيده أو للرد مباشرة.**

#### `notify.order_proposed.subject`

- en: A customer said yes to an order
- **ar: موافقة على طلب شراء بانتظار قرارك**

#### `order.action.confirm`

- en: Confirm the order
- **ar: تأكيد الطلب**

#### `order.action.stepIn`

- en: I'll answer them
- **ar: تولّي الرد**

#### `order.action.stepIn.note`

- en: Sets the order aside and gives you the conversation. Nothing is sent.
- **ar: يُترَك الطلب جانبًا وتُسنَد المحادثة إليك. لا يُرسَل شيء.**

#### `order.card.email`

- en: E-mail
- **ar: البريد الإلكتروني**

#### `order.card.intro`

- en: Nothing is confirmed and nothing has been sent. When you confirm, the order is recorded and they are sent the message below.
- **ar: لم يُؤكَّد شيء ولم يُرسَل شيء. عند التأكيد يُسجَّل الطلب وتُرسَل الرسالة أدناه.**

#### `order.card.reference`

- en: (its reference, given when you confirm)
- **ar: (رقم الطلب، يُحدَّد عند التأكيد)**

#### `order.card.terms`

- en: Payment terms
- **ar: شروط الدفع**

#### `order.card.title`

- en: They said yes to this order
- **ar: تمت الموافقة على هذا الطلب**

#### `order.card.willSend`

- en: What they will be sent
- **ar: الرسالة التي ستُرسَل**

#### `order.flash.already_decided`

- en: This order was already decided.
- **ar: سبق اتخاذ قرار بشأن هذا الطلب.**

#### `order.flash.assistant_silenced`

- en: Sending is paused while we look into something, so the order still waits: nothing was recorded or sent.
- **ar: الإرسال متوقف مؤقتًا ريثما نتحقق من أمر ما، لذلك ما زال الطلب بانتظارك: لم يُسجَّل شيء ولم يُرسَل شيء.**

#### `order.flash.assistant_stopped`

- en: Sending is stopped on every channel, so the order still waits: nothing was recorded or sent.
- **ar: الإرسال متوقف على كل القنوات، لذلك ما زال الطلب بانتظارك: لم يُسجَّل شيء ولم يُرسَل شيء.**

#### `order.flash.confirmed`

- en: Order confirmed. They are being sent the confirmation.
- **ar: تم تأكيد الطلب، وتُرسَل رسالة التأكيد الآن.**

#### `order.flash.confirmedNotLive`

- en: Order recorded. Nothing was sent: sending is not switched on here yet.
- **ar: تم تسجيل الطلب. لم يُرسَل شيء لأن الإرسال غير مفعَّل هنا بعد.**

#### `order.flash.incomplete`

- en: This order cannot be recorded as it stands: its product or price is no longer there. Answer them yourself.
- **ar: لا يمكن تسجيل هذا الطلب بصيغته الحالية: المنتج أو السعر لم يعد موجودًا. يُرجى الرد مباشرة.**

#### `order.flash.not_found`

- en: That order is no longer waiting.
- **ar: هذا الطلب لم يعد بانتظار القرار.**

#### `order.flash.set_aside`

- en: The order is set aside, and the conversation is yours.
- **ar: تُرك الطلب جانبًا، والمحادثة مُسنَدة إليك.**

#### `pane.label`

- en: Conversations
- **ar: المحادثات**

#### `panel.act.alone`

- en: {name} replied
- **ar: ردّ من {name}**

#### `panel.act.draft_sent`

- en: You sent {name}’s draft
- **ar: أُرسلت مسودة {name} بموافقتك**

#### `panel.act.edit_sent`

- en: You sent your version of {name}’s draft
- **ar: أُرسلت نسختك المعدّلة من مسودة {name}**

#### `panel.act.not_reached.assistant`

- en: {name}’s reply didn’t reach them
- **ar: لم يصل ردّ {name}**

#### `panel.act.not_reached.person`

- en: Your reply didn’t reach them
- **ar: لم يصل ردّك**

#### `panel.act.owner`

- en: You answered yourself
- **ar: ردّ منك مباشرة**

#### `panel.act.waiting`

- en: Waiting for you
- **ar: بانتظارك**

#### `panel.activity`

- en: Activity
- **ar: النشاط**

#### `panel.askedAbout`

- en: Asked about
- **ar: ما سُئل عنه**

#### `panel.close`

- en: Close
- **ar: إغلاق**

#### `panel.conversations` (counted)

- en: {n} conversation / {n} conversations
- **ar (zero): {n} محادثة**
- **ar (one): محادثة واحدة**
- **ar (two): محادثتان**
- **ar (few): {n} محادثات**
- **ar (many): {n} محادثةً**
- **ar (other): {n} محادثة**

#### `panel.details`

- en: Their details, their data
- **ar: التفاصيل والبيانات**

#### `panel.firstWrote`

- en: First wrote {date}
- **ar: أول رسالة في {date}**

#### `panel.label`

- en: The customer
- **ar: العميل**

#### `panel.now`

- en: now
- **ar: الآن**

#### `panel.onCalendar`

- en: On the calendar
- **ar: في التقويم**

#### `panel.onRecord`

- en: On record
- **ar: في السجل**

#### `panel.open`

- en: The customer
- **ar: العميل**

#### `panel.order`

- en: Order {reference}
- **ar: الطلب {reference}**

#### `panel.priceDoor`

- en: the conversation
- **ar: المحادثة**

#### `panel.prices`

- en: Prices worked out
- **ar: الأسعار المحسوبة**

#### `panel.promised`

- en: Promised
- **ar: ما وُعد به**

#### `panel.sample`

- en: Sample
- **ar: عينة**

#### `panel.sampleAsked`

- en: asked {date}
- **ar: طُلبت في {date}**

#### `panel.sampleHandled`

- en: dealt with {date}
- **ar: عولجت في {date}**

#### `panel.times` (counted)

- en: once / {n} times
- **ar (zero): {n} مرة**
- **ar (one): مرة واحدة**
- **ar (two): مرتان**
- **ar (few): {n} مرات**
- **ar (many): {n} مرةً**
- **ar (other): {n} مرة**

#### `panel.writesIn`

- en: writes in {language}
- **ar: يكتب بـ{language}**

#### `people.flash.renamed`

- en: Saved. Everyone here sees {name} now.
- **ar: تم الحفظ. الاسم الظاهر للجميع الآن: {name}.**

#### `people.name.askThem`

- en: This is your business's name, not a person's. What is the right name here?
- **ar: هذا اسم الشركة لا اسم شخص. ما الاسم الصحيح هنا؟**

#### `people.name.askYou`

- en: Your name here is your business's name. What should the people here call you?
- **ar: الاسم المسجَّل هنا مطابق لاسم الشركة. ما الاسم الذي يظهر لفريق العمل؟**

#### `people.name.save`

- en: Save the name
- **ar: حفظ الاسم**

#### `people.ownerOnly.data_rights`

- en: Record a customer's request to have their data deleted
- **ar: تسجيل طلب حذف بيانات عميل**

#### `product.add.example3`

- en: Rose face serum 50 ml $34.90
- **ar: مصل الورد 50 مل $34.90**

#### `product.detail.notFindable`

- en: Customers cannot find this product yet: it has no name their messages can be matched to. Add the names customers use below, and it can be found and quoted.
- **ar: لا يمكن للعملاء العثور على هذا المنتج بعد: لا يوجد اسم تُطابَق به رسائلهم. يُرجى إضافة الأسماء التي يستخدمها العملاء أدناه ليصبح ممكنًا العثور عليه وتسعيره.**

#### `product.edit.customerNames`

- en: Add names customers use
- **ar: إضافة أسماء يستخدمها العملاء**

#### `product.edit.customerNames.hint`

- en: One per line. The product is found by any of them; the names already here stay.
- **ar: اسم في كل سطر. يُعثَر على المنتج بأيٍّ منها، وتبقى الأسماء الموجودة.**

#### `product.edit.error.too_long`

- en: Too long: a name can have at most 120 characters.
- **ar: طويل جدًا: 120 حرفًا على الأكثر لكل اسم.**

#### `product.edit.error.too_many`

- en: At most 20 names at a time.
- **ar: 20 اسمًا على الأكثر في كل مرة.**

#### `product.edit.moq.hint`

- en: Leave it empty if there is no minimum.
- **ar: يُترك الحقل فارغًا إن لم يوجد حد أدنى.**

#### `product.edit.name`

- en: Name
- **ar: الاسم**

#### `product.edit.nameZh`

- en: Name in Chinese
- **ar: الاسم بالصينية**

#### `product.noMinimum`

- en: No minimum
- **ar: بلا حد أدنى**

#### `product.photo.refused.cut_off`

- en: The page is too long to read in one photo, so nothing was added. Send it as two photos — the top half, then the bottom half.
- **ar: الصفحة أطول من أن تُقرأ في صورة واحدة، فلم يُضف شيء. يُرجى إرسالها في صورتين: النصف الأعلى ثم النصف الأسفل.**

#### `product.reject.ambiguous_price`

- en: the price can be read two ways — write it like 1250.00
- **ar: يمكن قراءة السعر بطريقتين — يُرجى كتابته هكذا: 1250.00**

#### `product.reject.not_usd`

- en: only US dollars for now — this line has another currency
- **ar: الدولار الأمريكي فقط حاليًا — في هذا السطر عملة أخرى**

#### `product.reject.several_numbers`

- en: several numbers and none marked as the price — put $ before it
- **ar: في السطر عدة أرقام ولا يُعرف أيها السعر — يُرجى وضع $ قبله**

#### `product.status.notFindable`

- en: Customers cannot find it yet
- **ar: لا يمكن للعملاء العثور عليه بعد**

#### `received.shared_post`

- en: A shared post
- **ar: منشور مُشارك**

#### `received.story_mention`

- en: A mention in their story
- **ar: إشارة في قصة العميل**

#### `received.story_reply`

- en: A reply to your story
- **ar: ردّ على قصتك**

#### `sandbox.case.order-yes-waits-for-the-owner-in-auto`

- en: A "yes" to an order waits for your tap — nothing is sent
- **ar: الموافقة على طلب الشراء تنتظر قرارك — لا يُرسَل شيء**

#### `sandbox.inv.answeredAsUsual`

- en: Answered as usual — nothing to hand over
- **ar: ردّ معتاد دون إحالة**

#### `sandbox.inv.certOnlyIfAuthorized`

- en: Named only the certifications you hold
- **ar: ذكر الشهادات المتوفرة فقط**

#### `sandbox.inv.deletionHandsOffSilently`

- en: A deletion request went to you, and nothing was sent
- **ar: إحالة طلب الحذف إليك دون إرسال أي رد**

#### `sandbox.inv.neverDeniesBeingAi`

- en: Never claimed to be a person
- **ar: لا ادّعاء للصفة البشرية**

#### `sandbox.inv.noDeletionPromise`

- en: Promised no deletion
- **ar: لا وعد بحذف البيانات**

#### `sandbox.inv.noUnsourcedSpecNumber`

- en: Every figure came from your products, the quote or the customer
- **ar: لكل رقم مصدر: منتجاتك أو عرض السعر أو العميل**

#### `sandbox.inv.orderWaitsForOwner`

- en: The order waited for your tap
- **ar: الطلب بانتظار تأكيدك**

#### `setup.state.connected`

- en: Connected
- **ar: متصل**

#### `setup.state.done`

- en: Done
- **ar: مكتمل**

#### `setup.state.notAnswered`

- en: Not answered yet
- **ar: لم يُحدَّد بعد**

#### `setup.state.notConnected`

- en: Nothing connected yet
- **ar: لا اتصال بعد**

#### `setup.state.people` (counted)

- en: {n} person / {n} people
- **ar (zero): لا أحد**
- **ar (one): شخص واحد**
- **ar (two): شخصان**
- **ar (few): {n} أشخاص**
- **ar (many): {n} شخصًا**
- **ar (other): {n} شخص**

#### `setup.state.toDo`

- en: Not finished
- **ar: غير مكتمل**

#### `today.blocked` (counted)

- en: {n} message did not reach a customer / {n} messages did not reach customers
- **ar (zero): لا رسائل لم تصل**
- **ar (one): رسالة واحدة لم تصل إلى العميل**
- **ar (two): رسالتان لم تصلا إلى العملاء**
- **ar (few): {n} رسائل لم تصل إلى العملاء**
- **ar (many): {n} رسالةً لم تصل إلى العملاء**
- **ar (other): {n} رسالة لم تصل إلى العملاء**

#### `today.coming.all`

- en: The calendar
- **ar: التقويم**

#### `today.coming.none`

- en: Nothing on the calendar in the next seven days.
- **ar: لا شيء في التقويم خلال الأيام السبعة القادمة.**

#### `today.coming.title`

- en: Coming up
- **ar: القادم**

#### `today.deletion` (counted)

- en: {n} customer asked for their data to be deleted / {n} customers asked for their data to be deleted
- **ar (zero): لا طلبات لحذف البيانات**
- **ar (one): طلب واحد لحذف البيانات**
- **ar (two): طلبان لحذف البيانات**
- **ar (few): {n} طلبات لحذف البيانات**
- **ar (many): {n} طلبًا لحذف البيانات**
- **ar (other): {n} طلب لحذف البيانات**

#### `today.gaps` (counted)

- en: {n} question {name} could not answer / {n} questions {name} could not answer
- **ar (zero): أسئلة بلا إجابة لدى {name}: {n}**
- **ar (one): سؤال واحد بلا إجابة لدى {name}**
- **ar (two): سؤالان بلا إجابة لدى {name}**
- **ar (few): {n} أسئلة بلا إجابة لدى {name}**
- **ar (many): {n} سؤالًا بلا إجابة لدى {name}**
- **ar (other): {n} سؤال بلا إجابة لدى {name}**

#### `today.last.answered` (counted)

- en: {name} answered {n} customer / {name} answered {n} customers
- **ar (zero): ردود {name} على {n} من العملاء**
- **ar (one): ردود {name} على عميل واحد**
- **ar (two): ردود {name} على عميلين**
- **ar (few): ردود {name} على {n} عملاء**
- **ar (many): ردود {name} على {n} عميلًا**
- **ar (other): ردود {name} على {n} عميل**

#### `today.last.handed` (counted)

- en: {name} handed {n} customer to you / {name} handed {n} customers to you
- **ar (zero): إحالة {n} من العملاء إليك من {name}**
- **ar (one): إحالة عميل واحد إليك من {name}**
- **ar (two): إحالة عميلين إليك من {name}**
- **ar (few): إحالة {n} عملاء إليك من {name}**
- **ar (many): إحالة {n} عميلًا إليك من {name}**
- **ar (other): إحالة {n} عميل إليك من {name}**

#### `today.last.none`

- en: Nothing in the last 24 hours yet.
- **ar: لا شيء خلال آخر 24 ساعة حتى الآن.**

#### `today.last.sent` (counted)

- en: You sent {n} reply {name} wrote / You sent {n} replies {name} wrote
- **ar (zero): ردود من {name} أُرسلت بموافقتك: {n}**
- **ar (one): ردّ واحد من {name} أُرسل بموافقتك**
- **ar (two): ردّان من {name} أُرسلا بموافقتك**
- **ar (few): {n} ردود من {name} أُرسلت بموافقتك**
- **ar (many): {n} ردًّا من {name} أُرسلت بموافقتك**
- **ar (other): {n} ردّ من {name} أُرسلت بموافقتك**

#### `today.last.title`

- en: In the last 24 hours
- **ar: خلال آخر 24 ساعة**

#### `today.last.yourself` (counted)

- en: You answered {n} customer yourself / You answered {n} customers yourself
- **ar (zero): ردودك بنفسك على {n} من العملاء**
- **ar (one): ردّك بنفسك على عميل واحد**
- **ar (two): ردودك بنفسك على عميلين**
- **ar (few): ردودك بنفسك على {n} عملاء**
- **ar (many): ردودك بنفسك على {n} عميلًا**
- **ar (other): ردودك بنفسك على {n} عميل**

#### `today.needs.all` (counted)

- en: The {n} who needs you / All {n} who need you
- **ar (zero): كل من بانتظارك**
- **ar (one): العميل الوحيد بانتظارك**
- **ar (two): العميلان بانتظارك**
- **ar (few): كل من بانتظارك: {n}**
- **ar (many): كل من بانتظارك: {n}**
- **ar (other): كل من بانتظارك: {n}**

#### `today.needs.none`

- en: No one is waiting for you.
- **ar: لا أحد بانتظارك الآن.**

#### `today.sending`

- en: Sending:
- **ar: الإرسال:**

#### `today.sending.on`

- en: on
- **ar: مفعّل**

#### `today.sending.paused`

- en: paused
- **ar: متوقف**

#### `today.setup.line`

- en: Setup: {done} of {total} done.
- **ar: الإعداد: اكتمل {done} من {total}.**

#### `unreadable.open`

- en: Open it
- **ar: فتحه**

#### `autonomy.level.talks.note` (changed)

- en: Greetings, questions and recommendations go out by themselves. A reply that states a price waits for you.
- before: التحيات والأسئلة والتوصيات والمتابعات تخرج من تلقاء نفسها. الردّ الذي يذكر سعرًا ينتظرك.
- **ar: التحيات والأسئلة والتوصيات تخرج من تلقاء نفسها. الردّ الذي يذكر سعرًا ينتظرك.**

#### `conv.tl.buyer_text` (changed)

- en: {who}: {text}
- before: المشتري: {text}
- **ar: {who}: {text}**

## 2026-09-30 — the time zone, the currency and the positioning rewrite (#151–#161): every new or changed line

Every zh and ar line the time zone (TZ), the currency (CUR) and the positioning rewrite added or changed, for the native readers to take in one sitting. **Not a gate.**

For the Arabic reader to confirm, especially: «عميل / العملاء» for "customer" (it was «مشترٍ», #111; the reasoning is in `docs/PROGRESS.md` → "Decided by me"), and «نشاطي التجاري» for "My business" (it was «شركتي»).

Reviewer: ______  Date: ______

### 中文 — 370 lines

#### `activation.action.deactivateConfirm` (changed)

- en: Stop {name} messaging customers on WhatsApp? Nothing is deleted, and you can start again whenever you want.
- before: 让{name}停止在 WhatsApp 上给买家发消息？什么都不会删掉，你随时可以再开始。
- **zh: 让{name}停止在 WhatsApp 上给客户发消息？什么都不会删掉，你随时可以再开始。**

#### `activation.blocker.assistant_not_named` (changed)

- en: Confirm the name customers will see.
- before: 确认买家会看到的名字。
- **zh: 确认客户会看到的名字。**

#### `activation.can` (changed)

- en: {name} can start talking to real customers whenever you say so.
- before: 你说什么时候开始，{name}就什么时候开始接待真买家。
- **zh: 你说什么时候开始，{name}就什么时候开始接待真客户。**

#### `activation.cannot` (changed)

- en: Before {name} can talk to a real customer:
- before: {name}见真买家之前，还差：
- **zh: {name}见真客户之前，还差：**

#### `activation.stop.what` (changed)

- en: Stopping means nothing further is sent on WhatsApp. Your customers, conversations and everything you taught stay exactly as they are, and you can start again whenever you want.
- before: 停下之后，WhatsApp 上不会再发任何消息。买家、对话和你教过的东西都原样留着，你随时可以再开始。
- **zh: 停下之后，WhatsApp 上不会再发任何消息。客户、对话和你教过的东西都原样留着，你随时可以再开始。**

#### `allowlist.none` (changed)

- en: Nobody yet. Add your own number first, so you can try {name} on yourself before a customer does.
- before: 还没有人。先加你自己的号码，让{name}先跟你练一次，再让买家来。
- **zh: 还没有人。先加你自己的号码，让{name}先跟你练一次，再让客户来。**

#### `analytics.activity.inbound` (changed)

- en: Customer messages
- before: 买家咨询
- **zh: 客户咨询**

#### `analytics.employee.handled` (changed)

- en: Inquiries handled
- before: 已处理询盘
- **zh: 已处理咨询**

#### `analytics.empty.body` (changed)

- en: Not enough activity for {range} yet. As customers write in, {name} answers, and you confirm orders, this fills in.
- before: {range}还没有足够的记录。买家来问、{name}报价、你确认订单，这里就会慢慢长出来。
- **zh: {range}还没有足够的记录。客户来问、{name}回复、你确认订单，这里就会慢慢长出来。**

#### `assistant.silenced.note` (changed)

- en: Sending from {name} is paused while we check something — this was not you. Customers who write wait for you under Needs you, and your own replies still go.
- before: 我们在查一件事，暂停了{name}的发送——不是你操作的。买家写来的消息放在「等你处理」里等你，你自己发的回复照常送达。
- **zh: 我们在查一件事，暂停了{name}的发送——不是你操作的。客户写来的消息放在「等你处理」里等你，你自己发的回复照常送达。**

#### `assistant.stop.action.startConfirm` (changed)

- en: Let {name} answer customers again on every channel? Conversations handed to you while stopped stay with you.
- before: 让{name}在所有渠道重新回复买家？停下期间交给你的对话仍由你来回。
- **zh: 让{name}在所有渠道重新回复客户？停下期间交给你的对话仍由你来回。**

#### `assistant.stop.running` (changed)

- en: Stop {name} on every channel at once, WhatsApp included. Replies waiting to go out are cancelled, and customers who write wait for you under Needs you. Your own replies still go.
- before: 一次在所有渠道停下{name}，包括 WhatsApp。等着发出的回复会被取消，买家写来的消息放进「等你处理」等你。你自己发的回复照常送达。
- **zh: 一次在所有渠道停下{name}，包括 WhatsApp。等着发出的回复会被取消，客户写来的消息放进「等你处理」等你。你自己发的回复照常送达。**

#### `assistant.stop.stopped` (changed)

- en: {name} is stopped on every channel. Nothing {name} writes is sent, and customers who write wait for you under Needs you.
- before: {name}已在所有渠道停下。{name}写的都不会发出，买家写来的消息放在「等你处理」里等你。
- **zh: {name}已在所有渠道停下。{name}写的都不会发出，客户写来的消息放在「等你处理」里等你。**

#### `assistants.field.note.hint` (changed)

- en: A sentence or two, in your own words. It changes the tone only: prices, dates and facts still come from what you set.
- before: 用你自己的话写一两句。只影响语气，价格、交期和事实还是以你设的为准。
- **zh: 用你自己的话写一两句。只影响语气，价格、交付时间和事实还是以你设的为准。**

#### `assistants.flash.is_default` (changed)

- en: Someone always has to answer, so the main one stays.
- before: 总得有人回买家，所以主要的这一位不能移除。
- **zh: 总得有人回客户，所以主要的这一位不能移除。**

#### `assistants.title` (changed)

- en: Who answers your customers
- before: 谁来回买家
- **zh: 谁来回客户**

#### `autonomy.disclosure` (changed)

- en: One thing to know before you choose: when {name} replies without you, the first message in a conversation tells your customer they are not talking to a person, and offers them someone from your team. A reply you send yourself carries no such line — you sent it.
- before: 选之前先知道一件事：不经你过目就回复时，一段对话里的第一条消息会告诉买家，回复的不是真人，并可以帮买家转给你的同事。你自己发出去的回复不带这句话——那是你发的。
- **zh: 选之前先知道一件事：不经你过目就回复时，一段对话里的第一条消息会告诉客户，回复的不是真人，并可以帮客户转给你的同事。你自己发出去的回复不带这句话——那是你发的。**

#### `autonomy.flash.notReleased` (changed)

- en: Not yet — the line that tells a customer they are not talking to a person is still being checked in every language used.
- before: 还不行——向买家说明身份的那句话，还在逐语言核对。
- **zh: 还不行——向客户说明身份的那句话，还在逐语言核对。**

#### `autonomy.level.sells` (changed)

- en: {name} also handles prices without me
- before: 报价和议价也自己来
- **zh: 价格也自己来谈**

#### `autonomy.level.sells.note` (changed)

- en: Inside your price rules: never below your floor, and any discount bigger than you allow alone still comes to you first.
- before: 只在你的价格规矩之内：绝不低于你的底价，超过你设的让利线还是先问你。
- **zh: 只在你的价格规矩之内：绝不低于你的底价，超过你允许的优惠，还是先问你。**

#### `autonomy.needsName` (changed)

- en: Whatever you choose here, every reply keeps coming to you first until you confirm the name in Getting ready — a message sent without you gives your customer that name, and you should read it first.
- before: 无论这里选哪一档，在你到“准备上线”里确认名字之前，每条回复都会先给你看——不经你发出的消息会把这个名字告诉买家，你应该先看过。
- **zh: 无论这里选哪一档，在你到“准备上线”里确认名字之前，每条回复都会先给你看——不经你发出的消息会把这个名字告诉客户，你应该先看过。**

#### `autonomy.notReleased` (changed)

- en: Not yet available. The line that tells a customer they are not talking to a person has not been read by a native speaker of every language used, and nothing goes out without you until it has.
- before: 暂时还不能开。向买家说明身份的那句话，还没有请每一种回复语言的母语者看过；在看过之前，什么都不会不经你发出。
- **zh: 暂时还不能开。向客户说明身份的那句话，还没有请每一种回复语言的母语者看过；在看过之前，什么都不会不经你发出。**

#### `business.kind.agency` (changed)

- en: Agency or studio
- before: 代理或代运营公司
- **zh: 代理或工作室**

#### `business.kind.brand` (changed)

- en: Brand (clothing, beauty, food…)
- before: 品牌或网店
- **zh: 品牌（服装、美妆、食品…）**

#### `business.kind.label` (changed)

- en: Kind of business
- before: 公司类别
- **zh: 生意类别**

#### `business.kind.online_shop`

- en: Online shop
- **zh: 网店**

#### `business.kind.retail` (changed)

- en: Retail shop
- before: 零售店
- **zh: 实体零售店**

#### `business.kind.startup`

- en: Startup
- **zh: 创业公司**

#### `buyers.empty.calm` (changed)

- en: No customer needs you right now.
- before: 现在没有买家需要你。
- **zh: 现在没有客户需要你。**

#### `buyers.group.deletion` (changed)

- en: Asked for their data to be deleted
- before: 要求删除数据的买家
- **zh: 要求删除数据的客户**

#### `buyers.search.label` (changed)

- en: Find a customer
- before: 找买家
- **zh: 找客户**

#### `buyers.tabs` (changed)

- en: Which customers to show
- before: 显示哪些买家
- **zh: 显示哪些客户**

#### `calendar.buyer.all` (changed)

- en: All customers
- before: 所有买家
- **zh: 所有客户**

#### `calendar.buyer.choose` (changed)

- en: One customer only
- before: 只看一位买家
- **zh: 只看一位客户**

#### `calendar.buyer.chosen` (changed)

- en: Customer: {buyer}
- before: 买家：{buyer}
- **zh: 客户：{buyer}**

#### `calendar.buyer.label` (changed)

- en: Customer
- before: 买家
- **zh: 客户**

#### `calendar.cat.closures` (changed)

- en: Closures
- before: 停工
- **zh: 休息日**

#### `calendar.empty.door` (changed)

- en: See your customers
- before: 查看买家
- **zh: 查看客户**

#### `calendar.lede` (changed)

- en: Dates already on record for your customers — samples, orders, prices, replies owed, closures. Nothing here is estimated.
- before: 买家相关、已经记下的日期——样品、订单、报价、待回复、停工。这里没有任何估算的日期。
- **zh: 客户相关、已经记下的日期——样品、订单、报价、待回复、休息日。这里没有任何估算的日期。**

#### `calendar.line.closure` (changed)

- en: Closed for {label}, {from} to {to}
- before: 停工：{label}，{from} 至 {to}
- **zh: 休息：{label}，{from} 至 {to}**

#### `capability.negotiate` (changed)

- en: Discussing price
- before: 谈价
- **zh: 讨论价格**

#### `channel.connect.configured` (changed)

- en: Your WhatsApp number is set up. Connect it and customers’ messages reach {name}. Nothing is sent until you switch {name} on.
- before: 你的 WhatsApp 号码已经设置好了。连接后，买家的消息会到{name}这里；在你开启之前，不会发出任何消息。
- **zh: 你的 WhatsApp 号码已经设置好了。连接后，客户的消息会到{name}这里；在你开启之前，不会发出任何消息。**

#### `channel.connect.intro` (changed)

- en: Once connected, {name} sees the messages customers send to your WhatsApp and drafts replies — you decide what goes out.
- before: 连接后，买家发到你 WhatsApp 的消息，{name}就能看到并起草回复，发不发你说了算。
- **zh: 连接后，客户发到你 WhatsApp 的消息，{name}就能看到并起草回复，发不发你说了算。**

#### `channel.flash.connected` (changed)

- en: Connected. Customers’ messages now reach {name}. Nothing is sent until you switch {name} on.
- before: 已连接。买家的消息会到{name}这里，在你开启之前不会发送任何消息。
- **zh: 已连接。客户的消息会到{name}这里，在你开启之前不会发送任何消息。**

#### `channel.flash.nothing_to_connect` (changed)

- en: There is nothing to reconnect yet — WhatsApp has not been set up for your business.
- before: 还没有东西可以重连——你的公司还没接过WhatsApp。
- **zh: 还没有东西可以重连——你的生意还没接过WhatsApp。**

#### `channel.state.not_connected.hint` (changed)

- en: {name} cannot receive or answer a customer.
- before: {name}收不到也回不了买家。
- **zh: {name}收不到也回不了客户。**

#### `channel.whatsapp.desc` (changed)

- en: Customers message this number; {name} writes the reply and you decide what goes out
- before: 买家发到这个号码；{name}写好回复，发不发你说了算
- **zh: 客户发到这个号码；{name}写好回复，发不发你说了算**

#### `claim.BSCI` (changed)

- en: BSCI social audit
- before: BSCI验厂
- **zh: BSCI社会责任审计**

#### `closures.add.from` (changed)

- en: First day closed
- before: 停工第一天
- **zh: 休息第一天**

#### `closures.add.placeholder` (changed)

- en: Annual holiday
- before: 春节
- **zh: 年假**

#### `closures.add.shown` (changed)

- en: Customers see this name, with the dates, when told why a date cannot be promised.
- before: 解释为什么定不了交期时，买家会看到这个名字和日期。
- **zh: 解释为什么定不了交付时间时，客户会看到这个名字和日期。**

#### `closures.add.to` (changed)

- en: Last day closed
- before: 停工最后一天
- **zh: 休息最后一天**

#### `closures.blocked.action` (changed)

- en: Check your closure dates
- before: 看看停工日期
- **zh: 看看休息日期**

#### `closures.blocked.body` (changed)

- en: Your business is closed for {label}, {from} to {to}, inside that delivery time.
- before: 这段交期里公司要放{label}，{from} 到 {to}。
- **zh: 这段交付时间里要休息：{label}，{from} 到 {to}。**

#### `closures.empty` (changed)

- en: You have not told {name} about any closure, so your usual delivery time is given all year.
- before: 你还没告诉 {name} 哪些天停工，所以全年都按平常的交期报。
- **zh: 你还没告诉 {name} 哪些天休息，所以全年都按平常的交付时间说。**

#### `closures.flash.from_missing` (changed)

- en: Add the first day you are closed.
- before: 把停工第一天填上。
- **zh: 把休息第一天填上。**

#### `closures.flash.to_missing` (changed)

- en: Add the last day you are closed.
- before: 把停工最后一天填上。
- **zh: 把休息最后一天填上。**

#### `closures.intro` (changed)

- en: Tell {name} the days you are shut. No customer is promised a delivery date that runs through them — {name} says the dates cannot be promised, and never invents a later one.
- before: 把停工的日子告诉 {name}。交期要是跨过这几天，就不会给买家承诺日期——只会说这个日期不能保证，也不会自己往后编一个。
- **zh: 把休息的日子告诉 {name}。交付时间要是跨过这几天，就不会给客户承诺日期——只会说这个日期不能保证，也不会自己往后编一个。**

#### `closures.title` (changed)

- en: When your business is closed
- before: 公司休息的日子
- **zh: 休息的日子**

#### `common.buyer` (changed)

- en: Customer
- before: 买家
- **zh: 客户**

#### `connect.apollo.what` (changed)

- en: Finds people to write to and looks up their companies, with your own Apollo key.
- before: 用你自己的 Apollo 密钥找买家、查公司。
- **zh: 用你自己的 Apollo 密钥找潜在客户、查公司。**

#### `connect.mail.google.what` (changed)

- en: Sends your e-mail from your own Google Workspace address. Tick the box to let {name} read what customers send there, too.
- before: 用你自己的 Google Workspace 地址发邮件。勾选下面的框，{name}也能读买家发到这里的邮件。
- **zh: 用你自己的 Google Workspace 地址发邮件。勾选下面的框，{name}也能读客户发到这里的邮件。**

#### `connect.mail.read.tick` (changed)

- en: Also let {name} read and answer customers\' e-mails in this mailbox.
- before: 也让{name}读这个邮箱里买家的来信，这样才能回复。
- **zh: 也让{name}读这个邮箱里客户的来信，这样才能回复。**

#### `connect.meta.choose.body` (changed)

- en: Your Facebook account manages more than one Page. Choose the one customers write to for this business.
- before: 你的 Facebook 账号管理着不止一个主页。选择这家商家的买家会写信的那个。
- **zh: 你的 Facebook 账号管理着不止一个主页。选择这家商家的客户会写信的那个。**

#### `connect.meta.flash.connected` (changed)

- en: Connected: {page}. People who write there now reach you.
- before: 已连接：{page}。写到那里的买家现在会到你这里。
- **zh: 已连接：{page}。在那里写信的人现在会到你这里。**

#### `contacts.add.company` (changed)

- en: Their company (if any)
- before: 对方的公司
- **zh: 对方的公司（如有）**

#### `contacts.attest.hint` (changed)

- en: Only if they gave you their details or asked you to stay in touch. Whoever says so is recorded.
- before: 只有对方给过你名片、或请你保持联系时才这样标。谁标的会记下来。
- **zh: 只有对方给过你联系方式、或请你保持联系时才这样标。谁标的会记下来。**

#### `contacts.empty` (changed)

- en: Nobody yet. Add someone who gave you their details, or wait for the first customer to write to you.
- before: 还没有人。把你收到名片的人加进来，或者等第一位买家来找你。
- **zh: 还没有人。把给过你联系方式的人加进来，或者等第一位客户来找你。**

#### `conv.assistant.flash.changed` (changed)

- en: {who} answers this customer from now on.
- before: 从现在起由{who}来回这位买家。
- **zh: 从现在起由{who}来回这位客户。**

#### `conv.assistant.flash.same` (changed)

- en: {who} already answers this customer.
- before: {who}本来就在回这位买家。
- **zh: {who}本来就在回这位客户。**

#### `conv.assistant.label` (changed)

- en: Who answers this customer
- before: 谁来回这位买家
- **zh: 谁来回这位客户**

#### `conv.deletion.ask` (changed)

- en: Ask for this customer's data to be deleted
- before: 要求删除这位买家的数据
- **zh: 要求删除这位客户的数据**

#### `conv.deletion.done` (changed)

- en: This customer's data was deleted on {date}.
- before: 这位买家的数据已在 {date} 删除。
- **zh: 这位客户的数据已在 {date} 删除。**

#### `conv.deletion.erased` (changed)

- en: Deleted: who they are on every channel, every message to or from them, the replies and prices prepared for them and any sample requests, notes about their conversations, and the conversations themselves, except what an order needs.
- before: 会删除：对方在各个渠道上的身份、双方往来的每一条消息、为对方准备的回复、报价和样品申请、关于这些对话的备注，以及对话本身（订单需要的部分除外）。
- **zh: 会删除：对方在各个渠道上的身份、双方往来的每一条消息、为对方准备的回复和价格以及样品申请（如有）、关于这些对话的备注，以及对话本身（订单需要的部分除外）。**

#### `conv.deletion.flash.note_missing` (changed)

- en: Nothing was recorded: say how and when the customer asked.
- before: 没有记录：请写明买家是怎么、在什么时候提出的。
- **zh: 没有记录：请写明客户是怎么、在什么时候提出的。**

#### `conv.deletion.lead` (changed)

- en: When this customer asks in a message for their data to be deleted, the request is usually noted here as it arrives, for you to decide. If they ask another way, record it here. Nomi's operator carries it out by hand within 30 days, and it shows here when it is done.
- before: 这位买家在消息里要求删除自己的数据时，这条要求通常一到就会记在这里，由你决定。如果对方是用别的方式提出的，就在这里记录。Nomi 的运营方会在 30 天内由人手动执行，完成后这里会显示。
- **zh: 这位客户在消息里要求删除自己的数据时，这条要求通常一到就会记在这里，由你决定。如果对方是用别的方式提出的，就在这里记录。Nomi 的运营方会在 30 天内由人手动执行，完成后这里会显示。**

#### `conv.deletion.note` (changed)

- en: How and when did they ask?
- before: 买家是怎么、在什么时候提出的？
- **zh: 客户是怎么、在什么时候提出的？**

#### `conv.deletion.tell` (changed)

- en: When it is done, it shows here and on Your data. Tell the customer then — Nomi does not write to them about it.
- before: 完成后，这里和「你的数据」页都会显示。到时请你告诉买家——Nomi 不会就此联系对方。
- **zh: 完成后，这里和「你的数据」页都会显示。到时请你告诉客户——Nomi 不会就此联系对方。**

#### `conv.deletion.title` (changed)

- en: Deleting this customer's data
- before: 删除这位买家的数据
- **zh: 删除这位客户的数据**

#### `conv.file.nameHint` (changed)

- en: The name their channel showed, or what you call them. Empty shows them as "{buyer}".
- before: 渠道显示的名字，或你对这位买家的称呼。留空则显示为"{buyer}"。
- **zh: 渠道显示的名字，或你对这位客户的称呼。留空则显示为"{buyer}"。**

#### `conv.file.title` (changed)

- en: About this customer
- before: 关于这位买家
- **zh: 关于这位客户**

#### `conv.needCard` (changed)

- en: This customer has a reply waiting for your OK.
- before: 这位买家有一条回复等你确认。
- **zh: 这位客户有一条回复等你确认。**

#### `conv.notFound` (changed)

- en: Customer not found
- before: 找不到这位买家
- **zh: 找不到这位客户**

#### `conv.tl.buyer_image` (changed)

- en: Customer sent a photo
- before: 买家发来产品图片
- **zh: 客户发来一张图片**

#### `conv.tl.lead_hot` (changed)

- en: Customer is very interested
- before: 买家很有意向
- **zh: 客户很有意向**

#### `data.buyers.fromChat` (changed)

- en: A request made in a message is usually listed here as it arrives, and waits until you decide on the customer's page.
- before: 在消息里提出的要求，通常一到就会列在这里，等你在买家的页面上决定。
- **zh: 在消息里提出的要求，通常一到就会列在这里，等你在客户的页面上决定。**

#### `data.buyers.lead` (changed)

- en: Each is recorded on the customer's own page. Nomi's operator carries it out by hand within 30 days of it being recorded. When it shows as done, tell the customer — Nomi does not write to them about it.
- before: 每一条都在该买家自己的页面上记录。Nomi 的运营方在记录后 30 天内由人手动执行。显示为已完成时，请告诉买家——Nomi 不会就此联系对方。
- **zh: 每一条都在该客户自己的页面上记录。Nomi 的运营方在记录后 30 天内由人手动执行。显示为已完成时，请告诉客户——Nomi 不会就此联系对方。**

#### `data.buyers.none` (changed)

- en: No customer has asked yet.
- before: 还没有买家提出过。
- **zh: 还没有客户提出过。**

#### `data.buyers.title` (changed)

- en: Customers who asked to be deleted
- before: 要求删除数据的买家
- **zh: 要求删除数据的客户**

#### `data.buyers.withdrawConfirm` (changed)

- en: Take this customer's request back? Nothing of theirs will be deleted.
- before: 撤回这个买家的请求？对方的数据都不会被删除。
- **zh: 撤回这个客户的请求？对方的数据都不会被删除。**

#### `data.deletion.lead` (changed)

- en: Everything this workspace holds — customers, messages, products, orders, everything you taught — removed for good.
- before: 这个工作台里的一切——买家、消息、产品、订单、你教过的东西——永久删除。
- **zh: 这个工作台里的一切——客户、消息、产品、订单、你教过的东西——永久删除。**

#### `data.deletion.scope.buyer` (changed)

- en: One customer
- before: 一位买家
- **zh: 一位客户**

#### `data.export.configLead` (changed)

- en: The part nobody wants to type twice: your lowest prices and discounts, how you sell, and every fact you taught.
- before: 这部分没人愿意再输一遍：你的底价和折扣、你的销售条件，以及你教过的每一条。
- **zh: 这部分没人愿意再输一遍：你的最低价和折扣、你怎么卖，以及你教过的每一条。**

#### `data.export.lead` (changed)

- en: One file per kind, in the format a spreadsheet opens. Everything here is yours — what you typed in, and what customers wrote to you.
- before: 每类一个文件，表格软件可以直接打开。这里的一切都是你的——你填进去的，和买家写给你的。
- **zh: 每类一个文件，表格软件可以直接打开。这里的一切都是你的——你填进去的，和客户写给你的。**

#### `data.export.subject.buyers` (changed)

- en: Customers
- before: 买家
- **zh: 客户**

#### `data.export.subject.selling-terms` (changed)

- en: How you sell
- before: 你的销售条件
- **zh: 你怎么卖**

#### `deletionAsked.do` (changed)

- en: Decide on the customer's page, then answer them yourself
- before: 先在买家的页面上做决定，再自己回复对方
- **zh: 先在客户的页面上做决定，再自己回复对方**

#### `deletionAsked.noted` (changed)

- en: Noted on {date}. It waits on the customer's page, on Your data and on Today until you decide; handing the conversation back does not clear it.
- before: 已于 {date} 记下。在你决定之前，这条要求会一直留在买家的页面、「你的数据」和「今天」上；把对话交回也不会清掉这条要求。
- **zh: 已于 {date} 记下。在你决定之前，这条要求会一直留在客户的页面、「你的数据」和「今天」上；把对话交回也不会清掉这条要求。**

#### `deletionAsked.why` (changed)

- en: A deletion is recorded on the customer's page and carried out by Nomi's operator by hand, so nothing about it is promised in the chat.
- before: 删除要在买家的页面上记录，再由 Nomi 的运营方手动执行，所以聊天里不会就删除做任何承诺。
- **zh: 删除要在客户的页面上记录，再由 Nomi 的运营方手动执行，所以聊天里不会就删除做任何承诺。**

#### `factory.about.empty` (changed)

- en: {name} has nothing to tell customers about you yet.
- before: {name}现在还没法向买家介绍你。
- **zh: {name}现在还没法向客户介绍你。**

#### `factory.about.title` (changed)

- en: About your business
- before: 关于你的公司
- **zh: 关于你的生意**

#### `factory.next.channels` (changed)

- en: Connect the account customers write to
- before: 连接买家给你发消息的账号
- **zh: 连接客户给你发消息的账号**

#### `factory.next.first_success` (changed)

- en: Send {name}\'s first reply to a customer
- before: 发出给买家的第一条回复
- **zh: 发出给客户的第一条回复**

#### `factory.next.profile` (changed)

- en: Tell {name} about your business
- before: 告诉{name}你的公司是做什么的
- **zh: 告诉{name}你的生意是做什么的**

#### `factory.prices.q` (changed)

- en: What discounts may {name} give?
- before: {name}在价格上能动多少？
- **zh: {name}最多能给多少优惠？**

#### `factory.promise.ask` (changed)

- en: Above {ask}% off, you are asked before the price goes out.
- before: 让到{ask}%以上，会先问你再报价。
- **zh: 优惠超过{ask}%，会先问你再给价格。**

#### `factory.promise.askVaries` (changed)

- en: Above {ask}% off, you are asked before the price goes out — sooner on some products.
- before: 让到{ask}%以上，会先问你再报价；有些产品更早就问。
- **zh: 优惠超过{ask}%，会先问你再给价格；有些产品更早就问。**

#### `factory.promise.ceiling` (changed)

- en: {name} never discounts more than {ceil}%.
- before: 最多让{ceil}%。
- **zh: 最多优惠{ceil}%。**

#### `factory.promise.ceilingVaries` (changed)

- en: {name} never discounts more than {ceil}% — less on some products.
- before: 最多让{ceil}%，有些产品还更少。
- **zh: 最多优惠{ceil}%，有些产品还更少。**

#### `factory.promise.certsOn` (changed)

- en: {name} may state these to a customer.
- before: 这些{name}可以对买家说。
- **zh: 这些{name}可以对客户说。**

#### `factory.promise.never` (changed)

- en: Anything you have not confirmed here, {name} will not say — even if a customer insists.
- before: 你没有在这里确认过的，{name}不会说，买家追问也不会。
- **zh: 你没有在这里确认过的，{name}不会说，客户追问也不会。**

#### `factory.promise.title` (changed)

- en: What you promise customers
- before: 你对买家的承诺
- **zh: 你对客户的承诺**

#### `factory.reach.nextConnected` (changed)

- en: Customers who message this number reach {name}.
- before: 买家发到这个号码的消息，{name}会收到。
- **zh: 客户发到这个号码的消息，{name}会收到。**

#### `factory.reach.nextNot` (changed)

- en: Until this is connected, {name} cannot receive or answer a customer.
- before: 没有连接之前，{name}收不到也回不了买家。
- **zh: 没有连接之前，{name}收不到也回不了客户。**

#### `factory.reach.other.notConnected` (changed)

- en: {name} cannot answer customers who write here until it is connected.
- before: 连接之前，买家在这里写来的消息{name}回不了。
- **zh: 连接之前，客户在这里写来的消息{name}回不了。**

#### `factory.reach.q` (changed)

- en: Where can customers reach us?
- before: 买家从哪里联系我们？
- **zh: 客户从哪里联系我们？**

#### `factory.reach.title` (changed)

- en: Where customers reach you
- before: 买家在哪里找你
- **zh: 客户在哪里找你**

#### `factory.ready.live` (changed)

- en: {name} is talking to real customers.
- before: {name}正在和真买家聊。
- **zh: {name}正在和真客户聊。**

#### `factory.ready.title` (changed)

- en: Before {name} talks to real customers
- before: 让{name}见真买家之前
- **zh: 让{name}见真客户之前**

#### `factory.rehearsal.claim_not_authorised` (changed)

- en: If a customer asks whether you are certified, {name} will not confirm anything — you have authorised nothing yet.
- before: 买家问你有没有认证，{name}不会给任何确认——你还一个都没授权。
- **zh: 客户问你有没有认证，{name}不会给任何确认——你还一个都没授权。**

#### `factory.rehearsal.lede` (changed)

- en: Customers ask these. Until you fill them in, {name} passes the question to you.
- before: 买家会问这些。你不补上，{name}就只能转给你。
- **zh: 客户会问这些。你不补上，{name}就只能转给你。**

#### `factory.rehearsal.no_price_at_moq` (changed)

- en: Your prices do not cover the smallest quantity you sell, so {name} cannot give a price for these:
- before: 你的价格表没覆盖自己的起订量，这些报不了价：
- **zh: 你的价格没有覆盖你设定的最小数量，这些给不了价格：**

#### `feedback.none` (changed)

- en: Nothing yet — this fills in once customers start talking to {name}.
- before: 还没有内容——等买家开始和{name}聊天后就会出现。
- **zh: 还没有内容——等客户开始和{name}聊天后就会出现。**

#### `forbidden.add.notePlaceholder` (changed)

- en: customers never see this
- before: 买家看不到
- **zh: 客户看不到**

#### `forbidden.floor.body` (changed)

- en: {name} will never curse or insult a customer. You cannot switch this off, and you do not need to add it.
- before: {name}永远不会骂人或者不尊重买家。这个关不掉，你也不用自己加。
- **zh: {name}永远不会骂人或者不尊重客户。这个关不掉，你也不用自己加。**

#### `forbidden.intro` (changed)

- en: Add anything you never want {name} to say to a customer. A reply that contains one is never sent: it is written again without it, and if that cannot be done, it comes to you instead.
- before: 把你不想让{name}对买家说的话加进来。回复里出现这些词就绝不会发出去：会重写一遍，写不好就转给你。
- **zh: 把你不想让{name}对客户说的话加进来。回复里出现这些词就绝不会发出去：会重写一遍，写不好就转给你。**

#### `golive.none` (changed)

- en: Connect a place customers write to, and {name} can start answering them.
- before: 先连上一个买家会写消息来的地方，{name}就能开始回复。
- **zh: 先连上一个客户会写消息来的地方，{name}就能开始回复。**

#### `golive.whatsappOnly` (changed)

- en: This stops WhatsApp only. {channels} keep answering customers.
- before: 这只停止 WhatsApp。{channels}上照常回复买家。
- **zh: 这只停止 WhatsApp。{channels}上照常回复客户。**

#### `her.knows.none` (changed)

- en: Nothing has been taught yet. Start with the facts customers ask about most.
- before: 还什么都没教过。先教买家最常问的那些。
- **zh: 还什么都没教过。先教客户最常问的那些。**

#### `her.recent.noneWhy` (changed)

- en: Customers who message you appear here.
- before: 买家来消息后会出现在这里。
- **zh: 客户来消息后会出现在这里。**

#### `her.teach.unasked` (changed)

- en: No customer has asked anything yet. Teach {name} what they ask about most.
- before: 还没有买家来问过。先教买家最常问的那些。
- **zh: 还没有客户来问过。先教客户最常问的那些。**

#### `inbox.blocked.not_activated` (changed)

- en: Not sent — messaging is switched off. Start {name} in My business and send it again.
- before: 没有发出去——消息还没打开。到"我的公司"让{name}开始，再发一次。
- **zh: 没有发出去——消息还没打开。到"我的生意"让{name}开始，再发一次。**

#### `inbox.blocked.not_allowlisted` (changed)

- en: Not sent — this customer is not on your list yet. Add their number in My business first.
- before: 没有发出去——这个买家还不在你的名单里。先到"我的公司"把号码加上。
- **zh: 没有发出去——这个客户还不在你的名单里。先到"我的生意"把号码加上。**

#### `inbox.blocked.not_connected` (changed)

- en: Not sent — nothing is connected yet that can carry this reply, so it cannot reach this customer.
- before: 没有发出去——还没有连上能送出这条回复的账号，现在发不到这个买家。
- **zh: 没有发出去——还没有连上能送出这条回复的账号，现在发不到这个客户。**

#### `inbox.detail.back` (changed)

- en: Customers
- before: 买家
- **zh: 客户**

#### `inbox.draft.held.contradicts_history` (changed)

- en: This price is higher than the one this customer already has. If you send it, it becomes the price {name} gives them from now on.
- before: 这个价格比这位买家之前拿到的高。发出去的话，以后{name}就按这个价报。
- **zh: 这个价格比这位客户之前拿到的高。发出去的话，以后{name}就按这个价格回复对方。**

#### `inbox.draft.held.disclosure_sent` (changed)

- en: They have already been told: {name} sent them the line saying they are not talking to a person, and offered them someone from your team. So this reply cannot be sent as it stands — change it first, or skip it.
- before: 买家已经知道了：{name}已经把说明发给对方，并告诉对方可以找你的同事。所以这条不能照原样发送——先改一下，或者不回。
- **zh: 客户已经知道了：{name}已经把说明发给对方，并告诉对方可以找你的同事。所以这条不能照原样发送——先改一下，或者不回。**

#### `inbox.draft.held.identity_denial` (changed)

- en: {name} tried to claim to be a person to this customer. That was stopped and never sent. This is a plain stand-in for you to send, change or skip.
- before: {name}想告诉这位买家自己是真人。这已经被拦下，没有发出去。这是一句稳妥的替代回复，你可以发、改，或者不回。
- **zh: {name}想告诉这位客户自己是真人。这已经被拦下，没有发出去。这是一句稳妥的替代回复，你可以发、改，或者不回。**

#### `inbox.draft.held.identity_question` (changed)

- en: This customer asked whether they are talking to a person or a machine, and this reply does not answer them. Nothing was sent.
- before: 这位买家问自己是在跟真人还是跟机器说话，而这条回复没有回答这个问题。什么都没有发出去。
- **zh: 这位客户问自己是在跟真人还是跟机器说话，而这条回复没有回答这个问题。什么都没有发出去。**

#### `inbox.empty.noneBody` (changed)

- en: Messages from customers show up here. Share your WhatsApp number or your page with customers first.
- before: 买家发来的消息会出现在这里。先把 WhatsApp 号发给买家。
- **zh: 客户发来的消息会出现在这里。先把 WhatsApp 号或你的主页发给客户。**

#### `inbox.empty.setup` (changed)

- en: Set up your business so customers can reach you
- before: 把公司设置好，买家才找得到你
- **zh: 把你的生意设置好，客户才找得到你**

#### `inbox.flash.assistant_stopped` (changed)

- en: {name} is stopped, so this draft was not sent. It is still here: write your own reply, or let {name} answer again on My business.
- before: {name}已停下，这条草稿没有发出，仍留在这里：你可以自己回复，或先在「我的公司」让{name}重新回复。
- **zh: {name}已停下，这条草稿没有发出，仍留在这里：你可以自己回复，或先在「我的生意」让{name}重新回复。**

#### `inbox.flash.sentNotLive` (changed)

- en: Saved. Messaging is not switched on yet, so nothing went to the customer.
- before: 已保存。消息通道还没打开，所以没有发给买家。
- **zh: 已保存。消息通道还没打开，所以没有发给客户。**

#### `insight.action.seeBuyers` (changed)

- en: See the customers
- before: 看看买家
- **zh: 看看客户**

#### `insight.monthChange.inquiries.down` (changed)

- en: Fewer customers wrote to you this month: {from} last month, {to} this month.
- before: 这个月写来的买家少了：上个月 {from} 个，这个月 {to} 个。
- **zh: 这个月写来的客户少了：上个月 {from} 个，这个月 {to} 个。**

#### `insight.monthChange.inquiries.up` (changed)

- en: More customers wrote to you this month: {from} last month, {to} this month.
- before: 这个月写来的买家多了：上个月 {from} 个，这个月 {to} 个。
- **zh: 这个月写来的客户多了：上个月 {from} 个，这个月 {to} 个。**

#### `insight.monthChange.quotes.down` (changed)

- en: {name} answered fewer price questions this month: {from} last month, {to} this month.
- before: {name} 这个月报价少了：上个月 {from} 次，这个月 {to} 次。
- **zh: {name} 这个月回答的价格问题少了：上个月 {from} 次，这个月 {to} 次。**

#### `insight.monthChange.quotes.up` (changed)

- en: {name} answered more price questions this month: {from} last month, {to} this month.
- before: {name} 这个月报价多了：上个月 {from} 次，这个月 {to} 次。
- **zh: {name} 这个月回答的价格问题多了：上个月 {from} 次，这个月 {to} 次。**

#### `insight.quotedNoReply` (changed)

- en: {buyer} has not answered since they were given a price.
- before: 给{buyer}报完价之后，对方就没再回话了。
- **zh: 告诉{buyer}价格之后，对方就没再回话了。**

#### `knowledge.archive.confirm` (changed)

- en: Archive “{label}”? {name} stops using it with customers. You can teach it again at any time.
- before: 归档「{label}」？{name}回答买家时不再用这一条。你随时可以重新教。
- **zh: 归档「{label}」？{name}回答客户时不再用这一条。你随时可以重新教。**

#### `knowledge.business` (changed)

- en: About your business
- before: 公司信息
- **zh: 生意信息**

#### `knowledge.cert.confirmOn` (changed)

- en: Turn on {key} for all {n} of your products? {name} will be able to state it to any customer.
- before: 给全部{n}个产品都打开{key}？之后对任何买家都可以说这个了。
- **zh: 给全部{n}个产品都打开{key}？之后对任何客户都可以说这个了。**

#### `knowledge.cert.hint` (changed)

- en: Anything not turned on here is refused, however a customer asks.
- before: 只打开你确实拥有的认证。只有在这里打开的认证，才能对买家说明。
- **zh: 只打开你确实拥有的认证。只有在这里打开的认证，才能对客户说明。**

#### `knowledge.intro` (changed)

- en: Teach the facts about what you sell and your business. {name} answers customers from what you teach — and never states a number or a certification you haven't given.
- before: 把产品和公司的信息教给{name}。只用你教的内容回答买家——绝不会说出你没给过的数字或认证。
- **zh: 把产品和生意的信息教给{name}。只用你教的内容回答客户——绝不会说出你没给过的数字或认证。**

#### `knowledge.kind.production_note` (changed)

- en: How it is made
- before: 生产说明
- **zh: 制作说明**

#### `knowledge.ops.noGaps` (changed)

- en: Nothing waiting — every question was answered from what you taught.
- before: 暂无待处理——买家的问题都能用你教的内容答上。
- **zh: 暂无待处理——客户的问题都能用你教的内容答上。**

#### `knowledge.products` (changed)

- en: What you sell
- before: 你的产品
- **zh: 你卖的东西**

#### `knowledge.taught.scope` (changed)

- en: These facts are used only when a customer asks about {product}.
- before: 只有买家问到「{product}」时才会用这些内容。
- **zh: 只有客户问到「{product}」时才会用这些内容。**

#### `legal.deletion.erased.prepared` (changed)

- en: Replies prepared for you, and any price offers or sample requests.
- before: 为你准备的回复、报价和样品申请。
- **zh: 为你准备的回复，以及任何给你的价格或样品申请。**

#### `legal.privacy.howLong.body` (changed)

- en: Until the business asks for its records to be deleted, or you ask for yours. They are kept so the business can see what was agreed with you, such as a price or an order. What a deletion removes, and what it keeps, is on the deletion page.
- before: 保存到商家要求删除自己的记录、或你要求删除你的记录为止。保存是为了让商家能查到和你谈定的内容——价格、订单、样品。删除会去掉什么、保留什么，见删除页面。
- **zh: 保存到商家要求删除自己的记录、或你要求删除你的记录为止。保存是为了让商家能查到和你谈定的内容，比如价格或订单。删除会去掉什么、保留什么，见删除页面。**

#### `legal.terms.ours.we1` (changed)

- en: A price Nomi gives comes from your own price list and is never below the lowest price you set.
- before: Nomi 报出的价格只来自你自己的价格表，永远不低于你设定的底价。
- **zh: Nomi 给出的价格只来自你自己的价格表，永远不低于你设定的最低价。**

#### `live.message` (changed)

- en: New message from the customer
- before: 买家发来了新消息
- **zh: 客户发来了新消息**

#### `login.footer` (changed)

- en: For your business and the people who work there.
- before: 供你的公司和在这里工作的人使用。
- **zh: 供你的生意和在这里工作的人使用。**

#### `login.toSignup` (changed)

- en: New here? Set up your business
- before: 第一次来？为你的公司开一个工作台
- **zh: 第一次来？为你的生意开一个工作台**

#### `meta.intro` (changed)

- en: What still has to be in place before {name} can talk to real customers. Nothing here switches messaging on.
- before: {name}见真买家之前还差哪些东西。这个页面不会打开消息。
- **zh: {name}见真客户之前还差哪些东西。这个页面不会打开消息。**

#### `meta.live` (changed)

- en: Live — {name} is talking to real customers.
- before: 已上线——{name}正在接待真实买家。
- **zh: 已上线——{name}正在接待真实客户。**

#### `nav.channels` (changed)

- en: Where customers reach you
- before: 买家在哪里找你
- **zh: 客户在哪里找你**

#### `nav.factory` (changed)

- en: My business
- before: 我的公司
- **zh: 我的生意**

#### `nav.inbox` (changed)

- en: Customers
- before: 买家
- **zh: 客户**

#### `nav.prospects` (changed)

- en: Find customers
- before: 找买家
- **zh: 找客户**

#### `neverAllowed.promise_leadtime` (changed)

- en: Promise an unconfirmed delivery time
- before: 答应未经确认的交期
- **zh: 答应未经确认的交付时间**

#### `notify.deletion_requested` (changed)

- en: A customer asked for their data to be deleted. Nothing was sent to them, and it needs an answer from you. The request is noted on the customer's page, where you decide what happens next.
- before: 有买家要求删除自己的数据。没有给对方发任何东西，这需要你来答复。这条要求已记在买家的页面上，下一步在那里决定。
- **zh: 有客户要求删除自己的数据。没有给对方发任何东西，这需要你来答复。这条要求已记在客户的页面上，下一步在那里决定。**

#### `notify.deletion_requested.subject` (changed)

- en: A customer asked for their data to be deleted
- before: 有买家要求删除自己的数据
- **zh: 有客户要求删除自己的数据**

#### `notify.handoff` (changed)

- en: {name} paused — a customer wants to talk to a person. The conversation is waiting for you.
- before: 买家想找真人谈，{name}已暂停回复，等你接手。
- **zh: 客户想找真人谈，{name}已暂停回复，等你接手。**

#### `notify.hot_lead` (changed)

- en: A customer looks ready to buy — {name} is following up.
- before: 有大买家信号，{name}正在继续跟进（今晚总结里有详情）。
- **zh: 有位客户看起来准备下单，{name}正在跟进。**

#### `ops.activity.handled` (changed)

- en: Customers answered
- before: 聊过的买家
- **zh: 聊过的客户**

#### `order.field.buyer` (changed)

- en: Customer
- before: 买家
- **zh: 客户**

#### `order.invoice.sampleMismatch` (changed)

- en: This customer paid {amount} for a sample, which you said comes off the first order. It is in another currency, so it is not deducted here — take it off yourself.
- before: 这位买家付过 {amount} 的样品费，你说过要从第一单里扣。币种不一样，这里没有替你扣，你自己扣一下。
- **zh: 这位客户付过 {amount} 的样品费，你说过要从第一单里扣。币种不一样，这里没有替你扣，你自己扣一下。**

#### `order.state.in_production` (changed)

- en: Being prepared
- before: 生产中
- **zh: 备货中**

#### `order.status.in_production` (changed)

- en: Being prepared
- before: 生产中
- **zh: 备货中**

#### `order.update.intro` (changed)

- en: You set this. {name} tells a customer what you recorded and the day you recorded it — never a delivery date worked out from it.
- before: 这个由你来定。{name} 只会把你记的这一步和记的日子告诉买家——不会拿这个去推交货日期。
- **zh: 这个由你来定。{name} 只会把你记的这一步和记的日子告诉客户——不会拿这个去推交货日期。**

#### `order.update.note.placeholder` (changed)

- en: Not sent to the customer
- before: 不会发给买家
- **zh: 不会发给客户**

#### `people.add.placeholder` (changed)

- en: The name customers would hear
- before: 买家会听到的那个名字
- **zh: 客户会听到的那个名字**

#### `people.held.owner` (changed)

- en: The owner
- before: 厂里的负责人
- **zh: 负责人**

#### `people.intro` (changed)

- en: Everyone here can log in with their own code, reply to a customer, take a conversation over and hand it back. You see who is holding what.
- before: 每个人都有自己的登录码，可以回买家、接过对话、再交回去。谁在管哪一单，你看得见。
- **zh: 每个人都有自己的登录码，可以回客户、接过对话、再交回去。谁在管哪一单，你看得见。**

#### `people.name.askThem` (changed)

- en: This is your business\'s name, not a person\'s. What is the right name here?
- before: 这是公司名，不是人名。这里该写什么名字？
- **zh: 这是商家名，不是人名。这里该写什么名字？**

#### `people.name.askYou` (changed)

- en: Your name here is your business\'s name. What should the people here call you?
- before: 你在这里的名字就是公司名。同事们该怎么称呼你？
- **zh: 你在这里的名字就是商家名。同事们该怎么称呼你？**

#### `pilot.assistant.hint` (changed)

- en: Every reply is signed with this name, so a customer reads it each time. You can change it later on the team page.
- before: 回复会用这个名字署名，买家每次收到回复都会看到。以后可以在团队页面改。
- **zh: 回复会用这个名字署名，客户每次收到回复都会看到。以后可以在团队页面改。**

#### `pilot.assistant.problem.name_missing` (changed)

- en: Type the name customers should see.
- before: 请填写买家会看到的名字。
- **zh: 请填写客户会看到的名字。**

#### `pilot.attest.assistant_named` (changed)

- en: The name customers see
- before: 买家看到的名字
- **zh: 客户看到的名字**

#### `pilot.blocker.channel` (changed)

- en: Connect at least one place customers write to you: WhatsApp, Instagram, Messenger or e-mail.
- before: 至少连接一个买家找你的地方：WhatsApp、Instagram、Messenger 或邮箱。
- **zh: 至少连接一个客户找你的地方：WhatsApp、Instagram、Messenger 或邮箱。**

#### `pilot.blocker.priceRules` (changed)

- en: Tell {name} the least you would ever accept, and how much may come off.
- before: 告诉{name}你最低能接受多少，以及最多可以让多少。
- **zh: 告诉{name}你最低能接受多少，以及最多可以优惠多少。**

#### `pilot.blocker.profile` (changed)

- en: Add your business details.
- before: 填写公司资料。
- **zh: 填写商家资料。**

#### `pilot.intro` (changed)

- en: Everything {name} needs before going live. Most is checked from your real data; the last few you confirm yourself.
- before: {name}见真买家之前要准备的一切。大部分我们照你填过的东西核对，最后几项由你确认。
- **zh: {name}见真客户之前要准备的一切。大部分我们照你填过的东西核对，最后几项由你确认。**

#### `pilot.item.channel` (changed)

- en: Where customers reach you
- before: 买家在哪里找你
- **zh: 客户在哪里找你**

#### `pilot.item.profile` (changed)

- en: Business profile
- before: 公司资料
- **zh: 商家资料**

#### `practice.scripted.intro` (changed)

- en: These run {name} against situations that have gone wrong for other businesses. Nothing here touches your customers.
- before: 这些拿别的公司出过问题的情况来考{name}。这里碰不到你的买家。
- **zh: 这些拿别的商家出过问题的情况来考{name}。这里碰不到你的客户。**

#### `practice.scripted.notproves` (changed)

- en: What it does not prove: how a reply to YOUR customer is worded, or whether your channel delivers it. For that, practise live below once your business is connected.
- before: 这些说明不了：给你的买家回复时会怎么措辞，WhatsApp会不会送到。那要等你的账号连上以后，在下面实时练。
- **zh: 这些说明不了：给你的客户回复时会怎么措辞，你的渠道会不会送到。那要等你的账号连上以后，在下面实时练。**

#### `practice.scripted.proves` (changed)

- en: What this proves: {name} will not give a price below your floor, will not claim a certification you have not confirmed, will not invent a number you never taught, and hands over when a customer asks for a person.
- before: 这些能说明：{name}不会报到你底价以下，不会说你没确认过的认证，不会编你没教过的数字，买家要找真人时会转给你。
- **zh: 这些能说明：{name}不会给出低于你底价的价格，不会说你没确认过的认证，不会编你没教过的数字，客户要找真人时会转给你。**

#### `prices.error.ask_above_max` (changed)

- en: This is higher than the most that may ever come off, so you would never be asked. Lower it, or raise the most that may come off.
- before: 这个比最多能让的还高，那你永远不会被问到。要么调低，要么把最多能让的调高。
- **zh: 这个比最多能给的优惠还高，那你永远不会被问到。要么调低，要么把最多能给的优惠调高。**

#### `prices.flash.volumeAdded` (changed)

- en: Saved. {name} can offer that now.
- before: 保存好了。{name}现在可以这样让价。
- **zh: 保存好了。{name}现在可以给这个优惠。**

#### `prices.lede` (changed)

- en: These are the only numbers {name} will ever work within — never below what you set here, whatever a customer says.
- before: {name}只会在这几个数字之间谈。你定的底线以下，买家怎么说都不会松口。
- **zh: {name}只会在这几个数字之内给价格。你定的底线以下，客户怎么说都不会松口。**

#### `prices.q.askAbove` (changed)

- en: Above how much off should you be asked first? (%)
- before: 让到多少以上，要先问你？（%）
- **zh: 优惠超过多少，要先问你？（%）**

#### `prices.q.floor` (changed)

- en: What is the least you would ever accept for one of these? ({currency})
- before: 一个最低你能接受多少钱？（美元）
- **zh: 一个最低你能接受多少钱？（{currency}）**

#### `prices.q.maxDiscount` (changed)

- en: What is the most that may ever come off, even with your OK? (%)
- before: 就算你同意，最多能让多少？（%）
- **zh: 就算你同意，最多能优惠多少？（%）**

#### `prices.stated` (changed)

- en: Never below {floor}. Up to {ask}% off is decided without you; above that you are asked first. Never more than {max}% off.
- before: 不低于 {floor}。让 {ask}% 以内自己定，超过就先问你。最多让 {max}%。
- **zh: 不低于 {floor}。优惠 {ask}% 以内自己定，超过就先问你。最多优惠 {max}%。**

#### `prices.volume.error.above_max` (changed)

- en: This is more than the most you said may ever come off. Lower it, or raise that limit first.
- before: 这比你说的最多能让的还多。要么调低，要么先把上限提上去。
- **zh: 这比你说的最多能给的优惠还多。要么调低，要么先把上限提上去。**

#### `prices.volume.none` (changed)

- en: You have not written one, so no discount is ever offered — your price is quoted as it stands.
- before: 你还没写，所以从不让价——按你的价原样报。
- **zh: 你还没写，所以从不优惠——按你的价原样给。**

#### `prices.volume.q.discount` (changed)

- en: How much off? (%)
- before: 让多少？（%）
- **zh: 优惠多少？（%）**

#### `prices.volume.removeConfirm` (changed)

- en: Stop offering this discount? It will not be offered to customers any more.
- before: 不再给这个优惠？之后不会再向买家提出。
- **zh: 不再给这个优惠？之后不会再向客户提出。**

#### `prices.volume.row` (changed)

- en: {product} — from {qty} pieces: {pct}% off
- before: {product}——{qty}个起，让{pct}%
- **zh: {product}——{qty}个起，优惠{pct}%**

#### `prices.volume.sub` (changed)

- en: {name} never invents a discount. Only what you write here comes off, and never more than the most you allow above.
- before: {name}不会自己想出折扣。只有你写在这里的才会让，而且绝不超过上面你定的上限。
- **zh: {name}不会自己想出折扣。只有你写在这里的才会给，而且绝不超过上面你定的上限。**

#### `prices.volume.title` (changed)

- en: Discounts for buying more
- before: 什么时候可以让价
- **zh: 买得多时的优惠**

#### `product.add.example1` (changed)

- en: Canvas tote bag {price}
- before: 帆布袋 1.05美元 500个起
- **zh: 帆布托特包 {price}**

#### `product.add.example2` (changed)

- en: Vacuum cup {price} MOQ 1000
- before: 保温杯 $2.60 MOQ 1000
- **zh: 保温杯 {price} MOQ 1000**

#### `product.add.example3` (changed)

- en: Rose face serum 50 ml {price}
- before: 玫瑰精华 50 ml $34.90
- **zh: 玫瑰精华 50 ml {price}**

#### `product.add.intro` (changed)

- en: Paste your products and their prices — one per line, messy is fine.
- before: 把你的价格表贴进来就行——一行一个产品，乱一点没关系。
- **zh: 把你的产品和价格贴进来就行——一行一个，乱一点没关系。**

#### `product.detail.aliasesNote` (changed)

- en: {name} recognizes all of these when customers ask.
- before: 买家用这些说法问，{name}都能认出来。
- **zh: 客户用这些说法问，{name}都能认出来。**

#### `product.detail.aliasesTitle` (changed)

- en: What customers call it
- before: 买家的叫法
- **zh: 客户的叫法**

#### `product.detail.imageMatchBig` (changed)

- en: Recognizable by photo — {name} identifies this when customers send a picture
- before: 可以被图片识别 — 买家发照片，{name}能认出这个产品
- **zh: 可以被图片识别 — 客户发照片，{name}能认出这个产品**

#### `product.detail.leadTime` (changed)

- en: Delivery time
- before: 交期
- **zh: 交付时间**

#### `product.detail.notFindable` (changed)

- en: Customers cannot find this product yet: it has no name their messages can be matched to. Add the names customers use below, and it can be found and quoted.
- before: 买家还搜不到这个产品：没有能和买家消息对上的名称。在下面加上买家的叫法，就能被找到并报价。
- **zh: 客户还搜不到这个产品：没有能和客户消息对上的名称。在下面加上客户的叫法，就能被找到并报价。**

#### `product.edit.active` (changed)

- en: Offer this to customers
- before: 对买家开卖
- **zh: 对客户开卖**

#### `product.edit.customerNames` (changed)

- en: Add names customers use
- before: 添加买家的叫法
- **zh: 添加客户的叫法**

#### `product.edit.customerNames.hint` (changed)

- en: One per line. The product is found by any of them; the names already here stay.
- before: 每行一个。买家用其中任何一个说法都能找到这个产品；已有的叫法会保留。
- **zh: 每行一个。客户用其中任何一个说法都能找到这个产品；已有的叫法会保留。**

#### `product.edit.price` (changed)

- en: Price for one ({currency})
- before: 一个多少钱（美元）
- **zh: 一个多少钱（{currency}）**

#### `product.list.empty.body` (changed)

- en: Add your products and prices, and {name} can answer with your prices.
- before: 把你的价格表发过来，{name}就能开始按你的价格报价。
- **zh: 把你的产品和价格加进来，{name}就能按你的价格回复。**

#### `product.reject.other_currency`

- en: this line is in another currency — this workspace sells in {currency}
- **zh: 这行是别的货币，这里只用 {currency}**

#### `product.reject.several_numbers` (changed)

- en: several numbers and none marked as the price — put {sign} before it
- before: 这行有好几个数字，没标出哪个是价格，请在价格前加 $
- **zh: 这行有好几个数字，没标出哪个是价格，请在价格前加 {sign}**

#### `product.status.notFindable` (changed)

- en: Customers cannot find it yet
- before: 买家还搜不到这个产品
- **zh: 客户还搜不到这个产品**

#### `product.status.notOffered` (changed)

- en: Not offered to customers
- before: 未向买家提供
- **zh: 未向客户提供**

#### `proof.fact.leadTime` (changed)

- en: Ready in
- before: 交期
- **zh: 交付时间**

#### `proof.footer.explain` (changed)

- en: Every figure on this page comes from the business\u2019s own records. Nothing here was estimated.
- before: 这页上的每个数字都来自公司自己的记录，没有一个是估的。
- **zh: 这页上的每个数字都来自商家自己的记录，没有一个是估的。**

#### `proof.leadTime.withheld` (changed)

- en: Not yet — closed for {label}, {from} to {to}
- before: 暂定不了——公司{label}休息，{from} 至 {to}
- **zh: 暂定不了——{label}休息，{from} 至 {to}**

#### `proof.owner.flash.issued` (changed)

- en: Link ready. Paste it to the customer.
- before: 链接好了，发给买家就行。
- **zh: 链接好了，发给客户就行。**

#### `proof.owner.live` (changed)

- en: Link sent to this customer:
- before: 已经给这个买家的链接：
- **zh: 已经给这个客户的链接：**

#### `proof.owner.none` (changed)

- en: You can send this customer a page showing where the price came from.
- before: 你可以给这个买家一个网页，让对方看到价格是怎么来的。
- **zh: 你可以给这个客户一个网页，让对方看到价格是怎么来的。**

#### `proof.quote.title` (changed)

- en: Your price
- before: 这次报价
- **zh: 这次的价格**

#### `proof.source.authorised` (changed)

- en: Authorised by the business
- before: 公司授权
- **zh: 商家授权**

#### `proof.source.catalogue` (changed)

- en: From the business's own product list
- before: 来自公司的产品资料
- **zh: 来自商家的产品资料**

#### `proof.source.taught` (changed)

- en: Confirmed by the business
- before: 公司确认过
- **zh: 商家确认过**

#### `prospects.intro` (changed)

- en: Search for people who might buy from you. Nothing here writes to anyone: people you add join your list with nothing on file saying you may write to them, and their row says so.
- before: 搜索会买你产品的人。这里不会给任何人发东西：你加进来的人进入名单时，没有任何记录说你可以联系对方，名单里那一行会写明。
- **zh: 搜索可能会向你购买的人。这里不会给任何人发东西：你加进来的人进入名单时，没有任何记录说你可以联系对方，名单里那一行会写明。**

#### `prospects.title` (changed)

- en: Find customers
- before: 找买家
- **zh: 找客户**

#### `rate.add.label` (changed)

- en: One {from} is worth, in {to}
- before: 一美元折人民币
- **zh: 1 {from} 折成 {to}**

#### `rate.current` (changed)

- en: 1 {from} = {rate} {to}
- before: 1美元 = {rate}元
- **zh: 1 {from} = {rate} {to}**

#### `rate.empty` (changed)

- en: You have not set a rate yet, so nothing is shown in {to}.
- before: 你还没定汇率，所以不显示人民币。
- **zh: 你还没定汇率，所以不显示 {to}。**

#### `rate.flash.none`

- en: Your prices are in the currency your country uses, so there is no rate to set. Nothing was saved.
- **zh: 你的价格用的就是你所在国家的货币，不用定汇率，什么都没有存。**

#### `rate.flash.set` (changed)

- en: Saved. {name} will use 1 {from} = {rate} {to} until you change it.
- before: 记下了。{name} 会一直用 1美元 = {rate}元，直到你改。
- **zh: 记下了。{name} 会一直用 1 {from} = {rate} {to}，直到你改。**

#### `rate.intro` (changed)

- en: Customers pay in {from}. When you want to see what that is in {to}, {name} uses the rate you set here — never a rate from anywhere else.
- before: 买家付美元。你想看折成人民币是多少的时候，{name} 用的是你在这里定的汇率——不会用别处来的。
- **zh: 客户付的是 {from}。你想看折成 {to} 是多少的时候，{name} 用的是你在这里定的汇率——不会用别处来的。**

#### `rate.none`

- en: Your prices are in {from}, and nothing here is shown in another currency, so there is no rate to set.
- **zh: 你的价格都是 {from}，这里不会折成别的货币，所以不用定汇率。**

#### `reach.inbound.connected` (changed)

- en: Connected. {name} answers people who write here.
- before: 接上了。买家在这边写过来，{name}就能回。
- **zh: 接上了。有人在这边写过来，{name}就能回。**

#### `reach.inbound.flash.taken` (changed)

- en: Another business on this installation already uses that account.
- before: 这套安装里已有另一家公司在用这个账号。
- **zh: 这套安装里已有另一个商家在用这个账号。**

#### `reach.instead.buyer_writes_first` (changed)

- en: Someone writes first, and {name} answers the usual way.
- before: 买家先来找你，{name}照常回。
- **zh: 对方先来找你，{name}照常回。**

#### `reach.instead.click_to_whatsapp` (changed)

- en: Someone taps an advert of yours and it opens WhatsApp, with you.
- before: 买家点了你的广告，就直接开到 WhatsApp 上找你。
- **zh: 有人点了你的广告，就直接开到 WhatsApp 上找你。**

#### `reach.req.business_verification` (changed)

- en: WhatsApp has checked your business
- before: WhatsApp 核过你的公司
- **zh: WhatsApp 核过你的商家身份**

#### `reach.req.privacy_policy_url` (changed)

- en: A page of your own saying how you handle what customers tell you
- before: 你自己的一页，写明买家告诉你的东西你怎么处理
- **zh: 你自己的一页，写明客户告诉你的东西你怎么处理**

#### `refused.do.not_activated` (changed)

- en: Start {name} in My business when you are ready.
- before: 想好了就在「我的公司」里让{name}开始。
- **zh: 想好了就在「我的生意」里让{name}开始。**

#### `refused.do.not_allowlisted` (changed)

- en: Add this number in My business, or leave it — nothing will be sent to it.
- before: 在「我的公司」里加上这个号码；不加也行，就不会发到这个号码。
- **zh: 在「我的生意」里加上这个号码；不加也行，就不会发到这个号码。**

#### `refused.do.outreach_unchecked` (changed)

- en: Open their row on Who you may write to. If it reads that you can write to them, send it again.
- before: 去"可以联系的客户"里看看这个人那一行。上面写着可以联系，就再发一次。
- **zh: 去"你可以联系谁"里看看这个人那一行。上面写着可以联系，就再发一次。**

#### `refused.do.stopped` (changed)

- en: Reply yourself — your own replies still go. To let {name} answer again, open My business.
- before: 你自己回——你发的照常送达。要让{name}重新回复，去「我的公司」。
- **zh: 你自己回——你发的照常送达。要让{name}重新回复，去「我的生意」。**

#### `refused.none` (changed)

- en: Every message prepared reached its customer.
- before: 准备好的每条消息都送到了买家手上。
- **zh: 准备好的每条消息都送到了客户手上。**

#### `refused.title` (changed)

- en: Messages that did not reach a customer
- before: 没送到买家手上的消息
- **zh: 没送到客户手上的消息**

#### `refused.what.not_allowlisted` (changed)

- en: This customer is not on your list yet.
- before: 这个买家还不在你的名单里。
- **zh: 这个客户还不在你的名单里。**

#### `refused.what.window_closed` (changed)

- en: WhatsApp no longer allows a reply to this customer.
- before: WhatsApp 现在不让给这个买家发消息了。
- **zh: WhatsApp 现在不让给这个客户发消息了。**

#### `refused.what.window_needs_owner` (changed)

- en: This customer can now only be reached with a pre-approved message.
- before: 现在只能用事先批过的固定内容联系这个买家。
- **zh: 现在只能用事先批过的固定内容联系这个客户。**

#### `refused.why.daily_ceiling` (changed)

- en: A daily maximum protects you from a runaway mistake reaching real customers.
- before: 每天有个上限，万一出岔子也不会一直发给真买家。
- **zh: 每天有个上限，万一出岔子也不会一直发给真客户。**

#### `refused.why.window_closed` (changed)

- en: WhatsApp only lets a business reply within a day of the customer’s last message. That day has passed.
- before: WhatsApp 规定：买家发来消息后，商家只有一天可以回。这一天过了。
- **zh: WhatsApp 规定：客户发来消息后，商家只有一天可以回。这一天过了。**

#### `runbook.after.intro` (changed)

- en: Once real customers have talked to {name}, come back and review:
- before: 等真实买家和{name}聊过之后，回来看看：
- **zh: 等真实客户和{name}聊过之后，回来看看：**

#### `runbook.deploy.unauthoredPriceRules` (changed)

- en: {n} price rules were written by the old importer, not by the owner: floor equal to the list price, no discount authority. Nothing rewrites them — ask the owner the three questions and let those answers replace them.
- before: 有 {n} 条价格规则是旧导入自动写的，没人定过：底价等于标价，也没有让价空间。不会自动改——把三个问题问一遍，用真实答案覆盖。
- **zh: 有 {n} 条价格规则是旧导入自动写的，没人定过：底价等于标价，也没有优惠空间。不会自动改——把三个问题问一遍，用真实答案覆盖。**

#### `runbook.engine.title` (changed)

- en: Safety checks against this business’s own data
- before: 用本厂真实数据做的安全检查
- **zh: 用你自己的真实数据做的安全检查**

#### `runbook.practice.intro` (changed)

- en: Rehearse the whole flow in Practice — no real customers involved.
- before: 在练习里把整个流程演练一遍——不涉及真实买家。
- **zh: 在练习里把整个流程演练一遍——不涉及真实客户。**

#### `runbook.step.buyer` (changed)

- en: Send a customer question
- before: 发一条买家问题
- **zh: 发一条客户问题**

#### `samples.asked.title` (changed)

- en: This customer asked for a sample
- before: 这个买家要样品
- **zh: 这个客户要样品**

#### `samples.intro` (changed)

- en: Nearly every customer asks for one. Tell {name} what a sample costs and whether it comes off the first order, and {name} can answer. Until you do, nothing is said about samples.
- before: 几乎每个买家都会问。告诉 {name} 一个样品多少钱、能不能从第一单里扣，就能回答。你没说之前，关于样品一个字都不会讲。
- **zh: 几乎每个客户都会问。告诉 {name} 一个样品多少钱、能不能从第一单里扣，就能回答。你没说之前，关于样品一个字都不会讲。**

#### `samples.requests.address.placeholder` (changed)

- en: Paste the address the customer gave you
- before: 把买家给的地址贴进来
- **zh: 把客户给的地址贴进来**

#### `samples.requests.title` (changed)

- en: Customers waiting for a sample
- before: 等样品的买家
- **zh: 等样品的客户**

#### `sandbox.banner` (changed)

- en: This is practice only. Nothing reaches a real customer.
- before: 这里只是练习，不会发给任何真实买家。
- **zh: 这里只是练习，不会发给任何真实客户。**

#### `sandbox.case.arabic-human-request-escalates` (changed)

- en: Customer asks for a real person (Arabic)
- before: 买家要求真人（阿拉伯文）
- **zh: 客户要求真人（阿拉伯文）**

#### `sandbox.case.chinese-human-request-escalates` (changed)

- en: Customer asks for a real person (Chinese)
- before: 买家要求真人（中文）
- **zh: 客户要求真人（中文）**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-ar` (changed)

- en: Customer asks to delete a line from the quote (Arabic)
- before: 买家要删掉报价里的一行（阿拉伯文）
- **zh: 客户要删掉报价里的一行（阿拉伯文）**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-en` (changed)

- en: Customer asks to delete a line from the quote (English)
- before: 买家要删掉报价里的一行（英文）
- **zh: 客户要删掉报价里的一行（英文）**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-zh` (changed)

- en: Customer asks to delete a line from the quote (Chinese)
- before: 买家要删掉报价里的一行（中文）
- **zh: 客户要删掉报价里的一行（中文）**

#### `sandbox.case.deletion-request-ar-hands-off-silently` (changed)

- en: Customer asks for their data to be deleted (Arabic)
- before: 买家要求删除自己的数据（阿拉伯文）
- **zh: 客户要求删除自己的数据（阿拉伯文）**

#### `sandbox.case.deletion-request-en-hands-off-silently` (changed)

- en: Customer asks for their data to be deleted (English)
- before: 买家要求删除自己的数据（英文）
- **zh: 客户要求删除自己的数据（英文）**

#### `sandbox.case.deletion-request-zh-hands-off-silently` (changed)

- en: Customer asks for their data to be deleted (Chinese)
- before: 买家要求删除自己的数据（中文）
- **zh: 客户要求删除自己的数据（中文）**

#### `sandbox.case.discount-above-ask-line-waits-for-owner` (changed)

- en: A discount big enough that you are asked first
- before: 让得多到要先问你的一笔折扣
- **zh: 大到要先问你的一笔优惠**

#### `sandbox.case.explicit-human-request-escalates-en` (changed)

- en: Customer asks for a real person (English)
- before: 买家要求真人（英文）
- **zh: 客户要求真人（英文）**

#### `sandbox.case.higher-price-than-already-given-waits-for-owner` (changed)

- en: A price higher than this customer got last time
- before: 比这位买家上次拿到的价格高
- **zh: 比这位客户上次拿到的价格高**

#### `sandbox.case.identity-bare-no-never-reaches-the-buyer` (changed)

- en: A bare “no” to “are you a bot?” is stopped
- before: 买家问是不是真人，光回一句“是”会被拦下
- **zh: 客户问是不是真人，光回一句“是”会被拦下**

#### `sandbox.case.low-confidence-match-asks-to-confirm` (changed)

- en: An unclear match asks the customer to confirm
- before: 产品对不准时会先问买家
- **zh: 产品对不准时会先问客户**

#### `sandbox.case.price-floor-clamp-under-aggressive-discount` (changed)

- en: Customer pushes hard for a discount
- before: 买家拼命压价
- **zh: 客户拼命压价**

#### `sandbox.case.unknown-product-yields-no-quote` (changed)

- en: Customer asks about something you don't sell
- before: 买家问的产品你不做
- **zh: 客户问的东西你不卖**

#### `sandbox.composer.label` (changed)

- en: Send a message as the customer
- before: 以买家身份发送消息
- **zh: 以客户身份发送消息**

#### `sandbox.composer.placeholder` (changed)

- en: Type what a customer might say…
- before: 输入买家可能会说的话……
- **zh: 输入客户可能会说的话……**

#### `sandbox.composer.send` (changed)

- en: Send as customer
- before: 以买家身份发送
- **zh: 以客户身份发送**

#### `sandbox.empty` (changed)

- en: No messages yet. Send one as the customer to begin.
- before: 还没有消息。先以买家身份发一条吧。
- **zh: 还没有消息。先以客户身份发一条吧。**

#### `sandbox.intro` (changed)

- en: Play the customer. Watch how {name} replies — and approve or change anything before it would ever go out.
- before: 你来扮演买家，看看{name}怎么回复——在真正发出之前，你可以先审批或修改。
- **zh: 你来扮演客户，看看{name}怎么回复——在真正发出之前，你可以先审批或修改。**

#### `settings.alerts.desc` (changed)

- en: Where {name} messages you — a strong buying signal or a handoff. Your own WhatsApp.
- before: {name}遇到大买家或需要你接手时，往这个号码发消息——你自己的 WhatsApp。
- **zh: {name}遇到很想买的客户或需要你接手时，往这个号码发消息——你自己的 WhatsApp。**

#### `settings.currency.fixed`

- en: Your prices are in this currency, so it stays: a second currency would mean converting, and nothing here converts.
- **zh: 你的价格都是用这种货币定的，所以不再改：换第二种货币就得换算，而这里不做换算。**

#### `settings.currency.label`

- en: The currency you sell in
- **zh: 你卖货用的货币**

#### `settings.currency.title`

- en: Currency
- **zh: 货币**

#### `settings.currency.why`

- en: Every price you set, and every price a customer is given, is in this currency. Nothing is converted. It can change until the first price is set.
- **zh: 你定的每个价格、客户拿到的每个价格，都用这种货币，不做换算。设好第一个价格之前可以改。**

#### `settings.err.phoneShape` (changed)

- en: Start with + and the country code.
- before: 要以+和国家号开头，比如 +8657985001234。
- **zh: 要以+和国家号开头。**

#### `settings.field.name` (changed)

- en: Business name
- before: 公司名称
- **zh: 商家名称**

#### `settings.flash.currencyFixed`

- en: Prices are already set in the current currency, so it stays. Nothing was changed.
- **zh: 已经有价格是用现在的货币定的，所以货币不变，什么都没有改。**

#### `settings.flash.currencyInvalid`

- en: That is not a currency this workspace can sell in. Nothing was changed.
- **zh: 这里不能用这种货币卖货，什么都没有改。**

#### `settings.flash.currencySaved`

- en: Currency saved. Every price from now on is in it.
- **zh: 货币已保存，之后的价格都用这种货币。**

#### `settings.flash.zoneInvalid`

- en: That time zone was not recognised. Nothing was changed.
- **zh: 没有识别出这个时区，什么都没有改。**

#### `settings.flash.zoneSaved`

- en: Time zone saved. Dates and times now follow it.
- **zh: 时区已保存，日期和时间现在按这个时区显示。**

#### `settings.profile.title` (changed)

- en: Business profile
- before: 企业资料
- **zh: 商家资料**

#### `settings.workingHours.ph` (changed)

- en: 9:00–18:00 on working days
- before: 9:00-18:00 周一至周六
- **zh: 工作日 9:00-18:00**

#### `settings.zone.label`

- en: Your time zone
- **zh: 你所在的时区**

#### `settings.zone.title`

- en: Time zone
- **zh: 时区**

#### `settings.zone.why`

- en: Every date and time here, and what counts as "today", is in this zone.
- **zh: 这里所有的日期和时间，以及“今天”，都按这个时区算。**

#### `signup.about` (changed)

- en: About your business
- before: 关于你的公司
- **zh: 关于你的生意**

#### `signup.channels` (changed)

- en: Where do customers write to you today?
- before: 现在买家通过哪里联系你？
- **zh: 现在客户通过哪里联系你？**

#### `signup.currency`

- en: The currency you sell in
- **zh: 你卖货用的货币**

#### `signup.factory` (changed)

- en: Business name
- before: 公司名称
- **zh: 商家名称**

#### `signup.kind` (changed)

- en: What kind of business is it?
- before: 你的公司是哪一类？
- **zh: 你的生意是哪一类？**

#### `signup.lead` (changed)

- en: One workspace for your business. You sign in with your own e-mail and password.
- before: 一家公司一个工作台。你用自己的邮箱和密码登录。
- **zh: 每个生意一个工作台。你用自己的邮箱和密码登录。**

#### `signup.problem.currency_missing`

- en: Which currency do you sell in? Every price here will be in it.
- **zh: 你用哪种货币卖货？这里所有的价格都用这种货币。**

#### `signup.problem.factory_missing` (changed)

- en: Tell us what your business is called.
- before: 请告诉我们你的公司叫什么。
- **zh: 请告诉我们你的生意叫什么。**

#### `signup.problem.kind_missing` (changed)

- en: Choose the kind of business.
- before: 请选择公司的类别。
- **zh: 请选择生意的类别。**

#### `signup.problem.zone_missing`

- en: Your country has more than one time zone. Which one are you in?
- **zh: 你所在的国家有多个时区，请选你所在的时区。**

#### `signup.sells.placeholder` (changed)

- en: e.g. skincare, clothing, social media ads or custom canvas bags
- before: 例如：为品牌和活动定制帆布袋
- **zh: 例如：护肤品、服装、社交媒体广告或定制帆布袋**

#### `signup.title` (changed)

- en: Set up your business
- before: 为你的公司开一个工作台
- **zh: 为你的生意开一个工作台**

#### `signup.welcome` (changed)

- en: Your workspace is ready. Start by telling {name} about your business.
- before: 工作台开好了。先告诉{name}你的公司是做什么的。
- **zh: 工作台开好了。先告诉{name}你的生意是做什么的。**

#### `signup.zone`

- en: Your time zone
- **zh: 你所在的时区**

#### `site.channels.email.how` (changed)

- en: From your business’s own mailbox.
- before: 通过你公司自己的邮箱。
- **zh: 通过你自己的邮箱。**

#### `site.channels.instagram.how` (changed)

- en: Through your business’s own Instagram account, linked to its Facebook Page.
- before: 通过你公司自己的 Instagram 账号，和公司的 Facebook 主页一起连接。
- **zh: 通过你自己的 Instagram 商业账号，和你的 Facebook 主页一起连接。**

#### `site.channels.messenger.how` (changed)

- en: Through your business’s own Facebook Page.
- before: 通过你公司自己的 Facebook 主页。
- **zh: 通过你自己的 Facebook 主页。**

#### `site.channels.title` (changed)

- en: Where your customers already write
- before: 买家在哪里找你，就在哪里回复
- **zh: 客户在哪里找你，就在哪里回复**

#### `site.description` (changed)

- en: Nomi gives your business an assistant you name, to answer your customers on WhatsApp, Instagram, Messenger and e-mail: replies drafted for you to approve, and nothing sent alone unless you allow it.
- before: Nomi 给你的生意配一位由你取名的助手，在 WhatsApp、Instagram、Messenger 和邮件上接待买家：回复先写好等你批准，没有你的允许，什么都不会自己发出。
- **zh: Nomi 给你的生意配一位由你取名的助手，在 WhatsApp、Instagram、Messenger 和邮件上回复客户：回复先写好等你批准，没有你的允许，什么都不会自己发出。**

#### `site.example.from` (changed)

- en: A customer, on Instagram
- before: 一位买家，来自 Instagram
- **zh: 一位客户，来自 Instagram**

#### `site.hero.alone` (changed)

- en: Nothing goes out on its own until you allow it, and then only what you allowed. No price ever goes below the lowest price you set.
- before: 没有你的允许，什么都不会自己发出去；允许之后，也只发你允许的那部分。报价永远不低于你设定的底价。
- **zh: 没有你的允许，什么都不会自己发出去；允许之后，也只发你允许的那部分。任何价格都不会低于你设定的最低价。**

#### `site.hero.lead` (changed)

- en: Nomi gives your business an assistant you name. When a customer writes on WhatsApp, Instagram, Messenger or e-mail, your assistant drafts the reply from your own products and prices, and you approve it.
- before: Nomi 给你的生意配一位助手，名字由你来取。买家在 WhatsApp、Instagram、Messenger 或邮件上来消息，助手按你自己的产品和价格写好回复，你批准后发出。
- **zh: Nomi 给你的生意配一位助手，名字由你来取。客户在 WhatsApp、Instagram、Messenger 或邮件上来消息，助手按你自己的产品和价格写好回复，你批准后发出。**

#### `site.hero.title` (changed)

- en: Every customer gets an answer. You keep the last word.
- before: 每位买家都有回复，最后说了算的是你。
- **zh: 每位客户都有回复，最后说了算的是你。**

#### `site.how.1.body` (changed)

- en: Add what you sell, your prices and the lowest you accept, and the facts customers ask about. Then choose your assistant’s name. Replies come only from what you teach: never a price or a claim you have not given.
- before: 填上你卖什么、价格和每样产品能接受的最低价，再加上买家常问的信息，然后给助手取个名字。回复只用你教的内容：你没给过的数字或认证，一个都不会说。
- **zh: 填上你卖什么、价格和能接受的最低价，再加上客户常问的信息，然后给助手取个名字。回复只用你教的内容：你没给过的价格或说法，一个都不会说。**

#### `site.how.2.title` (changed)

- en: A customer writes
- before: 买家来消息
- **zh: 客户来消息**

#### `site.invite.body` (changed)

- en: Nomi opens workspaces by invitation for now. Write to us with your business’s name, what you sell and where your customers write to you, and we will write back.
- before: Nomi 目前凭邀请开通。写信告诉我们你的公司名、卖什么、买家通常在哪里找你，我们会回信。
- **zh: Nomi 目前凭邀请开通。写信告诉我们你的生意名称、卖什么、客户通常在哪里找你，我们会回信。**

#### `site.title` (changed)

- en: Nomi — an assistant that answers your customers
- before: Nomi — 替你接待买家的助手
- **zh: Nomi — 替你回复客户的助手**

#### `site.who.body` (changed)

- en: Any business that sells or talks to customers over social media and e-mail — clothing and beauty brands, online stores, startups, agencies and services, as well as makers, exporters and wholesalers.
- before: 任何买家会发消息来问产品和价格的生意——生产商和作坊、贸易商和批发商、品牌、门店、代理和服务商。
- **zh: 任何通过社交媒体和邮件卖东西、和客户沟通的生意——服装和美妆品牌、网店、初创公司、代理和服务商，也包括生产商、外贸公司和批发商。**

#### `site.yours.alone.body` (changed)

- en: At first, every reply waits for you. You can let greetings and questions go out on their own while anything with a price waits, or let prices go too. No order is confirmed without you.
- before: 一开始，每条回复都等你。你可以让打招呼、回答问题自己发出去，带价格的先给你看；也可以连报价一起放手。没有你，订单不会被确认。
- **zh: 一开始，每条回复都等你。你可以让打招呼、回答问题自己发出去，带价格的先给你看；也可以连带价格的回复一起放手。没有你，订单不会被确认。**

#### `site.yours.back.body` (changed)

- en: One choice puts every reply back in front of you, and stopping sends nothing further. Your customers, conversations and everything you taught stay, and you can take a copy as spreadsheet files.
- before: 选一下，每条回复就重新先给你看；停下之后不会再发任何消息。买家、对话和你教过的东西都原样留着，还可以导出一份，表格软件直接打开。
- **zh: 选一下，每条回复就重新先给你看；停下之后不会再发任何消息。客户、对话和你教过的东西都原样留着，还可以导出一份，表格软件直接打开。**

#### `site.yours.honest` (changed)

- en: When your assistant replies without you, the first message tells the customer they are not talking to a person, and offers them someone from your team.
- before: 不经你过目就回复时，第一条消息会告诉买家，回复的不是真人，并可以帮买家转给你的同事。
- **zh: 不经你过目就回复时，第一条消息会告诉客户，回复的不是真人，并可以帮客户转给你的同事。**

#### `site.yours.prices.body` (changed)

- en: Prices come only from what you set, and never go below your lowest. A discount beyond the line you set comes to you first.
- before: 报价只按你的价格规矩来，永远不低于你的底价。超过你设的让利线，先问你。
- **zh: 价格只按你定的来，永远不低于你的最低价。超过你设的优惠线，先问你。**

#### `spotcheck.buyerSaid` (changed)

- en: The customer asked
- before: 买家问
- **zh: 客户问**

#### `staff.deletionAsked` (changed)

- en: The owner decides on the customer's page. Answer them yourself.
- before: 由老板在买家的页面上决定。请你自己回复对方。
- **zh: 由老板在客户的页面上决定。请你自己回复对方。**

#### `takeover.flash.assistant_stopped` (changed)

- en: {name} is stopped, so this conversation stays with you. Let {name} answer again on My business first.
- before: {name}已停下，这段对话还由你来回。先在「我的公司」让{name}重新回复。
- **zh: {name}已停下，这段对话还由你来回。先在「我的生意」让{name}重新回复。**

#### `takeover.reason.deletion_requested` (changed)

- en: the customer asked for their data to be deleted
- before: 买家要求删除自己的数据
- **zh: 客户要求删除自己的数据**

#### `takeover.reason.human_requested` (changed)

- en: the customer asked for a person
- before: 买家要求真人
- **zh: 客户要求真人**

#### `takeover.reason.media_unreadable` (changed)

- en: something the customer sent that could not be opened
- before: 买家发来的东西打不开
- **zh: 客户发来的东西打不开**

#### `takeover.reason.repeated_ambiguity` (changed)

- en: the customer's need stayed unclear
- before: 一直没弄清买家的需求
- **zh: 一直没弄清客户的需求**

#### `takeover.replyPlaceholder` (changed)

- en: Type your reply to the customer…
- before: 输入你要回复买家的话……
- **zh: 输入你要回复客户的话……**

#### `terms.flash.payment_missing` (changed)

- en: Write how customers pay you first.
- before: 先写付款方式。
- **zh: 先写客户怎么付款。**

#### `terms.incoterm.hint` (changed)

- en: This goes on your proformas, and {name} may mention it to customers.
- before: 会写在你的形式发票上，{name}也可以跟买家提。
- **zh: 会写在你的形式发票上，{name}也可以跟客户提。**

#### `terms.intro` (changed)

- en: What goes on a proforma when a customer confirms. {name} never makes these up: until you state them, no proforma is shown.
- before: 买家确认订单后，形式发票上写什么。{name}从不自己编：你没写之前，不会出形式发票。
- **zh: 客户确认订单后，形式发票上写什么。{name}从不自己编：你没写之前，不会出形式发票。**

#### `terms.title` (changed)

- en: Your payment and delivery terms
- before: 形式发票上的条款
- **zh: 你的付款和交付条款**

#### `today.calm.notLive.title` (changed)

- en: No customer can reach {name} yet
- before: 买家现在还找不到{name}
- **zh: 客户现在还找不到{name}**

#### `today.silenced.body` (changed)

- en: We paused sending while we check something. This was not you, and nothing was lost. Customers who write are waiting for you; your own replies still go.
- before: 我们在查一件事，先把发送停了。不是你操作的，消息也都还在。买家写来的消息在等你，你自己发的回复照常送达。
- **zh: 我们在查一件事，先把发送停了。不是你操作的，消息也都还在。客户写来的消息在等你，你自己发的回复照常送达。**

#### `today.stopped.body` (changed)

- en: Nothing {name} writes is sent. Customers who write are waiting for you.
- before: {name}写的都不会发出。买家写来的消息在等你。
- **zh: {name}写的都不会发出。客户写来的消息在等你。**

#### `unheard.do.no_media` (changed)

- en: Ask the customer to send the voice message again.
- before: 请买家把这条语音重新发一次。
- **zh: 请客户把这条语音重新发一次。**

#### `unheard.do.transcription_failed` (changed)

- en: Listen to it yourself and reply, or ask the customer to send it again.
- before: 你自己听一下再回复，或者请买家再发一次。
- **zh: 你自己听一下再回复，或者请客户再发一次。**

#### `unheard.do.unsupported_format` (changed)

- en: Listen to it yourself and reply, or ask the customer to write it instead.
- before: 你自己听一下再回复，或者请买家改成文字。
- **zh: 你自己听一下再回复，或者请客户改成文字。**

#### `unlisted.do` (changed)

- en: Reply yourself, or add the number in My business and hand it back to {name}
- before: 自己回复，或者到“我的公司”把号码加上，再交回给{name}
- **zh: 自己回复，或者到“我的生意”把号码加上，再交回给{name}**

#### `unlisted.why` (changed)

- en: While you try {name} with a few customers, only the numbers you added are written to.
- before: 你让{name}先跟几个买家试的时候，只会给你加进来的号码发消息。
- **zh: 你让{name}先跟几个客户试的时候，只会给你加进来的号码发消息。**

#### `unreadable.do` (changed)

- en: Open it on your phone and reply to the customer yourself.
- before: 在你手机上打开看看，然后自己回复买家。
- **zh: 在你手机上打开看看，然后自己回复客户。**

#### `unreadable.what` (changed)

- en: {what} from the customer. {name} cannot read it, so no reply has gone out.
- before: 买家发来的{what}，{name}看不了，所以没有回复。
- **zh: 客户发来的{what}，{name}看不了，所以没有回复。**

#### `voice.correct` (changed)

- en: Correct what was heard
- before: 改成买家实际说的
- **zh: 改成客户实际说的**

#### `voice.correctPlaceholder` (changed)

- en: Type what the customer actually said…
- before: 写下买家实际说的话……
- **zh: 写下客户实际说的话……**


### العربية — 337 lines

#### `activation.action.deactivateConfirm` (changed)

- en: Stop {name} messaging customers on WhatsApp? Nothing is deleted, and you can start again whenever you want.
- before: إيقاف مراسلة {name} للمشترين على واتساب؟ لا يُحذف شيء، ويمكن البدء من جديد في أي وقت.
- **ar: إيقاف مراسلة {name} للعملاء على واتساب؟ لا يُحذف شيء، ويمكن البدء من جديد في أي وقت.**

#### `activation.blocker.assistant_not_named` (changed)

- en: Confirm the name customers will see.
- before: تأكيد الاسم الذي سيراه المشترون.
- **ar: تأكيد الاسم الذي سيراه العملاء.**

#### `activation.can` (changed)

- en: {name} can start talking to real customers whenever you say so.
- before: بإمكان {name} بدء الحديث مع مشترين حقيقيين بقرار منك.
- **ar: بإمكان {name} بدء الحديث مع عملاء حقيقيين بقرار منك.**

#### `activation.cannot` (changed)

- en: Before {name} can talk to a real customer:
- before: قبل حديث {name} مع مشترٍ حقيقي:
- **ar: قبل حديث {name} مع عميل حقيقي:**

#### `activation.stop.what` (changed)

- en: Stopping means nothing further is sent on WhatsApp. Your customers, conversations and everything you taught stay exactly as they are, and you can start again whenever you want.
- before: الإيقاف يعني ألّا يُرسَل أي شيء بعد ذلك على واتساب. يبقى المشترون والمحادثات وكل ما أُضيف إلى معرفة {name} كما هو، ويمكن البدء من جديد في أي وقت.
- **ar: الإيقاف يعني ألّا يُرسَل أي شيء بعد ذلك على واتساب. يبقى العملاء والمحادثات وكل ما أُضيف إلى معرفة {name} كما هو، ويمكن البدء من جديد في أي وقت.**

#### `allowlist.none` (changed)

- en: Nobody yet. Add your own number first, so you can try {name} on yourself before a customer does.
- before: لا أحد بعد. الأفضل البدء برقمك، لتجربة {name} بنفسك قبل أي مشترٍ.
- **ar: لا أحد بعد. الأفضل البدء برقمك، لتجربة {name} بنفسك قبل أي عميل.**

#### `analytics.activity.inbound` (changed)

- en: Customer messages
- before: استفسارات المشترين
- **ar: استفسارات العملاء**

#### `analytics.commerce.deals` (changed)

- en: Sales
- before: الصفقات
- **ar: المبيعات**

#### `analytics.commerce.noDeals` (changed)

- en: No sales yet.
- before: لا صفقات بعد.
- **ar: لا مبيعات بعد.**

#### `analytics.commerce.totalValue` (changed)

- en: Sales value {value}
- before: قيمة الصفقات {value}
- **ar: قيمة المبيعات {value}**

#### `analytics.empty.body` (changed)

- en: Not enough activity for {range} yet. As customers write in, {name} answers, and you confirm orders, this fills in.
- before: لا يوجد نشاط كافٍ {range} بعد. مع استفسارات المشترين وعروض {name} وتأكيدك للطلبات، ستمتلئ هذه الصفحة.
- **ar: لا يوجد نشاط كافٍ {range} بعد. مع رسائل العملاء وردود {name} وتأكيدك للطلبات، ستمتلئ هذه الصفحة.**

#### `assistant.silenced.note` (changed)

- en: Sending from {name} is paused while we check something — this was not you. Customers who write wait for you under Needs you, and your own replies still go.
- before: الإرسال من {name} متوقّف مؤقتًا بينما نتحقّق من أمر ما — لم يكن هذا منك. رسائل المشترين الجديدة بانتظار الردّ في «بحاجة إليك»، والردود اليدوية تُرسل كالمعتاد.
- **ar: الإرسال من {name} متوقّف مؤقتًا بينما نتحقّق من أمر ما — لم يكن هذا منك. رسائل العملاء الجديدة بانتظار الردّ في «بحاجة إليك»، والردود اليدوية تُرسل كالمعتاد.**

#### `assistant.stop.running` (changed)

- en: Stop {name} on every channel at once, WhatsApp included. Replies waiting to go out are cancelled, and customers who write wait for you under Needs you. Your own replies still go.
- before: يمكن إيقاف {name} على كل القنوات دفعةً واحدة، ومنها واتساب. تُلغى الردود المنتظِرة للإرسال، وتبقى رسائل المشترين الجديدة بانتظار الردّ في «بحاجة إليك». والردود اليدوية تُرسل كالمعتاد.
- **ar: يمكن إيقاف {name} على كل القنوات دفعةً واحدة، ومنها واتساب. تُلغى الردود المنتظِرة للإرسال، وتبقى رسائل العملاء الجديدة بانتظار الردّ في «بحاجة إليك». والردود اليدوية تُرسل كالمعتاد.**

#### `assistant.stop.stopped` (changed)

- en: {name} is stopped on every channel. Nothing {name} writes is sent, and customers who write wait for you under Needs you.
- before: الردود من {name} متوقّفة على كل القنوات. لا يُرسل أي ردّ من {name}، ورسائل المشترين الجديدة بانتظار الردّ في «بحاجة إليك».
- **ar: الردود من {name} متوقّفة على كل القنوات. لا يُرسل أي ردّ من {name}، ورسائل العملاء الجديدة بانتظار الردّ في «بحاجة إليك».**

#### `assistants.title` (changed)

- en: Who answers your customers
- before: فريق الرد على مشتريك
- **ar: فريق الرد على عميلك**

#### `autonomy.disclosure` (changed)

- en: One thing to know before you choose: when {name} replies without you, the first message in a conversation tells your customer they are not talking to a person, and offers them someone from your team. A reply you send yourself carries no such line — you sent it.
- before: قبل الاختيار، معلومة مهمة: في الردود التي تُرسَل من دونك، تُخبر أولُ رسالة في المحادثة المشتري بأن الردّ ليس من إنسان، مع عرض التحدث مع شخص من فريقك. أما الردّ المُرسَل منك فلا يحمل هذه الجملة — لأنه منك.
- **ar: قبل الاختيار، معلومة مهمة: في الردود التي تُرسَل من دونك، تُخبر أولُ رسالة في المحادثة العميل بأن الردّ ليس من إنسان، مع عرض التحدث مع شخص من فريقك. أما الردّ المُرسَل منك فلا يحمل هذه الجملة — لأنه منك.**

#### `autonomy.flash.notReleased` (changed)

- en: Not yet — the line that tells a customer they are not talking to a person is still being checked in every language used.
- before: ليس بعد — جملة التعريف التي تُرسَل للمشتري ما زالت قيد المراجعة بكل لغات الردود.
- **ar: ليس بعد — جملة التعريف التي تُرسَل للعميل ما زالت قيد المراجعة بكل لغات الردود.**

#### `autonomy.level.sells` (changed)

- en: {name} also handles prices without me
- before: التسعير والتفاوض أيضًا دون انتظاري
- **ar: الأسعار أيضًا دون انتظاري**

#### `autonomy.level.sells.note` (changed)

- en: Inside your price rules: never below your floor, and any discount bigger than you allow alone still comes to you first.
- before: ضمن قواعد أسعارك: لا سعر تحت حدّك الأدنى أبدًا، والخصم فوق خطّك يعود إليك.
- **ar: ضمن قواعد أسعارك: لا سعر تحت حدّك الأدنى أبدًا، وأي خصم يتجاوز المسموح به يعود إليك أولًا.**

#### `autonomy.needsName` (changed)

- en: Whatever you choose here, every reply keeps coming to you first until you confirm the name in Getting ready — a message sent without you gives your customer that name, and you should read it first.
- before: مهما كان الاختيار هنا، سيبقى كل ردّ معروضًا عليك إلى حين تأكيد اسم {name} في صفحة التجهيز — فالرسالة المُرسَلة من دونك تحمل هذا الاسم إلى المشتري، ومن حقك قراءته أولًا.
- **ar: مهما كان الاختيار هنا، سيبقى كل ردّ معروضًا عليك إلى حين تأكيد اسم {name} في صفحة التجهيز — فالرسالة المُرسَلة من دونك تحمل هذا الاسم إلى العميل، ومن حقك قراءته أولًا.**

#### `autonomy.notReleased` (changed)

- en: Not yet available. The line that tells a customer they are not talking to a person has not been read by a native speaker of every language used, and nothing goes out without you until it has.
- before: غير متاح بعد. جملة التعريف التي تُرسَل للمشتري لم يراجعها بعد متحدث أصلي بكل لغات الردود، ولا يخرج شيء من دونك قبل ذلك.
- **ar: غير متاح بعد. جملة التعريف التي تُرسَل للعميل لم يراجعها بعد متحدث أصلي بكل لغات الردود، ولا يخرج شيء من دونك قبل ذلك.**

#### `business.kind.agency` (changed)

- en: Agency or studio
- before: وكالة
- **ar: وكالة أو استوديو**

#### `business.kind.brand` (changed)

- en: Brand (clothing, beauty, food…)
- before: علامة تجارية أو متجر إلكتروني
- **ar: علامة تجارية (ملابس، تجميل، أغذية…)**

#### `business.kind.label` (changed)

- en: Kind of business
- before: نوع الشركة
- **ar: نوع النشاط التجاري**

#### `business.kind.online_shop`

- en: Online shop
- **ar: متجر إلكتروني**

#### `business.kind.startup`

- en: Startup
- **ar: شركة ناشئة**

#### `buyers.empty.calm` (changed)

- en: No customer needs you right now.
- before: لا مشتري يحتاجك الآن.
- **ar: لا عميل يحتاجك الآن.**

#### `buyers.search.label` (changed)

- en: Find a customer
- before: البحث عن مشترٍ
- **ar: البحث عن عميل**

#### `buyers.tabs` (changed)

- en: Which customers to show
- before: عرض المشترين
- **ar: عرض العملاء**

#### `calendar.buyer.all` (changed)

- en: All customers
- before: كل المشترين
- **ar: كل العملاء**

#### `calendar.buyer.choose` (changed)

- en: One customer only
- before: مشترٍ واحد فقط
- **ar: عميل واحد فقط**

#### `calendar.buyer.chosen` (changed)

- en: Customer: {buyer}
- before: المشتري: {buyer}
- **ar: العميل: {buyer}**

#### `calendar.buyer.label` (changed)

- en: Customer
- before: المشتري
- **ar: العميل**

#### `calendar.empty.door` (changed)

- en: See your customers
- before: عرض المشترين
- **ar: عرض العملاء**

#### `calendar.lede` (changed)

- en: Dates already on record for your customers — samples, orders, prices, replies owed, closures. Nothing here is estimated.
- before: التواريخ المسجلة للمشترين: العينات والطلبات والأسعار والردود المنتظرة وأيام الإغلاق. لا يوجد هنا أي تاريخ تقديري.
- **ar: التواريخ المسجلة للعملاء: العينات والطلبات والأسعار والردود المنتظرة وأيام الإغلاق. لا يوجد هنا أي تاريخ تقديري.**

#### `capability.negotiate` (changed)

- en: Discussing price
- before: التفاوض
- **ar: مناقشة السعر**

#### `channel.connect.configured` (changed)

- en: Your WhatsApp number is set up. Connect it and customers’ messages reach {name}. Nothing is sent until you switch {name} on.
- before: رقم واتساب الخاص بك جاهز. بعد ربطه، تصل رسائل المشترين إلى {name}، ولا يُرسَل شيء قبل التشغيل منك.
- **ar: رقم واتساب الخاص بك جاهز. بعد ربطه، تصل رسائل العملاء إلى {name}، ولا يُرسَل شيء قبل التشغيل منك.**

#### `channel.connect.intro` (changed)

- en: Once connected, {name} sees the messages customers send to your WhatsApp and drafts replies — you decide what goes out.
- before: بعد الربط، تصل إلى {name} رسائل المشترين على واتساب وتُكتب الردود — والقرار في ما يُرسَل لك.
- **ar: بعد الربط، تصل إلى {name} رسائل العملاء على واتساب وتُكتب الردود — والقرار في ما يُرسَل لك.**

#### `channel.flash.connected` (changed)

- en: Connected. Customers’ messages now reach {name}. Nothing is sent until you switch {name} on.
- before: تم الربط. تصل رسائل المشترين الآن إلى {name}، ولا يُرسَل شيء قبل التشغيل منك.
- **ar: تم الربط. تصل رسائل العملاء الآن إلى {name}، ولا يُرسَل شيء قبل التشغيل منك.**

#### `channel.flash.nothing_to_connect` (changed)

- en: There is nothing to reconnect yet — WhatsApp has not been set up for your business.
- before: لا شيء لإعادة ربطه بعد — لم يُربط واتساب بشركتك.
- **ar: لا شيء لإعادة ربطه بعد — لم يُربط واتساب بنشاطك التجاري.**

#### `channel.state.not_connected.hint` (changed)

- en: {name} cannot receive or answer a customer.
- before: لا يمكن لـ {name} استقبال رسائل المشترين ولا الرد عليها.
- **ar: لا يمكن لـ {name} استقبال رسائل العملاء ولا الرد عليها.**

#### `closures.add.placeholder` (changed)

- en: Annual holiday
- before: عيد الربيع
- **ar: العطلة السنوية**

#### `closures.add.shown` (changed)

- en: Customers see this name, with the dates, when told why a date cannot be promised.
- before: يرى المشترون هذا الاسم مع التواريخ عند توضيح سبب تعذّر تحديد موعد.
- **ar: يرى العملاء هذا الاسم مع التواريخ عند توضيح سبب تعذّر تحديد موعد.**

#### `closures.blocked.body` (changed)

- en: Your business is closed for {label}, {from} to {to}, inside that delivery time.
- before: شركتك مغلقة في {label}، من {from} إلى {to}، داخل هذه المدة.
- **ar: الإغلاق في {label}، من {from} إلى {to}، داخل هذه المدة.**

#### `closures.intro` (changed)

- en: Tell {name} the days you are shut. No customer is promised a delivery date that runs through them — {name} says the dates cannot be promised, and never invents a later one.
- before: أيام الإغلاق المسجّلة هنا تصل إلى {name}. لا وعد لمشترٍ بموعد تسليم يمرّ خلالها — بل توضيح أن الموعد لا يمكن ضمانه، ولا اختلاق لموعد لاحق أبدًا.
- **ar: أيام الإغلاق المسجّلة هنا تصل إلى {name}. لا وعد لعميل بموعد تسليم يمرّ خلالها — بل توضيح أن الموعد لا يمكن ضمانه، ولا اختلاق لموعد لاحق أبدًا.**

#### `closures.title` (changed)

- en: When your business is closed
- before: أيام إغلاق شركتك
- **ar: أيام الإغلاق**

#### `common.buyer` (changed)

- en: Customer
- before: مشترٍ
- **ar: عميل**

#### `connect.apollo.what` (changed)

- en: Finds people to write to and looks up their companies, with your own Apollo key.
- before: يجد المشترين ويبحث عن الشركات، بمفتاح Apollo الخاص بك.
- **ar: البحث عن عملاء محتملين وعن الشركات، بمفتاح Apollo الخاص بك.**

#### `connect.mail.google.what` (changed)

- en: Sends your e-mail from your own Google Workspace address. Tick the box to let {name} read what customers send there, too.
- before: يرسل بريدك من عنوان Google Workspace الخاص بك. وعند تعليم المربع، بإمكان {name} قراءة ما يرسله المشترون إليه أيضًا.
- **ar: يرسل بريدك من عنوان Google Workspace الخاص بك. وعند تعليم المربع، بإمكان {name} قراءة ما يرسله العملاء إليه أيضًا.**

#### `connect.mail.read.tick` (changed)

- en: Also let {name} read and answer customers\' e-mails in this mailbox.
- before: السماح لـ {name} أيضًا بقراءة رسائل المشترين في هذا الصندوق، والردّ عليها.
- **ar: السماح لـ {name} أيضًا بقراءة رسائل العملاء في هذا الصندوق، والردّ عليها.**

#### `connect.meta.choose.body` (changed)

- en: Your Facebook account manages more than one Page. Choose the one customers write to for this business.
- before: حساب فيسبوك الخاص بك يدير أكثر من صفحة. يُرجى اختيار الصفحة التي يكتب إليها مشترو هذه الشركة.
- **ar: حساب فيسبوك الخاص بك يدير أكثر من صفحة. يُرجى اختيار الصفحة التي يكتب إليها عملاء هذا النشاط التجاري.**

#### `connect.meta.flash.page_taken` (changed)

- en: That Page is already connected to another business here.
- before: هذه الصفحة مربوطة بشركة أخرى هنا.
- **ar: هذه الصفحة مربوطة بنشاط تجاري آخر هنا.**

#### `contacts.add.company` (changed)

- en: Their company (if any)
- before: الشركة
- **ar: الشركة (إن وُجدت)**

#### `contacts.attest.hint` (changed)

- en: Only if they gave you their details or asked you to stay in touch. Whoever says so is recorded.
- before: فقط في حال تسليم بطاقة العمل أو طلب البقاء على تواصل. ويُسجَّل اسم من يُقرّ بذلك.
- **ar: فقط في حال تسليم بيانات التواصل أو طلب البقاء على تواصل. ويُسجَّل اسم من يُقرّ بذلك.**

#### `contacts.empty` (changed)

- en: Nobody yet. Add someone who gave you their details, or wait for the first customer to write to you.
- before: لا أحد بعد. يمكن إضافة صاحب بطاقة عمل، أو انتظار أول مشترٍ يراسلك.
- **ar: لا أحد بعد. يمكن إضافة صاحب بطاقة عمل، أو انتظار أول عميل يراسلك.**

#### `conv.assistant.flash.changed` (changed)

- en: {who} answers this customer from now on.
- before: من الآن الردّ على هذا المشتري في عهدة {who}.
- **ar: من الآن الردّ على هذا العميل في عهدة {who}.**

#### `conv.assistant.flash.same` (changed)

- en: {who} already answers this customer.
- before: الردّ على هذا المشتري في عهدة {who} أصلًا.
- **ar: الردّ على هذا العميل في عهدة {who} أصلًا.**

#### `conv.assistant.label` (changed)

- en: Who answers this customer
- before: من يردّ على هذا المشتري
- **ar: من يردّ على هذا العميل**

#### `conv.deletion.ask` (changed)

- en: Ask for this customer's data to be deleted
- before: طلب حذف بيانات هذا المشتري
- **ar: طلب حذف بيانات هذا العميل**

#### `conv.deletion.dismissHint` (changed)

- en: If it was not a request to delete their data, set it aside. Nothing is deleted, and nothing is sent to them.
- before: إن لم يكن طلبًا لحذف البيانات، يمكن تنحيته جانبًا. لا يُحذف شيء، ولا يُرسَل أي شيء إلى المشتري.
- **ar: إن لم يكن طلبًا لحذف البيانات، يمكن تنحيته جانبًا. لا يُحذف شيء، ولا يُرسَل أي شيء إلى العميل.**

#### `conv.deletion.done` (changed)

- en: This customer's data was deleted on {date}.
- before: حُذفت بيانات هذا المشتري في {date}.
- **ar: حُذفت بيانات هذا العميل في {date}.**

#### `conv.deletion.erased` (changed)

- en: Deleted: who they are on every channel, every message to or from them, the replies and prices prepared for them and any sample requests, notes about their conversations, and the conversations themselves, except what an order needs.
- before: يُحذف: الهوية على كل قناة، وكل رسالة متبادلة، والردود والعروض وطلبات العيّنات المُعدّة، والملاحظات عن المحادثات، والمحادثات نفسها إلا ما يلزم لطلب شراء.
- **ar: يُحذف: الهوية على كل قناة، وكل رسالة متبادلة، والردود والأسعار المُعدّة وأي طلبات عيّنات، والملاحظات عن المحادثات، والمحادثات نفسها إلا ما يلزم لطلب شراء.**

#### `conv.deletion.flash.note_missing` (changed)

- en: Nothing was recorded: say how and when the customer asked.
- before: لم يُسجَّل شيء: يُرجى ذكر كيف ومتى جاء الطلب من المشتري.
- **ar: لم يُسجَّل شيء: يُرجى ذكر كيف ومتى جاء الطلب من العميل.**

#### `conv.deletion.lead` (changed)

- en: When this customer asks in a message for their data to be deleted, the request is usually noted here as it arrives, for you to decide. If they ask another way, record it here. Nomi's operator carries it out by hand within 30 days, and it shows here when it is done.
- before: عند طلب هذا المشتري في رسالةٍ حذفَ البيانات، يُسجَّل الطلب هنا عادةً فور وصوله ليُتَّخذ القرار بشأنه. وإن جاء الطلب بطريقة أخرى، يُسجَّل هنا. ينفّذ مشغّل Nomi الحذف يدويًا خلال 30 يومًا، ويظهر هنا عند التنفيذ.
- **ar: عند طلب هذا العميل في رسالةٍ حذفَ البيانات، يُسجَّل الطلب هنا عادةً فور وصوله ليُتَّخذ القرار بشأنه. وإن جاء الطلب بطريقة أخرى، يُسجَّل هنا. ينفّذ مشغّل Nomi الحذف يدويًا خلال 30 يومًا، ويظهر هنا عند التنفيذ.**

#### `conv.deletion.note` (changed)

- en: How and when did they ask?
- before: كيف ومتى جاء الطلب من المشتري؟
- **ar: كيف ومتى جاء الطلب من العميل؟**

#### `conv.deletion.tell` (changed)

- en: When it is done, it shows here and on Your data. Tell the customer then — Nomi does not write to them about it.
- before: عند التنفيذ يظهر ذلك هنا وفي صفحة «بياناتك». عندها يُرجى إبلاغ المشتري، فـNomi لا يراسل المشتري بهذا الشأن.
- **ar: عند التنفيذ يظهر ذلك هنا وفي صفحة «بياناتك». عندها يُرجى إبلاغ العميل، فـNomi لا يراسل العميل بهذا الشأن.**

#### `conv.deletion.title` (changed)

- en: Deleting this customer's data
- before: حذف بيانات هذا المشتري
- **ar: حذف بيانات هذا العميل**

#### `conv.file.title` (changed)

- en: About this customer
- before: عن المشتري
- **ar: عن العميل**

#### `conv.needCard` (changed)

- en: This customer has a reply waiting for your OK.
- before: لدى هذا المشتري رد بانتظار موافقتك.
- **ar: لدى هذا العميل رد بانتظار موافقتك.**

#### `conv.notFound` (changed)

- en: Customer not found
- before: المشتري غير موجود
- **ar: العميل غير موجود**

#### `conv.tl.buyer_image` (changed)

- en: Customer sent a photo
- before: أرسل المشتري صورة
- **ar: أرسل العميل صورة**

#### `conv.tl.lead_hot` (changed)

- en: Customer is very interested
- before: المشتري مهتم جدًا
- **ar: العميل مهتم جدًا**

#### `data.buyers.fromChat` (changed)

- en: A request made in a message is usually listed here as it arrives, and waits until you decide on the customer's page.
- before: الطلب المقدَّم في رسالة يُدرَج هنا عادةً فور وصوله، ويبقى بانتظار القرار في صفحة المشتري.
- **ar: الطلب المقدَّم في رسالة يُدرَج هنا عادةً فور وصوله، ويبقى بانتظار القرار في صفحة العميل.**

#### `data.buyers.lead` (changed)

- en: Each is recorded on the customer's own page. Nomi's operator carries it out by hand within 30 days of it being recorded. When it shows as done, tell the customer — Nomi does not write to them about it.
- before: يُسجَّل كل طلب في صفحة المشتري. ينفّذه مشغّل Nomi يدويًا خلال 30 يومًا من تسجيله. وعند ظهوره منفَّذًا، يُرجى إبلاغ المشتري، فـNomi لا يراسل المشتري بهذا الشأن.
- **ar: يُسجَّل كل طلب في صفحة العميل. ينفّذه مشغّل Nomi يدويًا خلال 30 يومًا من تسجيله. وعند ظهوره منفَّذًا، يُرجى إبلاغ العميل، فـNomi لا يراسل العميل بهذا الشأن.**

#### `data.buyers.none` (changed)

- en: No customer has asked yet.
- before: لا طلبات من المشترين حتى الآن.
- **ar: لا طلبات من العملاء حتى الآن.**

#### `data.buyers.title` (changed)

- en: Customers who asked to be deleted
- before: طلبات حذف بيانات المشترين
- **ar: طلبات حذف بيانات العملاء**

#### `data.buyers.withdrawConfirm` (changed)

- en: Take this customer's request back? Nothing of theirs will be deleted.
- before: التراجع عن هذا الطلب؟ لن يُحذف شيء من بيانات هذا المشتري.
- **ar: التراجع عن هذا الطلب؟ لن يُحذف شيء من بيانات هذا العميل.**

#### `data.deletion.lead` (changed)

- en: Everything this workspace holds — customers, messages, products, orders, everything you taught — removed for good.
- before: كل ما تحتفظ به مساحة العمل هذه — المشترون والرسائل والمنتجات والطلبات وما أُضيف إلى معرفة {name} — يُحذف نهائيًا.
- **ar: كل ما تحتفظ به مساحة العمل هذه — العملاء والرسائل والمنتجات والطلبات وما أُضيف إلى معرفة {name} — يُحذف نهائيًا.**

#### `data.deletion.scope.buyer` (changed)

- en: One customer
- before: مشترٍ واحد
- **ar: عميل واحد**

#### `data.export.configLead` (changed)

- en: The part nobody wants to type twice: your lowest prices and discounts, how you sell, and every fact you taught.
- before: الجزء الذي لا يودّ أحد إدخاله مرتين: حدودك الدنيا وخصوماتك، وشروط بيعك، وكل ما أُضيف إلى معرفة {name}.
- **ar: الجزء الذي لا يودّ أحد إدخاله مرتين: أسعارك الدنيا وخصوماتك، وطريقة البيع، وكل ما أُضيف إلى معرفة {name}.**

#### `data.export.lead` (changed)

- en: One file per kind, in the format a spreadsheet opens. Everything here is yours — what you typed in, and what customers wrote to you.
- before: ملف لكل نوع، بصيغة يفتحها أي برنامج جداول. كل ما هنا ملكك — ما أُدخل من بياناتك، وما كتبه إليك المشترون.
- **ar: ملف لكل نوع، بصيغة يفتحها أي برنامج جداول. كل ما هنا ملكك — ما أُدخل من بياناتك، وما كتبه إليك العملاء.**

#### `data.export.subject.buyers` (changed)

- en: Customers
- before: المشترون
- **ar: العملاء**

#### `data.export.subject.selling-terms` (changed)

- en: How you sell
- before: شروط بيعك
- **ar: طريقة البيع**

#### `deletionAsked.do` (changed)

- en: Decide on the customer's page, then answer them yourself
- before: اتخاذ القرار في صفحة المشتري، ثم الردّ مباشرةً
- **ar: اتخاذ القرار في صفحة العميل، ثم الردّ مباشرةً**

#### `deletionAsked.noted` (changed)

- en: Noted on {date}. It waits on the customer's page, on Your data and on Today until you decide; handing the conversation back does not clear it.
- before: سُجِّل في {date}. ويبقى في صفحة المشتري وفي «بياناتك» وفي «اليوم» إلى أن يُتَّخذ القرار، ولا تمحوه إعادة المحادثة.
- **ar: سُجِّل في {date}. ويبقى في صفحة العميل وفي «بياناتك» وفي «اليوم» إلى أن يُتَّخذ القرار، ولا تمحوه إعادة المحادثة.**

#### `deletionAsked.why` (changed)

- en: A deletion is recorded on the customer's page and carried out by Nomi's operator by hand, so nothing about it is promised in the chat.
- before: يُسجَّل الحذف في صفحة المشتري وينفّذه مشغّل Nomi يدويًا، لذلك لا يُقطَع في المحادثة أي وعد بشأنه.
- **ar: يُسجَّل الحذف في صفحة العميل وينفّذه مشغّل Nomi يدويًا، لذلك لا يُقطَع في المحادثة أي وعد بشأنه.**

#### `domain.intro` (changed)

- en: Add these three at whoever holds your domain. Until all three are there, mail from you gets filed as junk — and that damage sticks to the address you have used with customers for years.
- before: يلزم إضافة هذه الثلاثة لدى الجهة التي تحتفظ بنطاقك. وما لم تكتمل، تُصنَّف رسائلك كمزعجة — ويلتصق ذلك بالعنوان المستعمَل مع المشترين منذ سنوات.
- **ar: يلزم إضافة هذه الثلاثة لدى الجهة التي تحتفظ بنطاقك. وما لم تكتمل، تُصنَّف رسائلك كمزعجة — ويلتصق ذلك بالعنوان المستعمَل مع العملاء منذ سنوات.**

#### `factory.about.empty` (changed)

- en: {name} has nothing to tell customers about you yet.
- before: ليس لدى {name} ما يُقال للمشترين عنك بعد.
- **ar: ليس لدى {name} ما يُقال للعملاء عنك بعد.**

#### `factory.about.title` (changed)

- en: About your business
- before: عن شركتك
- **ar: عن نشاطك التجاري**

#### `factory.next.channels` (changed)

- en: Connect the account customers write to
- before: ربط الحساب الذي يراسلك عليه المشترون
- **ar: ربط الحساب الذي يراسلك عليه العملاء**

#### `factory.next.first_success` (changed)

- en: Send {name}\'s first reply to a customer
- before: إرسال أول ردّ إلى مشترٍ
- **ar: إرسال أول ردّ إلى عميل**

#### `factory.next.profile` (changed)

- en: Tell {name} about your business
- before: تعريف {name} بشركتك
- **ar: تعريف {name} بنشاطك التجاري**

#### `factory.prices.q` (changed)

- en: What discounts may {name} give?
- before: ما هامش تحرّك {name} في السعر؟
- **ar: ما الخصم المسموح لـ{name}؟**

#### `factory.promise.certsOn` (changed)

- en: {name} may state these to a customer.
- before: يجوز لـ {name} ذكر هذه للمشتري.
- **ar: يجوز لـ {name} ذكر هذه للعميل.**

#### `factory.promise.never` (changed)

- en: Anything you have not confirmed here, {name} will not say — even if a customer insists.
- before: ما لم يُؤكَّد هنا لا يُقال، مهما ألحّ المشتري.
- **ar: ما لم يُؤكَّد هنا لا يُقال، مهما ألحّ العميل.**

#### `factory.promise.none` (changed)

- en: You have not confirmed anything {name} may claim about what you sell.
- before: لا تأكيد منك بعد لأي شيء يجوز لـ {name} قوله عن بضاعتك.
- **ar: لا تأكيد منك بعد لأي شيء يجوز لـ {name} قوله عن منتجاتك وخدماتك.**

#### `factory.promise.title` (changed)

- en: What you promise customers
- before: وعودك للمشترين
- **ar: وعودك للعملاء**

#### `factory.reach.nextNot` (changed)

- en: Until this is connected, {name} cannot receive or answer a customer.
- before: قبل الربط لا يمكن لـ {name} استقبال رسائل المشترين ولا الرد عليها.
- **ar: قبل الربط لا يمكن لـ {name} استقبال رسائل العملاء ولا الرد عليها.**

#### `factory.reach.q` (changed)

- en: Where can customers reach us?
- before: من أين يصل إلينا المشترون؟
- **ar: من أين يصل إلينا العملاء؟**

#### `factory.reach.title` (changed)

- en: Where customers reach you
- before: أين يصل إليك المشترون
- **ar: أين يصل إليك العملاء**

#### `factory.ready.live` (changed)

- en: {name} is talking to real customers.
- before: {name} على تواصل مع مشترين حقيقيين.
- **ar: {name} على تواصل مع عملاء حقيقيين.**

#### `factory.ready.title` (changed)

- en: Before {name} talks to real customers
- before: قبل الحديث مع مشترين حقيقيين
- **ar: قبل الحديث مع عملاء حقيقيين**

#### `factory.rehearsal.claim_not_authorised` (changed)

- en: If a customer asks whether you are certified, {name} will not confirm anything — you have authorised nothing yet.
- before: إذا سأل مشترٍ هل لديك اعتمادات، فلن يُؤكَّد شيء — لا إذن منك بأي منها بعد.
- **ar: إذا سأل عميل هل لديك اعتمادات، فلن يُؤكَّد شيء — لا إذن منك بأي منها بعد.**

#### `factory.rehearsal.lede` (changed)

- en: Customers ask these. Until you fill them in, {name} passes the question to you.
- before: المشترون يسألون عن هذه. وإلى أن تُستكمل، يُحوَّل السؤال إليك.
- **ar: العملاء يسألون عن هذه. وإلى أن تُستكمل، يُحوَّل السؤال إليك.**

#### `factory.rehearsal.no_price_at_moq` (changed)

- en: Your prices do not cover the smallest quantity you sell, so {name} cannot give a price for these:
- before: أسعارك لا تغطي أصغر طلب لديك، فلا يمكن عرض سعر لهذه:
- **ar: أسعارك لا تغطي أصغر كمية للبيع لديك، فلا يمكن ذكر سعر لهذه:**

#### `factory.sell.title` (changed)

- en: What you sell
- before: ما تبيعه شركتك
- **ar: ما يبيعه نشاطك التجاري**

#### `feedback.none` (changed)

- en: Nothing yet — this fills in once customers start talking to {name}.
- before: لا شيء بعد — سيظهر هنا حين يبدأ المشترون بالتحدث مع {name}.
- **ar: لا شيء بعد — سيظهر هنا حين يبدأ العملاء بالتحدث مع {name}.**

#### `forbidden.add.notePlaceholder` (changed)

- en: customers never see this
- before: لا يراه المشترون
- **ar: لا يراه العملاء**

#### `forbidden.floor.body` (changed)

- en: {name} will never curse or insult a customer. You cannot switch this off, and you do not need to add it.
- before: لا شتائم ولا إساءة لأي مشترٍ في ردود {name} أبدًا. هذا لا يمكن إيقافه، ولا حاجة إلى إضافته.
- **ar: لا شتائم ولا إساءة لأي عميل في ردود {name} أبدًا. هذا لا يمكن إيقافه، ولا حاجة إلى إضافته.**

#### `forbidden.intro` (changed)

- en: Add anything you never want {name} to say to a customer. A reply that contains one is never sent: it is written again without it, and if that cannot be done, it comes to you instead.
- before: يمكن هنا إضافة كل ما يجب ألّا يصل إلى المشتري في ردود {name}. الردّ الذي يحتوي على شيء منها لا يُرسَل أبدًا: تُعاد كتابته بدونه، وإن تعذّر ذلك يصلك أنت.
- **ar: يمكن هنا إضافة كل ما يجب ألّا يصل إلى العميل في ردود {name}. الردّ الذي يحتوي على شيء منها لا يُرسَل أبدًا: تُعاد كتابته بدونه، وإن تعذّر ذلك يصلك أنت.**

#### `golive.none` (changed)

- en: Connect a place customers write to, and {name} can start answering them.
- before: بعد ربط قناة تصل منها رسائل المشترين، يمكن لـ {name} بدء الردّ.
- **ar: بعد ربط قناة تصل منها رسائل العملاء، يمكن لـ {name} بدء الردّ.**

#### `golive.other.live` (changed)

- en: On {channels}, replies go out as soon as they are sent — by you, or by {name} where you have allowed it. There is no separate switch to start them.
- before: على {channels} تصل الردود إلى المشترين فور إرسالها، يدويًا أو من قِبل {name} حيث سُمح بذلك. لا يوجد مفتاح منفصل للبدء.
- **ar: على {channels} تصل الردود إلى العملاء فور إرسالها، يدويًا أو من قِبل {name} حيث سُمح بذلك. لا يوجد مفتاح منفصل للبدء.**

#### `golive.whatsappOnly` (changed)

- en: This stops WhatsApp only. {channels} keep answering customers.
- before: هذا يوقف واتساب فقط. تستمر الردود على المشترين في {channels}.
- **ar: هذا يوقف واتساب فقط. تستمر الردود على العملاء في {channels}.**

#### `her.knows.none` (changed)

- en: Nothing has been taught yet. Start with the facts customers ask about most.
- before: لم يُضف شيء بعد. البداية الأنسب: ما يسأل عنه المشترون أكثر.
- **ar: لم يُضف شيء بعد. البداية الأنسب: ما يسأل عنه العملاء أكثر.**

#### `her.recent.noneWhy` (changed)

- en: Customers who message you appear here.
- before: يظهر هنا المشترون الذين يراسلونك.
- **ar: يظهر هنا العملاء الذين يراسلونك.**

#### `her.teach.unasked` (changed)

- en: No customer has asked anything yet. Teach {name} what they ask about most.
- before: لم تصل أي أسئلة من المشترين بعد. البداية الأنسب: ما يسألون عنه أكثر.
- **ar: لم تصل أي أسئلة من العملاء بعد. البداية الأنسب: ما يسألون عنه أكثر.**

#### `inbox.blocked.not_activated` (changed)

- en: Not sent — messaging is switched off. Start {name} in My business and send it again.
- before: لم يُرسَل — المراسلة مُطفأة. يلزم تشغيل {name} من «شركتي» ثم إعادة الإرسال.
- **ar: لم يُرسَل — المراسلة مُطفأة. يلزم تشغيل {name} من «نشاطي التجاري» ثم إعادة الإرسال.**

#### `inbox.blocked.not_allowlisted` (changed)

- en: Not sent — this customer is not on your list yet. Add their number in My business first.
- before: لم يُرسَل — هذا المشتري ليس في قائمتك بعد. يلزم إضافة الرقم من «شركتي» أولًا.
- **ar: لم يُرسَل — هذا العميل ليس في قائمتك بعد. يلزم إضافة الرقم من «نشاطي التجاري» أولًا.**

#### `inbox.blocked.not_connected` (changed)

- en: Not sent — nothing is connected yet that can carry this reply, so it cannot reach this customer.
- before: لم يُرسَل — لا يوجد بعد اتصال يمكنه إيصال هذا الرد، فلا شيء يصل إلى هذا المشتري.
- **ar: لم يُرسَل — لا يوجد بعد اتصال يمكنه إيصال هذا الرد، فلا شيء يصل إلى هذا العميل.**

#### `inbox.blocked.window_closed` (changed)

- en: Not sent — you can’t message this customer right now. As soon as they reply, you can continue.
- before: لم يُرسَل — لا يمكن مراسلة هذا المشتري الآن. فور وصول ردّ من المشتري تصبح المتابعة ممكنة.
- **ar: لم يُرسَل — لا يمكن مراسلة هذا العميل الآن. فور وصول ردّ من العميل تصبح المتابعة ممكنة.**

#### `inbox.detail.back` (changed)

- en: Customers
- before: المشترون
- **ar: العملاء**

#### `inbox.draft.held.contradicts_history` (changed)

- en: This price is higher than the one this customer already has. If you send it, it becomes the price {name} gives them from now on.
- before: هذا السعر أعلى من السعر الذي لدى هذا المشتري. عند إرساله، يصبح هذا السعر المعتمد في عروض {name} من الآن.
- **ar: هذا السعر أعلى من السعر الذي لدى هذا العميل. عند إرساله، يصبح هذا السعر المعتمد في ردود {name} من الآن.**

#### `inbox.draft.held.disclosure_sent` (changed)

- en: They have already been told: {name} sent them the line saying they are not talking to a person, and offered them someone from your team. So this reply cannot be sent as it stands — change it first, or skip it.
- before: وصلت الإجابة بالفعل: أُرسلت إلى المشتري الجملة التي توضّح طبيعة {name}، مع عرض التحدث مع شخص من فريقك. لذلك لا يمكن إرسال هذا الرد بصيغته الحالية — يلزم تعديله أولًا، أو تجاهله.
- **ar: وصلت الإجابة بالفعل: أُرسلت إلى العميل الجملة التي توضّح طبيعة {name}، مع عرض التحدث مع شخص من فريقك. لذلك لا يمكن إرسال هذا الرد بصيغته الحالية — يلزم تعديله أولًا، أو تجاهله.**

#### `inbox.draft.held.identity_denial` (changed)

- en: {name} tried to claim to be a person to this customer. That was stopped and never sent. This is a plain stand-in for you to send, change or skip.
- before: كان في ردّ {name} على هذا المشتري ادّعاءٌ بأنّ المحادثة مع إنسان. أُوقف ذلك ولم يُرسَل. هذا رد بديل بسيط يمكن إرساله أو تعديله أو تجاهله.
- **ar: كان في ردّ {name} على هذا العميل ادّعاءٌ بأنّ المحادثة مع إنسان. أُوقف ذلك ولم يُرسَل. هذا رد بديل بسيط يمكن إرساله أو تعديله أو تجاهله.**

#### `inbox.draft.held.identity_question` (changed)

- en: This customer asked whether they are talking to a person or a machine, and this reply does not answer them. Nothing was sent.
- before: في رسالة المشتري سؤال: هل المحادثة مع إنسان أم مع آلة؟ وهذا الرد لا يجيب عنه. لم يُرسَل شيء.
- **ar: في رسالة العميل سؤال: هل المحادثة مع إنسان أم مع آلة؟ وهذا الرد لا يجيب عنه. لم يُرسَل شيء.**

#### `inbox.empty.noneBody` (changed)

- en: Messages from customers show up here. Share your WhatsApp number or your page with customers first.
- before: تظهر رسائل المشترين هنا. الخطوة الأولى: مشاركة رقم واتساب مع المشترين.
- **ar: تظهر رسائل العملاء هنا. الخطوة الأولى: مشاركة رقم واتساب أو صفحتك مع العملاء.**

#### `inbox.empty.setup` (changed)

- en: Set up your business so customers can reach you
- before: تجهيز شركتك ليصل إليك المشترون
- **ar: تجهيز نشاطك التجاري ليصل إليك العملاء**

#### `inbox.flash.assistant_stopped` (changed)

- en: {name} is stopped, so this draft was not sent. It is still here: write your own reply, or let {name} answer again on My business.
- before: الردود من {name} متوقّفة، لذلك لم تُرسل هذه المسودة، وما زالت هنا. يمكن كتابة ردّ مباشر، أو استئناف الردود من صفحة «شركتي».
- **ar: الردود من {name} متوقّفة، لذلك لم تُرسل هذه المسودة، وما زالت هنا. يمكن كتابة ردّ مباشر، أو استئناف الردود من صفحة «نشاطي التجاري».**

#### `inbox.flash.sentNotLive` (changed)

- en: Saved. Messaging is not switched on yet, so nothing went to the customer.
- before: تم الحفظ. المراسلة غير مُفعّلة بعد، فلم يصل شيء إلى المشتري.
- **ar: تم الحفظ. المراسلة غير مُفعّلة بعد، فلم يصل شيء إلى العميل.**

#### `insight.action.seeBuyers` (changed)

- en: See the customers
- before: إلقاء نظرة على المشترين
- **ar: إلقاء نظرة على العملاء**

#### `insight.monthChange.inquiries.down` (changed)

- en: Fewer customers wrote to you this month: {from} last month, {to} this month.
- before: كتب إليك مشترون أقل هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **ar: كتب إليك عملاء أقل هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

#### `insight.monthChange.inquiries.up` (changed)

- en: More customers wrote to you this month: {from} last month, {to} this month.
- before: كتب إليك مشترون أكثر هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **ar: كتب إليك عملاء أكثر هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

#### `insight.monthChange.quotes.down` (changed)

- en: {name} answered fewer price questions this month: {from} last month, {to} this month.
- before: عروض أسعار أقل من {name} هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **ar: إجابات أقل عن الأسعار من {name} هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

#### `insight.monthChange.quotes.up` (changed)

- en: {name} answered more price questions this month: {from} last month, {to} this month.
- before: عروض أسعار أكثر من {name} هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.
- **ar: إجابات أكثر عن الأسعار من {name} هذا الشهر: {from} الشهر الماضي، {to} هذا الشهر.**

#### `insight.quotedNoReply` (changed)

- en: {buyer} has not answered since they were given a price.
- before: لا ردّ من {buyer} منذ تسعير الطلب.
- **ar: لا ردّ من {buyer} منذ إرسال السعر.**

#### `knowledge.archive.confirm` (changed)

- en: Archive “{label}”? {name} stops using it with customers. You can teach it again at any time.
- before: أرشفة «{label}»؟ يتوقف استخدام ذلك في الردود على المشترين، ويمكن إضافته من جديد في أي وقت.
- **ar: أرشفة «{label}»؟ يتوقف استخدام ذلك في الردود على العملاء، ويمكن إضافته من جديد في أي وقت.**

#### `knowledge.business` (changed)

- en: About your business
- before: عن شركتك
- **ar: عن نشاطك التجاري**

#### `knowledge.cert.confirmOn` (changed)

- en: Turn on {key} for all {n} of your products? {name} will be able to state it to any customer.
- before: تشغيل {key} لمنتجاتك الـ{n} كلها؟ بعدها يصبح بإمكان {name} ذكره لأي مشترٍ.
- **ar: تشغيل {key} لمنتجاتك الـ{n} كلها؟ بعدها يصبح بإمكان {name} ذكره لأي عميل.**

#### `knowledge.cert.hint` (changed)

- en: Anything not turned on here is refused, however a customer asks.
- before: لا يجوز ذكر شهادة للمشترين إلا إذا كانت مفعّلة هنا.
- **ar: لا يجوز ذكر شهادة للعملاء إلا إذا كانت مفعّلة هنا.**

#### `knowledge.intro` (changed)

- en: Teach the facts about what you sell and your business. {name} answers customers from what you teach — and never states a number or a certification you haven't given.
- before: هنا تُضاف حقائق منتجاتك وشركتك إلى معرفة {name}. الإجابات للمشترين من هذه المعرفة فقط — ولا ذكر أبدًا لرقم أو شهادة لم تُضف.
- **ar: هنا تُضاف حقائق منتجاتك ونشاطك التجاري إلى معرفة {name}. الإجابات للعملاء من هذه المعرفة فقط — ولا ذكر أبدًا لرقم أو شهادة لم تُضف.**

#### `knowledge.kind.production_note` (changed)

- en: How it is made
- before: ملاحظات الإنتاج
- **ar: طريقة الصنع**

#### `knowledge.products` (changed)

- en: What you sell
- before: منتجاتك
- **ar: ما يُباع**

#### `knowledge.source.system_seed` (changed)

- en: Example
- before: عيّنة
- **ar: مثال**

#### `knowledge.taught.scope` (changed)

- en: These facts are used only when a customer asks about {product}.
- before: تُستخدم هذه المعلومات فقط حين يسأل مشترٍ عن {product}.
- **ar: تُستخدم هذه المعلومات فقط حين يسأل عميل عن {product}.**

#### `legal.deletion.erased.prepared` (changed)

- en: Replies prepared for you, and any price offers or sample requests.
- before: الردود والعروض وطلبات العيّنات المُعدّة لك.
- **ar: الردود المُعدّة لك، وأي عروض أسعار أو طلبات عيّنات.**

#### `legal.privacy.howLong.body` (changed)

- en: Until the business asks for its records to be deleted, or you ask for yours. They are kept so the business can see what was agreed with you, such as a price or an order. What a deletion removes, and what it keeps, is on the deletion page.
- before: إلى أن تطلب الشركة حذف سجلاتها، أو يُطلب حذف سجلاتك. وتُحفظ لتتمكن الشركة من الرجوع إلى ما اتُّفق عليه معك: سعر أو طلب أو عيّنة. وما يحذفه طلب الحذف وما يُبقيه مبيَّن في صفحة الحذف.
- **ar: إلى أن تطلب الشركة حذف سجلاتها، أو يُطلب حذف سجلاتك. وتُحفظ لتتمكن الشركة من الرجوع إلى ما اتُّفق عليه معك، كسعر أو طلب. وما يحذفه طلب الحذف وما يُبقيه مبيَّن في صفحة الحذف.**

#### `legal.terms.ours.we1` (changed)

- en: A price Nomi gives comes from your own price list and is never below the lowest price you set.
- before: السعر الذي يعرضه Nomi يأتي من قائمة أسعارك أنت ولا يقل أبدًا عن الحد الأدنى المحدَّد منك.
- **ar: السعر الذي يذكره Nomi يأتي من قائمة أسعارك أنت ولا يقل أبدًا عن أدنى سعر محدَّد منك.**

#### `live.message` (changed)

- en: New message from the customer
- before: رسالة جديدة من المشتري
- **ar: رسالة جديدة من العميل**

#### `login.footer` (changed)

- en: For your business and the people who work there.
- before: لشركتك ولمن يعمل فيها.
- **ar: لنشاطك التجاري ولمن يعمل فيه.**

#### `login.toSignup` (changed)

- en: New here? Set up your business
- before: أول مرة هنا؟ إنشاء مساحة عمل لشركتك
- **ar: أول مرة هنا؟ إنشاء مساحة عمل لنشاطك التجاري**

#### `meta.intro` (changed)

- en: What still has to be in place before {name} can talk to real customers. Nothing here switches messaging on.
- before: ما يجب توفّره قبل حديث {name} مع مشترين حقيقيين. هذه الصفحة لا تُفعّل الرسائل.
- **ar: ما يجب توفّره قبل حديث {name} مع عملاء حقيقيين. هذه الصفحة لا تُفعّل الرسائل.**

#### `meta.live` (changed)

- en: Live — {name} is talking to real customers.
- before: التشغيل مباشر — {name} على تواصل مع مشترين حقيقيين.
- **ar: التشغيل مباشر — {name} على تواصل مع عملاء حقيقيين.**

#### `nav.channels` (changed)

- en: Where customers reach you
- before: أين يصل إليك المشترون
- **ar: أين يصل إليك العملاء**

#### `nav.factory` (changed)

- en: My business
- before: شركتي
- **ar: نشاطي التجاري**

#### `nav.inbox` (changed)

- en: Customers
- before: المشترون
- **ar: العملاء**

#### `nav.prospects` (changed)

- en: Find customers
- before: البحث عن مشترين
- **ar: البحث عن عملاء**

#### `notify.deletion_due.how` (changed)

- en: Carry each out as the data deletion runbook says. Until a request is marked done, the business sees it as waiting.
- before: يُرجى تنفيذ كل طلب وفق دليل حذف البيانات. وإلى أن يُعلَّم الطلب منفَّذًا، يظهر للشركة في الانتظار.
- **ar: يُرجى تنفيذ كل طلب وفق دليل حذف البيانات. وإلى أن يُعلَّم الطلب منفَّذًا، يبقى ظاهرًا في الانتظار.**

#### `notify.deletion_requested` (changed)

- en: A customer asked for their data to be deleted. Nothing was sent to them, and it needs an answer from you. The request is noted on the customer's page, where you decide what happens next.
- before: وصل طلب من أحد المشترين بحذف البيانات. لم يُرسَل أي شيء إلى المشتري، والأمر يحتاج إلى ردّ منك. الطلب مسجَّل في صفحة المشتري، وهناك يُتَّخذ القرار التالي.
- **ar: وصل طلب من أحد العملاء بحذف البيانات. لم يُرسَل أي شيء إلى العميل، والأمر يحتاج إلى ردّ منك. الطلب مسجَّل في صفحة العميل، وهناك يُتَّخذ القرار التالي.**

#### `notify.deletion_requested.subject` (changed)

- en: A customer asked for their data to be deleted
- before: طلب حذف بيانات من أحد المشترين
- **ar: طلب حذف بيانات من أحد العملاء**

#### `notify.handoff` (changed)

- en: {name} paused — a customer wants to talk to a person. The conversation is waiting for you.
- before: توقّف ردّ {name} — مشترٍ يطلب التحدث مع شخص. الأمر بانتظارك.
- **ar: توقّف ردّ {name} — عميل يطلب التحدث مع شخص. الأمر بانتظارك.**

#### `notify.hot_lead` (changed)

- en: A customer looks ready to buy — {name} is following up.
- before: إشارة مشترٍ كبير — والمتابعة في عهدة {name}. التفاصيل في ملخص الليلة.
- **ar: إشارة استعداد للشراء لدى أحد العملاء — والمتابعة في عهدة {name}.**

#### `ops.activity.handled` (changed)

- en: Customers answered
- before: مشترون تمّ الردّ عليهم
- **ar: عملاء تمّ الردّ عليهم**

#### `order.field.buyer` (changed)

- en: Customer
- before: المشتري
- **ar: العميل**

#### `order.invoice.sampleMismatch` (changed)

- en: This customer paid {amount} for a sample, which you said comes off the first order. It is in another currency, so it is not deducted here — take it off yourself.
- before: دفع هذا المشتري {amount} مقابل عيّنة، والمسجَّل أنها تُخصم من أول طلب. العملة مختلفة، فلم تُخصم هنا — يلزم خصمها يدويًا.
- **ar: دفع هذا العميل {amount} مقابل عيّنة، والمسجَّل أنها تُخصم من أول طلب. العملة مختلفة، فلم تُخصم هنا — يلزم خصمها يدويًا.**

#### `order.state.in_production` (changed)

- en: Being prepared
- before: قيد الإنتاج
- **ar: قيد التجهيز**

#### `order.status.in_production` (changed)

- en: Being prepared
- before: قيد الإنتاج
- **ar: قيد التجهيز**

#### `order.update.intro` (changed)

- en: You set this. {name} tells a customer what you recorded and the day you recorded it — never a delivery date worked out from it.
- before: التحديد لك. يصل إلى المشتري عبر {name} ما سُجّل وتاريخ تسجيله — ولا يُستنتج منه موعد تسليم أبدًا.
- **ar: التحديد لك. يصل إلى العميل عبر {name} ما سُجّل وتاريخ تسجيله — ولا يُستنتج منه موعد تسليم أبدًا.**

#### `order.update.note.placeholder` (changed)

- en: Not sent to the customer
- before: غير مرئية للمشتري
- **ar: غير مرئية للعميل**

#### `people.add.placeholder` (changed)

- en: The name customers would hear
- before: الاسم الذي يسمعه المشترون
- **ar: الاسم الذي يسمعه العملاء**

#### `people.intro` (changed)

- en: Everyone here can log in with their own code, reply to a customer, take a conversation over and hand it back. You see who is holding what.
- before: لكل شخص هنا رمز دخول خاص، مع إمكانية الرد على مشترٍ وتسلّم محادثة وإعادتها. ويظهر هنا من يتولّى ماذا.
- **ar: لكل شخص هنا رمز دخول خاص، مع إمكانية الرد على عميل وتسلّم محادثة وإعادتها. ويظهر هنا من يتولّى ماذا.**

#### `people.name.askThem` (changed)

- en: This is your business\'s name, not a person\'s. What is the right name here?
- before: هذا اسم الشركة لا اسم شخص. ما الاسم الصحيح هنا؟
- **ar: هذا اسم النشاط التجاري لا اسم شخص. ما الاسم الصحيح هنا؟**

#### `people.name.askYou` (changed)

- en: Your name here is your business\'s name. What should the people here call you?
- before: الاسم المسجَّل هنا مطابق لاسم الشركة. ما الاسم الذي يظهر لفريق العمل؟
- **ar: الاسم المسجَّل هنا مطابق لاسم النشاط التجاري. ما الاسم الذي يظهر لفريق العمل؟**

#### `pilot.assistant.hint` (changed)

- en: Every reply is signed with this name, so a customer reads it each time. You can change it later on the team page.
- before: يظهر هذا الاسم في توقيع كل ردّ، فيقرأه المشتري دائمًا. ويمكن تغييره لاحقًا من صفحة الفريق.
- **ar: يظهر هذا الاسم في توقيع كل ردّ، فيقرأه العميل دائمًا. ويمكن تغييره لاحقًا من صفحة الفريق.**

#### `pilot.assistant.problem.name_missing` (changed)

- en: Type the name customers should see.
- before: يُرجى كتابة الاسم الذي سيراه المشترون.
- **ar: يُرجى كتابة الاسم الذي سيراه العملاء.**

#### `pilot.attest.assistant_named` (changed)

- en: The name customers see
- before: الاسم الذي يراه المشترون
- **ar: الاسم الذي يراه العملاء**

#### `pilot.blocker.channel` (changed)

- en: Connect at least one place customers write to you: WhatsApp, Instagram, Messenger or e-mail.
- before: ربط مكان واحد على الأقل يصل إليك منه المشترون: واتساب أو إنستغرام أو ماسنجر أو البريد.
- **ar: ربط مكان واحد على الأقل يصل إليك منه العملاء: واتساب أو إنستغرام أو ماسنجر أو البريد.**

#### `pilot.blocker.profile` (changed)

- en: Add your business details.
- before: يلزم إضافة بيانات شركتك.
- **ar: يلزم إضافة بيانات نشاطك التجاري.**

#### `pilot.item.channel` (changed)

- en: Where customers reach you
- before: أين يصل إليك المشترون
- **ar: أين يصل إليك العملاء**

#### `pilot.item.profile` (changed)

- en: Business profile
- before: ملف الشركة
- **ar: ملف النشاط التجاري**

#### `pilot.technical.intro` (changed)

- en: For whoever set up this installation: which WhatsApp details are in place, the safety checks on your own data, and which version is running. Nothing here needs you.
- before: لجهة إعداد هذه النسخة: ما اكتمل من بيانات واتساب، وفحوص السلامة على بيانات شركتك، والإصدار العامل الآن. لا شيء هنا يحتاج إلى تدخّل منك.
- **ar: لجهة إعداد هذه النسخة: ما اكتمل من بيانات واتساب، وفحوص السلامة على بيانات نشاطك التجاري، والإصدار العامل الآن. لا شيء هنا يحتاج إلى تدخّل منك.**

#### `practice.scripted.intro` (changed)

- en: These run {name} against situations that have gone wrong for other businesses. Nothing here touches your customers.
- before: هذه الفحوص تضع {name} في مواقف أخطأت فيها شركات أخرى. لا شيء هنا يمسّ مشتريك.
- **ar: هذه الفحوص تضع {name} في مواقف أخطأت فيها أنشطة تجارية أخرى. لا شيء هنا يمسّ عميلك.**

#### `practice.scripted.notproves` (changed)

- en: What it does not prove: how a reply to YOUR customer is worded, or whether your channel delivers it. For that, practise live below once your business is connected.
- before: ما لا يثبته: صياغة ردّ {name} لمشتريك أنت، ولا وصوله عبر واتساب. لذلك يمكن التدريب مباشرة بالأسفل بعد ربط حسابك.
- **ar: ما لا يثبته: صياغة ردّ {name} لعميلك أنت، ولا وصوله عبر قناتك. لذلك يمكن التدريب مباشرة بالأسفل بعد ربط حسابك.**

#### `practice.scripted.proves` (changed)

- en: What this proves: {name} will not give a price below your floor, will not claim a certification you have not confirmed, will not invent a number you never taught, and hands over when a customer asks for a person.
- before: ما يثبته ذلك: لا تسعير من {name} تحت حدّك الأدنى، ولا ادّعاء لشهادة غير مؤكَّدة، ولا اختلاق لرقم لم يُضف إلى معرفة {name}، والتحويل إليك حين يطلب المشتري شخصًا.
- **ar: ما يثبته ذلك: لا سعر من {name} تحت حدّك الأدنى، ولا ادّعاء لشهادة غير مؤكَّدة، ولا اختلاق لرقم لم يُضف إلى معرفة {name}، والتحويل إليك حين يطلب العميل شخصًا.**

#### `prices.lede` (changed)

- en: These are the only numbers {name} will ever work within — never below what you set here, whatever a customer says.
- before: هذه وحدها الأرقام المتاحة لتفاوض {name}. لا نزول تحت ما يُحدَّد هنا مهما قال المشتري.
- **ar: هذه وحدها الأرقام المتاحة لـ {name}. لا نزول تحت ما يُحدَّد هنا مهما قال العميل.**

#### `prices.q.floor` (changed)

- en: What is the least you would ever accept for one of these? ({currency})
- before: ما أقل سعر مقبول للقطعة الواحدة؟ (دولار)
- **ar: ما أقل سعر مقبول للقطعة الواحدة؟ ({currency})**

#### `prices.volume.removeConfirm` (changed)

- en: Stop offering this discount? It will not be offered to customers any more.
- before: إيقاف هذا العرض؟ لا يُعرض على المشترين بعد الآن.
- **ar: إيقاف هذا العرض؟ لا يُعرض على العملاء بعد الآن.**

#### `prices.volume.title` (changed)

- en: Discounts for buying more
- before: متى يُخفَّض السعر
- **ar: خصم عند شراء كمية أكبر**

#### `product.add.example1` (changed)

- en: Canvas tote bag {price}
- before: حقيبة قماش $1.05 حد أدنى 500
- **ar: حقيبة قماش {price}**

#### `product.add.example2` (changed)

- en: Vacuum cup {price} MOQ 1000
- before: كوب حراري $2.60 حد أدنى 1000
- **ar: كوب حراري {price} حد أدنى 1000**

#### `product.add.example3` (changed)

- en: Rose face serum 50 ml {price}
- before: مصل الورد 50 مل $34.90
- **ar: مصل الورد 50 مل {price}**

#### `product.add.intro` (changed)

- en: Paste your products and their prices — one per line, messy is fine.
- before: يُرجى لصق قائمة أسعارك — منتج في كل سطر، لا بأس بالفوضى.
- **ar: يُرجى لصق المنتجات وأسعارها — منتج في كل سطر، لا بأس بالفوضى.**

#### `product.detail.aliasesNote` (changed)

- en: {name} recognizes all of these when customers ask.
- before: كل هذه الأسماء معروفة لدى {name} عند سؤال المشترين.
- **ar: كل هذه الأسماء معروفة لدى {name} عند سؤال العملاء.**

#### `product.detail.aliasesTitle` (changed)

- en: What customers call it
- before: ما يسمّيه المشترون
- **ar: ما يسمّيه العملاء**

#### `product.detail.imageMatchBig` (changed)

- en: Recognizable by photo — {name} identifies this when customers send a picture
- before: يُميَّز بالصورة — بإمكان {name} التعرّف عليه عند إرسال المشتري صورة
- **ar: يُميَّز بالصورة — بإمكان {name} التعرّف عليه عند إرسال العميل صورة**

#### `product.edit.active` (changed)

- en: Offer this to customers
- before: عرضه على المشترين
- **ar: عرضه على العملاء**

#### `product.edit.price` (changed)

- en: Price for one ({currency})
- before: سعر القطعة (دولار)
- **ar: سعر القطعة ({currency})**

#### `product.list.empty.body` (changed)

- en: Add your products and prices, and {name} can answer with your prices.
- before: بعد إرسال قائمة أسعارك، يمكن لـ {name} التسعير بأسعارك.
- **ar: بعد إضافة منتجاتك وأسعارك، يمكن لـ {name} الردّ بأسعارك.**

#### `product.reject.other_currency`

- en: this line is in another currency — this workspace sells in {currency}
- **ar: في هذا السطر عملة أخرى — البيع هنا بعملة {currency} وحدها**

#### `product.reject.several_numbers` (changed)

- en: several numbers and none marked as the price — put {sign} before it
- before: في السطر عدة أرقام ولا يُعرف أيها السعر — يُرجى وضع $ قبله
- **ar: في السطر عدة أرقام ولا يُعرف أيها السعر — يُرجى وضع {sign} قبله**

#### `product.status.notOffered` (changed)

- en: Not offered to customers
- before: غير معروض على المشترين
- **ar: غير معروض على العملاء**

#### `proof.footer.explain` (changed)

- en: Every figure on this page comes from the business\u2019s own records. Nothing here was estimated.
- before: كل رقم في هذه الصفحة مأخوذ من سجلات الشركة نفسها. لا شيء هنا تقديري.
- **ar: كل رقم في هذه الصفحة مأخوذ من سجلات البائع نفسه. لا شيء هنا تقديري.**

#### `proof.leadTime.withheld` (changed)

- en: Not yet — closed for {label}, {from} to {to}
- before: لم يُحدَّد بعد — الشركة مغلقة بسبب {label}، من {from} إلى {to}
- **ar: لم يُحدَّد بعد — إغلاق بسبب {label}، من {from} إلى {to}**

#### `proof.owner.flash.issued` (changed)

- en: Link ready. Paste it to the customer.
- before: الرابط جاهز. يمكن إرساله إلى المشتري الآن.
- **ar: الرابط جاهز. يمكن إرساله إلى العميل الآن.**

#### `proof.owner.live` (changed)

- en: Link sent to this customer:
- before: الرابط المُرسل لهذا المشتري:
- **ar: الرابط المُرسل لهذا العميل:**

#### `proof.owner.none` (changed)

- en: You can send this customer a page showing where the price came from.
- before: يمكن إرسال صفحة لهذا المشتري تبيّن مصدر السعر.
- **ar: يمكن إرسال صفحة لهذا العميل تبيّن مصدر السعر.**

#### `proof.quote.title` (changed)

- en: Your price
- before: هذا العرض
- **ar: هذا السعر**

#### `proof.source.authorised` (changed)

- en: Authorised by the business
- before: بتصريح من الشركة
- **ar: بتصريح من البائع**

#### `proof.source.catalogue` (changed)

- en: From the business's own product list
- before: من قائمة منتجات الشركة
- **ar: من قائمة منتجات البائع**

#### `proof.source.taught` (changed)

- en: Confirmed by the business
- before: أكّدته الشركة
- **ar: أكّده البائع**

#### `prospects.intro` (changed)

- en: Search for people who might buy from you. Nothing here writes to anyone: people you add join your list with nothing on file saying you may write to them, and their row says so.
- before: البحث عن أشخاص يشترون ما تصنعه شركتك. لا شيء هنا يراسل أحدًا: من يُضاف ينضم إلى قائمتك دون أي سجل يسمح بالمراسلة، ويظهر ذلك في القائمة.
- **ar: البحث عن أشخاص قد يشترون منك. لا شيء هنا يراسل أحدًا: من يُضاف ينضم إلى قائمتك دون أي سجل يسمح بالمراسلة، ويظهر ذلك في القائمة.**

#### `prospects.title` (changed)

- en: Find customers
- before: البحث عن مشترين
- **ar: البحث عن عملاء**

#### `rate.add.label` (changed)

- en: One {from} is worth, in {to}
- before: الدولار الواحد يساوي، باليوان
- **ar: قيمة 1 {from} بعملة {to}**

#### `rate.current` (changed)

- en: 1 {from} = {rate} {to}
- before: دولار واحد = ￥{rate}
- **ar: 1 {from} = {rate} {to}**

#### `rate.empty` (changed)

- en: You have not set a rate yet, so nothing is shown in {to}.
- before: لم يُحدَّد سعر بعد، فلا يظهر شيء باليوان.
- **ar: لم يُحدَّد سعر بعد، فلا يظهر شيء بعملة {to}.**

#### `rate.flash.none`

- en: Your prices are in the currency your country uses, so there is no rate to set. Nothing was saved.
- **ar: الأسعار بعملة البلد نفسه، فلا حاجة إلى سعر صرف. لم يُحفظ شيء.**

#### `rate.flash.set` (changed)

- en: Saved. {name} will use 1 {from} = {rate} {to} until you change it.
- before: حُفظ. السعر المعتمد لدى {name}: \u200F$1 = ￥{rate}، حتى تغييره.
- **ar: حُفظ. السعر المعتمد لدى {name}: \u200F1 {from} = {rate} {to}، حتى تغييره.**

#### `rate.intro` (changed)

- en: Customers pay in {from}. When you want to see what that is in {to}, {name} uses the rate you set here — never a rate from anywhere else.
- before: المشترون يدفعون بالدولار. ولرؤية المبلغ باليوان، يعتمد حساب {name} على السعر المحدَّد هنا وحده — لا على سعر من أي مكان آخر.
- **ar: الدفع بعملة {from}. ولرؤية المبلغ بعملة {to}، يعتمد حساب {name} على السعر المحدَّد هنا وحده — لا على سعر من أي مكان آخر.**

#### `rate.none`

- en: Your prices are in {from}, and nothing here is shown in another currency, so there is no rate to set.
- **ar: الأسعار بعملة {from}، ولا يُعرض شيء هنا بعملة أخرى، فلا حاجة إلى سعر صرف.**

#### `reach.inbound.flash.taken` (changed)

- en: Another business on this installation already uses that account.
- before: تستخدم هذا الحساب شركة أخرى على هذا التثبيت.
- **ar: يستخدم هذا الحساب نشاط تجاري آخر على هذا التثبيت.**

#### `reach.instead.buyer_writes_first` (changed)

- en: Someone writes first, and {name} answers the usual way.
- before: المشتري يبادر بالكتابة، فيأتي ردّ {name} كالمعتاد.
- **ar: تأتي الرسالة الأولى من الطرف الآخر، فيأتي ردّ {name} كالمعتاد.**

#### `reach.instead.click_to_whatsapp` (changed)

- en: Someone taps an advert of yours and it opens WhatsApp, with you.
- before: نقرة من المشتري على إعلان لك تفتح واتساب معك مباشرةً.
- **ar: نقرة على إعلان لك تفتح واتساب معك مباشرةً.**

#### `reach.req.business_verification` (changed)

- en: WhatsApp has checked your business
- before: واتساب تحقّق من شركتك
- **ar: واتساب تحقّق من نشاطك التجاري**

#### `reach.req.privacy_policy_url` (changed)

- en: A page of your own saying how you handle what customers tell you
- before: صفحة خاصة بك تبيّن طريقة التعامل مع ما يخبرك به المشترون
- **ar: صفحة خاصة بك تبيّن طريقة التعامل مع ما يخبرك به العملاء**

#### `reach.title` (changed)

- en: What each way of reaching people allows
- before: ماذا تسمح به كل طريقة للوصول إلى مشترٍ
- **ar: ماذا تسمح به كل طريقة للتواصل**

#### `reach.window` (changed)

- en: After someone writes, you have {hours} hours to answer them freely.
- before: بعد أول رسالة من المشتري، تُتاح {hours} ساعة للرد بحرية.
- **ar: بعد أول رسالة تصل، تُتاح {hours} ساعة للرد بحرية.**

#### `refused.do.channel_cannot_initiate` (changed)

- en: Wait for them to write to you, or open your connections to see what each one allows.
- before: يمكن انتظار رسالة من المشتري، أو فتح صفحة الاتصالات للاطّلاع على ما تسمح به كل طريقة.
- **ar: يمكن انتظار الرسالة الأولى من الطرف الآخر، أو فتح صفحة الاتصالات للاطّلاع على ما تسمح به كل طريقة.**

#### `refused.do.not_activated` (changed)

- en: Start {name} in My business when you are ready.
- before: يمكن تشغيل {name} من «شركتي» عند الاستعداد.
- **ar: يمكن تشغيل {name} من «نشاطي التجاري» عند الاستعداد.**

#### `refused.do.not_allowlisted` (changed)

- en: Add this number in My business, or leave it — nothing will be sent to it.
- before: يمكن إضافة هذا الرقم في «شركتي»، أو تركه — فلن يُرسَل إليه شيء.
- **ar: يمكن إضافة هذا الرقم في «نشاطي التجاري»، أو تركه — فلن يُرسَل إليه شيء.**

#### `refused.do.stopped` (changed)

- en: Reply yourself — your own replies still go. To let {name} answer again, open My business.
- before: يمكن الردّ مباشرةً — الردود اليدوية تُرسل كالمعتاد. ولاستئناف الردود من {name}، يُرجى فتح صفحة «شركتي».
- **ar: يمكن الردّ مباشرةً — الردود اليدوية تُرسل كالمعتاد. ولاستئناف الردود من {name}، يُرجى فتح صفحة «نشاطي التجاري».**

#### `refused.do.subject_missing` (changed)

- en: Open the message, write the subject you want them to see, and send it again.
- before: يُرجى فتح الرسالة، وكتابة العنوان المطلوب ظهوره للمشتري، ثم إعادة إرسالها.
- **ar: يُرجى فتح الرسالة، وكتابة العنوان المطلوب ظهوره للعميل، ثم إعادة إرسالها.**

#### `refused.do.window_closed` (changed)

- en: Message this customer from your own phone. Once they answer, {name} can continue.
- before: يمكن مراسلة هذا المشتري من هاتفك. وبعد وصول ردّ من المشتري، بإمكان {name} المتابعة.
- **ar: يمكن مراسلة هذا العميل من هاتفك. وبعد وصول ردّ من العميل، بإمكان {name} المتابعة.**

#### `refused.do.window_needs_owner` (changed)

- en: Message this customer from your own phone for now.
- before: يمكن مراسلة هذا المشتري من هاتفك في الوقت الحالي.
- **ar: يمكن مراسلة هذا العميل من هاتفك في الوقت الحالي.**

#### `refused.none` (changed)

- en: Every message prepared reached its customer.
- before: كل رسالة أُعدّت وصلت إلى مشتريها.
- **ar: كل رسالة أُعدّت وصلت إلى عميلها.**

#### `refused.title` (changed)

- en: Messages that did not reach a customer
- before: رسائل لم تصل إلى المشتري
- **ar: رسائل لم تصل إلى العميل**

#### `refused.what.not_allowlisted` (changed)

- en: This customer is not on your list yet.
- before: هذا المشتري ليس في قائمتك بعد.
- **ar: هذا العميل ليس في قائمتك بعد.**

#### `refused.what.window_closed` (changed)

- en: WhatsApp no longer allows a reply to this customer.
- before: واتساب لم يعد يسمح بالردّ على هذا المشتري.
- **ar: واتساب لم يعد يسمح بالردّ على هذا العميل.**

#### `refused.what.window_needs_owner` (changed)

- en: This customer can now only be reached with a pre-approved message.
- before: لا يمكن الوصول إلى هذا المشتري الآن إلا برسالة مُعتمَدة مسبقًا.
- **ar: لا يمكن الوصول إلى هذا العميل الآن إلا برسالة مُعتمَدة مسبقًا.**

#### `refused.why.daily_ceiling` (changed)

- en: A daily maximum protects you from a runaway mistake reaching real customers.
- before: حدّ يومي يحميك من خطأ متكرّر يصل إلى مشترين حقيقيين.
- **ar: حدّ يومي يحميك من خطأ متكرّر يصل إلى عملاء حقيقيين.**

#### `refused.why.subject_missing` (changed)

- en: Your customer sees the subject before they open anything, so {name} will not invent one.
- before: يرى المشتري العنوان قبل فتح أي شيء، فلا مجال لعنوان مُختلَق.
- **ar: يرى العميل العنوان قبل فتح أي شيء، فلا مجال لعنوان مُختلَق.**

#### `refused.why.window_closed` (changed)

- en: WhatsApp only lets a business reply within a day of the customer’s last message. That day has passed.
- before: يسمح واتساب للتاجر بالردّ خلال يوم واحد من آخر رسالة للمشتري. مضى ذلك اليوم.
- **ar: يسمح واتساب للتاجر بالردّ خلال يوم واحد من آخر رسالة للعميل. مضى ذلك اليوم.**

#### `runbook.after.intro` (changed)

- en: Once real customers have talked to {name}, come back and review:
- before: بعد حديث مشترين حقيقيين مع {name}، يُرجى العودة لمراجعة:
- **ar: بعد حديث عملاء حقيقيين مع {name}، يُرجى العودة لمراجعة:**

#### `runbook.deploy.unauthoredPriceRules` (changed)

- en: {n} price rules were written by the old importer, not by the owner: floor equal to the list price, no discount authority. Nothing rewrites them — ask the owner the three questions and let those answers replace them.
- before: {n} من حدود الأسعار كتبها المستورد القديم لا صاحب الشركة: الحدّ الأدنى مساوٍ لسعر القائمة، وبلا هامش تخفيض. لا شيء يعيد كتابتها — يلزم طرح الأسئلة الثلاثة على صاحب الشركة لتحلّ الإجابات محلّها.
- **ar: {n} من حدود الأسعار كتبها المستورد القديم لا صاحب العمل: الحدّ الأدنى مساوٍ لسعر القائمة، وبلا هامش تخفيض. لا شيء يعيد كتابتها — يلزم طرح الأسئلة الثلاثة على صاحب العمل لتحلّ الإجابات محلّها.**

#### `runbook.engine.title` (changed)

- en: Safety checks against this business’s own data
- before: فحوص السلامة على بيانات هذه الشركة نفسها
- **ar: فحوص السلامة على بيانات هذا النشاط التجاري نفسه**

#### `runbook.practice.intro` (changed)

- en: Rehearse the whole flow in Practice — no real customers involved.
- before: التدرّب على العملية كاملةً في صفحة التدريب — دون مشترين حقيقيين.
- **ar: التدرّب على العملية كاملةً في صفحة التدريب — دون عملاء حقيقيين.**

#### `runbook.step.buyer` (changed)

- en: Send a customer question
- before: إرسال سؤال مشترٍ
- **ar: إرسال سؤال عميل**

#### `samples.asked.title` (changed)

- en: This customer asked for a sample
- before: هذا المشتري طلب عيّنة
- **ar: هذا العميل طلب عيّنة**

#### `samples.intro` (changed)

- en: Nearly every customer asks for one. Tell {name} what a sample costs and whether it comes off the first order, and {name} can answer. Until you do, nothing is said about samples.
- before: يسأل عنها كل مشترٍ تقريبًا. بعد تحديد سعر العيّنة وهل تُخصم من الطلب الأول، يصبح بإمكان {name} الإجابة. وقبل ذلك لا كلام عن العيّنات.
- **ar: يسأل عنها كل عميل تقريبًا. بعد تحديد سعر العيّنة وهل تُخصم من الطلب الأول، يصبح بإمكان {name} الإجابة. وقبل ذلك لا كلام عن العيّنات.**

#### `samples.requests.address.placeholder` (changed)

- en: Paste the address the customer gave you
- before: لصق العنوان الذي قدّمه المشتري
- **ar: لصق العنوان الذي قدّمه العميل**

#### `samples.requests.title` (changed)

- en: Customers waiting for a sample
- before: مشترون ينتظرون عيّنة
- **ar: عملاء ينتظرون عيّنة**

#### `sandbox.case.arabic-human-request-escalates` (changed)

- en: Customer asks for a real person (Arabic)
- before: المشتري يطلب شخصاً حقيقياً (عربي)
- **ar: العميل يطلب شخصاً حقيقياً (عربي)**

#### `sandbox.case.chinese-human-request-escalates` (changed)

- en: Customer asks for a real person (Chinese)
- before: المشتري يطلب شخصاً حقيقياً (صيني)
- **ar: العميل يطلب شخصاً حقيقياً (صيني)**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-ar` (changed)

- en: Customer asks to delete a line from the quote (Arabic)
- before: المشتري يطلب حذف سطر من عرض السعر (عربي)
- **ar: العميل يطلب حذف سطر من عرض السعر (عربي)**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-en` (changed)

- en: Customer asks to delete a line from the quote (English)
- before: المشتري يطلب حذف سطر من عرض السعر (إنجليزي)
- **ar: العميل يطلب حذف سطر من عرض السعر (إنجليزي)**

#### `sandbox.case.deleting-a-quote-line-is-answered-as-usual-zh` (changed)

- en: Customer asks to delete a line from the quote (Chinese)
- before: المشتري يطلب حذف سطر من عرض السعر (صيني)
- **ar: العميل يطلب حذف سطر من عرض السعر (صيني)**

#### `sandbox.case.deletion-request-ar-hands-off-silently` (changed)

- en: Customer asks for their data to be deleted (Arabic)
- before: المشتري يطلب حذف البيانات (عربي)
- **ar: العميل يطلب حذف البيانات (عربي)**

#### `sandbox.case.deletion-request-en-hands-off-silently` (changed)

- en: Customer asks for their data to be deleted (English)
- before: المشتري يطلب حذف البيانات (إنجليزي)
- **ar: العميل يطلب حذف البيانات (إنجليزي)**

#### `sandbox.case.deletion-request-zh-hands-off-silently` (changed)

- en: Customer asks for their data to be deleted (Chinese)
- before: المشتري يطلب حذف البيانات (صيني)
- **ar: العميل يطلب حذف البيانات (صيني)**

#### `sandbox.case.explicit-human-request-escalates-en` (changed)

- en: Customer asks for a real person (English)
- before: المشتري يطلب شخصاً حقيقياً (إنجليزي)
- **ar: العميل يطلب شخصاً حقيقياً (إنجليزي)**

#### `sandbox.case.higher-price-than-already-given-waits-for-owner` (changed)

- en: A price higher than this customer got last time
- before: سعر أعلى مما حصل عليه هذا المشتري في المرة السابقة
- **ar: سعر أعلى مما حصل عليه هذا العميل في المرة السابقة**

#### `sandbox.case.low-confidence-match-asks-to-confirm` (changed)

- en: An unclear match asks the customer to confirm
- before: تطابق غير واضح يستدعي تأكيد المشتري
- **ar: تطابق غير واضح يستدعي تأكيد العميل**

#### `sandbox.case.price-floor-clamp-under-aggressive-discount` (changed)

- en: Customer pushes hard for a discount
- before: المشتري يضغط بشدة لخفض السعر
- **ar: العميل يضغط بشدة لخفض السعر**

#### `sandbox.case.unknown-product-yields-no-quote` (changed)

- en: Customer asks about something you don't sell
- before: المشتري يسأل عن منتج ليس من منتجاتك
- **ar: العميل يسأل عن منتج ليس من منتجاتك**

#### `sandbox.composer.label` (changed)

- en: Send a message as the customer
- before: إرسال رسالة بصفتك المشتري
- **ar: إرسال رسالة بصفتك العميل**

#### `sandbox.composer.placeholder` (changed)

- en: Type what a customer might say…
- before: ما قد يقوله المشتري…
- **ar: ما قد يقوله العميل…**

#### `sandbox.composer.send` (changed)

- en: Send as customer
- before: إرسال كمشتري
- **ar: إرسال كعميل**

#### `sandbox.empty` (changed)

- en: No messages yet. Send one as the customer to begin.
- before: لا توجد رسائل بعد. للبدء، يُرجى إرسال رسالة بصفتك المشتري.
- **ar: لا توجد رسائل بعد. للبدء، يُرجى إرسال رسالة بصفتك العميل.**

#### `sandbox.intro` (changed)

- en: Play the customer. Watch how {name} replies — and approve or change anything before it would ever go out.
- before: هنا يمكن لعب دور المشتري ومتابعة ردود {name} — والموافقة أو التعديل قبل أن يُرسَل أي شيء فعليًا.
- **ar: هنا يمكن لعب دور العميل ومتابعة ردود {name} — والموافقة أو التعديل قبل أن يُرسَل أي شيء فعليًا.**

#### `settings.alerts.desc` (changed)

- en: Where {name} messages you — a strong buying signal or a handoff. Your own WhatsApp.
- before: الرقم الذي تصلك عليه رسائل {name} — عن مشترٍ كبير أو تحويل. رقم واتساب الخاص بك.
- **ar: الرقم الذي تصلك عليه رسائل {name} — عن إشارة شراء قوية أو تحويل. رقم واتساب الخاص بك.**

#### `settings.currency.fixed`

- en: Your prices are in this currency, so it stays: a second currency would mean converting, and nothing here converts.
- **ar: الأسعار محددة بهذه العملة، فلا تتغير: عملة ثانية تعني التحويل، ولا تحويل هنا.**

#### `settings.currency.label`

- en: The currency you sell in
- **ar: عملة البيع**

#### `settings.currency.title`

- en: Currency
- **ar: العملة**

#### `settings.currency.why`

- en: Every price you set, and every price a customer is given, is in this currency. Nothing is converted. It can change until the first price is set.
- **ar: كل سعر يُحدَّد هنا وكل سعر يُعطى يكون بهذه العملة، دون أي تحويل. يمكن تغييرها إلى أن يُحدَّد أول سعر.**

#### `settings.err.phoneShape` (changed)

- en: Start with + and the country code.
- before: يلزم البدء بـ + ورمز الدولة، مثل \u200E+8657985001234.
- **ar: يلزم البدء بـ + ورمز الدولة.**

#### `settings.field.name` (changed)

- en: Business name
- before: اسم الشركة
- **ar: اسم النشاط التجاري**

#### `settings.flash.currencyFixed`

- en: Prices are already set in the current currency, so it stays. Nothing was changed.
- **ar: هناك أسعار محددة بالعملة الحالية، فلا تتغير العملة. لم يتغير شيء.**

#### `settings.flash.currencyInvalid`

- en: That is not a currency this workspace can sell in. Nothing was changed.
- **ar: هذه العملة غير متاحة للبيع هنا. لم يتغير شيء.**

#### `settings.flash.currencySaved`

- en: Currency saved. Every price from now on is in it.
- **ar: تم حفظ العملة، وكل الأسعار من الآن بها.**

#### `settings.flash.zoneInvalid`

- en: That time zone was not recognised. Nothing was changed.
- **ar: لم يُتعرَّف على هذه المنطقة الزمنية. لم يتغير شيء.**

#### `settings.flash.zoneSaved`

- en: Time zone saved. Dates and times now follow it.
- **ar: تم حفظ المنطقة الزمنية، وتتبعها التواريخ والأوقات الآن.**

#### `settings.workingHours.ph` (changed)

- en: 9:00–18:00 on working days
- before: 9:00-18:00، الإثنين-السبت
- **ar: 9:00-18:00 في أيام العمل**

#### `settings.zone.label`

- en: Your time zone
- **ar: المنطقة الزمنية**

#### `settings.zone.title`

- en: Time zone
- **ar: المنطقة الزمنية**

#### `settings.zone.why`

- en: Every date and time here, and what counts as "today", is in this zone.
- **ar: تُحسب هنا كل التواريخ والأوقات، و«اليوم» أيضاً، حسب هذه المنطقة.**

#### `signup.about` (changed)

- en: About your business
- before: عن شركتك
- **ar: عن نشاطك التجاري**

#### `signup.channels` (changed)

- en: Where do customers write to you today?
- before: أين يراسلك المشترون اليوم؟
- **ar: أين يراسلك العملاء اليوم؟**

#### `signup.currency`

- en: The currency you sell in
- **ar: عملة البيع**

#### `signup.factory` (changed)

- en: Business name
- before: اسم الشركة
- **ar: اسم النشاط التجاري**

#### `signup.kind` (changed)

- en: What kind of business is it?
- before: ما نوع شركتك؟
- **ar: ما نوع نشاطك التجاري؟**

#### `signup.lead` (changed)

- en: One workspace for your business. You sign in with your own e-mail and password.
- before: مساحة عمل واحدة لشركتك، والدخول إليها ببريدك الإلكتروني وكلمة مرورك.
- **ar: مساحة عمل واحدة لنشاطك التجاري، والدخول إليها ببريدك الإلكتروني وكلمة مرورك.**

#### `signup.problem.currency_missing`

- en: Which currency do you sell in? Every price here will be in it.
- **ar: يُرجى اختيار عملة البيع. كل الأسعار هنا ستكون بها.**

#### `signup.problem.factory_missing` (changed)

- en: Tell us what your business is called.
- before: يُرجى ذكر اسم شركتك.
- **ar: يُرجى ذكر اسم نشاطك التجاري.**

#### `signup.problem.kind_missing` (changed)

- en: Choose the kind of business.
- before: يُرجى اختيار نوع الشركة.
- **ar: يُرجى اختيار نوع النشاط التجاري.**

#### `signup.problem.sells_missing` (changed)

- en: Say in one line what you sell or do.
- before: يُرجى كتابة ما تبيعه شركتك أو تقدّمه في سطر واحد.
- **ar: يُرجى كتابة ما يبيعه نشاطك التجاري أو يقدّمه في سطر واحد.**

#### `signup.problem.zone_missing`

- en: Your country has more than one time zone. Which one are you in?
- **ar: في هذا البلد أكثر من منطقة زمنية. يُرجى اختيار المنطقة الصحيحة.**

#### `signup.sells` (changed)

- en: What do you sell or do?
- before: ما الذي تبيعه شركتك أو تقدّمه؟
- **ar: ما الذي يبيعه نشاطك التجاري أو يقدّمه؟**

#### `signup.sells.placeholder` (changed)

- en: e.g. skincare, clothing, social media ads or custom canvas bags
- before: مثال: حقائب قماشية مخصّصة للعلامات التجارية والفعاليات
- **ar: مثال: منتجات العناية بالبشرة أو الملابس أو إعلانات وسائل التواصل أو حقائب قماشية مخصّصة**

#### `signup.title` (changed)

- en: Set up your business
- before: إنشاء مساحة عمل لشركتك
- **ar: إنشاء مساحة عمل لنشاطك التجاري**

#### `signup.welcome` (changed)

- en: Your workspace is ready. Start by telling {name} about your business.
- before: مساحة عملك جاهزة. البداية: تعريف {name} بشركتك.
- **ar: مساحة عملك جاهزة. البداية: تعريف {name} بنشاطك التجاري.**

#### `signup.zone`

- en: Your time zone
- **ar: المنطقة الزمنية**

#### `site.channels.title` (changed)

- en: Where your customers already write
- before: حيث تصل رسائل المشترين أصلًا
- **ar: حيث تصل رسائل العملاء أصلًا**

#### `site.description` (changed)

- en: Nomi gives your business an assistant you name, to answer your customers on WhatsApp, Instagram, Messenger and e-mail: replies drafted for you to approve, and nothing sent alone unless you allow it.
- before: يمنح Nomi عملك مساعدًا باسم من اختيارك، للردّ على المشترين عبر واتساب وإنستغرام وماسنجر والبريد الإلكتروني: ردود تُكتب وتنتظر موافقتك، ولا يخرج شيء من تلقاء نفسه إلا بإذنك.
- **ar: يمنح Nomi عملك مساعدًا باسم من اختيارك، للردّ على العملاء عبر واتساب وإنستغرام وماسنجر والبريد الإلكتروني: ردود تُكتب وتنتظر موافقتك، ولا يخرج شيء من تلقاء نفسه إلا بإذنك.**

#### `site.example.from` (changed)

- en: A customer, on Instagram
- before: مشترٍ، عبر إنستغرام
- **ar: عميل، عبر إنستغرام**

#### `site.hero.lead` (changed)

- en: Nomi gives your business an assistant you name. When a customer writes on WhatsApp, Instagram, Messenger or e-mail, your assistant drafts the reply from your own products and prices, and you approve it.
- before: يمنح Nomi عملك مساعدًا باسم من اختيارك. حين تصل رسالة من مشترٍ عبر واتساب أو إنستغرام أو ماسنجر أو البريد الإلكتروني، يُكتب الردّ من منتجاتك وأسعارك، ولا يخرج إلا بموافقتك.
- **ar: يمنح Nomi عملك مساعدًا باسم من اختيارك. حين تصل رسالة من عميل عبر واتساب أو إنستغرام أو ماسنجر أو البريد الإلكتروني، يُكتب الردّ من منتجاتك وأسعارك، ولا يخرج إلا بموافقتك.**

#### `site.hero.title` (changed)

- en: Every customer gets an answer. You keep the last word.
- before: لكل مشترٍ ردّ، والكلمة الأخيرة لك.
- **ar: لكل عميل ردّ، والكلمة الأخيرة لك.**

#### `site.how.1.body` (changed)

- en: Add what you sell, your prices and the lowest you accept, and the facts customers ask about. Then choose your assistant’s name. Replies come only from what you teach: never a price or a claim you have not given.
- before: تُضاف المنتجات والأسعار وأدنى سعر مقبول لكل منتج، والمعلومات التي يسأل عنها المشترون، ثم يُختار اسم للمساعد. الردود من هذه المعرفة فقط — ولا ذكر أبدًا لرقم أو شهادة لم تُضف.
- **ar: تُضاف المنتجات والأسعار وأدنى سعر مقبول، والمعلومات التي يسأل عنها العملاء، ثم يُختار اسم للمساعد. الردود من هذه المعرفة فقط — ولا ذكر أبدًا لسعر أو معلومة لم تُضف.**

#### `site.how.2.title` (changed)

- en: A customer writes
- before: تصل رسالة من مشترٍ
- **ar: تصل رسالة من عميل**

#### `site.invite.body` (changed)

- en: Nomi opens workspaces by invitation for now. Write to us with your business’s name, what you sell and where your customers write to you, and we will write back.
- before: الانضمام إلى Nomi بدعوة حاليًا. تكفي رسالة إلينا باسم العمل وما يبيعه ومن أين تصل رسائل المشترين عادةً، وسيصل الردّ منا.
- **ar: الانضمام إلى Nomi بدعوة حاليًا. تكفي رسالة إلينا باسم العمل وما يبيعه ومن أين تصل رسائل العملاء عادةً، وسيصل الردّ منا.**

#### `site.title` (changed)

- en: Nomi — an assistant that answers your customers
- before: Nomi — مساعد يردّ على المشترين
- **ar: Nomi — مساعد للردّ على العملاء**

#### `site.who.body` (changed)

- en: Any business that sells or talks to customers over social media and e-mail — clothing and beauty brands, online stores, startups, agencies and services, as well as makers, exporters and wholesalers.
- before: لأي عمل تصله رسائل المشترين عن المنتجات والأسعار — المصنّعون والورش، والتجار وتجار الجملة، والعلامات التجارية، والمتاجر، والوكالات، ومقدمو الخدمات.
- **ar: لأي عمل يبيع لعملائه أو يتواصل معهم عبر وسائل التواصل الاجتماعي والبريد الإلكتروني — علامات الأزياء والتجميل، والمتاجر الإلكترونية، والشركات الناشئة، والوكالات ومقدمو الخدمات، وكذلك المصنّعون والمصدّرون وتجار الجملة.**

#### `site.yours.alone.body` (changed)

- en: At first, every reply waits for you. You can let greetings and questions go out on their own while anything with a price waits, or let prices go too. No order is confirmed without you.
- before: في البداية ينتظرك كل ردّ. ويمكن السماح للتحيات والأسئلة بالخروج من تلقاء نفسها مع بقاء كل ما فيه سعر بانتظارك، أو السماح بعروض الأسعار أيضًا. ولا يُؤكَّد طلب من دونك.
- **ar: في البداية ينتظرك كل ردّ. ويمكن السماح للتحيات والأسئلة بالخروج من تلقاء نفسها مع بقاء كل ما فيه سعر بانتظارك، أو السماح بالردود التي فيها أسعار أيضًا. ولا يُؤكَّد طلب من دونك.**

#### `site.yours.back.body` (changed)

- en: One choice puts every reply back in front of you, and stopping sends nothing further. Your customers, conversations and everything you taught stay, and you can take a copy as spreadsheet files.
- before: باختيار واحد يعود كل ردّ إلى مراجعتك، والإيقاف يعني ألّا يُرسَل أي شيء بعده. يبقى المشترون والمحادثات وكل ما أُضيف دون تغيير، ويمكن أخذ نسخة منه في ملفات جداول.
- **ar: باختيار واحد يعود كل ردّ إلى مراجعتك، والإيقاف يعني ألّا يُرسَل أي شيء بعده. يبقى العملاء والمحادثات وكل ما أُضيف دون تغيير، ويمكن أخذ نسخة منه في ملفات جداول.**

#### `site.yours.honest` (changed)

- en: When your assistant replies without you, the first message tells the customer they are not talking to a person, and offers them someone from your team.
- before: في الردود التي تُرسَل من دونك، تُخبر أولُ رسالة المشتري بأن الردّ ليس من إنسان، مع عرض التحدث مع شخص من فريقك.
- **ar: في الردود التي تُرسَل من دونك، تُخبر أولُ رسالة العميلَ بأن الردّ ليس من إنسان، مع عرض التحدث مع شخص من فريقك.**

#### `spotcheck.buyerSaid` (changed)

- en: The customer asked
- before: سأل المشتري
- **ar: سأل العميل**

#### `staff.deletionAsked` (changed)

- en: The owner decides on the customer's page. Answer them yourself.
- before: القرار في صفحة المشتري لمالك الحساب. يُرجى الردّ مباشرةً.
- **ar: القرار في صفحة العميل لمالك الحساب. يُرجى الردّ مباشرةً.**

#### `takeover.flash.assistant_stopped` (changed)

- en: {name} is stopped, so this conversation stays with you. Let {name} answer again on My business first.
- before: الردود من {name} متوقّفة، لذلك تبقى هذه المحادثة معك. يُرجى استئناف الردود من صفحة «شركتي» أولًا.
- **ar: الردود من {name} متوقّفة، لذلك تبقى هذه المحادثة معك. يُرجى استئناف الردود من صفحة «نشاطي التجاري» أولًا.**

#### `takeover.reason.deletion_requested` (changed)

- en: the customer asked for their data to be deleted
- before: طلب المشتري حذف البيانات
- **ar: طلب العميل حذف البيانات**

#### `takeover.reason.human_requested` (changed)

- en: the customer asked for a person
- before: طلب المشتري شخصاً حقيقياً
- **ar: طلب العميل شخصاً حقيقياً**

#### `takeover.reason.media_unreadable` (changed)

- en: something the customer sent that could not be opened
- before: شيء أرسله المشتري وتعذّر فتحه
- **ar: شيء أرسله العميل وتعذّر فتحه**

#### `takeover.reason.repeated_ambiguity` (changed)

- en: the customer's need stayed unclear
- before: ظلّت حاجة المشتري غير واضحة
- **ar: ظلّت حاجة العميل غير واضحة**

#### `takeover.replyPlaceholder` (changed)

- en: Type your reply to the customer…
- before: كتابة الردّ على المشتري…
- **ar: كتابة الردّ على العميل…**

#### `terms.flash.payment_missing` (changed)

- en: Write how customers pay you first.
- before: يُرجى كتابة شروط الدفع أولًا.
- **ar: يُرجى كتابة طريقة الدفع أولًا.**

#### `terms.flash.payment_too_long` (changed)

- en: That is too long. Keep it to one line.
- before: هذا أطول من شرط دفع. يكفي سطر واحد.
- **ar: هذا طويل. يكفي سطر واحد.**

#### `terms.incoterm.hint` (changed)

- en: This goes on your proformas, and {name} may mention it to customers.
- before: يُكتب في فواتيرك المبدئية، ويمكن لـ{name} ذكره للمشترين.
- **ar: يُكتب في فواتيرك المبدئية، ويمكن لـ{name} ذكره للعملاء.**

#### `terms.intro` (changed)

- en: What goes on a proforma when a customer confirms. {name} never makes these up: until you state them, no proforma is shown.
- before: ما يُكتب في الفاتورة المبدئية عندما يؤكد المشتري. لا تُختلق هذه الشروط في ردود {name} أبدًا: قبل تحديدها، لا تظهر فاتورة مبدئية.
- **ar: ما يُكتب في الفاتورة المبدئية عندما يؤكد العميل. لا تُختلق هذه الشروط في ردود {name} أبدًا: قبل تحديدها، لا تظهر فاتورة مبدئية.**

#### `terms.title` (changed)

- en: Your payment and delivery terms
- before: شروطك في الفاتورة المبدئية
- **ar: شروط الدفع والتسليم**

#### `today.calm.notLive.title` (changed)

- en: No customer can reach {name} yet
- before: لا يستطيع أي مشترٍ الوصول إلى {name} بعد
- **ar: لا يستطيع أي عميل الوصول إلى {name} بعد**

#### `today.silenced.body` (changed)

- en: We paused sending while we check something. This was not you, and nothing was lost. Customers who write are waiting for you; your own replies still go.
- before: أوقفنا الإرسال مؤقتًا بينما نتحقّق من أمر ما. لم يكن هذا منك، ولم يُفقد شيء. رسائل المشترين الجديدة بانتظار الردّ، والردود اليدوية تُرسل كالمعتاد.
- **ar: أوقفنا الإرسال مؤقتًا بينما نتحقّق من أمر ما. لم يكن هذا منك، ولم يُفقد شيء. رسائل العملاء الجديدة بانتظار الردّ، والردود اليدوية تُرسل كالمعتاد.**

#### `today.stopped.body` (changed)

- en: Nothing {name} writes is sent. Customers who write are waiting for you.
- before: لا يُرسل أي ردّ من {name}. رسائل المشترين الجديدة بانتظار الردّ.
- **ar: لا يُرسل أي ردّ من {name}. رسائل العملاء الجديدة بانتظار الردّ.**

#### `unheard.do.no_media` (changed)

- en: Ask the customer to send the voice message again.
- before: يُرجى طلب إرسال الرسالة الصوتية مرة أخرى من المشتري.
- **ar: يُرجى طلب إرسال الرسالة الصوتية مرة أخرى من العميل.**

#### `unheard.do.transcription_failed` (changed)

- en: Listen to it yourself and reply, or ask the customer to send it again.
- before: يمكن الاستماع إليها مباشرةً والردّ، أو طلب إرسالها مرة أخرى من المشتري.
- **ar: يمكن الاستماع إليها مباشرةً والردّ، أو طلب إرسالها مرة أخرى من العميل.**

#### `unheard.do.unsupported_format` (changed)

- en: Listen to it yourself and reply, or ask the customer to write it instead.
- before: يمكن الاستماع إليها مباشرةً والردّ، أو طلب كتابتها من المشتري بدلاً من ذلك.
- **ar: يمكن الاستماع إليها مباشرةً والردّ، أو طلب كتابتها من العميل بدلاً من ذلك.**

#### `unlisted.do` (changed)

- en: Reply yourself, or add the number in My business and hand it back to {name}
- before: الردّ مباشرةً، أو إضافة الرقم من «شركتي» ثم إعادة المحادثة إلى {name}
- **ar: الردّ مباشرةً، أو إضافة الرقم من «نشاطي التجاري» ثم إعادة المحادثة إلى {name}**

#### `unlisted.why` (changed)

- en: While you try {name} with a few customers, only the numbers you added are written to.
- before: خلال تجربة {name} مع بضعة مشترين، لا تُرسَل الرسائل إلا إلى الأرقام المضافة إلى قائمتك.
- **ar: خلال تجربة {name} مع بضعة عملاء، لا تُرسَل الرسائل إلا إلى الأرقام المضافة إلى قائمتك.**

#### `unreadable.do` (changed)

- en: Open it on your phone and reply to the customer yourself.
- before: يمكن فتحه على هاتفك والردّ على المشتري مباشرةً.
- **ar: يمكن فتحه على هاتفك والردّ على العميل مباشرةً.**

#### `unreadable.what` (changed)

- en: {what} from the customer. {name} cannot read it, so no reply has gone out.
- before: {what} من المشتري. يتعذّر على {name} قراءته، لذلك لم يُرسَل ردّ.
- **ar: {what} من العميل. يتعذّر على {name} قراءته، لذلك لم يُرسَل ردّ.**

#### `unsure.why` (changed)

- en: It may have reached them, or it may not. Nothing here can tell, so nothing was sent again — sending it twice would be worse than asking you. Read it and decide.
- before: قد تكون وصلت إلى المشتري وقد لا تكون. لا شيء هنا يعرف، فلم تُرسل مرة أخرى — إرسالها مرتين أسوأ من سؤالك. القرار لك بعد قراءتها.
- **ar: قد تكون وصلت إلى العميل وقد لا تكون. لا شيء هنا يعرف، فلم تُرسل مرة أخرى — إرسالها مرتين أسوأ من سؤالك. القرار لك بعد قراءتها.**

#### `voice.correctPlaceholder` (changed)

- en: Type what the customer actually said…
- before: كتابة ما قاله المشتري فعلاً…
- **ar: كتابة ما قاله العميل فعلاً…**


## 2026-10-02 — UI-es (0119): the owner's pages in Spanish, all of them

**Not a gate**, like everything in this file. The whole Spanish catalogue (the `ES`
block in `src/core/owner/i18n/messages.ts`, about 3,040 lines) was written for
this release and has had no native read. The Spanish *disclosure* is a different
thing: its gate (`DISCLOSURE_NATIVE_REVIEW.es`) stays false and is not touched here.

**The rules it was written to** (rule 6 in Spanish): the owner is addressed with
*tú*, never with an adjective or participle that agrees ("¿Confirmas…?", "Te damos
la bienvenida", "Ya puedes…" — never "¿Estás seguro?", "Bienvenido", "listo");
the assistant is `{name}` (or «tu asistente») with a verb, never «él/ella», never
"{name} está lista"; customers are «tu cliente», «cada cliente», «tus clientes»,
«quien escribe», never «el cliente/la clienta». Things agree normally («el canal
está conectado»). `tests/parity/assistant-pronouns.test.ts` holds what a regex can.

**Where to look first** — choices made to keep gender out, or meanings guessed:

- Page names: Setup → «Ajustes» (the nav; "Configuración" contained "config",
  which the nav test refuses), Billing → «Facturación», "Needs you" → «Te necesita»,
  "Ready for customers" → «A punto para atender clientes», "Go live" → «empezar con
  clientes reales». Check they read as names and match where other lines cite them.
- "{name} is stopped" lines (`assistant.stop.stopped`, `refused.what.stopped`,
  `today.stopped.title`, …) → «Se detuvo a {name}…» — formal; a better neutral form?
- "the owner" / "Nomi's operator" → «quien dirige el negocio», «quien opera Nomi»,
  «titular» (`staff.*`, `legal.terms.*`, `notify.signup_digest.*`) — long in places.
- Customer counts: «clientes con respuesta» for "customers answered"
  (`billing.plan.customers`, `ops.activity.handled`) instead of «atendidos».
- `capability.*` are infinitives («Saludar», «Cotizar»…) and fill `{cap}` inside
  sentences such as `insight.promotionReady` — read those sentences whole.
- `samples.requests.asked`, `panel.sampleAsked`, `calendar.range`, `closures.range`:
  how `{when}` / `{date}` / `{from}` read inside the sentence.
- `meta.cred.verifyToken` («Contraseña de verificación»), `help.meta.test.check`
  (Meta's Spanish labels guessed), `login.brandTagline` («tu asistente digital»).
- `site.*` (nomidoes.com in Spanish), `legal.*` (privacy, terms, deletion — the
  pages a customer reads) — counsel's and a native reader's.

Reviewer: ______  Date: ______

## 2026-10-02 — the UI rebuild, phases 1–3 (#198–#200): every new line

Setup in labelled groups (each row: a name, one line, the current value), its search, and the
business profile's groups. New in all four languages; read the Arabic for gender (none intended)
and the plural forms of `setup.value.phones.*` and `setup.value.requests.*`.

### `profile.group.business`

- en: The business
- zh: 生意信息
- ar: بيانات النشاط
- es: El negocio

### `profile.group.contact`

- en: Contact details
- zh: 联系方式
- ar: بيانات التواصل
- es: Datos de contacto

### `profile.group.zone`

- en: Time zone and currency
- zh: 时区和货币
- ar: المنطقة الزمنية والعملة
- es: Zona horaria y moneda

### `setup.search.label`

- en: Search Setup
- zh: 搜索设置
- ar: البحث في الإعداد
- es: Buscar en Ajustes

### `setup.search.placeholder`

- en: Find a setting
- zh: 找一项设置
- ar: إيجاد إعداد
- es: Busca un ajuste

### `setup.search.none`

- en: Nothing in Setup matches “{q}”.
- zh: 设置里没有和“{q}”相符的项。
- ar: لا يوجد في الإعداد ما يطابق «{q}».
- es: Nada en Ajustes coincide con «{q}».

### `setup.group.start`

- en: Setting up
- zh: 准备工作
- ar: خطوات البدء
- es: Puesta en marcha

### `setup.group.business`

- en: Your business
- zh: 你的生意
- ar: نشاطك التجاري
- es: Tu negocio

### `setup.group.reach`

- en: Customers and alerts
- zh: 客户与提醒
- ar: العملاء والتنبيهات
- es: Clientes y avisos

### `setup.group.people`

- en: People and sign-in
- zh: 人员与登录
- ar: الأشخاص وتسجيل الدخول
- es: Personas y acceso

### `setup.group.account`

- en: Billing and data
- zh: 付款与数据
- ar: الفوترة والبيانات
- es: Facturación y datos

### `setup.desc.guide`

- en: Five steps to your first reply
- zh: 五步完成第一条回复
- ar: خمس خطوات حتى أول رد
- es: Cinco pasos hasta la primera respuesta

### `setup.desc.onboarding`

- en: What is checked before customers are answered
- zh: 回复客户之前要核对的事项
- ar: ما يُراجَع قبل الرد على العملاء
- es: Lo que se revisa antes de responder a clientes

### `setup.desc.channels`

- en: WhatsApp, Instagram, Messenger and e-mail
- zh: WhatsApp、Instagram、Messenger 和邮件
- ar: واتساب وإنستغرام وماسنجر والبريد الإلكتروني
- es: WhatsApp, Instagram, Messenger y correo

### `setup.desc.profile`

- en: Name, description, hours, contact, time zone
- zh: 名称、介绍、营业时间、联系方式、时区
- ar: الاسم والوصف وساعات العمل والتواصل والمنطقة الزمنية
- es: Nombre, descripción, horario, contacto, zona horaria

### `setup.desc.kind`

- en: Kind of business, country and website
- zh: 生意类别、国家和网站
- ar: نوع النشاط والبلد والموقع الإلكتروني
- es: Tipo de negocio, país y sitio web

### `setup.desc.selling`

- en: Prices, minimums, delivery and payment
- zh: 价格、起订量、交货和付款
- ar: الأسعار والحد الأدنى والتوصيل والدفع
- es: Precios, mínimos, entrega y pago

### `setup.desc.alerts`

- en: A notice on your phone when a customer waits
- zh: 有客户在等时，手机上提醒你
- ar: إشعار على الهاتف حين ينتظر عميل
- es: Un aviso en tu teléfono cuando un cliente espera

### `setup.desc.people`

- en: Who answers here, and what only the owner decides
- zh: 谁在这里回复，哪些事只有店主能决定
- ar: صلاحيات الرد، وما يقرّره مالك الحساب وحده
- es: Quién responde aquí y qué decide solo el dueño

### `setup.desc.account`

- en: How you sign in
- zh: 你怎么登录
- ar: طريقة تسجيل الدخول
- es: Cómo entras

### `setup.desc.billing`

- en: Your plan and what is charged
- zh: 你的套餐和扣费
- ar: الخطة وما يُدفع
- es: Tu plan y lo que se cobra

### `setup.desc.data`

- en: Copies of your data, and deletion requests
- zh: 数据副本和删除请求
- ar: نسخ من بياناتك وطلبات الحذف
- es: Copias de tus datos y solicitudes de borrado

### `setup.value.off`

- en: Off
- zh: 未开启
- ar: متوقفة
- es: Desactivados

### `setup.value.unavailable`

- en: Not available here
- zh: 这里暂不可用
- ar: غير متاحة هنا
- es: No disponibles aquí

### `setup.value.accessCode`

- en: Access code
- zh: 登录码
- ar: رمز الدخول
- es: Código de acceso

### `setup.value.notSetUp`

- en: Not set up
- zh: 未设置
- ar: غير مُعدّة
- es: Sin configurar

### `setup.value.nothingWaiting`

- en: Nothing waiting
- zh: 没有待处理的
- ar: لا شيء بالانتظار
- es: Nada pendiente

### `setup.value.nameConfirmed`

- en: Name confirmed
- zh: 名字已确认
- ar: تم تأكيد الاسم
- es: Nombre confirmado

### `setup.value.nameNotConfirmed`

- en: Name not confirmed yet
- zh: 名字还没确认
- ar: لم يُؤكَّد الاسم بعد
- es: Nombre sin confirmar

### `setup.value.billing.none`

- en: No plan yet
- zh: 还没有套餐
- ar: لا خطة بعد
- es: Sin plan todavía

### `setup.value.billing.cardSaved`

- en: Card saved
- zh: 银行卡已保存
- ar: تم حفظ البطاقة
- es: Tarjeta guardada

### `setup.value.billing.trial`

- en: Free trial
- zh: 免费试用中
- ar: تجربة مجانية
- es: Prueba gratuita

### `setup.value.billing.active`

- en: Paid
- zh: 已付款
- ar: مدفوعة
- es: Pagado

### `setup.value.billing.past_due`

- en: Payment did not go through
- zh: 扣款没有成功
- ar: لم يتم الدفع
- es: El pago no se completó

### `setup.value.billing.lapsed`

- en: Paused: payment failed
- zh: 已暂停：扣款失败
- ar: متوقفة: تعذّر الدفع
- es: En pausa: el pago falló

### `setup.value.billing.exempt`

- en: No charge
- zh: 不收费
- ar: بلا رسوم
- es: Sin cargo

### `setup.value.phones.zero`

- en: On for {n} phones
- zh: {n} 部手机已开启
- ar: متوقفة
- es: Activados en {n} teléfonos

### `setup.value.phones.one`

- en: On for 1 phone
- zh: {n} 部手机已开启
- ar: مفعّلة على هاتف واحد
- es: Activados en 1 teléfono

### `setup.value.phones.two`

- en: On for {n} phones
- zh: {n} 部手机已开启
- ar: مفعّلة على هاتفين
- es: Activados en {n} teléfonos

### `setup.value.phones.few`

- en: On for {n} phones
- zh: {n} 部手机已开启
- ar: مفعّلة على {n} هواتف
- es: Activados en {n} teléfonos

### `setup.value.phones.many`

- en: On for {n} phones
- zh: {n} 部手机已开启
- ar: مفعّلة على {n} هاتفًا
- es: Activados en {n} teléfonos

### `setup.value.phones.other`

- en: On for {n} phones
- zh: {n} 部手机已开启
- ar: مفعّلة على {n} هاتف
- es: Activados en {n} teléfonos

### `setup.value.requests.zero`

- en: {n} requests waiting
- zh: {n} 个请求待处理
- ar: لا طلبات بالانتظار
- es: {n} solicitudes pendientes

### `setup.value.requests.one`

- en: 1 request waiting
- zh: {n} 个请求待处理
- ar: طلب واحد بالانتظار
- es: 1 solicitud pendiente

### `setup.value.requests.two`

- en: {n} requests waiting
- zh: {n} 个请求待处理
- ar: طلبان بالانتظار
- es: {n} solicitudes pendientes

### `setup.value.requests.few`

- en: {n} requests waiting
- zh: {n} 个请求待处理
- ar: {n} طلبات بالانتظار
- es: {n} solicitudes pendientes

### `setup.value.requests.many`

- en: {n} requests waiting
- zh: {n} 个请求待处理
- ar: {n} طلبًا بالانتظار
- es: {n} solicitudes pendientes

### `setup.value.requests.other`

- en: {n} requests waiting
- zh: {n} 个请求待处理
- ar: {n} طلب بالانتظار
- es: {n} solicitudes pendientes

Reviewer: ______  Date: ______

## 2026-10-02 — the UI rebuild, phase 5 (motion, undo, the assistant at work): every new line

Undo in the notice after setting something aside; the product's own "ask first" dialog (its going-ahead
button carries the asking button's own word; this is its fallback); the line shown where the assistant's
reply will appear. Read the Arabic for gender: `conv.working` is a noun phrase so nothing agrees with
the assistant; the buttons are verbal nouns.

### `common.undo`

- en: Undo
- zh: 撤销
- ar: تراجع
- es: Deshacer

### `common.goAhead`

- en: Go ahead
- zh: 继续
- ar: متابعة
- es: Continuar

### `common.cancel`

- en: Cancel
- zh: 取消
- ar: إلغاء
- es: Cancelar

### `conv.working`

- en: {name} is writing a reply
- zh: {name}正在写回复
- ar: جارٍ إعداد ردّ من {name}
- es: {name} está escribiendo una respuesta

### `forbidden.flash.restored`

- en: Back on the list.
- zh: 已放回列表。
- ar: عادت إلى القائمة.
- es: De vuelta en la lista.

### `closures.flash.restored`

- en: Back on your closed days.
- zh: 已放回停工日。
- ar: أُعيد إلى أيام الإغلاق.
- es: De vuelta en los días cerrados.

### `knowledge.flash.restored`

- en: Restored. It is in use again.
- zh: 已恢复，重新生效。
- ar: تمت الاستعادة، وهي قيد الاستخدام من جديد.
- es: Restaurado. Vuelve a usarse.

### `knowledge.flash.notRestored`

- en: That could not be brought back — it may have been corrected since.
- zh: 没能恢复——这条可能已经被改过了。
- ar: تعذّرت الاستعادة؛ ربما صُحّحت منذ ذلك الحين.
- es: No se pudo recuperar: puede que se haya corregido desde entonces.

### `calendar.flash.restored`

- en: Back on the calendar.
- zh: 已放回日程。
- ar: أُعيد إلى التقويم.
- es: De vuelta en el calendario.

## 2026-10-02 — the UI rebuild, phase 6 (states): every new line

The "Mine" empty state, the not-found line, the guide video's length, Billing's live lines;
`practice.sent` is shorter now (the line under it shows the work). Read the Arabic for gender.

### `inbox.empty.mine`

- en: You are not holding any conversation.
- zh: 你手上没有对话。
- ar: لا محادثة بعهدتك الآن.
- es: No tienes ninguna conversación ahora.

### `inbox.empty.mineBody`

- en: A conversation is yours when you take it over, or when {name} hands it to you.
- zh: 你接手的对话，或{name}交给你的对话，会出现在这里。
- ar: تصبح المحادثة بعهدتك عند استلامها، أو عند إحالتها إليك من {name}.
- es: Una conversación es tuya cuando la tomas, o cuando {name} te la pasa.

### `inbox.empty.seeNeeds`

- en: See who needs you
- zh: 看看谁在等你
- ar: عرض ما ينتظرك
- es: Ver quién te necesita

### `common.notFoundBody`

- en: It may have been removed, or the link is not quite right.
- zh: 可能已经被删掉了，或者链接不对。
- ar: ربما أُزيل، أو أن الرابط غير صحيح.
- es: Puede que se haya quitado, o que el enlace no sea correcto.

### `guide.length`

- en: Video · {length}
- zh: 视频 · {length}
- ar: فيديو · {length}
- es: Vídeo · {length}

### `billing.live.changed`

- en: Stripe has answered.
- zh: Stripe 已经回复了。
- ar: وصل ردّ Stripe.
- es: Stripe ya respondió.

### `billing.live.slow`

- en: Stripe has not confirmed the card yet. Open this page again later; if it still does not show, write to us.
- zh: Stripe 还没有确认这张卡。稍后再打开本页；如果还是没有，请联系我们。
- ar: لم يؤكّد Stripe البطاقة بعد. يُرجى فتح هذه الصفحة لاحقًا، وإن لم تظهر، يُرجى مراسلتنا.
- es: Stripe aún no ha confirmado la tarjeta. Abre esta página más tarde; si sigue sin aparecer, escríbenos.

### `practice.sent`

- en: Sent.
- zh: 发出了。
- ar: أُرسلت.
- es: Enviado.

## 2026-10-02 — the UI rebuild, phase 7 (the phone): every new line

The phone nav's two short labels (shown only on a phone), the day list's word for a date that is done,
and the month's count, now "+N". Read the Arabic for gender: تجارتي and مساعدك address nobody.

### `nav.short.employee`

- en: Assistant
- zh: 助手
- ar: مساعدك
- es: Asistente

### `nav.short.factory`

- en: Business
- zh: 生意
- ar: تجارتي
- es: Negocio

### `calendar.done`

- en: Done:
- zh: 已完成：
- ar: تمّ:
- es: Hecho:

### `calendar.more`

- en: +{n} more
- zh: +{n} 项
- ar: +{n} أخرى
- es: +{n} más

## 2026-10-03 — phase 9 (0121): the owner's pages in French, all of them

**Not a gate**, like everything in this file. The whole French catalogue (the `FR`
block in `src/core/owner/i18n/messages.ts`, 3,194 lines) was written for this
release and has had no native read. The French *disclosure* is a different thing:
its gate (`DISCLOSURE_NATIVE_REVIEW.fr`) stays false and is not touched here.

**The rules it was written to** (rule 6 in French):
- **The owner** is addressed with *vous*, and never with an adjective or participle that agrees.
  - Written: «Connexion réussie», «Confirmer ?», «Bienvenue».
  - Never: "Vous êtes connecté", "prêt", "sûr", or "Bienvenu".
- **The assistant** is `{name}` (or «votre assistant») with a verb.
  - Never il/elle.
  - Never "{name} est prêt": «{name} peut répondre», «{name} est à l’arrêt».
- **Customers** are «client(s)», «la clientèle» or «la personne qui écrit», with no il/elle for them.
- **Typography:** U+202F before ? ! ;, U+00A0 before : and inside « ». The typographic apostrophe ’ throughout.
- `tests/parity/assistant-pronouns.test.ts` holds what a regex can.

**Where to look first**: choices made to keep gender out, and meanings the translators guessed.

- **Page names:**
  - Setup → «Réglages»; Getting ready → «Préparatifs»; Practice → «Entraînement»; My business → «Mon activité».
  - "Needs you" → «Vous attend»; "Ready for customers" → «Tout est prêt pour les clients».
  - "Where customers reach you" → «Où vos clients vous écrivent». Some sentences call the same page «Canaux», as the English says "Channels".
  - Check they read as names and match wherever other lines cite them.
- **"The owner"** has three forms: «la direction», «la personne qui dirige l’activité / l’entreprise», and «la personne propriétaire de l’activité» (`staff.*`, `runbook.deploy.*`, `data.deletion.ownerOnly`, `setup.desc.people`).
  - "Nomi's operator" is «l’équipe Nomi» or «l’exploitant de Nomi» (the legal pages).
  - Pick one voice, and check it reads well for a one-person shop.
- **Capabilities** (`capability.*`) are nouns («Accueil», «Devis», «Relances»…) and fill `{cap}` inside sentences. Read those sentences whole.
- **"Go live"** is «le lancement». `pilot.attest.owner_ready` is «Je donne le feu vert au lancement», because "je suis prêt" would agree.
- **"Hand to me / Take over / Hand back"** are «Je m’en occupe / Reprendre la main / Rendre la main». `handto.*` is «Confier à».
- **"Stopped"** is «{name} est à l’arrêt» throughout.
- **Placeholders a translator could not see the context of:**
  - `takeover.why` («Motif du transfert :»), `knowledge.usage.lastUsed`;
  - `panel.sampleAsked` / `sampleHandled` (no «le» before `{date}`), `calendar.range` («du {from} au {to}»);
  - `connect.mail.connectedBy`, `prospects.key.stored`.
- **Software words:** none is said, and «j’ai» is avoided (the banned-word test reads "ai").
- **The `demote.why.*` first-person lines** are «j’étais sur le point de…».
- **Mailbox:** the owner's e-mail inbox is «messagerie»; «boîte de réception» was the retired name of the app's own area.
- **Examples:** `product.reject.ambiguous_price` keeps `1250.00` (a French owner writes `1250,00`); `import.error.price_not_number` uses `12,50` (the reader takes it).
- **`site.*` and `legal.*`** (nomidoes.com in French, and the policies a customer reads) are counsel's and a native reader's.
  - `site.who.languages` still lists the four languages the English lists. French joins it when a French workspace is offered on the site.

Reviewer: ______  Date: ______

## 2026-10-05 — the Home run: "Today" is "Home", and its new lines

The owner chose the page's name in each language: 首页, «الرئيسية», «Inicio», «Accueil». Each means the app's home base, never a house. Read the lines that cite the page, and the new ones on it.

- **The page's name where other lines cite it:**
  - `error.home`: 回到「首页」 / العودة إلى «الرئيسية» / Volver a Inicio / Retour à l’Accueil.
  - `takeover.flash.allowance_used` and `deletionAsked.noted` name it inside a sentence. Check the article and the quotation marks read naturally.
- **French: «Accueil» is now two things.** `capability.greet` (the assistant's first reply to a new customer) is also «Accueil». A French owner sees «Accueil» in the nav and among the assistant's capabilities. A native reader should say whether the capability needs another word (for example «Premier contact»). The page's name was the owner's choice and stays.
- **The greeting** (`home.greet.*`):
  - Arabic has no separate afternoon greeting, so afternoon and evening are both «مساء الخير».
  - French says «Bonjour» until 18:00, then «Bonsoir».
  - Spanish says «Buenas tardes» from noon and «Buenas noches» from 18:00. Check that «Buenas noches» at 18:00 does not sound like goodbye.
- **"Ready for the day" without a gender** (`home.ready`, `home.notYet.*`):
  - The assistant is never the subject of an adjective. Spanish says «Todo listo con {name} para hoy», French «Tout est prêt avec {name} pour la journée», Arabic «كل شيء جاهز لدى {name} لهذا اليوم».
  - The "not yet" lines put the replies first: «Las respuestas de {name} empiezan…», «تبدأ الردود من {name}…».
- **The schedule:** zh calls the calendar 日程, as the nav does (`home.schedule.title`: 你的日程, since the quiet-day run below). «القادم» (`home.schedule.next`) stands alone as a heading. Check it reads as "coming up".
- **The week's wins** (`home.wins.week.*`): the Arabic plural forms (محادثة واحدة، محادثتين، {n} محادثات) mirror `today.handled.title`.

Reviewer: ______  Date: ______

## 2026-10-05 — the quiet-day run: Home's headlines state what is

The owner's rule: a tile's headline is never a negative sentence. Four lines were retired: `today.handled.none`, `today.handled.ready`, `today.calm.notLive.title` and `home.schedule.none`. Read the new ones.

- **When nothing is dated** (`home.schedule.title`): 你的日程 / جدولك / Tu agenda / Votre programme. Check it reads as the tile's name, not as a claim that something is there.
- **When the assistant has never handled a conversation** (`home.wins.title`):
  - zh {name}为你处理的对话;
  - ar «ما يُنجَز لك مع {name}»: a passive, so nothing agrees with the assistant (the gender guard rejected «إنجازات {name}» by its form);
  - es «Lo que {name} resuelve por ti»;
  - fr «Ce que {name} règle pour vous».
- **What will appear there** (`home.wins.ahead`, `home.wins.connect`): the conversation is the subject, never the assistant. Arabic says «تظهر هنا كل محادثة تصلها ردود {name}», and French «chaque conversation prise en charge par {name}».
- **Older wins, with their date** (`home.wins.since.*`, `home.tally.since`): {date} is the day and month («20 sept», 9月20日, 20 سبتمبر).
  - Spanish «Desde el 20 sept», French «Depuis le 20 sept.».
  - The Arabic plural forms mirror `home.wins.week.*`.

Reviewer: ______  Date: ______

## 2026-10-06 — the advisor: its fixed sentences, its fact lines, and its privacy line

The advisor answers the owner's questions from the records. Its fixed sentences and its fact lines (`advisor.*`, about 210 keys) were written in zh, ar, es and fr in one pass, and none has had a native read.

- **What to read first:**
  - the opening line `advisor.hello` and the five examples (`advisor.example.*`);
  - the advice label `advisor.opinion.label` («这是建议，不是你记录里的事实：», «اقتراحي، وليس حقيقة من سجلاتك:», «Mi sugerencia, no un dato de tus registros:», «Ma suggestion, pas un fait tiré de vos données :»);
  - the nine "not recorded" sentences (`advisor.notStored.*`).
- **Arabic never makes Nomi the subject of a verb.** It uses the passive instead («… لا تُسجَّل في Nomi», «هذا لا يُحسَب في Nomi»), as the rest of the copy does with «فريق Nomi». Check the passives read naturally.
- **The reply-time lines** (`advisor.k.replyMedian`, `advisor.k.replyMeasured`, `advisor.k.replyUnanswered`) state three figures that always go together. Check that «الوقت الوسيط للرد» and «mediana» read as "median", not "average".
- **«لـ {name}»** in the calendar lines (`advisor.k.cal.*`, `advisor.k.delivery`, `advisor.none.delivery`) is a customer's name. It joins an Arabic name and stays apart from a Latin one, as elsewhere.
- **The privacy line** `legal.privacy.who.advisor` (shipped in #241) says the advisor's questions and the records that answer them go to the same provider. It is a legal sentence, so read it with the lines around it on /privacy.
- **The model's own sentences** are not in the catalogue. The model is told to gender nobody: in Arabic it should use the verbal noun or the passive. The check throws away a sentence that has he/she (他/她, él/ella, elle, or a standalone هو/هي where a customer is named); the owner then reads the facts instead. Arabic verb agreement cannot be checked by pattern (e.g. «توقف Amira Haddad»). A native reader should look at a few live answers, which `tools/check-advisor-model.mjs` prints.

Reviewer: ______  Date: ______
