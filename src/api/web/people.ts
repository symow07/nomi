import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { planLimits } from '../../db/billing.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Person, type PersonError, validatePerson, OWNER_ONLY } from '../../core/conversation/people.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn, booksShown } from './say.js';

import { esc } from './layout.js';
import { fieldRow, cardActs } from './rows.js';
import { pageHead, setSection, setNotice, saveForm, saveActs, rowSwitch, dangerZone } from './settingsPage.js';
import { flashBanner, type Flash } from './flash.js';
import type { Assistant } from '../../core/owner/assistants.js';
import * as show from './values.js';
import type { RotationView } from '../../db/rotation.js';

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
export const ISSUED_PATH = '/app/settings/team';
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

/** A4 — how someone gets in, and when they were last here. */
export type TeamMember = Person & {
  readonly addedAt: Date;
  /** She signs in with her own e-mail and password; otherwise with a code the owner handed her. */
  readonly signsInWithEmail: boolean;
  /** Null: not seen since the page began to look (migration 0057). */
  readonly lastSeenAt: Date | null;
};

/** Seen in the last five minutes. The check writes at most once a minute, so this is never stale by more than that. */
export const ONLINE_WITHIN_MS = 5 * 60 * 1000;
export const isOnline = (m: { readonly lastSeenAt: Date | null }, now: Date): boolean =>
  m.lastSeenAt !== null && now.getTime() - m.lastSeenAt.getTime() < ONLINE_WITHIN_MS;

export type PeopleView = {
  readonly people: readonly TeamMember[];
  /** Shown ONCE, immediately after creating someone. Never stored. */
  readonly justIssued: { readonly name: string; readonly code: string } | null;
  /** A5 — who answers buyers. Absent on a caller that shows only people. */
  readonly assistants?: readonly Assistant[];
  /** The business's own name — a person called by it is asked for a real one. */
  readonly business?: string | null;
  /** S3 (0198) — hand-offs in turn: the switch, and each person's place in it. */
  readonly rotation?: RotationView;
};

/**
 * THE DESIGN PASS (UI-PASS 5) — a person called by the business's name. A
 * workspace made before logins had its owner named after the business (0035),
 * so "Hand to" offered "Westlake Canvas Co." as a person. Compared as words:
 * case, width and spacing aside.
 */
const asWords = (s: string): string => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export const namedLikeBusiness = (person: string, business: string | null | undefined): boolean =>
  !!business && asWords(business) !== '' && asWords(person) === asWords(business);

