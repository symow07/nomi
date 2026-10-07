# The advisor's memory: the plan, as decided

**Status: decided, and being built.** The owner answered D1–D9 on 2026-10-07 (section 11).
- **PR 1, storage and deletion, no page:** built. Branch `advisor-memory-storage`, migration 0130.
- **PR 2, the page and the copy:** next. It ships the privacy page's advisor and cookie sections with it, because nothing may be stored before the privacy page describes it.
- **A later batch:** the provider list with fallbacks, and the owner's own API key (section 10).

It replaces the advisor's "nothing is kept" stance, which the owner settled on 2026-10-07: the advisor stores conversation history, so it can help the owner analyse and grow the business over time.

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

Everything is in Nomi's own Postgres. Every row carries the `business_id` and the `person_id` of the one who asked. Row security checks both: the workspace, as today, and the person (`current_person_id()`, set per transaction like the workspace). A person's history is theirs alone: **not even the owner can read a staff member's advisor conversations** (decision D2). The owner can only delete it whole, unread (section 5i).

**`advisor_threads`**: one conversation.
- `id`, `business_id`, `person_id`;
- `started_at`, `last_turn_at`;
- `opened_at`: the last time it was opened. The 12-month deletion counts from it (D5);
- `title`: the first question, cut to 80 characters, encrypted;
- `sealed_with`: the fingerprint of the key that sealed it (section 7).

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
- the owner can never read a staff member's history. The owner can delete it whole, unread (section 5i);
- saying no changes nothing about how the advisor answers them.

**The card.** It appears on the advisor's page above the question box, after the first answer the person gets. It is never a pop-up before the first question, so the advisor can be tried first. It stays until answered.
- Two buttons of equal weight, "Allow" and "Not now", plus a link to the privacy page's section.
- "Not now" is recorded as `refused`. The card comes back once, 90 days later. After a second "Not now" it never asks again, and the switch in Settings is then the only way to turn it on (decision D6).
- There is no pre-ticked box, and no "by continuing you agree".

**Withdrawal.** The same sentence is a switch in Settings → Your data. Every person sees their own switch and their own download there (D4); the owner also sees the workspace switch (D1) and the team list for section 5i. Turning a switch off asks once, with the consequence spelled out, then deletes at once (section 5a).

**The workspace switch (D1).** Only the owner turns it on (`advisor_history_set`). Until then the card is never shown and nothing is kept for anyone. Turning it off deletes everyone's history in the workspace, with its ledger line.

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
- Calls the security-definer function `advisor_forget(p_person, p_thread)`, built like `erase_customer`. The app role still holds no `DELETE`. A null `p_thread` means all of that person's conversations.
- The function lets only these callers through: the person themselves, for one conversation or all; and the owner, for all of a team member's, never one (section 5i).
- In one transaction, the app appends `withdrawn` to `advisor_consents`. The function deletes the person's threads, turns and subjects, and writes `erasure_ledger`: kind `advisor`, the person's id, the conversations' ids, and counts. Never the words.
- The answer page says "deleted from Nomi's database", and nothing more.

**b. Deleting one conversation.** The same function, scoped to one thread. Ledger as above.

**c. A customer's erasure.**
- `advisor_turn_subjects` has a foreign key to `clients`, so the existing classification finds it. The test "a table nobody classified stops it" fails until it is classified.
- It is classified `erase` in `RULES` and in `customer_erasure_contract()`. Every turn that names the customer is deleted whole, and the turns are not redacted. A conversation left with no turns is deleted too.
- **Limit:** a customer named only in the owner's own free words, with no record behind them (for example a name the advisor did not recognise), cannot be found reliably. The privacy section says so. The owner can delete that conversation.

**d. Closing the workspace.** Automatic: every new table carries `business_id`, and `workspace_erasure_steps()` takes every such table by itself.

**e. A person removed.** Today a removed staff member is archived and never erased. A trigger on archiving now deletes their advisor history, with its ledger line (`by_who: team-removal`). Their login stays archived as today.

**f. Practice.** The practice copy is a separate business row and has no advisor history (section 2).

