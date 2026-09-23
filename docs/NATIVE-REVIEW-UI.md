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

