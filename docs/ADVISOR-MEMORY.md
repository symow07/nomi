# The advisor's memory: a plan for approval

**Status: plan only. Nothing here is built.** Written 2026-10-07 for the owner's approval. It replaces the advisor's "nothing is kept" stance, which the owner settled on 2026-10-07: the advisor stores conversation history, so it can help the owner analyse and grow the business over time.

What exists today, so the plan starts from the truth:
- The advisor stores nothing. Its routes log nothing above `warn` (`src/api/web/advisor.ts`).
- Customer erasure is schema-driven:
  - `erase_customer` (0126);
  - `RULES` in `tools/erase-buyer.mjs`, with the same list in SQL (`customer_erasure_contract()`);
  - a test that refuses any table nobody classified.
- Closing a workspace erases every table with a `business_id`, by itself (`workspace_erasure_steps()`).
- Every erasure writes `erasure_ledger` (ids and counts only), and `tools/replay-erasures.mjs` re-applies it after a restore.
- One model provider per installation (`LLM_*`, `src/llm/provider.ts`). Production uses DeepSeek. The privacy page names the provider from its address (`aiProcessor`).
- Every cookie Nomi sets is first-party and needed for the app to work. There is no analytics, no tracker and no consent banner, and the privacy page does not mention cookies (the full list is in section 9).

---

## 1. The three promises, and how each is kept

| Promise | How it is kept | Its honest limit |
|---|---|---|
| **1. Consent.** Stored only after an explicit, specific opt-in: "Allow Nomi to store your advisor conversations to help analyse your business over time". | A card on the advisor's page, with two buttons of equal weight. The advisor works the same without it. Each person decides for themselves. Each decision is recorded with the exact wording, its version, the language and the time. Withdrawing is one switch away, and it deletes. | None for Nomi's own copy. Nothing is stored before the card is answered "Allow". |
| **2. Deletion.** Turning it off, or deleting, removes it from **Nomi's database**. | The existing erasure system gains the advisor's tables (section 5): one switch, one delete per conversation, customer erasure, workspace closure, and person removal. Each writes the ledger, so a restore re-applies it. | Older encrypted backups keep a deleted row until they expire: dailies after 60 days, manual copies after 180, point-in-time recovery after about 4 weeks. A provider's copy is the provider's (section 6). |
| **3. No snooping from our end.** No human at Nomi reads stored conversations. | **A policy, backed by technical controls** (section 7): the content is encrypted at rest with its own key, operator tools cannot open it, and neither logs nor error reports carry it. | **Not a technical guarantee.** The service that answers has to read the history to use it, and Nomi's operator runs that service. Section 7 says this plainly. |

---

## 2. What is stored, where, and tied to whom

Everything is in Nomi's own Postgres. Every row carries the `business_id`, under row security as today, and the `person_id` of the one who asked. A person's history is theirs alone: **not even the owner can read a staff member's advisor conversations** (decision D2).

**`advisor_threads`**: one conversation.
- `id`, `business_id`, `person_id`;
- `started_at`, `last_turn_at`;
- `title`: the first question, cut to 80 characters, encrypted.

**`advisor_turns`**: one question and its answer.

| Column | What it holds |
|---|---|
| `id`, `thread_id`, `business_id`, `person_id`, `asked_at` | Who, when, which conversation. |
| `question` | The owner's words, encrypted. |
| `entry_id` | The catalogue entry it was resolved to (`A1` … `I6`), or `unknown`. |
| `params` | What was resolved: period, customer, product, reference. Encrypted, because a customer's name is personal data. |
| `answer_kind` | `fact`, `none`, `notStored`, `opinion`, `unknown` or `failed`. |
| `answer` | The answer exactly as shown, encrypted. |
| `facts` | The fact lines the answer drew on, as shown, encrypted. |
| `door` | The page link that went with it. |
| `provider`, `model` | Which provider phrased it, if any (section 6). |
| `phrased` | Whether the model's sentence passed the check. |

**`advisor_turn_subjects`**: `(turn_id, client_id)`, one row for every customer a turn named. This link lets a customer's erasure find every turn that mentions them (section 5c). Every read already knows which customers it names. Section 8 adds the guard that keeps the two in step.

**`advisor_consents`**: append-only, like `contact_consent` (0036).
- `id`, `business_id`, `person_id`;
- `event`: `granted`, `refused` or `withdrawn`;
- `wording_version`: the first 12 hex of the sha256 of the English opt-in sentence, as `TERMS_VERSION` does;
- `locale`, `at`.

The current state is the newest event. Nothing in the other three tables is ever written for a person whose newest event is not `granted`. A database constraint enforces this, not only the app (section 8).

**What is never stored:**
- the model's raw output when the check threw it away;
- the prompts sent to the provider;
- anything from a person who has not opted in;
- anything from the practice workspace.

---

## 3. Consent

**Lawful basis.**
- **Asking at all:** the contract with the business (GDPR art. 6(1)(b)), as today.
- **Storing the asker's conversations:** that person's consent (art. 6(1)(a)). It is specific (this one purpose), informed (the card names what is stored, who processes it and for how long), freely given, and withdrawable as easily as it was given.
- **Customers' personal data inside answers** (names, amounts): this is the business's data, held by Nomi as its processor. Storing a copy in history extends that processing, so it needs the business's instruction. **The owner switches it on for the workspace first** (decision D1), and only then can each person opt in. Nomi's terms need one sentence that covers it (section 9).