**g. Backups and restore.**
- Deleted rows stay in the encrypted backups until those expire: dailies 60 days, manual copies 180 days, point-in-time recovery about 4 weeks. Being encrypted with the advisor key (section 7), they are unreadable without it.
- `tools/replay-erasures.mjs` already re-applies the ledger after a restore. It learns the new ledger kind, so a restore never brings a deleted conversation back.
- The privacy page says "at most 180 days".

**h. Retention cap (decision D5).** A conversation not opened for 12 months is deleted by a daily job (`advisor_expire()`, 03:50 UTC), with a ledger line (`via: retention`).

**i. The owner deletes a team member's history, unread (decision D2).**
- Where: Settings → Your data, while that person is on the team. One control per team member.
- What: `advisor_forget(person, null)` as the owner. It deletes all of that person's conversations and reads none of them. The ledger line says `via: owner`.
- What the owner sees: nothing of the history. The control is there for every team member, whether or not they kept anything, and the result reads the same either way. So it does not tell the owner who said yes.
- The owner cannot delete one conversation of someone else's. The database refuses it (`NE022`).

**j. The workspace switched off (D1).** `advisor_history_set(false)` deletes everyone's history in the workspace, with a ledger line. From then on, nothing is kept until the owner turns it on again.

**What deletion does not reach, said plainly:** a copy a model provider kept of a question and its records, when it phrased an answer (section 6). Nomi cannot erase that.

---

## 6. Providers: several, and the owner's own

**This batch (PR 2):** one provider per installation, as today. Each turn records which provider and model phrased it. The privacy page names that one provider, with its line (section 9.3).

**A later batch:** items 1 and 4 below, the list with fallbacks and the owner's own key.

**Planned:**

1. **A list, not one.** `LLM_PROVIDERS` names an ordered list; the first is used and each next one is a fallback when the one before fails. Each entry has the same three settings as today.
2. **Each turn records** which provider and model phrased it (`advisor_turns.provider/model`). The owner can then see where a given question went. When deletion cannot reach a provider's copy, the record says which provider holds it.
3. **The privacy page names every provider on the list.** It reads the list, as `aiProcessor` reads the one address today. It gets one honest line per provider about what that provider keeps:

   | Provider | What it keeps (checked 2026-10-07) |
   |---|---|
   | DeepSeek | Its API terms (effective 2026-04-29) state no retention period, no storage location and nothing about training. Its privacy policy (2026-02-10) says the data DeepSeek collects is stored in the People's Republic of China, and that it does not cover content sent through apps built on its platform. |
   | OpenAI API | Abuse-monitoring logs kept for up to 30 days. API content is not used for training unless the customer opts in. Zero data retention needs OpenAI's approval. |
   | Anthropic | **To be checked against its current API terms before it is named.** It is not in production use. |

   DeepSeek's API terms also require the app (Nomi) to tell end users how their data is processed and to get their consent. The opt-in card and the privacy section do exactly that.
4. **The owner's own provider account (D9).** The owner pastes their own API key. It is stored sealed, like channel tokens (`CREDENTIAL_KEY`, AES-256-GCM, `src/security/credentials.ts`). A provider sign-in (OAuth) is not planned now.

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
1. **Encrypted at rest with their own key (D8).** `question`, `params`, `answer`, `facts` and `title` are sealed with AES-256-GCM under `ADVISOR_KEY`, separate from `CREDENTIAL_KEY` and from the database credentials (`src/advisor/seal.ts`). Each row records the fingerprint of the key that sealed it. A database console, a dump, a backup or a stolen disk shows only ciphertext.
   - **Rotation.** Set `ADVISOR_KEY_PREVIOUS` to the old key and `ADVISOR_KEY` to the new one. The app opens with either and seals again with the new one whenever a conversation is opened. The boot log counts the rows still under the old key. `tools/rekey.mjs` does not open these columns; it says so. Twelve months unopened (D5) bounds how long an old key is needed. Runbook: `docs/SECRET-ROTATION.md`, beside `CREDENTIAL_KEY`.
   - **Missing or wrong key.** The advisor keeps answering, exactly as without history. Nothing new is kept. A stored conversation it cannot open shows "This conversation could not be opened" (`advisor.thread.unreadable`). It never crashes. The boot log says which: not set, or not a 64-hex key.
