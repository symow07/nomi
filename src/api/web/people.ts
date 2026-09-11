import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Person, type PersonError, validatePerson, OWNER_ONLY } from '../../core/conversation/people.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { esc } from './layout.js';

/**
 * M47 — the people who can log in, and the codes that let them.
 *
 * A CODE IS SHOWN ONCE. `people.code_hash` is an HMAC keyed by the
 * installation's credential key, so a code this table could give back is a code
 * this table could leak. She sees it at creation, hands it over, and if it is
 * lost she issues a new one — which is a smaller problem than a database that
 * remembers everyone's password.
 *
 * The OWNER's own way in is unchanged and still comes from the environment. Her
 * row here is her NAME, so `assigned_to` can say who holds a conversation; it
 * is not her credential, and losing this table must not lock her out of her own
 * business.
 */

/** Codes she reads aloud over a factory floor: no O/0, no I/l/1. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newAccessCode(bytes: Buffer = randomBytes(10)): string {
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
}

export const hashCode = (secret: string, code: string): string =>
  createHmac('sha256', secret).update(`person:${code.trim().toUpperCase()}`).digest('base64url');

/** Constant-time, like the owner's own comparison. */
const sameHash = (a: string, b: string): boolean => {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * G9a — a code she has just issued, on its way to the one page that shows it.
 *
 * It used to travel in the redirect's query string, and a URL is the one
 * place a secret is certain to be written down: the production request log,
 * the browser history, any proxy in between. Now it rides a short-lived,
 * HttpOnly cookie scoped to the people page, read once and cleared.
 *
 * SIGNED WITH ITS OWN PURPOSE, NOT THE SESSION CODEC. The session codec signs
 * any payload and reads a session without a person as the OWNER — so a code
 * token minted by it would verify as an owner's session, and a session would
 * verify here. The `staffcode:` prefix (as `unsubscribe:` in
 * outbound/unsubscribe.ts) makes each token useless as the other.
 */
export const ISSUED_COOKIE = 'yf_issued';
export const ISSUED_PATH = '/app/settings/people';
/** Long enough to land on the page; short enough that a forgotten tab forgets it. */
export const ISSUED_TTL_MS = 5 * 60 * 1000;

const issuedMac = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(`staffcode:${payload}`).digest('base64url');

export function mintIssuedCode(secret: string, issued: { name: string; code: string }, now: number): string {
  const payload = Buffer.from(JSON.stringify([issued.name, issued.code, now + ISSUED_TTL_MS]), 'utf8')
    .toString('base64url');
  return `${payload}.${issuedMac(secret, payload)}`;
}

/** Null for anything but a fresh token this installation minted for this purpose. */
export function readIssuedCode(
  secret: string, token: string | undefined, now: number,
): { name: string; code: string } | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!sameHash(token.slice(dot + 1), issuedMac(secret, payload))) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [name, code, exp] = parsed as unknown[];
    if (typeof name !== 'string' || typeof code !== 'string' || typeof exp !== 'number' || exp < now) return null;
    return { name, code };
  } catch { return null; }
}

export type PeopleView = {
  readonly people: readonly (Person & { readonly addedAt: Date })[];
  /** Shown ONCE, immediately after creating someone. Never stored. */
  readonly justIssued: { readonly name: string; readonly code: string } | null;
};

export async function loadPeople(db: Db, businessIdRaw: string): Promise<readonly (Person & { addedAt: Date })[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string; name: string; is_owner: boolean; created_at: Date }>`
      select id::text as id, name, is_owner, created_at from people
       where business_id = ${bid.value}::uuid and archived_at is null
       order by is_owner desc, created_at`.execute(tx);
    return r.rows.map((x) => ({ id: x.id, name: x.name, isOwner: x.is_owner, addedAt: x.created_at }));
  });
}

/**
 * Who is this code? The owner's code is NOT checked here — that comparison
 * lives where it always did, against the environment, so a staff table can
 * never become a way to impersonate her.
 */
export async function personForCode(
  db: Db, businessIdRaw: string, secret: string, code: string,
): Promise<Person | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !code.trim()) return null;
  const want = hashCode(secret, code);
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string; name: string; is_owner: boolean; code_hash: string }>`
      select id::text as id, name, is_owner, code_hash from people
       where business_id = ${bid.value}::uuid and archived_at is null and code_hash is not null`
      .execute(tx);
    const row = r.rows.find((x) => sameHash(x.code_hash, want));
    return row ? { id: row.id, name: row.name, isOwner: row.is_owner } : null;
  });
}

/**
 * The owner's own person row — her name, for `assigned_to`.
 *
 * CREATED IF MISSING, on her first login. 0035 backfills a row for every
 * business that existed when it ran; a business created AFTERWARDS — a new
 * tenant, a freshly seeded demo — has none, and would have shown a generic
 * word where her name belongs. Idempotent against the one-owner index, and it
 * is only her NAME: her way in is still the environment's code, so this write
 * failing cannot keep her out (the caller catches).
 */