**Staff.** Consent from an employee is fragile, because of the imbalance of power. So:
- staff decide for themselves;
- the owner cannot opt in on their behalf;
- the owner cannot see who said yes;
- the owner can never read a staff member's history;
- saying no changes nothing about how the advisor answers them.

**The card.** It appears on the advisor's page above the question box, after the first answer the person gets. It is never a pop-up before the first question, so the advisor can be tried first. It stays until answered.
- Two buttons of equal weight, "Allow" and "Not now", plus a link to the privacy page's section.
- "Not now" is recorded as `refused`. The card does not come back for 90 days (decision D6). Settings can change it at any time.
- There is no pre-ticked box, and no "by continuing you agree".

**Withdrawal.** The same sentence is a switch on the advisor's page, for everyone, and in Settings → Your data, which is the owner's page. Turning it off asks once, with the consequence spelled out, then deletes at once (section 5a).

---

## 4. Grounding with history: a follow-up always re-resolves to a real query

History helps the advisor understand a follow-up. **It is never a source of facts.**

1. **Resolution, with context.** The recogniser receives:
   - the new question;
   - from this conversation only, at most the last 3 turns as *(question, resolved entry, resolved params)*.

   It never receives an earlier answer, an earlier fact line, or an earlier figure. "And last month?" after `D1` resolves to `D1` with `period: month`. "What about her?" after `A3 Amira` resolves to the same customer. Earlier conversations are never read.
2. **A fresh read, every time.** The resolved entry's read runs again, now, against the database, read-only, exactly as today. If a record changed between turns, the new answer shows the new record.
3. **Phrased only from the fresh facts.** The phrasing call gets the question and this read's lines, nothing from history. The check compares the sentence with this read's facts only. So a figure the model remembers from an earlier answer, but which the fresh read does not carry, makes the sentence fail, and the facts are shown instead.
4. **No guessing.** If a follow-up cannot be resolved to an entry with everything it needs (for example "her" with no customer in the last 3 turns), the answer is the fixed sentence that asks which customer. It never guesses from older history.
5. **Analysis over time comes from the records, not from memory.**
   - "Is it getting better?" is answered by reads that compare periods: the existing D7, this month against the same days of last month, and future reads like it.
   - It is never answered by comparing two stored answers.
   - Stored answers are for the owner to look back at, never input to a new answer.

Tests, written before the code:
- a scripted model that repeats a figure from an earlier turn is thrown away;
- a record changed between two turns shows in the second answer;
- a follow-up whose referent is outside the last 3 turns, or in another conversation, gets the "which customer" sentence;
- the recogniser's input contains no answer text.

---

## 5. Deletion: how each path reaches the advisor's tables

The advisor's history joins the erasure system that exists. It does not get a second one.

**a. Withdrawing consent** (the switch).
- Calls a new security-definer function, `advisor_forget(p_person, p_scope)`, built like `erase_customer`: the app role still holds no `DELETE`, and the function checks the caller is that person.
- In one transaction, it deletes the person's threads, turns and subjects, appends `withdrawn` to `advisor_consents`, and writes `erasure_ledger` (counts and ids only).
- The answer page says "deleted from Nomi's database", and nothing more.

**b. Deleting one conversation.** The same function, scoped to one thread. Ledger as above.

**c. A customer's erasure.**
- `advisor_turn_subjects` has a foreign key to `clients`, so the existing classification finds it. The test "a table nobody classified stops it" fails until it is classified.
- It is classified `erase` in `RULES` and in `customer_erasure_contract()`. Every turn that names the customer is deleted whole, and the turns are not redacted. A conversation left with no turns is deleted too.
- **Limit:** a customer named only in the owner's own free words, with no record behind them (for example a name the advisor did not recognise), cannot be found reliably. The privacy section says so. The owner can delete that conversation.

**d. Closing the workspace.** Automatic: every new table carries `business_id`, and `workspace_erasure_steps()` takes every such table by itself.

**e. A person removed.** Today a removed staff member is archived and never erased. Archiving a person will also call `advisor_forget(person, 'all')`. Their advisor history goes; their login stays archived as today.

**f. Practice.** The practice copy is a separate business row and has no advisor history (section 2).

**g. Backups and restore.**
- Deleted rows stay in the encrypted backups until those expire: dailies 60 days, manual copies 180 days, point-in-time recovery about 4 weeks. Being encrypted with the advisor key (section 7), they are unreadable without it.
- `tools/replay-erasures.mjs` already re-applies the ledger after a restore. It learns the new ledger kind, so a restore never brings a deleted conversation back.
- The privacy page says "at most 180 days".

**h. Retention cap (decision D5).** A conversation not opened for 12 months is deleted by a daily job, through the same function and ledger.

**What deletion does not reach, said plainly:** a copy a model provider kept of a question and its records, when it phrased an answer (section 6). Nomi cannot erase that.

---

## 6. Providers: several, and the owner's own