2. **Opened in one place only.** Only the advisor's routes open them, for the signed-in person who owns the row (row security by business *and* person). The decrypt function lives in `src/advisor/`, and the import-graph guard allows it nowhere else.
3. **No operator tool can open them.** A test fails if anything under `tools/` reads those columns or imports the decrypt function. The erasure function deletes rows without decrypting them.
4. **Never in logs or error reports.** The routes stay at `warn`. Errors are turned into a "failed" answer and no report holds request bodies, as `app_errors` already promises. A test sends a question containing a marker and checks no log line and no `app_errors` row contains it.
5. **Never sent anywhere else.** No export to a third party. The person's own download (decision D4) is the only way out, apart from the model provider.
   - Each person downloads their own history from Settings → Your data, opened for them.
   - **The hole to close first:** the owner's business export (today's, owner-only) must hold advisor rows whose `person_id` is the owner's own, and no others. The test comes first and must be seen red before the fix.

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

**Guards.** Each one is broken on purpose once, and a test must fail.
- **Nothing stored without consent.** A trigger refuses a row when the workspace switch is off or the person's newest consent is not `granted`. Switching the trigger off lets the row in, and the test fails.
- **No tool opens the content.** Nothing under `tools/` names the encrypted columns, except the list that says no tool opens them, and nothing imports the decrypt function.
- **No question in the logs.** A question carrying a marker appears in no log line and no `app_errors` row.
- **History is never a source of facts.** A scripted model that repeats an earlier figure is thrown away. A record changed between turns shows the new value.
- **No guessing.** A follow-up whose referent is outside the last 3 turns, or in another conversation, gets the fixed "which customer" sentence.
- **The recogniser's input** contains no answer text.
- **Subjects complete.** Every read returns `subjects`, the client ids behind every customer it names. The fixture covers every customer-naming catalogue entry, and a new entry without a fixture fails the test.
- **Erasure reach.** Customer erasure removes only the turns naming that customer. Workspace closure removes everything. Withdrawal removes the history and writes the ledger. Replay after a restore deletes it again.
- **D4.** The owner's export contains no other person's rows.
- **D7.** No third-party browser request outside the allow-list (section 9.4).
- **The "a table nobody classified stops it" test** stays red until the new tables are classified.

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

### 9.2 The switch, withdrawal and deletion (Settings → Your data: each person their own; the owner also the workspace and the team)

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
| `advisor.thread.unreadable` | This conversation could not be opened. | 无法打开此对话。 | تعذّر فتح هذه المحادثة. | No se pudo abrir esta conversación. | Impossible d'ouvrir cette conversation. |
| `advisor.memory.download` | Download your advisor history | 下载你的顾问记录 | تنزيل سجل المستشار | Descargar tu historial de la Asesoría | Télécharger votre historique du Conseil |
| `advisor.memory.ownerDelete` | Delete {name}'s advisor history | 删除{name}的顾问记录 | حذف سجل المستشار الخاص بـ {name} | Borrar el historial de la Asesoría de {name} | Supprimer l'historique du Conseil de {name} |
| `advisor.memory.ownerDeleteConfirm` | Delete everything {name} kept with the advisor? You will not see it; it is deleted from Nomi's database. | 删除{name}保存的全部顾问对话吗？你不会看到其中内容，它们将从 Nomi 的数据库中删除。 | حذف كل ما حُفظ من محادثات {name} مع المستشار؟ لن يُعرض شيء منها، وتُحذف من قاعدة بيانات Nomi. | ¿Borrar todo lo que {name} guardó con la Asesoría? No lo verás; se borra de la base de datos de Nomi. | Supprimer tout ce que {name} a conservé avec le Conseil ? Vous ne le verrez pas ; c'est supprimé de la base de données de Nomi. |
| `advisor.memory.ownerDeleted` | Nothing of {name}'s advisor history is kept now. | {name}的顾问记录现已不再保存任何内容。 | لم يعد يُحفظ شيء من سجل {name} مع المستشار. | Ya no se guarda nada del historial de la Asesoría de {name}. | Plus rien de l'historique du Conseil de {name} n'est conservé. |

`advisor.memory.ownerDeleted` reads the same whether or not anything was kept (section 5i).

### 9.3 The privacy page: a new section, "The advisor's history" (`legal.privacy.advisor.*`)

