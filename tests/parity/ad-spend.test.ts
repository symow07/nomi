import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MARKETING_API_VERSION, INSIGHTS_FIELDS, INSIGHTS_PAGE_CAP, adsLoginFrom, adsDialogUrl, adsStateSecret, insightsUrl, readInsights,
  verdictOf, listAdAccounts, type AdsFetch,
} from '../../src/channels/meta/adSpend.js';
import { META_LOGIN_SCOPES, metaDialogUrl, metaLoginFrom, mintMetaState, readMetaState } from '../../src/channels/meta/connect.js';
import { isMetaAmount, readUsage, readSpan, monthDays, CHANNEL_OF, isNamedPlatform } from '../../src/core/ads/spend.js';

/**
 * 0238 — ad spend, without a database: the login stays apart from the Page connect; the Insights request is
 * exactly what was decided; the read is all or nothing, paced on Meta's headers, never a loop; amounts stay
 * strings. Meta exists only in this file (`fakeMeta`): built from the shapes on Meta's saved pages, not recorded.
 */

const ENV = { META_SOCIAL_APP_ID: '4070500000000001', META_LOGIN_CONFIG_ID: '1234567890', META_ADS_LOGIN_CONFIG_ID: '9876543210' };

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
function fakeMeta(pages: Answer[]): { fetch: AdsFetch; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetch: AdsFetch = async (url) => {
    urls.push(url);
    const a = pages[Math.min(i++, pages.length - 1)]!;
    const h = new Map(Object.entries(a.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: a.status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => JSON.stringify(a.body) };
  };
  return { fetch, urls };
}
const row = (day: string, platform: string, spend: string, o: Partial<Record<string, string>> = {}) => ({
  account_id: '111222333', account_currency: 'EUR', date_start: day, date_stop: day, publisher_platform: platform, spend, ...o,
});
const next = (n: number) => ({ next: `https://graph.facebook.com/${MARKETING_API_VERSION}/act_111222333/insights?after=c${n}` });
const IN = { token: 'ads-token', accountId: '111222333', currency: 'EUR', since: '2026-10-01', until: '2026-10-31' };

describe('0238 · the ads login is apart from the Page connect', () => {
  it('all three or nothing: without META_ADS_LOGIN_CONFIG_ID there is no ads login', () => {
    expect(adsLoginFrom(ENV, 'secret')).toEqual({ appId: ENV.META_SOCIAL_APP_ID, appSecret: 'secret', configId: '9876543210' });
    expect(adsLoginFrom({ ...ENV, META_ADS_LOGIN_CONFIG_ID: undefined }, 'secret')).toBeNull();
    expect(adsLoginFrom(ENV, undefined)).toBeNull();
    expect(adsLoginFrom({ ...ENV, META_ADS_LOGIN_CONFIG_ID: 'abc' }, 'secret')).toBeNull();
  });

  it('the base login never asks for ads_read; the ads dialog is its own configuration on v27.0', () => {
    expect(META_LOGIN_SCOPES as readonly string[]).not.toContain('ads_read');
    const base = metaDialogUrl(metaLoginFrom(ENV, 'secret')!, { redirectUri: 'https://n.test/cb', state: 's', graphVersion: 'v23.0' });
    expect(base).not.toContain('ads_read');
    expect(new URL(base).searchParams.get('config_id')).toBe('1234567890');
    const ads = new URL(adsDialogUrl(adsLoginFrom(ENV, 'secret')!, { redirectUri: 'https://n.test/ads', state: 's' }));
    expect(ads.pathname).toBe('/v27.0/dialog/oauth');
    expect(ads.searchParams.get('config_id')).toBe('9876543210');
    expect(ads.searchParams.has('scope')).toBe(false);
    // The connect module is untouched by this work: its own copy of the scopes, no Marketing API version.
    const connect = readFileSync('src/channels/meta/connect.ts', 'utf8');
    expect(connect).not.toMatch(/ads_read|v27\.0|META_ADS_LOGIN_CONFIG_ID/);
  });

  it('a Page connect state never reads as an ads state, nor the reverse', () => {
    const now = Date.now();
    const base = mintMetaState('session-secret', { nonce: 'n', personId: 'p', tokenCiphertext: null }, now);
    const ads = mintMetaState(adsStateSecret('session-secret'), { nonce: 'n', personId: 'p', tokenCiphertext: null }, now);
    expect(readMetaState(adsStateSecret('session-secret'), base, now)).toBeNull();
    expect(readMetaState('session-secret', ads, now)).toBeNull();
    expect(readMetaState(adsStateSecret('session-secret'), ads, now)?.nonce).toBe('n');
  });

  it('the Marketing API version is its own constant, not the social default', () => {
    expect(MARKETING_API_VERSION).toBe('v27.0');
    expect(readFileSync('src/channels/meta/adSpend.ts', 'utf8')).not.toContain('META_GRAPH_API_VERSION');
  });
});

describe('0238 · the Insights request', () => {
  it('v27.0, exactly five fields, account level, one row a day, broken down by placement only', () => {
    const u = new URL(insightsUrl('111222333', { since: '2026-10-01', until: '2026-10-31' }, 'tok'));
    expect(u.origin + u.pathname).toBe('https://graph.facebook.com/v27.0/act_111222333/insights');
    expect(u.searchParams.get('fields')).toBe('account_id,account_currency,date_start,date_stop,spend');
    expect(INSIGHTS_FIELDS.split(',')).toHaveLength(5);
    expect(u.searchParams.get('level')).toBe('account');
    expect(u.searchParams.get('time_increment')).toBe('1');
    expect(u.searchParams.get('breakdowns')).toBe('publisher_platform');
    expect(JSON.parse(u.searchParams.get('time_range')!)).toEqual({ since: '2026-10-01', until: '2026-10-31' });
    expect(u.searchParams.has('date_preset')).toBe(false);
  });

  it('pages are followed, rows kept as Meta wrote them, each placement its own row', async () => {
    const m = fakeMeta([
      { status: 200, body: { data: [row('2026-10-01', 'instagram', '12.34'), row('2026-10-01', 'facebook', '0.10')], paging: next(1) } },
      { status: 200, body: { data: [row('2026-10-02', 'instagram', '1000000.01'), row('2026-10-02', 'threads', '3')] } },
    ]);
    const r = await readInsights(IN, m.fetch);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.pages).toBe(2);
    expect(m.urls[1]).toContain('after=c1');
    expect(r.rows).toEqual([
      { day: '2026-10-01', platform: 'instagram', amount: '12.34', currency: 'EUR' },
      { day: '2026-10-01', platform: 'facebook', amount: '0.10', currency: 'EUR' },
      { day: '2026-10-02', platform: 'instagram', amount: '1000000.01', currency: 'EUR' },
      { day: '2026-10-02', platform: 'threads', amount: '3', currency: 'EUR' },
    ]);
  });

  it('an invented placement is kept under its own name and never folded into a named one', async () => {
    const m = fakeMeta([{ status: 200, body: { data: [row('2026-10-03', 'zz_invented_place', '7.77'), row('2026-10-03', 'instagram', '1.00')] } }]);
    const r = await readInsights(IN, m.fetch);
    expect(r.kind === 'ok' && r.rows.map((x) => x.platform)).toEqual(['zz_invented_place', 'instagram']);
    expect(isNamedPlatform('zz_invented_place')).toBe(false);
    expect(Object.keys(CHANNEL_OF).sort()).toEqual(['facebook', 'instagram', 'messenger']);
  });

  it('the page cap ends the read as incomplete, with no further call', async () => {
    // Six pages that do end, so a read with no cap finishes `ok` and this test fails on its assertion, not a hang.
    const m = fakeMeta([...Array.from({ length: 5 }, (_, i) => ({ status: 200, body: { data: [], paging: next(i + 2) } })), { status: 200, body: { data: [] } }]);
    const r = await readInsights(IN, m.fetch, { pageCap: 3 });
    expect(r.kind).toBe('incomplete');
    expect(m.urls).toHaveLength(3);
    expect(INSIGHTS_PAGE_CAP).toBe(20);
  });

  it('a next page outside Meta\'s Graph address is not followed', async () => {
    const m = fakeMeta([{ status: 200, body: { data: [], paging: { next: 'https://evil.example/v27.0/act_111222333/insights' } } }]);
    const r = await readInsights(IN, m.fetch);
    expect(r.kind).toBe('failed');
    expect(m.urls).toHaveLength(1);
  });

  it('usage at or past 75% stops paging and says how long to wait', async () => {
    const headers = {
      'x-business-use-case-usage': JSON.stringify({ '123': [{ type: 'ads_insights', call_count: 80, total_cputime: 10, total_time: 10, estimated_time_to_regain_access: 7 }] }),
      'x-ad-account-usage': JSON.stringify({ acc_id_util_pct: 9.67, reset_time_duration: 100 }),
      'x-fb-ads-insights-throttle': JSON.stringify({ app_id_util_pct: 20, acc_id_util_pct: 10 }),
    };
    const m = fakeMeta([{ status: 200, body: { data: [row('2026-10-01', 'instagram', '1')], paging: next(1) }, headers }]);
    const r = await readInsights(IN, m.fetch);
    expect(r.kind).toBe('throttled');
    expect(m.urls).toHaveLength(1);
    expect(r.waitSec).toBe(420);
    expect(Object.keys(r.usage[0]!.headers).sort()).toEqual(['x-ad-account-usage', 'x-business-use-case-usage', 'x-fb-ads-insights-throttle']);
    expect(JSON.stringify(r.usage)).not.toContain('ads-token');
  });

  it('errors: 190 refused whatever the subcode, 200 permission, 4 and 613 throttled, anything else failed', async () => {
    for (const [code, sub, kind] of [[190, 463, 'refused'], [190, 999999, 'refused'], [190, null, 'refused'], [200, null, 'permission'], [4, 1504022, 'throttled'], [613, null, 'throttled'], [17, null, 'failed'], [80000, null, 'failed'], [100, 1487534, 'failed']] as const) {
      const m = fakeMeta([{ status: 400, body: { error: { code, error_subcode: sub, message: `m${code}` } } }]);
      const r = await readInsights(IN, m.fetch);
      expect([code, r.kind]).toEqual([code, kind]);
      expect(m.urls).toHaveLength(1);
    }
    expect(verdictOf(null)).toBe('failed');
    const down = await readInsights(IN, async () => { throw new Error('ECONNRESET'); });
    expect(down.kind).toBe('failed');
  });

  it('all or nothing: a row that is not what was asked for fails the whole read', async () => {
    const bad = [
      row('2026-10-01', 'instagram', '1.5e3'), row('2026-10-01', 'instagram', '-1'), row('2026-10-01', 'instagram', '1,50'),
      row('2026-10-01', 'instagram', '1', { account_currency: 'USD' }), row('2026-10-01', 'instagram', '1', { account_id: '999' }),
      row('2026-10-01', 'instagram', '1', { date_stop: '2026-10-02' }), row('2026-09-30', 'instagram', '1'),
      { ...row('2026-10-01', 'instagram', '1'), publisher_platform: undefined },
    ];
    for (const b of bad) {
      const r = await readInsights(IN, fakeMeta([{ status: 200, body: { data: [row('2026-10-02', 'facebook', '2'), b] } }]).fetch);
      expect(r.kind, JSON.stringify(b)).toBe('failed');
    }
    const twice = await readInsights(IN, fakeMeta([{ status: 200, body: { data: [row('2026-10-02', 'facebook', '2'), row('2026-10-02', 'facebook', '2')] } }]).fetch);
    expect(twice.kind).toBe('failed');
    // A spend given as a JSON number (not Meta's string) is refused, never turned into a float.
    const num = await readInsights(IN, fakeMeta([{ status: 200, body: { data: [{ ...row('2026-10-02', 'facebook', '2'), spend: 2.5 }] } }]).fetch);
    expect(num.kind).toBe('failed');
  });
});