**Today:** one provider per installation. **Planned:**

1. **A list, not one.** `LLM_PROVIDERS` names an ordered list; the first is used and each next one is a fallback when the one before fails. Each entry has the same three settings as today.
2. **Each turn records** which provider and model phrased it (`advisor_turns.provider/model`). The owner can then see where a given question went. When deletion cannot reach a provider's copy, the record says which provider holds it.
3. **The privacy page names every provider on the list.** It reads the list, as `aiProcessor` reads the one address today. It gets one honest line per provider about what that provider keeps:

   | Provider | What it keeps (checked 2026-10-07) |
   |---|---|
   | DeepSeek | Its API terms (effective 2026-04-29) state no retention period, no storage location and nothing about training. Its privacy policy (2026-02-10) says the data DeepSeek collects is stored in the People's Republic of China, and that it does not cover content sent through apps built on its platform. |
   | OpenAI API | Abuse-monitoring logs kept for up to 30 days. API content is not used for training unless the customer opts in. Zero data retention needs OpenAI's approval. |
   | Anthropic | **To be checked against its current API terms before it is named.** It is not in production use. |

   DeepSeek's API terms also require the app (Nomi) to tell end users how their data is processed and to get their consent. The opt-in card and the privacy section do exactly that.
4. **The owner's own provider account.** Two forms. The first is the common one today; the second exists only where a provider offers it, and is not promised.
   - The owner pastes their own API key. It is stored sealed, like channel tokens (`CREDENTIAL_KEY`, AES-256-GCM, `src/security/credentials.ts`).
   - A provider sign-in (OAuth) that lets an app call the API on the owner's own account.

   **What changes when the owner uses their own provider:**
   - The owner's questions go through the owner's account. The owner, not Nomi, is that provider's customer. The provider's terms with the owner govern its copy: its retention, its training, its region.
   - Nomi's storage and deletion are unchanged. History, if allowed, is still in Nomi's database, and deletion still reaches exactly that.
   - The card and the privacy section name the owner's provider and say this in one sentence.
   - Revoking the key or signing out stops all advisor traffic through that account at once. It does not touch what that provider already holds.
   - The customers' data in a question still leaves Nomi. The business remains its controller, now sending it to a provider it chose itself.

---

## 7. "No snooping": a policy, with technical controls; not a technical guarantee

**The policy.** No one at Nomi reads stored advisor conversations: no support, no "improving the product", no training any model on them. The privacy page and the terms say so.

**The controls that make the policy hold:**
1. **Encrypted at rest with their own key.** `question`, `params`, `answer`, `facts` and `title` are sealed with AES-256-GCM under a new `ADVISOR_KEY`, separate from `CREDENTIAL_KEY` and from the database credentials. It uses the same sealing code as credentials, and a key version so it can be rotated (`tools/rekey.mjs` learns these columns). A database console, a dump, a backup or a stolen disk shows only ciphertext.
2. **Opened in one place only.** Only the advisor's routes open them, for the signed-in person who owns the row (row security by business *and* person). The decrypt function lives in `src/advisor/`, and the import-graph guard allows it nowhere else.
3. **No operator tool can open them.** A test fails if anything under `tools/` reads those columns or imports the decrypt function. The erasure function deletes rows without decrypting them.
4. **Never in logs or error reports.** The routes stay at `warn`. Errors are turned into a "failed" answer and no report holds request bodies, as `app_errors` already promises. A test sends a question containing a marker and checks no log line and no `app_errors` row contains it.
5. **Never sent anywhere else.** No export to a third party. The person's own download (decision D4) is the only way out, apart from the model provider.

**Why it is not a technical guarantee, said plainly.** The advisor's server has to read the history: to show it, and to resolve a follow-up. That server runs with `ADVISOR_KEY` in its environment, and Nomi's operator runs that server. Someone with production access could therefore change the code, or read the key, and decrypt. The controls stop the easy ways and make any other way a deliberate act. They do not make it impossible.

**Why not end-to-end encryption, with the key held only in the owner's browser:** the server could then neither show the history from another device nor use it to resolve a follow-up. And the provider still has to read each question to phrase its answer. So the privacy page will not say "encrypted so even we can't read it". It will say the policy and the controls.

---

## 8. Session or long-term: where a conversation begins and ends

- **It persists across days.** A conversation is kept until deleted, or until 12 months unopened (section 5h).
- **A conversation begins:**
  - with the first question after the page is opened fresh;
  - or after "New conversation" is pressed;
  - or when the last question in the current one is more than **4 hours** old (decision D3).
- **It ends** when the next one begins. There is no explicit "end".
- **What the page shows:** the current conversation, newest at the bottom, as today's exchange is shown. Above it is an "Earlier conversations" list (title and date), each one openable, deletable, and continued by asking. A person who has not opted in sees today's page: one exchange, nothing kept.
- **Context for follow-ups stays inside one conversation** (section 4: at most the last 3 turns). Earlier conversations are for reading, not for answering.