| Key | en |
|---|---|
| `title` | The advisor's history |
| `what` | If you allow it, Nomi stores your questions to the advisor, its answers and the records each answer drew on (such as a customer's name, an amount or a date), so you can come back to them and ask follow-up questions. Nothing is stored unless you allow it, and each person at the business decides for themselves. |
| `basis` | This rests on your consent, given or refused on the advisor's page and withdrawn at any time in Settings. Withdrawing it, or deleting a conversation, deletes it from Nomi's database at once. Encrypted backups keep it until they expire, at most 180 days, and are used for nothing but restoring the service. A conversation not opened for 12 months is deleted. |
| `providers` | To word each answer, the question and its records are sent to {processors}. What a provider keeps is governed by its own terms, and Nomi cannot delete a provider's copy: {providerLines} |
| `nobody` | No one at Nomi reads stored advisor conversations, and they are never used to train any model. They are stored encrypted, and the tools Nomi's operator uses cannot open them. This is a commitment backed by those safeguards, not a technical impossibility: the service that answers you has to read your history to use it. |
| `own` | *(later batch, with the owner's own key)* If you connect your own {processor} account, your questions go through that account, and {processor}'s terms with you govern its copy. |
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

**Provider lines (`legal.privacy.provider.*`).** One line per configured provider. The same wording rules apply in each language. PR 2 ships the line for the one provider configured; the others come with the provider list.

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

**What changes (decision D7):**
1. **The privacy page gets a "Cookies" section** listing them (the strings are below).
2. **No banner** while every cookie is strictly necessary.
3. **The gate covers every third-party request the browser makes**, not only cookies: fonts, scripts, stylesheets, images, frames and beacons from any host Nomi does not serve.
   - One allow-list, in code, with a reason for each entry.
   - A test renders the pages and fails on any such request, or any cookie, that is not on the list.
   - An optional cookie or request can only come after a recorded "yes" from a consent banner. The banner comes with the first one, and the gate makes sure it comes first.
4. **What ships today** (checked 2026-10-07):
   - **Fonts:** already served by Nomi (`assets/fonts/`, `src/api/web/type.ts`). Nothing to fix.
   - **The sign-up bot check** (Cloudflare Turnstile or hCaptcha), when configured: its script, and the frame it opens, on the sign-up page only. On the list, reason: security for sign-up. It may set its own cookie there; the cookie section names it.
   - **Product photos: a hole.** The product page draws `product_images.url` exactly as stored. An address on another host makes the owner's browser fetch from that host. PR 2 writes the test first, sees it red, and then draws only images Nomi serves.

| Key | en | zh | ar | es | fr |
|---|---|---|---|---|---|
| `legal.privacy.cookies.title` | Cookies | Cookie | ملفات تعريف الارتباط | Cookies | Cookies |
| `legal.privacy.cookies.body` | Nomi sets only the cookies it needs to work: to keep you signed in, to remember your language, to show a notice once after you save something, to recognise a device you have confirmed, and to hold a sign-in or a connection while it is in progress. None tracks you, and none comes from an advertiser or an analytics service, so there is nothing to agree to. | Nomi 只设置运行所必需的 Cookie：保持你的登录状态、记住你的语言、在你保存后显示一次提示、识别你已确认的设备，以及在登录或连接进行中时暂存信息。这些 Cookie 都不会追踪你，也不来自广告商或分析服务，因此无需你同意。 | تضع Nomi ملفات تعريف الارتباط اللازمة لعملها فقط: لإبقاء تسجيل الدخول، وتذكّر اللغة، وعرض إشعار مرة واحدة بعد الحفظ، والتعرّف على جهاز سبق تأكيده، والاحتفاظ بتسجيل دخول أو ربط أثناء إجرائه. لا يتتبّع أيٌّ منها التصفح، ولا يأتي أيٌّ منها من معلِن أو خدمة تحليلات، لذلك لا يلزم أي موافقة. | Nomi solo usa las cookies que necesita para funcionar: mantener tu sesión iniciada, recordar tu idioma, mostrar un aviso una vez después de guardar, reconocer un dispositivo que confirmaste y conservar un inicio de sesión o una conexión mientras está en curso. Ninguna te rastrea ni procede de un anunciante o de un servicio de analítica, así que no hay nada que aceptar. | Nomi n'utilise que les cookies nécessaires à son fonctionnement : garder votre session ouverte, retenir votre langue, afficher une fois un avis après un enregistrement, reconnaître un appareil que vous avez confirmé et conserver une connexion en cours. Aucun ne vous suit, aucun ne provient d'un annonceur ou d'un service d'analyse, il n'y a donc rien à accepter. |
| `legal.privacy.cookies.botCheck` | On the sign-up page only, a check against automated sign-ups ({provider}) may set its own cookie for that check. | 仅在注册页面上，防自动注册检查（{provider}）可能会为此设置它自己的 Cookie。 | في صفحة التسجيل فقط، قد يضع فحص التسجيل الآلي ({provider}) ملف تعريف ارتباط خاصًا به لهذا الفحص. | Solo en la página de registro, una comprobación contra registros automáticos ({provider}) puede usar su propia cookie para esa comprobación. | Sur la page d'inscription uniquement, une vérification contre les inscriptions automatisées ({provider}) peut déposer son propre cookie pour cette vérification. |

### 9.5 The terms and Nomi's documents

- **The terms.** One sentence: if the business turns on advisor history, Nomi, as the business's processor, keeps the advisor conversations of the people who allow it, as the privacy page describes.
- **`docs/LEGAL.md`** already lags: it still says three languages. It gets the new sections.
- **`docs/NATIVE-REVIEW-UI.md`.** Every string above, for a native read.

---

## 10. Building it: two PRs now, one batch later

**PR 1: storage and deletion, no page.** Built: branch `advisor-memory-storage`, migration 0130.
- The four tables, the consent trigger, `advisor_forget`, the ledger kind `advisor`.
- The classification in `RULES` and `customer_erasure_contract()`.
- Replay after a restore (`tools/replay-erasures.mjs`).
- `ADVISOR_KEY` sealing and its rotation (section 7).
- Back up the day before, as for any migration.

**PR 2: the page and the copy.**
- The opt-in card; the switches in Settings → Your data; the conversations list; "New conversation"; deleting one conversation.
- The owner's delete-without-reading (D2) and each person's own download (D4).
- Follow-ups carry at most the last 3 turns, as (question, resolved entry, resolved params). Never an answer or a figure (section 4).
- Subjects on every read.
- The privacy page's advisor section, the cookie section, the provider line for the one configured provider, the sub-processor additions and the terms sentence. They ship here because nothing may be stored before the privacy page describes it.
- The third-party request gate and its allow-list (D7).
- 5 languages; phone and desktop screenshots.
- `ADVISOR_KEY` must be in Railway before PR 2 deploys.

**A later batch.**
- The provider list with fallbacks.
- The owner's own API key, sealed like channel tokens (D9), with the privacy page's `own` sentence.
- The provider lines for every provider on the list.

---

## 11. The owner's decisions (2026-10-07)

- **D1. Yes.** The owner switches it on for the workspace first; only then may each person opt in.
- **D2. No: the owner can never read a staff member's history.** The owner can delete it whole, without reading it, from Settings → Your data, while that person is on the team. It goes through `advisor_forget` and writes the ledger (section 5i).
- **D3. Yes.** A new conversation begins after 4 hours of quiet, or on "New conversation".
- **D4. Yes.** Each person downloads their own history. The owner's business export must hold advisor rows whose `person_id` is the owner's own and no others; that test is written first and seen red.
- **D5. Yes.** A conversation not opened for 12 months is deleted.
- **D6. Yes, with a stop.** The card comes back 90 days after "Not now". After a second "Not now" it stops asking; Settings is then the only way.
- **D7. No banner** while every cookie is strictly necessary. The gate widens to every third-party request the browser makes, with one allow-list and a reason for each entry; anything already shipping that is off the list is fixed (section 9.4).
- **D8. Yes: a separate `ADVISOR_KEY`.** Missing or wrong, the advisor keeps working, a stored conversation shows "This conversation could not be opened", and nothing crashes. Documented beside `CREDENTIAL_KEY` in `docs/SECRET-ROTATION.md` and `.env.example`.
- **D9. The owner's own API key first,** sealed like channel tokens. No OAuth now.

Sources checked 2026-10-07:
- [OpenAI API: your data](https://developers.openai.com/api/docs/guides/your-data)
- [DeepSeek Open Platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) (effective 2026-04-29)
- [DeepSeek privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) (2026-02-10)