export async function ownerPerson(db: Db, businessIdRaw: string): Promise<Person | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const read = async () => (await sql<{ id: string; name: string }>`
      select id::text as id, name from people
       where business_id = ${bid.value}::uuid and is_owner and archived_at is null limit 1`
      .execute(tx)).rows[0];

    const existing = await read();
    if (existing) return { id: existing.id, name: existing.name, isOwner: true };

    await sql`
      insert into people (business_id, name, is_owner)
      select ${bid.value}::uuid, coalesce(nullif(btrim(b.name), ''), 'Owner'), true
        from businesses b where b.id = ${bid.value}::uuid
      on conflict do nothing`.execute(tx);
    const made = await read();
    return made ? { id: made.id, name: made.name, isOwner: true } : null;
  });
}

export async function addPerson(
  db: Db, businessIdRaw: string, secret: string, name: string | null,
): Promise<{ code: 'added'; name: string; accessCode: string } | { code: PersonError | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const v = validatePerson(name);
  if (!v.ok) return { code: v.error };
  const accessCode = newAccessCode();
  return withTenantTx(db, bid.value, async (tx) => {
    await sql`insert into people (business_id, name, code_hash)
              values (${bid.value}::uuid, ${v.value}, ${hashCode(secret, accessCode)})`.execute(tx);
    return { code: 'added' as const, name: v.value, accessCode };
  });
}

/**
 * Archive, never erase — and never the owner.
 *
 * A conversation she held last March still names her, and the page reads that
 * as "someone who has left" rather than as nobody. Removing the owner is not
 * offered: it would leave a business with no one who can grant a capability.
 */
export async function removePerson(
  db: Db, businessIdRaw: string, id: string,
): Promise<{ code: 'removed' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update people set archived_at = now()
       where id = ${id}::uuid and business_id = ${bid.value}::uuid
         and archived_at is null and not is_owner
      returning id`.execute(tx);
    return { code: r.rows[0] ? 'removed' as const : 'failed' as const };
  });
}

export function renderPeople(v: PeopleView, locale: Locale, flash: string | null): string {
  const issued = v.justIssued
    ? `<div class="card issued">
        <h3 class="rf-h">${esc(t(locale, 'people.issued.title', { name: v.justIssued.name }))}</h3>
        <p class="code"><bdi>${esc(v.justIssued.code)}</bdi></p>
        <p class="muted">${esc(t(locale, 'people.issued.once'))}</p>
      </div>`
    : '';

  return `<h1 class="page">${esc(t(locale, 'people.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${issued}
    <section class="block">
      <p class="muted">${esc(t(locale, 'people.intro'))}</p>
      <ul class="people">${v.people.map((p) => `<li>
        <span><bdi>${esc(p.name)}</bdi>${p.isOwner ? ` <span class="pill ok">${esc(t(locale, 'people.owner'))}</span>` : ''}
          <span class="muted">${esc(formatDate(locale, p.addedAt))}</span></span>
        ${p.isOwner ? '' : `<form method="post" action="/app/settings/people/${esc(p.id)}/remove" class="inline">
          <button class="btn" type="submit">${esc(t(locale, 'people.remove'))}</button></form>`}
      </li>`).join('')}</ul>
      <form method="post" action="/app/settings/people" class="pform">
        <label class="fld"><span class="muted">${esc(t(locale, 'people.add.label'))}</span>
          <input name="name" required maxlength="60"
            placeholder="${esc(t(locale, 'people.add.placeholder'))}" /></label>
        <button class="btn send" type="submit">${esc(t(locale, 'people.add.button'))}</button>
      </form>
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'people.ownerOnly.title'))}</h2>
      <p class="muted">${esc(t(locale, 'people.ownerOnly.intro'))}</p>
      <ul class="ownerOnly">${OWNER_ONLY.map((a) =>
        `<li>${esc(t(locale, `people.ownerOnly.${a}` as MessageKey))}</li>`).join('')}</ul>
      <p class="muted">${esc(t(locale, 'people.ownerOnly.rest'))}</p>
    </section>
    <style>
      .people, .ownerOnly { list-style:none; margin:var(--space-12) 0; padding:0; }
      .people li { display:flex; align-items:center; justify-content:space-between;
                   gap:var(--space-12); padding:var(--space-8) 0;
                   border-bottom:1px solid var(--color-border); }
      .people li:last-child { border-bottom:0; }
      .ownerOnly li { padding:var(--space-4) 0; color:var(--color-ink-secondary);
                      font-size:var(--font-size-note); }
      .issued .code { font-size:var(--font-size-numeral); font-weight:600;
                      letter-spacing:.08em; margin:var(--space-8) 0; }
    </style>`;
}