**Guards, written before the code:**
- **No consent, nothing stored.** A deferred constraint trigger refuses an insert into `advisor_turns` when the person's newest consent event is not `granted`. A test switches it off and sees it bite.
- **Subjects complete.** Every read returns `subjects`, the client ids behind every customer name in its lines. A test fails if a line names a customer of the fixture without that id. Every customer-naming read is run against a fixture with known names.
- **The "a table nobody classified stops it" test** must be red until the new tables are classified.
- **The privacy page's provider list** must equal the configured list.
- **Erasure reach:** customer erasure removes the turns naming that customer, and only those. Workspace closure removes everything. Withdrawal removes the person's history and writes the ledger. Replay after a restore deletes them again.
- **The no-snooping guards** in section 7.

---

## 9. Every copy change, in all five languages

Arabic follows rule 6: no gendered address and no pronoun for Nomi or the advisor. It uses verbal nouns, passives and «يُرجى». Spanish uses *tú*, French *vous*. `{processor}` is the provider's name as the privacy page prints it today.

### 9.1 The opt-in card (advisor page)

| Key | en | zh | ar | es | fr |
|---|---|---|---|---|---|
| `advisor.memory.title` | Keep your advisor conversations? | 保存你和顾问的对话吗？ | حفظ محادثات المستشار؟ | ¿Guardar tus conversaciones con la Asesoría? | Conserver vos conversations avec le Conseil ? |
| `advisor.memory.ask` | Allow Nomi to store your advisor conversations to help analyse your business over time. | 允许 Nomi 保存你和顾问的对话，以便长期帮助分析你的生意。 | السماح لـ Nomi بحفظ محادثات المستشار للمساعدة في تحليل النشاط التجاري مع مرور الوقت. | Permite que Nomi guarde tus conversaciones con la Asesoría para ayudar a analizar tu negocio con el tiempo. | Autoriser Nomi à conserver vos conversations avec le Conseil pour aider à analyser votre activité dans la durée. |
| `advisor.memory.what` | Your questions, the answers and the records they drew on are kept in Nomi's database. No one at Nomi reads them. Each question still goes to {processor} to word its answer. | 你的问题、回答以及回答所依据的记录会保存在 Nomi 的数据库里。Nomi 没有任何人会阅读它们。每个问题仍会发送给 {processor} 来组织回答。 | تُحفظ الأسئلة والإجابات والسجلات التي استندت إليها في قاعدة بيانات Nomi، ولا يقرؤها أحد في Nomi. ويُرسل كل سؤال إلى {processor} لصياغة الإجابة كما هو الحال الآن. | Tus preguntas, las respuestas y los registros en que se basan se guardan en la base de datos de Nomi. Nadie en Nomi los lee. Cada pregunta sigue enviándose a {processor} para redactar la respuesta. | Vos questions, les réponses et les données sur lesquelles elles s'appuient sont conservées dans la base de données de Nomi. Personne chez Nomi ne les lit. Chaque question est toujours envoyée à {processor} pour rédiger la réponse. |
| `advisor.memory.off` | You can turn this off at any time in Settings; that deletes them from Nomi's database. | 你可以随时在设置中关闭；关闭后会从 Nomi 的数据库中删除。 | يمكن إيقاف ذلك في أي وقت من الإعدادات، ويؤدي الإيقاف إلى حذفها من قاعدة بيانات Nomi. | Puedes desactivarlo cuando quieras en Ajustes; al hacerlo se borran de la base de datos de Nomi. | Vous pouvez le désactiver à tout moment dans les Réglages ; cela les supprime de la base de données de Nomi. |
| `advisor.memory.allow` | Allow | 允许 | السماح | Permitir | Autoriser |
| `advisor.memory.notNow` | Not now | 暂不 | ليس الآن | Ahora no | Pas maintenant |
| `advisor.memory.more` | What is kept, and for how long | 保存什么，保存多久 | ما يُحفظ ولأي مدة | Qué se guarda y durante cuánto tiempo | Ce qui est conservé, et combien de temps |

### 9.2 The switch, withdrawal and deletion (the advisor page for everyone; Settings → Your data for the owner)

