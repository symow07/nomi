#!/usr/bin/env node
/**
 * Block 4.3 — "What Nomi did for you": one workspace's month, as its owner's monthly e-mail says it.
 *
 *   npm run build
 *   railway run --service nomi -- node tools/month-report.mjs --business <uuid> --month YYYY-MM          # preview
 *   railway run --service nomi -- node tools/month-report.mjs --business <uuid> --month YYYY-MM --html   # its HTML
 *   railway run --service nomi -- node tools/month-report.mjs --business <uuid> --month YYYY-MM --send --yes
 *
 * The preview prints the subject, the address it would go to and the e-mail, built exactly as the monthly job builds
 * it (src/pipeline/monthMail.ts), and SENDS NOTHING. `--send --yes` sends that ONE e-mail to the owner's sign-in
 * address — the owner's live step, never an assistant's — through the installation's dedicated sender (MAIL_*), else
 * its SMTP sender (SYSTEM_SMTP_*), under MAIL's daily `alert` cap, as the job does. It claims nothing: the month's own
 * e-mail still goes on the 1st. An empty month sends nothing, here as there.
 *
 * Reads MIGRATE_DATABASE_URL (every row, as the job's own functions read them) and PUBLIC_BASE_URL (the one address
 * in the e-mail). Never prints a customer: the e-mail names none.
 */
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const has = (name) => process.argv.includes(name);
const fail = (why) => { console.error(`✗  ${why} Nothing was sent.`); process.exit(2); };

const url = process.env['MIGRATE_DATABASE_URL'];
const base = process.env['PUBLIC_BASE_URL'];
const business = arg('--business');
const month = arg('--month');
if (!url) fail('MIGRATE_DATABASE_URL must be set.');
if (!base) fail('PUBLIC_BASE_URL must be set: it is the one address in the e-mail.');
if (!business || !/^[0-9a-f-]{36}$/i.test(business) || !month) fail('Usage: --business <uuid> --month YYYY-MM [--html] [--send --yes]');

const { createDb } = await import('../dist/db/client.js');
const { parseBusinessId } = await import('../dist/core/types/ids.js');
const { isMonth } = await import('../dist/core/report/month.js');
const { isEmptyMonth } = await import('../dist/core/report/monthMail.js');
const { monthMailFor } = await import('../dist/pipeline/monthMail.js');
if (!isMonth(month)) fail(`Not a month: ${month} (YYYY-MM).`);
const bid = parseBusinessId(business);
if (!bid.ok) fail(`Not a workspace id: ${business}.`);

const db = createDb(url);
try {
  const { report, mail, to } = await monthMailFor(db, bid.value, month, new Date(), base);
  const empty = isEmptyMonth(report);
  console.log(`Subject: ${mail.subject}`);
  console.log(`To: ${to ?? '— the owner has no sign-in address'}`);
  if (report.running) console.log('(This month is still running: the figures are so far.)');
  if (report.mailOff) console.log('(The owner stopped the monthly e-mail: the job would send nothing.)');
  if (empty) console.log('(No activity this month: the job sends nothing for it.)');
  console.log('');
  console.log(has('--html') ? mail.html : mail.text);
  if (!has('--send')) process.exit(0);
  if (!has('--yes')) { console.log('\nDry run: add --yes to send this one e-mail to the owner.'); process.exit(0); }
  if (empty) fail('An empty month sends no e-mail.');
  if (!to) fail('The owner has no sign-in address.');
  const { httpsMailConfigFrom, httpsSystemMailer, cappedMail } = await import('../dist/channels/email/httpsMail.js');
  const { systemSmtpConfigFrom, systemMailer } = await import('../dist/channels/email/systemMail.js');
  const { claimMailSend, mailCapsFrom } = await import('../dist/db/mailCaps.js');
  const dedicated = httpsMailConfigFrom(process.env);
  const smtp = systemSmtpConfigFrom(process.env);
  const sender = dedicated ? httpsSystemMailer(dedicated) : smtp ? systemMailer(smtp) : null;
  if (!sender) fail('This installation has no sender set (MAIL_* or SYSTEM_SMTP_*).');
  const caps = mailCapsFrom(process.env);
  const sent = await cappedMail(sender, (address) => claimMailSend(db, 'alert', address, caps.alert))
    .send({ to, subject: mail.subject, text: mail.text });
  if (!sent.ok) { console.error(`✗  Not sent: ${sent.error}`); process.exit(1); }
  console.log(`\n✓ Sent to the owner's sign-in address.`);
} finally {
  await db.destroy();
}
