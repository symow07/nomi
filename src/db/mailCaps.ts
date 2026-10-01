import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * MAIL (0112) — the daily caps on mail strangers cause, asked before each
 * send. Defaults hold one installation well inside a sender's quota; the
 * operator may set others (MAIL_CAP_CODES_A_DAY, MAIL_CAP_ALERTS_A_DAY).
 */
export type MailKind = 'code' | 'alert';
export type MailClaim = 'ok' | 'address_cap' | 'installation_cap';
export type MailCaps = { readonly perAddress: number; readonly installation: number };

export const DEFAULT_MAIL_CAPS: Readonly<Record<MailKind, MailCaps>> = {
  // A person signs in a few times a day at most; ten covers a bad day.
  code: { perAddress: 10, installation: 1000 },
  // An owner's alerts: hand-offs, waiting replies (one an hour each), orders.
  alert: { perAddress: 60, installation: 3000 },
};

const positive = (v: string | undefined): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
export function mailCapsFrom(env: Record<string, string | undefined>): Readonly<Record<MailKind, MailCaps>> {
  return {
    code: { ...DEFAULT_MAIL_CAPS.code, installation: positive(env['MAIL_CAP_CODES_A_DAY']) ?? DEFAULT_MAIL_CAPS.code.installation },
    alert: { ...DEFAULT_MAIL_CAPS.alert, installation: positive(env['MAIL_CAP_ALERTS_A_DAY']) ?? DEFAULT_MAIL_CAPS.alert.installation },
  };
}

/** Counted when it may go; counted as refused when a cap holds. On the plain connection: there is no tenant. */
export async function claimMailSend(db: Db, kind: MailKind, recipient: string, caps: MailCaps): Promise<MailClaim> {
  const r = (await sql<{ v: string }>`select claim_mail_send(${kind}, ${recipient}, ${caps.perAddress}::int, ${caps.installation}::int) as v`
    .execute(db)).rows[0]?.v;
  return r === 'address_cap' || r === 'installation_cap' ? r : 'ok';
}

/** Yesterday's totals, for the operator's daily list. */
export async function mailSendsOn(db: Db, day: string): Promise<readonly { kind: MailKind; sent: number; refused: number }[]> {
  return (await sql<{ kind: string; sent: string; refused: string }>`select kind, sent::text, refused::text from mail_sends_on(${day}::date)`
    .execute(db)).rows.map((r) => ({ kind: r.kind as MailKind, sent: Number(r.sent), refused: Number(r.refused) }));
}
