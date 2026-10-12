import { sql } from 'kysely';
import type { Db } from './client.js';
import type { SystemMail } from '../channels/email/systemMail.js';
import { loggableMessage } from '../security/loggable.js';

/**
 * D12 (the data-protection audit, 2026-10-12; 0141) — EVERY ERASURE'S LEDGER
 * LINE REACHES THE OPERATOR'S MAILBOX, the copy of the ledger that outlives a
 * total loss (docs/BACKUP-RESTORE.md, "Restore"). Ids, who, when and counts
 * only — never a word of what was erased.
 */

/** The lines not yet mailed, oldest first (five minutes old at least). */
export async function unmailedLedgerLines(db: Db, limit = 200): Promise<Record<string, unknown>[]> {
  return (await sql<{ line: Record<string, unknown> }>`select erasure_ledger_unmailed(${limit}::int) as line`.execute(db))
    .rows.map((r) => r.line);
}

/** These lines reached the operator. */
export async function markLedgerMailed(db: Db, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`select erasure_ledger_mark_mailed(${[...ids]}::uuid[])`.execute(db);
}

/** The mail: one JSON line per ledger line, what tools/replay-erasures.mjs --ledger reads. */
export function ledgerLinesNotice(lines: readonly Record<string, unknown>[]): { subject: string; text: string } {
  return {
    subject: `Erasure ledger: ${lines.length} line${lines.length === 1 ? '' : 's'}`,
    text: 'Deletions carried out in Nomi that you were not yet sent: an advisor\'s history, the twelve-month expiry, '
      + 'a team member removed, an erasure run with an operator\'s tool, or a mail that did not go at the time.\n\n'
      + 'Keep this mail: if a backup is ever restored, save these lines to a file and give it to '
      + 'tools/replay-erasures.mjs --ledger (docs/BACKUP-RESTORE.md, "Restore").\n\n'
      + `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  };
}

/** The job: mail what was not mailed, and note it only once the mail went. Returns how many lines went. */
export async function mailUnmailedLedger(db: Db, mail: SystemMail | null, to: string | null): Promise<number> {
  if (!mail || !to) return 0;
  const lines = await unmailedLedgerLines(db);
  if (lines.length === 0) return 0;
  const sent = await mail.send({ to, ...ledgerLinesNotice(lines) });
  if (!sent.ok) {
    console.warn(`[erasure] ${lines.length} ledger line(s) not mailed, tried again later: ${loggableMessage(String(sent.error ?? ''))}`);
    return 0;
  }
  await markLedgerMailed(db, lines.map((l) => String(l['id'])));
  return lines.length;
}