| Key | en | zh | ar | es | fr |
|---|---|---|---|---|---|
| `advisor.memory.switch` | *(the same sentence as `advisor.memory.ask`)* | — | — | — | — |
| `advisor.memory.on` | On since {date} | 自 {date} 起开启 | مفعّل منذ {date} | Activado desde el {date} | Activé depuis le {date} |
| `advisor.memory.offState` | Off: nothing is kept | 已关闭：不保存任何内容 | متوقف: لا يُحفظ شيء | Desactivado: no se guarda nada | Désactivé : rien n'est conservé |
| `advisor.memory.confirm` | Turn this off and delete your stored advisor conversations from Nomi's database now? What {processor} kept when it worded an answer is governed by its own terms; Nomi cannot delete it. | 现在关闭并从 Nomi 的数据库中删除你保存的顾问对话吗？{processor} 在组织回答时保留的内容受其自身条款约束，Nomi 无法删除。 | إيقاف ذلك وحذف محادثات المستشار المحفوظة من قاعدة بيانات Nomi الآن؟ ما احتفظ به {processor} عند صياغة الإجابات تحكمه شروطه الخاصة، ولا يمكن لـ Nomi حذفه. | ¿Desactivar y borrar ahora de la base de datos de Nomi tus conversaciones guardadas con la Asesoría? Lo que {processor} conservó al redactar una respuesta se rige por sus propias condiciones; Nomi no puede borrarlo. | Désactiver et supprimer maintenant de la base de données de Nomi vos conversations conservées avec le Conseil ? Ce que {processor} a gardé en rédigeant une réponse relève de ses propres conditions ; Nomi ne peut pas le supprimer. |
| `advisor.memory.confirmYes` | Turn off and delete | 关闭并删除 | الإيقاف والحذف | Desactivar y borrar | Désactiver et supprimer |
| `advisor.memory.confirmNo` | Keep them | 保留 | الإبقاء عليها | Conservarlas | Les garder |
| `advisor.memory.deleted` | Your advisor conversations were deleted from Nomi's database. | 你的顾问对话已从 Nomi 的数据库中删除。 | حُذفت محادثات المستشار من قاعدة بيانات Nomi. | Tus conversaciones con la Asesoría se borraron de la base de datos de Nomi. | Vos conversations avec le Conseil ont été supprimées de la base de données de Nomi. |
| `advisor.thread.new` | New conversation | 新对话 | محادثة جديدة | Nueva conversación | Nouvelle conversation |
| `advisor.thread.earlier` | Earlier conversations | 之前的对话 | محادثات سابقة | Conversaciones anteriores | Conversations précédentes |
| `advisor.thread.delete` | Delete this conversation | 删除此对话 | حذف هذه المحادثة | Borrar esta conversación | Supprimer cette conversation |
| `advisor.thread.deleteConfirm` | Delete this conversation from Nomi's database? | 从 Nomi 的数据库中删除此对话吗？ | حذف هذه المحادثة من قاعدة بيانات Nomi؟ | ¿Borrar esta conversación de la base de datos de Nomi? | Supprimer cette conversation de la base de données de Nomi ? |
| `advisor.thread.deleted` | The conversation was deleted from Nomi's database. | 此对话已从 Nomi 的数据库中删除。 | حُذفت المحادثة من قاعدة بيانات Nomi. | La conversación se borró de la base de datos de Nomi. | La conversation a été supprimée de la base de données de Nomi. |

### 9.3 The privacy page: a new section, "The advisor's history" (`legal.privacy.advisor.*`)

