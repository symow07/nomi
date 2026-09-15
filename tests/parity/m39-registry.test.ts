import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  CHANNEL_REGISTRY, INSTEAD, OUTREACH_CHANNELS, REQUIREMENTS, mayInitiate, mayInitiateWith,
  type ChannelCapability, type Requirement, type OutreachChannel,
} from '../../src/core/channel/registry.js';
import { renderReach, satisfiedRequirements } from '../../src/api/web/channels.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M39 — what each channel can actually carry.
 *
 * The rule this file protects is not a preference. Any tool that appears to
 * cold-DM on Instagram is automating the consumer app, and those accounts get
 * closed; a product that softened "never" into "not recommended" would be
 * lying in the direction that costs her the account she built over years.
 */

const all = new Set<Requirement>(REQUIREMENTS);

describe('M39 · the registry states what the APIs permit', () => {
  it('email is the only true cold channel', () => {
    expect(CHANNEL_REGISTRY.email.coldInitiate).toBe('open');
    // M40.1 added its one condition: mail leaves as HER domain, so the records
    // that stop it being filed as junk must be in place first. The channel is
    // still the only one that permits a first message at all.
    expect(mayInitiate('email', new Set(['verified_sending_domain'])).ok).toBe(true);
    expect(mayInitiate('email').ok).toBe(false);
  });

  it('WhatsApp is conditional, and its conditions are named', () => {
    expect(CHANNEL_REGISTRY.whatsapp.coldInitiate).toBe('conditional');
    expect([...CHANNEL_REGISTRY.whatsapp.requires])
      .toEqual(['approved_template', 'business_verification', 'privacy_policy_url']);
  });

  it('Instagram and Messenger cannot be written to first, at all', () => {
    for (const c of ['instagram', 'messenger'] as const) {
      expect(CHANNEL_REGISTRY[c].coldInitiate, c).toBe('never');
      const r = mayInitiate(c, all);
      expect(r.ok, c).toBe(false);
      expect(r.ok === false && r.error.kind, c).toBe('never');
    }
  });

  it('NO SET OF SATISFIED REQUIREMENTS TALKS THEM INTO IT', () => {
    // The one thing that must survive every future edit: `never` is not a very
    // strict `conditional`. Walked over the whole power set of requirements.
    const subsets: Requirement[][] = [[]];
    for (const r of REQUIREMENTS) for (const s of [...subsets]) subsets.push([...s, r]);
    for (const c of ['instagram', 'messenger'] as const) {
      for (const s of subsets) {
        expect(mayInitiate(c, new Set(s)).ok, `${c} with ${s.join(',')}`).toBe(false);
      }
    }
  });

  it('A REPLY-ONLY CHANNEL WITH A CONDITION ON IT IS STILL REPLY-ONLY', () => {
    /**
     * No `never` channel carries a requirement today, so both orderings inside
     * the predicate refuse and a mutation of the order survives every test
     * written against the real registry. This is the case that could exist
     * tomorrow, and what it protects is the SENTENCE, not the boolean: `unmet`
     * renders as "you can write first once these are in place", which is a
     * promise no amount of paperwork can make true on Instagram.
     */
    const hypothetical: ChannelCapability = {
      availableHere: false, channel: 'instagram', coldInitiate: 'never',
      requires: ['approved_template'], replyWindowHours: 24, instead: ['buyer_writes_first'],
    };
    for (const s of [new Set<Requirement>(), new Set<Requirement>(['approved_template'])]) {
      const r = mayInitiateWith(hypothetical, s);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error.kind, 'must refuse as never, never as unmet').toBe('never');
    }
  });

  it('and no channel that cannot initiate carries conditions, so the page cannot mislead', () => {
    for (const c of OUTREACH_CHANNELS) {
      if (CHANNEL_REGISTRY[c].coldInitiate !== 'never') continue;
      expect(CHANNEL_REGISTRY[c].requires, c).toEqual([]);
    }
  });

  it('FAIL CLOSED — a requirement nobody mentioned is unmet, not satisfied', () => {
    // A caller that forgets to resolve template readiness gets a refusal.
    const r = mayInitiate('whatsapp');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.kind === 'unmet' && [...r.error.missing])
      .toEqual(['approved_template', 'business_verification', 'privacy_policy_url']);
  });

  it('and it names exactly what is still outstanding, not just that something is', () => {
    const r = mayInitiate('whatsapp', new Set<Requirement>(['approved_template']));
    expect(r.ok === false && r.error.kind === 'unmet' && [...r.error.missing])
      .toEqual(['business_verification', 'privacy_policy_url']);
    expect(mayInitiate('whatsapp', all).ok).toBe(true);
  });

  it('A REFUSAL NAMES WHAT DOES WORK — an empty refusal sends her elsewhere', () => {
    const r = mayInitiate('instagram');
    expect(r.ok === false && r.error.kind === 'never' && r.error.instead.length)
      .toBeGreaterThan(0);
    for (const c of OUTREACH_CHANNELS) {
      if (CHANNEL_REGISTRY[c].coldInitiate !== 'never') continue;
      expect(CHANNEL_REGISTRY[c].instead, c).toContain('comment_to_dm');
      expect(CHANNEL_REGISTRY[c].instead, c).toContain('click_to_whatsapp');
    }
  });

  it('it does NOT re-answer consent, which is M38’s for every channel at once', async () => {
    // Two places deciding whether a buyer opted in would agree right up until
    // the day they did not.
    const src = await readFile(new URL('../../src/core/channel/registry.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toMatch(/consent|opt_in|optIn|suppress/i);
    expect([...REQUIREMENTS]).not.toContain('recorded_consent');
  });

  it('nor template approval, which is M22 §B’s', async () => {
    const src = await readFile(new URL('../../src/core/channel/registry.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toMatch(/templateReadiness|templateState|approvedTemplates/);
  });

  it('WeChat is absent until it has an adapter behind it', () => {
    expect([...OUTREACH_CHANNELS]).toEqual(['email', 'whatsapp', 'instagram', 'messenger']);
  });
});

describe('M39 · what the installation actually satisfies', () => {
  it('an approved template satisfies its requirement, and nothing else', () => {
    expect([...satisfiedRequirements('approved', null, new Date())]).toEqual(['approved_template']);
  });

  it('and no template state satisfies anything', () => {
    for (const s of ['none', 'rejected'] as const) {
      expect([...satisfiedRequirements(s, null, new Date())], s).toEqual([]);
    }
  });

  it('WHAT NOTHING CAN OBSERVE IS UNMET — never assumed', () => {
    // Business verification and the privacy page are Meta's to confirm and hers
    // to supply. Reporting them satisfied would put "you can write first" in
    // front of an owner whose first send would be rejected.
    const s = satisfiedRequirements('approved', null, new Date());
    expect(s.has('business_verification')).toBe(false);
    expect(s.has('privacy_policy_url')).toBe(false);
    expect(mayInitiate('whatsapp', s).ok).toBe(false);
  });
});

describe('M39 · what she reads', () => {
  const page = (state: 'approved' | 'none' = 'none') =>
    renderReach('en', satisfiedRequirements(state, null, new Date()));

  it('every channel appears, with the truth about it', () => {
    const html = page();
    for (const c of OUTREACH_CHANNELS) expect(html, c).toContain(t('en', `reach.channel.${c}` as MessageKey));
    expect(html).toContain(t('en', 'reach.cold.open'));         // email
    expect(html).toContain(t('en', 'reach.cold.conditional'));  // whatsapp
    expect(html).toContain(t('en', 'reach.cold.never'));        // instagram, messenger
  });

  it('an approved template moves ONE line, and does not open the channel', () => {
    // The failure this prevents: a page that says "ready" because the one thing
    // it can see is done, while two things it cannot see are not.
    const html = page('approved');
    expect(html).toContain(t('en', 'reach.req.ready'));
    // Scoped to the WhatsApp card — email legitimately says "you can write
    // first", and asserting over the whole page would prove nothing.
    const card = html.slice(html.indexOf(t('en', 'reach.channel.whatsapp')));
    const whatsapp = card.slice(0, card.indexOf('class="card reach"'));
    expect(whatsapp).toContain(t('en', 'reach.cold.conditional'));
    // On the tone, not the sentence: "you can write first ONCE THESE ARE IN
    // PLACE" contains the open sentence as a substring, so asserting on text
    // would pass for the wrong reason.
    expect(whatsapp).toMatch(/class="pill warn"/);
    expect(whatsapp).not.toMatch(/class="pill ok">You can write first</);
    // one done, two still outstanding
    expect(whatsapp.split(t('en', 'reach.req.ready')).length - 1).toBe(1);
    expect(whatsapp.split(t('en', 'reach.req.waiting')).length - 1).toBe(2);
  });

  it('the channels that cannot be written to first say what works instead', () => {
    const html = page();
    expect(html).toContain(t('en', 'reach.instead.title'));
    for (const i of INSTEAD) expect(html, i).toContain(t('en', `reach.instead.${i}` as MessageKey));
  });

  it('IT IS DERIVED FROM THE PREDICATE, not from the table beside it', async () => {
    // What keeps this page and M42's gate the same answer: when the gate
    // refuses a send it refuses for the reason printed here, because it is the
    // same call.
    const src = await readFile(new URL('../../src/api/web/channels.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function renderReach'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('mayInitiate(channel, satisfied)');
  });

  it('WHAT THE CHANNEL ALLOWS IS NOT WHAT THIS PRODUCT CAN DO YET', () => {
    // The first version of this page said "Email · you can write first" beside
    // a Connect button, when nothing here could send an e-mail at all.
    //
    // C4.a — e-mail can now, so it is no longer the example; the RULE is
    // unchanged and is now read from the registry rather than from a channel
    // name, which is what stopped this test from having to be rewritten a
    // second time when the next adapter lands.
    const html = page();
    const cardFor = (c: OutreachChannel): string => {
      const at = html.indexOf(t('en', `reach.channel.${c}` as MessageKey));
      const rest = html.slice(at);
      const end = rest.indexOf('class="card reach"');
      return end === -1 ? rest : rest.slice(0, end);
    };
    for (const c of OUTREACH_CHANNELS) {
      const card = cardFor(c);
      if (CHANNEL_REGISTRY[c].availableHere) {
        expect(card, `${c} is available here and still says it is not`).not.toContain(t('en', 'reach.notHere'));
      } else {
        expect(card, `${c} cannot send from here and does not say so`).toContain(t('en', 'reach.notHere'));
      }
    }
    // …and at least one of each kind exists, so this cannot pass vacuously.
    expect(OUTREACH_CHANNELS.some((c) => CHANNEL_REGISTRY[c].availableHere)).toBe(true);
    expect(OUTREACH_CHANNELS.some((c) => !CHANNEL_REGISTRY[c].availableHere)).toBe(true);
  });

  it('and "available here" is checked against the adapters on disk, not asserted', async () => {
    // A boolean nobody verifies goes stale the release after it is written.
    // Email flips when its adapter lands, not when someone remembers.
    const { readdir } = await import('node:fs/promises');
    const dirs = (await readdir(new URL('../../src/channels/', import.meta.url), { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name);
    for (const c of OUTREACH_CHANNELS) {
      expect(CHANNEL_REGISTRY[c].availableHere, `${c}: registry vs src/channels/`)
        .toBe(dirs.includes(c));
    }
  });

  it('NOTHING IS PROMISED "SOON" THAT CANNOT HAPPEN AT ALL', async () => {
    // "Coming soon: Instagram, Messenger" sat eight lines under "you cannot
    // write first, ever" — the dishonesty this milestone removes, on the same
    // page as the fix.
    const src = await readFile(new URL('../../src/api/web/channels.ts', import.meta.url), 'utf8');
    const soon = src.slice(src.indexOf('const COMING_SOON'), src.indexOf('function problemBlock'));
    const code = soon.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    for (const c of OUTREACH_CHANNELS) {
      if (CHANNEL_REGISTRY[c].coldInitiate !== 'never') continue;
      expect(code.toLowerCase(), `${c} cannot be "coming soon"`).not.toContain(c);
    }
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'reach.title', 'reach.intro', 'reach.cold.open', 'reach.cold.conditional',
      'reach.cold.never', 'reach.req.ready', 'reach.req.waiting', 'reach.window',
      'reach.instead.title', 'reach.notHere',
      ...OUTREACH_CHANNELS.map((c) => `reach.channel.${c}` as MessageKey),
      ...REQUIREMENTS.map((r) => `reach.req.${r}` as MessageKey),
      ...INSTEAD.map((i) => `reach.instead.${i}` as MessageKey),
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { hours: '24' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
      const html = renderReach(locale, new Set());
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible, locale).toContain(t(locale, 'reach.cold.never'));
    }
  });

  it('and the Channel Center renders it', async () => {
    const src = await readFile(new URL('../../src/api/web/channels.ts', import.meta.url), 'utf8');
    // C4.a — the predicate moved to core/channel/requirements.ts so the SEND
    // path can ask it too, and takes its clock explicitly there (core owns no
    // clock). The rule this pins is unchanged: the page renders the predicate's
    // answer, never a second derivation of it.
    expect(src).toContain('renderReach(locale, satisfiedRequirements(data.templateState, data.domain, new Date()),');
    expect(src).toContain('${reach}');
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    // G3 added the configured number as a fifth argument; what this pins is
    // that the page is handed the REAL template state, not a default.
    expect(app).toMatch(/loadChannels\(deps\.db, s\.businessId, messagingEnabled, deps\.templateState \?\? 'none'[,)]/);
  });
});