describe('0238 · amounts, months and the ad accounts', () => {
  // Sums are the database's (`amount_num`, numeric, generated from Meta's text): ad-spend-results holds them exact.
  it('amounts are decimal strings', () => {
    expect(['12.34', '0.10', '1000000.01', '3'].every(isMetaAmount)).toBe(true);
    expect(['1e3', '-1', '1,5', '.5', '1.', ' 1', ''].some(isMetaAmount)).toBe(false);
  });

  it('months and spans are the account\'s days', () => {
    expect(monthDays('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28', next: '2026-03-01' });
    expect(monthDays('2026-12')?.next).toBe('2027-01-01');
    expect(monthDays('2026-13')).toBeNull();
    expect(readSpan('2026-11-10', true)).toEqual({ since: '2026-10-01', until: '2026-11-10' });
    expect(readSpan('2026-01-05', true)).toEqual({ since: '2025-12-01', until: '2026-01-05' });
    expect(readSpan('2026-11-10', false)).toEqual({ since: '2026-10-14', until: '2026-11-10' });
  });

  it('the usage headers: a header that is not JSON is kept as null, never guessed', () => {
    const u = readUsage((n) => (n === 'x-ad-account-usage' ? 'not json' : null));
    expect(u).toEqual({ headers: { 'x-ad-account-usage': null }, peak: null, waitSec: null });
  });

  it('an ad account without a currency code or a readable zone is left out', async () => {
    const m = fakeMeta([{ status: 200, body: { data: [
      { account_id: '1', name: 'Shop ads', currency: 'EUR', timezone_name: 'Europe/Paris' },
      { account_id: '2', name: 'No zone', currency: 'EUR', timezone_name: 'Mars/Olympus' },
      { account_id: '3', name: 'No currency', timezone_name: 'Europe/Paris' },
    ] } }]);
    const r = await listAdAccounts('t', m.fetch);
    expect(r.ok && r.accounts.map((a) => a.accountId)).toEqual(['1']);
    expect(m.urls[0]).toContain('/v27.0/me/adaccounts');
  });
});