| Key | en |
|---|---|
| `title` | The advisor's history |
| `what` | If you allow it, Nomi stores your questions to the advisor, its answers and the records each answer drew on (such as a customer's name, an amount or a date), so you can come back to them and ask follow-up questions. Nothing is stored unless you allow it, and each person at the business decides for themselves. |
| `basis` | This rests on your consent, given or refused on the advisor's page and withdrawn at any time in Settings. Withdrawing it, or deleting a conversation, deletes it from Nomi's database at once. Encrypted backups keep it until they expire, at most 180 days, and are used for nothing but restoring the service. A conversation not opened for 12 months is deleted. |
| `providers` | To word each answer, the question and its records are sent to {processors}. What a provider keeps is governed by its own terms, and Nomi cannot delete a provider's copy: {providerLines} |
| `nobody` | No one at Nomi reads stored advisor conversations, and they are never used to train any model. They are stored encrypted, and the tools Nomi's operator uses cannot open them. This is a commitment backed by those safeguards, not a technical impossibility: the service that answers you has to read your history to use it. |
| `own` | If you connect your own {processor} account, your questions go through that account, and {processor}'s terms with you govern its copy. |
| `customers` | A customer who asks for their data to be deleted is also deleted from advisor conversations that name them. A customer named only in your own words, with no record behind them, may not be found; you can delete that conversation yourself. |

The same keys in the other four languages:

**zh**
- `title`: 顾问的历史记录
- `what`: 如果你允许，Nomi 会保存你向顾问提出的问题、它的回答以及每个回答所依据的记录（例如客户姓名、金额或日期），方便你回看并继续追问。未经你允许，不会保存任何内容；商家里的每个人各自决定。
- `basis`: 这基于你的同意：你在顾问页面上同意或拒绝，并可随时在设置中撤回。撤回同意或删除某个对话，会立即将其从 Nomi 的数据库中删除。加密备份会保留到过期为止，最长 180 天，且只用于恢复服务。12 个月未打开的对话会被删除。
- `providers`: 为了组织每个回答，问题及其记录会发送给 {processors}。服务商保留什么受其自身条款约束，Nomi 无法删除服务商保留的副本：{providerLines}
- `nobody`: Nomi 没有任何人会阅读保存的顾问对话，这些对话也绝不会用于训练任何模型。它们以加密方式保存，Nomi 运营方使用的工具无法打开它们。这是一项有上述保护措施支撑的承诺，而不是技术上的不可能：为你回答问题的服务必须读取你的历史记录才能使用它。
- `own`: 如果你连接自己的 {processor} 账户，你的问题会通过该账户发送，{processor} 保留的副本受你与它之间的条款约束。
- `customers`: 客户要求删除其数据时，提到该客户的顾问对话也会被删除。仅在你自己的话里提到、没有对应记录的客户可能无法找到；你可以自行删除该对话。

**ar**
- `title`: سجل المستشار
- `what`: عند السماح بذلك، تحفظ Nomi الأسئلة الموجّهة إلى المستشار وإجاباته والسجلات التي استندت إليها كل إجابة (مثل اسم عميل أو مبلغ أو تاريخ)، للرجوع إليها وطرح أسئلة متابعة. لا يُحفظ شيء دون إذن، ويقرر كل شخص في النشاط التجاري ذلك بنفسه.
- `basis`: يستند ذلك إلى الموافقة، التي تُمنح أو تُرفض في صفحة المستشار ويمكن سحبها في أي وقت من الإعدادات. ويؤدي سحب الموافقة أو حذف محادثة إلى حذفها من قاعدة بيانات Nomi فورًا. وتحتفظ النسخ الاحتياطية المشفّرة بها حتى انتهاء صلاحيتها، 180 يومًا كحد أقصى، ولا تُستخدم إلا لاستعادة الخدمة. وتُحذف المحادثة التي لم تُفتح لمدة 12 شهرًا.
- `providers`: لصياغة كل إجابة، يُرسل السؤال وسجلاته إلى {processors}. وما يحتفظ به كل مزوّد تحكمه شروطه الخاصة، ولا يمكن لـ Nomi حذف نسخة المزوّد: {providerLines}
- `nobody`: لا يقرأ أحد في Nomi محادثات المستشار المحفوظة، ولا تُستخدم أبدًا لتدريب أي نموذج. وهي محفوظة بشكل مشفّر، ولا تستطيع الأدوات التي يستخدمها مشغّل Nomi فتحها. هذا التزام تدعمه هذه الضمانات، وليس استحالة تقنية: فالخدمة التي تجيب تحتاج إلى قراءة السجل لاستخدامه.
- `own`: عند ربط حساب {processor} خاص، تمرّ الأسئلة عبر ذلك الحساب، وتحكم شروط {processor} المبرمة معه النسخةَ التي يحتفظ بها.
- `customers`: عندما يطلب عميل حذف بياناته، يُحذف أيضًا من محادثات المستشار التي تذكره. أما العميل الذي لم يُذكر إلا في كلمات السؤال دون سجل يقابله، فقد يتعذّر العثور عليه، ويمكن حذف تلك المحادثة مباشرةً.

**es**
- `title`: El historial de la Asesoría
- `what`: Si lo permites, Nomi guarda tus preguntas a la Asesoría, sus respuestas y los registros en que se basa cada respuesta (como el nombre de un cliente, un importe o una fecha), para que puedas volver a ellas y hacer preguntas de seguimiento. No se guarda nada si no lo permites, y cada persona del negocio decide por sí misma.
- `basis`: Se basa en tu consentimiento, que das o rechazas en la página de la Asesoría y puedes retirar en cualquier momento en Ajustes. Retirarlo, o borrar una conversación, la borra de la base de datos de Nomi al instante. Las copias de seguridad cifradas la conservan hasta que caducan, como máximo 180 días, y solo se usan para restaurar el servicio. Una conversación que no se abre en 12 meses se borra.
- `providers`: Para redactar cada respuesta, la pregunta y sus registros se envían a {processors}. Lo que conserva cada proveedor se rige por sus propias condiciones, y Nomi no puede borrar la copia del proveedor: {providerLines}
- `nobody`: Nadie en Nomi lee las conversaciones guardadas con la Asesoría, y nunca se usan para entrenar ningún modelo. Se guardan cifradas y las herramientas del operador de Nomi no pueden abrirlas. Es un compromiso respaldado por esas salvaguardas, no una imposibilidad técnica: el servicio que te responde tiene que leer tu historial para usarlo.
- `own`: Si conectas tu propia cuenta de {processor}, tus preguntas pasan por esa cuenta y las condiciones de {processor} contigo rigen su copia.
- `customers`: Si un cliente pide que se borren sus datos, también se borra de las conversaciones con la Asesoría que lo nombran. Un cliente nombrado solo en tus propias palabras, sin un registro detrás, puede no encontrarse; puedes borrar esa conversación tú mismo.

**fr**
- `title`: L'historique du Conseil
- `what`: Si vous l'autorisez, Nomi conserve vos questions au Conseil, ses réponses et les données sur lesquelles chaque réponse s'appuie (par exemple le nom d'un client, un montant ou une date), pour que vous puissiez y revenir et poser des questions de suivi. Rien n'est conservé sans votre accord, et chaque personne de l'entreprise décide pour elle-même.
- `basis`: Cela repose sur votre consentement, donné ou refusé sur la page du Conseil et retirable à tout moment dans les Réglages. Le retirer, ou supprimer une conversation, la supprime aussitôt de la base de données de Nomi. Les sauvegardes chiffrées la conservent jusqu'à leur expiration, 180 jours au plus, et ne servent qu'à rétablir le service. Une conversation non ouverte depuis 12 mois est supprimée.
- `providers`: Pour rédiger chaque réponse, la question et ses données sont envoyées à {processors}. Ce qu'un fournisseur conserve relève de ses propres conditions, et Nomi ne peut pas supprimer la copie d'un fournisseur : {providerLines}
- `nobody`: Personne chez Nomi ne lit les conversations conservées avec le Conseil, et elles ne servent jamais à entraîner un modèle. Elles sont stockées chiffrées et les outils de l'opérateur de Nomi ne peuvent pas les ouvrir. C'est un engagement appuyé par ces garanties, pas une impossibilité technique : le service qui vous répond doit lire votre historique pour s'en servir.
- `own`: Si vous connectez votre propre compte {processor}, vos questions passent par ce compte, et les conditions de {processor} avec vous régissent sa copie.
- `customers`: Lorsqu'un client demande la suppression de ses données, il est aussi supprimé des conversations avec le Conseil qui le nomment. Un client nommé seulement dans vos propres mots, sans fiche correspondante, peut ne pas être retrouvé ; vous pouvez supprimer cette conversation vous-même.

**Provider lines (`legal.privacy.provider.*`).** One line per configured provider. The same wording rules apply in each language.

| Provider | en | zh | ar | es | fr |
|---|---|---|---|---|---|
| DeepSeek | DeepSeek's API terms state no retention period or storage location; its privacy policy says the data DeepSeek collects is stored in China. | DeepSeek 的 API 条款未规定保留期限或存储地点；其隐私政策称，DeepSeek 收集的数据存储在中国。 | لا تحدد شروط الواجهة البرمجية لدى DeepSeek مدة احتفاظ أو مكان تخزين، وتنص سياسة الخصوصية لديها على تخزين البيانات التي تجمعها في الصين. | Las condiciones de la API de DeepSeek no indican plazo de conservación ni lugar de almacenamiento; su política de privacidad dice que los datos que recoge se almacenan en China. | Les conditions de l'API de DeepSeek n'indiquent ni durée de conservation ni lieu de stockage ; sa politique de confidentialité indique que les données qu'elle collecte sont stockées en Chine. |
| OpenAI | OpenAI keeps API content for up to 30 days to monitor abuse and does not use it for training unless the account opts in. | OpenAI 会将 API 内容保留最多 30 天用于监测滥用，除非账户选择加入，否则不会用于训练。 | تحتفظ OpenAI بمحتوى الواجهة البرمجية لمدة تصل إلى 30 يومًا لرصد إساءة الاستخدام، ولا تستخدمه للتدريب ما لم يختر الحساب ذلك. | OpenAI conserva el contenido de la API hasta 30 días para vigilar abusos y no lo usa para entrenar salvo que la cuenta lo acepte. | OpenAI conserve le contenu de l'API jusqu'à 30 jours pour surveiller les abus et ne l'utilise pas pour l'entraînement, sauf accord du compte. |

**`legal.privacy.who.advisor`** (the line already shipped) becomes conditional. Without history it stays as it is. With history it adds: "…and, if you allow it, keeps your advisor conversations as described below."

**Sub-processors.** The "who" list names every configured provider, not only the first. It also names two that are not named today:
- the transcriber, when `TRANSCRIBE_API_KEY` is set (OpenAI by default);
- the sign-up bot check (Cloudflare Turnstile or hCaptcha), when set.

### 9.4 Cookies

**What Nomi sets today:**

| Cookie | Purpose | Lifetime |
|---|---|---|
| `yf_session` | Keeps you signed in. | 7 days |
| `yf_locale` | Remembers your language. | 1 year |
| `yf_flash` | Shows a notice once, after you save something. | 60 s |
| `yf_otp` | Holds a sign-in code you are entering. | 30 min |
| `yf_dev` | Recognises a device you have confirmed. | 180 days |
| `yf_setlink` | Holds a password-setting link. | 1 h |
| `yf_issued` | Shows a staff access code once. | 5 min |
| `yf_oauth`, `yf_meta`, `yf_wa` | Hold a connection in progress. | 10 min |

Every one is first-party and needed for the app to work. Strictly necessary cookies need no consent under the ePrivacy rules. There is no analytics, no advertising and no tracker.

**What changes:**
1. **The privacy page gets a "Cookies" section** listing them (the strings are below).
2. **A gate for anything non-essential.** Every cookie name the app sets is listed in one place, as necessary or optional. A test fails on any unlisted cookie. An optional cookie, or a third-party script that sets one, can only be written after a recorded "yes" from a consent banner.
3. **No banner today.** There is nothing optional to ask about, so a banner would only be noise (decision D7). The banner and its blocking come with the first optional cookie, and the gate makes sure they come first.
4. **The sign-up bot check** may set its own cookie, on the sign-up page only. It is named in the cookie section, classed as security (strictly necessary for sign-up), and loaded nowhere else.

| Key | en | zh | ar | es | fr |
|---|---|---|---|---|---|
| `legal.privacy.cookies.title` | Cookies | Cookie | ملفات تعريف الارتباط | Cookies | Cookies |
| `legal.privacy.cookies.body` | Nomi sets only the cookies it needs to work: to keep you signed in, to remember your language, to show a notice once after you save something, to recognise a device you have confirmed, and to hold a sign-in or a connection while it is in progress. None tracks you, and none comes from an advertiser or an analytics service, so there is nothing to agree to. | Nomi 只设置运行所必需的 Cookie：保持你的登录状态、记住你的语言、在你保存后显示一次提示、识别你已确认的设备，以及在登录或连接进行中时暂存信息。这些 Cookie 都不会追踪你，也不来自广告商或分析服务，因此无需你同意。 | تضع Nomi ملفات تعريف الارتباط اللازمة لعملها فقط: لإبقاء تسجيل الدخول، وتذكّر اللغة، وعرض إشعار مرة واحدة بعد الحفظ، والتعرّف على جهاز سبق تأكيده، والاحتفاظ بتسجيل دخول أو ربط أثناء إجرائه. لا يتتبّع أيٌّ منها التصفح، ولا يأتي أيٌّ منها من معلِن أو خدمة تحليلات، لذلك لا يلزم أي موافقة. | Nomi solo usa las cookies que necesita para funcionar: mantener tu sesión iniciada, recordar tu idioma, mostrar un aviso una vez después de guardar, reconocer un dispositivo que confirmaste y conservar un inicio de sesión o una conexión mientras está en curso. Ninguna te rastrea ni procede de un anunciante o de un servicio de analítica, así que no hay nada que aceptar. | Nomi n'utilise que les cookies nécessaires à son fonctionnement : garder votre session ouverte, retenir votre langue, afficher une fois un avis après un enregistrement, reconnaître un appareil que vous avez confirmé et conserver une connexion en cours. Aucun ne vous suit, aucun ne provient d'un annonceur ou d'un service d'analyse, il n'y a donc rien à accepter. |
| `legal.privacy.cookies.botCheck` | On the sign-up page only, a check against automated sign-ups ({provider}) may set its own cookie for that check. | 仅在注册页面上，防自动注册检查（{provider}）可能会为此设置它自己的 Cookie。 | في صفحة التسجيل فقط، قد يضع فحص التسجيل الآلي ({provider}) ملف تعريف ارتباط خاصًا به لهذا الفحص. | Solo en la página de registro, una comprobación contra registros automáticos ({provider}) puede usar su propia cookie para esa comprobación. | Sur la page d'inscription uniquement, une vérification contre les inscriptions automatisées ({provider}) peut déposer son propre cookie pour cette vérification. |

### 9.5 The terms and Nomi's documents

- **The terms.** One sentence: if the business turns on advisor history, Nomi, as the business's processor, keeps the advisor conversations of the people who allow it, as the privacy page describes.
- **`docs/LEGAL.md`** already lags: it still says three languages. It gets the new sections. Counsel reviews the privacy and cookie copy before it ships, especially the DeepSeek transfer to China for EU data, which already applies to the assistant.
- **`docs/NATIVE-REVIEW-UI.md`.** Every string above, for a native read.

---

## 10. Building it, once approved (about 3 PRs)

**1. Storage and deletion, with no UI.**
- A migration for the four tables; the consent trigger; `advisor_forget`; the ledger kind.
- The classification in `RULES` and `customer_erasure_contract()`.
- Replay after restore; `ADVISOR_KEY` sealing; rekey.
- Guards: no tool opens the content; nothing stored without consent; erasure reach; replay.
- Backup the day before, as for any migration.

**2. The page.**
- The opt-in card, the switch in Settings → Your data, the conversations list, "New conversation", per-conversation delete.
- Follow-ups with the last 3 turns, and the grounding tests (section 4).
- Subjects on every read.
- 5 languages; phone and desktop screenshots.

**3. Providers and the privacy page.**
- The provider list with fallbacks; provider per turn.
- The privacy and cookie sections and provider lines; the cookie gate.
- The owner's own API key (sealed). OAuth only where a provider offers it, as its own later step.
- The terms sentence.
- Counsel's read before deploy.

---

## 11. Decisions for the owner

- **D1. Who switches it on for the business?**
  - **Proposed:** the owner first, for the workspace, and then each person for themselves. This gives the business's instruction, as controller, before any copy of customers' data is kept.
  - **Alternative:** each person alone.
- **D2. Can the owner read staff members' advisor history?**
  - **Proposed: no.** Each person's history is theirs alone. This keeps staff consent freely given.
- **D3. When does a new conversation begin?**
  - **Proposed:** after 4 hours of quiet, or on "New conversation".
- **D4. Can each person download their own history?**
  - **Proposed: yes,** from Your data. Today's export is owner-only and covers the business's records.
- **D5. When is unopened history deleted?**
  - **Proposed:** after 12 months unopened. Other options: never, 6 months or 24 months.
- **D6. When does the card come back after "Not now"?**
  - **Proposed:** after 90 days, and never more often.
- **D7. Cookie banner today?**
  - **Proposed: no banner** while every cookie is strictly necessary. The cookie section and the gate are built now, and the banner comes with the first optional cookie.
  - **Alternative:** an informational notice now.
- **D8. Encryption with a separate `ADVISOR_KEY`?**
  - **Proposed: yes.** It is one more Railway variable you paste, like `CREDENTIAL_KEY`.
- **D9. Your own provider: which form first?**
  - **Proposed:** your own API key first. A provider sign-in only once a provider offers one that fits.

Sources checked 2026-10-07:
- [OpenAI API: your data](https://developers.openai.com/api/docs/guides/your-data)
- [DeepSeek Open Platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) (effective 2026-04-29)
- [DeepSeek privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) (2026-02-10)