/** A person's name changed — the owner's act; archived people keep theirs. */
export async function renamePerson(
  db: Db, businessIdRaw: string, id: string, name: string | null,
): Promise<{ code: 'renamed'; name: string } | { code: PersonError | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const v = validatePerson(name);
  if (!v.ok) return { code: v.error };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update people set name = ${v.value}
       where id = ${id}::uuid and business_id = ${bid.value}::uuid and archived_at is null
      returning id`.execute(tx);
    return r.rows[0] ? { code: 'renamed' as const, name: v.value } : { code: 'failed' as const };
  });
}

export async function loadPeople(db: Db, businessIdRaw: string): Promise<readonly TeamMember[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string; name: string; is_owner: boolean; kind: 'team' | 'accountant'; created_at: Date; last_seen_at: Date | null; has_login: boolean }>`
      select p.id::text as id, p.name, p.is_owner, p.kind, p.created_at, p.last_seen_at,
             exists (select 1 from logins l where l.person_id = p.id and l.archived_at is null) as has_login
        from people p
       where p.business_id = ${bid.value}::uuid and p.archived_at is null
       order by p.is_owner desc, p.created_at`.execute(tx);
    return r.rows.map((x) => ({
      id: x.id, name: x.name, isOwner: x.is_owner, kind: x.kind, addedAt: x.created_at,
      signsInWithEmail: x.has_login, lastSeenAt: x.last_seen_at,
    }));
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
  db: Db, businessIdRaw: string, secret: string, name: string | null, kind: 'team' | 'accountant' = 'team',
): Promise<{ code: 'added'; name: string; accessCode: string } | { code: PersonError | 'failed' | 'seat_limit' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const v = validatePerson(name);
  if (!v.ok) return { code: v.error };
  const accessCode = newAccessCode();
  return withTenantTx(db, bid.value, async (tx) => {
    // BILL (0117) — the plan's seats, the owner among them; no plan, no limit.
    const { seats } = await planLimits(tx);
    if (seats !== null) {
      const n = Number((await sql<{ n: number }>`select count(*)::int as n from people where business_id = ${bid.value}::uuid and archived_at is null`.execute(tx)).rows[0]?.n ?? 0);
      if (n >= seats) return { code: 'seat_limit' as const };
    }
    // A5 (0175) — an accountant is made as one, and stays one.
    await sql`insert into people (business_id, name, code_hash, kind)
              values (${bid.value}::uuid, ${v.value}, ${hashCode(secret, accessCode)}, ${kind})`.execute(tx);
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

/** Where Team is drawn, and where its one Save is sent (rule 104). */
export const TEAM_PAGE = '/app/settings/team';
/** The day a person is away until, as the page's date field shows it (and as the Save compares what it was sent). */
export const awayDay = (awayUntil: Date | null, now: Date): string =>
  awayUntil !== null && awayUntil.getTime() > now.getTime() ? awayUntil.toISOString().slice(0, 10) : '';

/**
 * THE SETTINGS OVERHAUL (rule 104) — Team in the one template.
 *
 *   · Add someone: the list's own Add, first on the page; the code is shown once and nothing here sends it.
 *   · People: ONE table. "In turn" is a switch in the row and acts at once (the one saving rule); "Away until" is a
 *     date, a FIELD, so every person's date waits for the page's one Save (the fields belong to the Save form by
 *     their `form` attribute: a table row cannot sit inside a form that holds other forms).
 *   · Hand-offs in turn: the workspace's switch, at once.
 *   · Roles: ONE table of what each role can do, the nine owner-only abilities among them.
 *   · Danger zone, last: removing a person, each row saying what it does, asking first.
 */
export function renderPeople(v: PeopleView, locale: Locale, flash: Flash | null, now: Date = new Date()): string {
  // A4 — who is here. Said in words, never by colour alone.
  const online = v.people.filter((p) => isOnline(p, now)).length;
  // Phase 9 (V1-517) — the one state here is a pill with its hairline; bare, it read as a stray bold word.
  const presence = (p: TeamMember): string => isOnline(p, now)
    ? `<span class="pill stop">${esc(t(locale, 'people.online'))}</span>`
    : `<span class="muted">${esc(p.lastSeenAt
        ? t(locale, 'people.lastSeen', { when: show.when(locale, p.lastSeenAt, now) })
        : t(locale, 'people.notSeen'))}</span>`;
  const issued = v.justIssued
    ? `<div class="card issued">
        <h3 class="rf-h">${esc(t(locale, 'people.issued.title', { name: v.justIssued.name }))}</h3>
        <p class="code"><bdi>${esc(v.justIssued.code)}</bdi></p>
        <p class="muted">${esc(t(locale, 'people.issued.once'))}</p>
      </div>`
    : '';
  const roleOf = (p: TeamMember): string => t(locale, p.isOwner ? 'team.role.owner' : p.kind === 'accountant' ? 'people.kind.accountant' : 'team.role.team');
  const turnOf = (p: TeamMember) => v.rotation?.people.find((r) => r.id === p.id) ?? null;
  const SAVE_FORM = 'team-save';

  const head = (k: MessageKey): string => `<th scope="col">${esc(t(locale, k))}</th>`;
  const cell = (k: MessageKey, body: string): string => `<td><span class="tm-k" aria-hidden="true">${esc(t(locale, k))}</span>${body}</td>`;
  // S3 — hand-offs in turn, per person (never the accountant): in turn or not, at once; away until a day, with Save.
  const turnCells = (p: TeamMember): string => {
    if (!v.rotation) return '';
    const r = turnOf(p);
    if (!r || r.accountant) return `${cell('turn.inTurn', `<span class="muted">${esc(t(locale, 'ws.team.never'))}</span>`)}${cell('turn.away', '')}`;
    const id = esc(p.id);
    return `${cell('turn.inTurn', `${rowSwitch(locale, { action: `/app/settings/people/${p.id}/in-turn`, on: r.inRotation, label: `${t(locale, 'turn.inTurn')}: ${p.name}` })}${
        r.lastGivenAt ? `<span class="caption muted">${esc(t(locale, 'turn.lastGiven', { when: show.when(locale, r.lastGivenAt, now) }))}</span>` : ''}`)}${
      cell('turn.away', `<input id="tt-away-${id}" type="date" form="${SAVE_FORM}" name="away_${id}" value="${esc(awayDay(r.awayUntil, now))}" aria-label="${esc(`${t(locale, 'turn.away')}: ${p.name}`)}" />`)}`;
  };
  const table = `<table class="team-table">
      <caption class="sa-vh">${esc(t(locale, 'ws.team.people'))}</caption>
      <thead><tr>${head('team.col.name')}${head('team.col.role')}${head('team.col.signIn')}${head('team.col.here')}${v.rotation ? `${head('turn.inTurn')}${head('turn.away')}` : ''}</tr></thead>
      <tbody>${v.people.map((p) => `<tr class="tm">
        <th scope="row"><span class="person"><span><bdi>${esc(p.name)}</bdi>${p.isOwner ? ` <span class="muted">· ${esc(t(locale, 'people.owner'))}</span>` : ''}</span>
          <span class="caption muted">${esc(t(locale, 'people.added', { date: show.date(locale, p.addedAt) }))}</span></span></th>
        ${cell('team.col.role', esc(roleOf(p)))}
        ${cell('team.col.signIn', esc(t(locale, p.signsInWithEmail ? 'people.via.email' : 'people.via.code')))}
        ${/* The warmth run (-01) — where they are is a line of its own, never led by a dot. */ ''}${cell('team.col.here', `<span class="caption">${presence(p)}</span>`)}
        ${turnCells(p)}
      </tr>`).join('')}</tbody></table>`;
  const people = setSection({ id: 'people', title: t(locale, 'ws.team.people'), rows: [table, setNotice({ text: t(locale, 'ws.team.roleStays') })] });

  // F36 — the role is a choice with its label beside its control, only where the books are on (A6).
  const roleChoice = booksShown() ? `<fieldset class="tm-roles"><legend>${esc(t(locale, 'team.col.role'))}</legend>
      <label class="tm-choice" for="pp-add-team"><input id="pp-add-team" type="radio" name="accountant" value="off" checked /> <span>${esc(t(locale, 'team.add.asTeam'))}</span></label>
      <label class="tm-choice" for="pp-add-accountant"><input id="pp-add-accountant" type="radio" name="accountant" value="on" /> <span>${esc(t(locale, 'people.add.accountant'))}</span></label>
    </fieldset>` : '';
  // Adding someone is the list's own Add: its form and its button, apart from the page's Save.
  const add = setSection({ id: 'add', title: t(locale, 'people.add.title'), rows: [
    setNotice({ text: t(locale, 'people.add.hint') }),
    `<form method="post" action="/app/settings/people" class="sform">${
      fieldRow({ label: t(locale, 'people.add.label'), forId: 'pp-add-name',
        control: `<input id="pp-add-name" name="name" required maxlength="60"
          placeholder="${esc(t(locale, 'people.add.placeholder'))}" />` })}${
      roleChoice ? `<div class="setrow tm-rolerow">${roleChoice}</div>` : ''}${
      cardActs(`<button class="btn" type="submit">${esc(t(locale, 'people.add.button'))}</button>`)}</form>`,
  ] });

  // S3 — the workspace's switch: on or off, at once.
  const handoffs = v.rotation ? setSection({ id: 'turn', title: t(locale, 'turn.title'), rows: [
    fieldRow({ label: t(locale, 'turn.switchOn'), desc: t(locale, 'turn.explain'),
      control: rowSwitch(locale, { action: '/app/settings/people/turn', on: v.rotation.on, label: t(locale, 'turn.switchOn') }) }),
  ] }) : '';

  // Phase 9 (V1-520) — a person called by the business's name is asked for their own: a field, saved with the page.
  const unnamed = v.people.filter((p) => namedLikeBusiness(p.name, v.business));
  const names = unnamed.length === 0 ? '' : setSection({ id: 'names', title: t(locale, 'people.name.yours'), rows: unnamed.map((p) =>
    fieldRow({ label: p.isOwner ? t(locale, 'people.name.yours') : `${t(locale, 'people.add.label')} (${p.name})`, forId: `pp-name-${esc(p.id)}`,
      desc: t(locale, p.isOwner ? 'people.name.askYou' : 'people.name.askThem'),
      control: `<input id="pp-name-${esc(p.id)}" name="name_${esc(p.id)}" maxlength="60" />` })) });
  const save = v.rotation || names ? saveForm(TEAM_PAGE, `${names}${saveActs(locale)}`, { id: SAVE_FORM }) : '';

  // F36; phase 9 (V1-518) — roles and what each can do: ONE table to read. The accountant's column only where the
  // books are on. Every owner-only ability is a row (`OWNER_ONLY`), so the table cannot fall behind the rule.
  const books = booksShown();
  const yes = `<span>${esc(t(locale, 'ws.team.yes'))}</span>`;
  const no = `<span class="muted">${esc(t(locale, 'ws.team.no'))}</span>`;
  const can = (label: string, owner: string, team: string, accountant: string): string =>
    `<tr class="tm"><th scope="row">${esc(label)}</th>${cell('team.role.owner', owner)}${cell('team.role.team', team)}${books ? cell('people.kind.accountant', accountant) : ''}</tr>`;
  const roles = setSection({ id: 'roles', title: t(locale, 'team.roles.title'), rows: [
    `<table class="team-table role-table">
      <thead><tr>${head('ws.team.can.col')}${head('team.role.owner')}${head('team.role.team')}${books ? head('people.kind.accountant') : ''}</tr></thead>
      <tbody>${can(t(locale, 'ws.team.can.everyday'), yes, yes, no)}${books ? can(t(locale, 'ws.team.can.books'), yes, no, yes) : ''}${
        OWNER_ONLY.map((a) => can(t(locale, `people.ownerOnly.${a}` as MessageKey), yes, no, no)).join('')}${
        can(t(locale, 'ws.team.can.turn'), yes, yes, `<span class="muted">${esc(t(locale, 'ws.team.never'))}</span>`)}</tbody></table>`,
    ...(books ? [setNotice({ text: `${t(locale, 'people.kind.accountant')}: ${t(locale, 'team.role.accountantWhat')}` })] : []),
  ] });

  // Removing someone: each row says what it does, and asks first. Never the owner (`removePerson`).
  const danger = dangerZone(locale, v.people.filter((p) => !p.isOwner).map((p) => ({
    title: t(locale, 'team.remove.button', { who: p.name }), what: t(locale, 'team.remove.what'),
    action: `/app/settings/people/${p.id}/remove`, verb: t(locale, 'closures.remove'),
    confirm: t(locale, 'people.remove.confirm', { who: p.name }), id: `remove-${p.id}`,
  })));

  const summary = v.people.length < 2 ? '' : ` ${t(locale, 'people.summary', { people: tn(locale, 'setup.state.people', v.people.length), online: show.count(locale, online) })}`;
  return `${pageHead(t(locale, 'settingsArea.team'), `${t(locale, 'ws.team.lede')}${summary}`)}
    ${flashBanner(flash)}
    ${issued}
    ${add}
    ${people}
    ${handoffs}
    ${save}
    ${roles}
    ${danger}`;
}
