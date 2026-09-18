/**
 * A1 — what a factory types to become a tenant, and whether it may.
 *
 * Pure: no database, no clock, no hashing. The route hashes and provisions;
 * this decides only whether the four things she typed are usable, and says
 * WHICH one is not, so the page can put the sentence beside the field.
 */

export type SignupMode = 'open' | 'invite' | 'closed';

/**
 * Who may create a tenant on this installation.
 *
 *   open    anyone who reaches the page
 *   invite  only someone holding a ticket the operator made (the default)
 *   closed  nobody; the page says so
 *
 * Unset or unrecognised is `invite`: an installation that has not decided is
 * one that has not agreed to pay for strangers' practice runs.
 */
export function signupModeFrom(raw: string | undefined): SignupMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'open' || v === 'closed' ? v : 'invite';
}

export type SignupInput = {
  readonly factory: string; readonly name: string; readonly email: string;
  readonly password: string; readonly invite: string;
};

export type SignupField = 'factory' | 'name' | 'email' | 'password' | 'invite';
export type SignupProblem =
  | 'factory_missing' | 'name_missing' | 'email_invalid'
  | 'password_short' | 'password_long' | 'password_is_email' | 'invite_missing';

export type ValidSignup = {
  readonly factory: string; readonly name: string; readonly email: string;
  readonly password: string; readonly invite: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately loose: the only proof an address works is a mail that arrives.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export function validateSignup(
  input: SignupInput, opts: { readonly mode: SignupMode; readonly passwordMin: number; readonly passwordMax: number },
): { ok: true; value: ValidSignup } | { ok: false; problems: Partial<Record<SignupField, SignupProblem>> } {
  const factory = input.factory.trim().slice(0, 120);
  const name = input.name.trim().slice(0, 80);
  const email = normalizeEmail(input.email);
  const invite = input.invite.trim();
  const problems: Partial<Record<SignupField, SignupProblem>> = {};

  if (!factory) problems.factory = 'factory_missing';
  if (!name) problems.name = 'name_missing';
  if (email.length > 254 || !EMAIL.test(email)) problems.email = 'email_invalid';
  if (input.password.length < opts.passwordMin) problems.password = 'password_short';
  else if (input.password.length > opts.passwordMax) problems.password = 'password_long';
  else if (email && input.password.trim().toLowerCase() === email) problems.password = 'password_is_email';
  if (opts.mode === 'invite' && !UUID.test(invite)) problems.invite = 'invite_missing';

  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, value: { factory, name, email, password: input.password, invite: UUID.test(invite) ? invite.toLowerCase() : null } };
}
