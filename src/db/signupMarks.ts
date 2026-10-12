import { sql } from 'kysely';
import { createHmac, randomBytes } from 'node:crypto';
import type { Db } from './client.js';
import {
  canonicalEmail, fingerprintSource, isThrowawayEmail, networkOf, scoreSignup,
  type SignupScore, type SignupSignals,
} from '../core/owner/signupRisk.js';

/**
 * Phase 1 (0148) — the sign-up's marks, as one-way codes. Each is the app's keyed SHA-256 (the key derived from
 * the session secret, so a copy of the table alone cannot be tried against guesses): the browser's sign-up
 * cookie, the browser fingerprint together with its network, the network, and the e-mail as a mailbox. The
 * address, the e-mail and the headers themselves are never stored.
 */
export type SignupDigests = {
  readonly device: string | null; readonly fingerprint: string | null;
  readonly network: string | null; readonly email: string;
};

export type SignupCheck = { readonly digests: SignupDigests; readonly score: SignupScore };

/** The sign-up cookie's value: a random id this browser keeps (`yf_signup`). */
export const newSignupDeviceId = (): string => randomBytes(18).toString('base64url');
const DEVICE_ID = /^[A-Za-z0-9_-]{24}$/;

export function signupDigests(secret: string, input: {
  readonly deviceId: string | undefined; readonly ip: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>; readonly email: string;
}): SignupDigests {
  const key = createHmac('sha256', secret).update('signup-marks').digest();
  const code = (kind: string, value: string): string => createHmac('sha256', key).update(`${kind}\n${value}`).digest('hex');
  const network = networkOf(input.ip);
  return {
    device: input.deviceId && DEVICE_ID.test(input.deviceId) ? code('device', input.deviceId) : null,
    fingerprint: network ? code('fingerprint', `${network}\n${fingerprintSource(input.headers)}`) : null,
    network: network ? code('network', network) : null,
    email: code('email', canonicalEmail(input.email)),
  };
}

/** What the database counts for these marks, and the score it makes. */
export async function checkSignup(db: Db, digests: SignupDigests, email: string): Promise<SignupCheck> {
  const r = (await sql<{ earlier_device: number; earlier_email: number; earlier_fingerprint: number; earlier_network: number;
    attempts_network: number; attempts_device: number }>`
    select * from signup_marks_seen(${digests.device}, ${digests.fingerprint}, ${digests.network}, ${digests.email})`.execute(db)).rows[0];
  const signals: SignupSignals = {
    earlierFromDevice: r?.earlier_device ?? 0, earlierWithEmail: r?.earlier_email ?? 0,
    earlierFromFingerprintAndNetwork: r?.earlier_fingerprint ?? 0, earlierFromNetwork: r?.earlier_network ?? 0,
    throwawayEmail: isThrowawayEmail(email),
    attemptsFromNetwork: r?.attempts_network ?? 0, attemptsFromDevice: r?.attempts_device ?? 0,
  };
  return { digests, score: scoreSignup(signals) };
}

/** The form was sent and scored: its network and browser count towards the day's attempts. */
export async function markSignupAttempt(db: Db, d: SignupDigests): Promise<void> {
  await sql`select signup_mark_attempt(${d.device}, ${d.network})`.execute(db);
}

/**
 * A workspace was made: its marks, and the tier its subscription follows (0148: medium needs a card and has no
 * free trial). A sign-up the operator vouched for (an invitation) is recorded as low, whatever it scored.
 */
export async function markSignupWorkspace(db: Db, businessId: string, check: SignupCheck, vouched: boolean): Promise<boolean> {
  const { digests: d, score } = check;
  const tier = vouched || score.tier === 'low' ? 'low' : 'medium';
  const r = (await sql<{ ok: boolean }>`
    select signup_mark_workspace(${businessId}::uuid, ${d.device}, ${d.fingerprint}, ${d.network}, ${d.email},
                                 ${tier}, ${score.points}::int, ${[...score.reasons]}::text[]) as ok`.execute(db)).rows[0];
  return r?.ok === true;
}
