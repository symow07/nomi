/**
 * Block 6.1 — help that answers: the "?" on every owner page, its guides, its question box and "Write to us".
 * English only, registered in the redesign's English fallback (redesign.ts); listed in docs/NATIVE-REVIEW-UI.md.
 *
 * The guides (`help.g.*`) are what the help question is grounded on: each is written from the product as built
 * (src/api/web/helpTopics.ts names, for each, the docs/kb article it came from, or the page). A guide's lines are
 * the FACTS the advisor's model may word an answer from, and nothing else.
 */
export const HELP_EN = {
  'help.door': 'Help for this page',
  'help.title': 'Help for this page',
  'help.lede': 'Short guides for what you see here. If they leave something out, ask below.',
  'help.video': 'Watch it done',
  'help.back': 'Back to the page',
  'help.ask.title': 'Ask about Nomi',
  'help.ask.label': 'Your question',
  'help.ask.hint': 'Answered from these guides and Nomi’s help. Nothing about your customers is read.',
  'help.ask.go': 'Ask',
  'help.ask.you': 'You asked',
  'help.ask.answer': 'Answer',
  'help.ask.fromGuide': 'From the guide “{guide}”:',
  'help.ask.notYet': 'Nomi can’t do that yet. If you need it, write to us below and say what for.',
  'help.ask.unknown': 'The guides don’t cover that. Write to us below and we’ll answer.',
  'help.ask.failed': 'That question couldn’t be answered just now. Try again, or write to us below.',
  'help.ask.unavailable': 'Questions can’t be answered here yet. Write to us below.',
  'help.ask.allowance': 'Today’s allowance is used up, so questions wait until it renews. Write to us below.',
  'help.ask.empty': 'Type a question first.',
  'help.ask.tooLong': 'That question is too long. Keep it under 1,000 characters.',
  'help.write.title': 'Still stuck? Write to us',
  'help.write.lede': 'We get your question, the page you were on and your workspace’s number — nothing about your customers. We answer within one working day.',
  'help.write.label': 'What do you need?',
  'help.write.go': 'Send to Nomi',
  'help.write.sent': 'Sent. We’ll answer within one working day.',
  'help.write.limit': 'You’ve written to us several times already. Please wait a while before writing again.',
  'help.write.cannot': 'Writing to us isn’t set up here yet.',
  'help.write.failed': 'That didn’t send. Try again in a minute.',
  'help.write.empty': 'Type what you need first.',
  'help.mail.subject': 'Help request from {business}',
  'help.mail.intro': 'Someone in a workspace wrote from the help panel. Their words, as typed:',
  'help.mail.page': 'Page: {page}',
  'help.mail.workspace': 'Workspace: {id} ({business})',
  'help.mail.person': 'Person: {id} ({role})',
  'help.mail.answer': 'Promised: an answer within one working day.',
  'help.role.owner': 'owner',
  'help.role.staff': 'team member',

  // ── The guides. Three lines at most each; a door to the page that does it. ──
  'help.g.setup.title': 'The five setup steps',
  'help.g.setup.1': 'Getting started lists five steps: your business profile, your products and prices, your assistant’s name, a channel, and a first reply.',
  'help.g.setup.2': 'Each step is ticked when it is done. Products and prices can be pasted, imported from a file or a store, or read from a photo where photo reading is on.',
  'help.g.setup.3': 'Try a first reply in Practice: you play the customer, and nothing is sent to anyone.',
  'help.g.setup.door': 'Open Getting started',

  'help.g.profile.title': 'Your business profile',
  'help.g.profile.1': 'The profile is what the assistant knows about your business: the name, what you sell, where you are, your time zone and your currency.',
  'help.g.profile.2': 'Times on every page are in your business’s time zone. The currency can change only until the first price is saved.',
  'help.g.profile.door': 'Open your profile',

  'help.g.channels.title': 'Where customers reach you',
  'help.g.channels.1': 'Channels connects the accounts your customers write to: WhatsApp, Instagram, Messenger, e-mail, Telegram and TikTok direct messages.',
  'help.g.channels.2': 'Connecting any one of them completes that setup step. Each account shows its state: connected, needs attention, or disconnected.',
  'help.g.channels.3': 'On Instagram and Messenger, replies go through Nomi for 24 hours after the customer’s last message; the customer always writes first.',
  'help.g.channels.door': 'Open Channels',

  'help.g.whatsapp.title': 'Connecting WhatsApp',
  'help.g.whatsapp.1': 'Use a number that is not on the WhatsApp app: a new SIM or a landline works. A number already on the app must have its WhatsApp account removed from the phone first.',
  'help.g.whatsapp.2': 'Connecting opens Meta’s own window, which asks for your business, the number and the name customers see, and sends the number a code.',
  'help.g.whatsapp.3': 'After 24 hours without a message from the customer, WhatsApp accepts only a message Meta approved; the WhatsApp card can ask Meta to approve one.',
  'help.g.whatsapp.door': 'Open WhatsApp',

  'help.g.approve.title': 'Replies that wait for you',
  'help.g.approve.1': 'A reply that waits shows the customer’s words, the reply the assistant wrote, and the source of each price in that reply.',
  'help.g.approve.2': 'Send sends it as written; change the words in the box and they go as yours; No reply needed sends nothing; Hand to me takes the conversation over.',
  'help.g.approve.3': 'Every kind of reply you have not let go alone waits for you.',
  'help.g.approve.door': 'Open the Inbox',

  'help.g.inbox.title': 'The Inbox',
  'help.g.inbox.1': 'Needs you lists the customers waiting for you first, each with the reason.',
  'help.g.inbox.2': 'A name stays bold until someone opens the conversation.',
  'help.g.inbox.3': 'Search finds a customer by name, number, e-mail, handle or the product they asked about.',
  'help.g.inbox.door': 'Open the Inbox',

  'help.g.products.title': 'Adding your products',
  'help.g.products.1': 'Paste a price list, a table or text from a chat; import a file or your online store; or send a photo of a printed price list where photo reading is on.',
  'help.g.products.2': 'Every line read is shown beside what you gave, waiting for your tick. A line that can’t be read for sure says why, for example a price that reads two ways or another currency.',
  'help.g.products.3': 'Only lines you confirm become products. Replies give only your prices, and never below the lowest price you set.',
  'help.g.products.door': 'Add products',

  'help.g.away.title': 'While you are away',
  'help.g.away.1': 'While you are away, only the kinds of reply you have let go alone are sent; the rest are written and wait for you.',
  'help.g.away.2': 'Confirming an order always waits for your tap.',
  'help.g.away.3': 'Today shows who needs you now and what happened in the last 24 hours.',
  'help.g.away.door': 'Open Today',

  'help.g.alone.title': 'How much the assistant does alone',
  'help.g.alone.1': 'You choose how much is sent without you on the assistant’s page; until then every reply waits for you.',
  'help.g.alone.2': 'In a new workspace, sending alone is earned: the page shows how many replies you sent as written, and offers only the levels that allows.',
  'help.g.alone.3': 'You can step down at any time, and replies wait for you again at once.',
  'help.g.alone.door': 'Open sending alone',

  'help.g.name.title': 'Your assistant’s name',
  'help.g.name.1': 'Customers see your account and the name you give the assistant.',
  'help.g.name.2': 'The name counts once you confirm it, and nothing is sent alone before it is confirmed.',
  'help.g.name.door': 'Open the name',

  'help.g.disclosure.title': 'What customers are told',
  'help.g.disclosure.1': 'A reply you approved is your own words. The first message sent without you in a conversation tells the customer they are talking to an assistant, not a person.',
  'help.g.disclosure.2': 'If a customer asks what they are talking to, they get an honest answer.',
  'help.g.disclosure.3': 'When a customer asks for a person, the conversation is handed to you; when unsure, the assistant stops and waits for you.',
  'help.g.disclosure.door': 'Open the name',

  'help.g.data.title': 'Your data',
  'help.g.data.1': 'The owner can download every kind of record as a spreadsheet file from Your data: customers, messages, products, orders, prices given and more, up to 20,000 rows each.',
  'help.g.data.2': 'A customer’s data is deleted from their page or from Your data, at once and for good; orders stay without their contact details. Nomi does not tell the customer.',
  'help.g.data.3': 'Closing the workspace, at the foot of Your data, erases everything in it and signs everyone out. It can’t be undone.',
  'help.g.data.door': 'Open Your data',

  'help.g.practice.title': 'Practice',
  'help.g.practice.1': 'In Practice you write as a customer and the assistant answers by the same rules as with real customers. Nothing reaches anyone.',
  'help.g.practice.2': 'You can send a photo or a voice note too. Practice has 50 messages a day.',
  'help.g.practice.3': 'Start over clears practice conversations; ones left quiet for 30 days are cleared on their own.',
  'help.g.practice.door': 'Open Practice',

  'help.g.knowledge.title': 'Teaching your assistant',
  'help.g.knowledge.1': 'Knowledge holds the facts the assistant may use: the ones you teach, and the ones from your site that you ticked.',
  'help.g.knowledge.2': 'Procedures are your numbered steps for one situation; a step with a price or a promise is refused when saved.',
  'help.g.knowledge.3': 'Where you have saved cases, a change is checked against them first, and you keep it or revert it.',
  'help.g.knowledge.door': 'Open Knowledge',

  'help.g.customers.title': 'Your customers',
  'help.g.customers.1': 'Every customer who wrote is here, with their conversations, orders and what they asked about.',
  'help.g.customers.2': 'A customer’s page is also where their data is deleted if they ask.',
  'help.g.customers.door': 'Open Customers',

  'help.g.calendar.title': 'The calendar',
  'help.g.calendar.1': 'The calendar shows the dates already on record — follow-ups, deliveries and prices that end, read from the replies that were sent — and your own dates.',
  'help.g.calendar.2': 'A dashed edge is a date you added; a solid one came from a conversation and opens it.',
  'help.g.calendar.door': 'Open the calendar',

  'help.g.books.title': 'Your books',
  'help.g.books.1': 'Books keeps invoices, spending and bank and cash accounts. Every figure on its home page is the sum of the entries behind it.',
  'help.g.books.2': 'Reports show what you made, money in and out, tax you owe, top customers and unpaid invoices, each as a page and a spreadsheet.',
  'help.g.books.door': 'Open Books',

  'help.g.team.title': 'Your team',
  'help.g.team.1': 'Team members answer customers and teach the assistant. Prices and going live stay the owner’s.',
  'help.g.team.2': 'An accountant sees only the books.',
  'help.g.team.door': 'Open your team',

  'help.g.billing.title': 'Billing',
  'help.g.billing.1': 'Billing shows your plan and opens the page where the card and invoices are kept.',
  'help.g.billing.2': 'Where payments are not set up, the page says so, and nobody is charged.',
  'help.g.billing.door': 'Open Billing',
} as const;
