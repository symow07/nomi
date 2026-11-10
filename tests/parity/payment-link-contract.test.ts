import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decimal } from '../../src/core/types/decimal.js';
import { minorAmount, minorUnits, linkRefusal, paymentLinkText } from '../../src/core/payments/paymentLink.js';
import { connectConfigFrom, connectClient, connectAuthorization, verifyConnectEvent } from '../../src/payments/stripeConnect.js';
import { connectRecorder, CONNECT_CONFIG, CONNECT_ACCOUNT, CHECKOUT_ANSWER, CHARGE_ANSWER } from '../fixtures/stripeConnect.js';

afterEach(() => vi.unstubAllGlobals());
describe('invoice payment links · exact rules and an offline Stripe port', () => {
  it('converts integer minor units exactly and refuses fractions, unsafe integers and rounded prices', () => {
    expect(minorAmount(10001)).toBe('100.01');
    expect(minorAmount(-300)).toBe('-3');
    expect(minorAmount(1.1)).toBeNull();
    expect(minorAmount(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(minorUnits(decimal('100.01'))).toBe('10001');
    expect(minorUnits(decimal('0.005'))).toBeNull();
    expect(minorUnits(decimal('-1'))).toBeNull();
  });
  it('allows only an issued amount due, ready GB/US account and identical currency, never Morocco', () => {
    const input = { country: 'GB', accountCountry: 'GB', ready: true, connected: true, invoiceState: 'issued', owed: decimal('100'), currency: 'GBP', accountCurrency: 'GBP', practice: false };
    expect(linkRefusal(input)).toBeNull();
    for (const change of [{ country: 'MA' }, { country: 'FR' }, { accountCountry: 'US' }, { ready: false }, { connected: false }, { invoiceState: 'draft' }, { owed: decimal('0') }, { currency: 'EUR' }, { practice: true }]) expect(linkRefusal({ ...input, ...change })).not.toBeNull();
  });
  it('keeps billing configuration separate; half configured cannot offer a link', () => {
    expect(connectConfigFrom({})).toBeNull();
    expect(connectConfigFrom({ STRIPE_SECRET_KEY: CONNECT_CONFIG.secretKey, STRIPE_WEBHOOK_SECRET: CONNECT_CONFIG.webhookSecret })).toBeNull();
    expect(connectConfigFrom({ STRIPE_SECRET_KEY: CONNECT_CONFIG.secretKey, STRIPE_CONNECT_CLIENT_ID: CONNECT_CONFIG.clientId })).toBeNull();
    expect(connectConfigFrom({ STRIPE_SECRET_KEY: CONNECT_CONFIG.secretKey, STRIPE_CONNECT_CLIENT_ID: CONNECT_CONFIG.clientId, STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_CONFIG.webhookSecret })).toEqual(CONNECT_CONFIG);
  });
  it('OAuth is to the existing account with a state; exchanging discards access and refresh secrets', async () => {
    const u = new URL(connectAuthorization(CONNECT_CONFIG, 'state', 'https://nomi.example/app/payments/stripe/return'));
    expect(u.origin).toBe('https://connect.stripe.com'); expect(u.searchParams.get('scope')).toBe('read_write'); expect(u.searchParams.get('state')).toBe('state');
    const f = connectRecorder([{ body: { stripe_user_id: 'acct_example', livemode: false, scope: 'read_write', access_token: 'never-keep', refresh_token: 'never-keep' } }, { body: CONNECT_ACCOUNT }]);
    const port = connectClient(CONNECT_CONFIG, f.fetch);
    expect(await port.exchange('single-use-code')).toEqual({ ok: true, value: { account: 'acct_example', live: false } });
    expect(await port.account('acct_example')).toEqual({ ok: true, value: { id: 'acct_example', country: 'GB', currency: 'GBP', ready: true } });
    expect(f.calls[0]!.headers['Authorization']).toBe(`Bearer ${CONNECT_CONFIG.secretKey}`);
    expect(f.calls[0]!.body).not.toContain(CONNECT_CONFIG.secretKey);
  });
  it('creates a direct charge, with a persistent idempotency key and no fee, destination, billing customer or private data', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('Real HTTP forbidden'); });
    const f = connectRecorder([{ body: CHECKOUT_ANSWER }]);
    const answer = await connectClient(CONNECT_CONFIG, f.fetch).createCheckout('acct_example', { attemptId: 'attempt-1', amount: decimal('100'), currency: 'GBP', successUrl: 'https://nomi.example/payment/return', cancelUrl: 'https://nomi.example/payment/return', expiresAt: 1800003600 });
    expect(answer.ok).toBe(true);
    const call = f.calls[0]!; const p = new URLSearchParams(call.body);
    expect(call.headers['Stripe-Account']).toBe('acct_example'); expect(call.headers['Idempotency-Key']).toBe('nomi-payment-attempt-1');
    expect(p.get('mode')).toBe('payment'); expect(p.get('line_items[0][price_data][unit_amount]')).toBe('10000');
    expect(p.get('payment_intent_data[metadata][nomi_attempt]')).toBe('attempt-1');
    expect(call.body).not.toMatch(/application_fee|transfer_data|customer|email|phone/);
  });
  it('reads capture and fee as separate facts; missing fee remains null', async () => {
    const f = connectRecorder([{ body: { id: 'pi_example', status: 'succeeded', latest_charge: CHARGE_ANSWER } }, { body: { id: 'pi_example', status: 'succeeded', latest_charge: { ...CHARGE_ANSWER, balance_transaction: null } } }]);
    const client = connectClient(CONNECT_CONFIG, f.fetch);
    const one = await client.intent('acct_example', 'pi_example');
    expect(one.ok && one.value.charge?.balance).toEqual({ id: 'txn_example', gross: '100', fee: '3', net: '97', currency: 'GBP', created: 1800000000 });
    const late = await client.intent('acct_example', 'pi_example'); expect(late.ok && late.value.charge?.balance).toBeNull();
  });
  it('refuses mismatched gross/net fee arithmetic, untrusted URLs, wrong OAuth mode and provider errors without leaking their body', async () => {
    const f = connectRecorder([{ body: { ...CHECKOUT_ANSWER, url: 'https://evil.example/' } }, { body: { stripe_user_id: 'acct_example', livemode: true, scope: 'read_write' } }, { status: 401, body: { error: { message: 'a secret in an upstream error' } } }, { body: { id: 'pi_example', status: 'succeeded', latest_charge: { ...CHARGE_ANSWER, balance_transaction: { ...CHARGE_ANSWER.balance_transaction, net: 9999 } } } }]);
    const c = connectClient(CONNECT_CONFIG, f.fetch);
    expect((await c.checkout('acct_example', 'cs_test_example')).ok).toBe(false);
    expect((await c.exchange('code')).ok).toBe(false);
    expect(await c.account('acct_example')).toEqual({ ok: false, reason: 'refused', retryable: false });
    const bad = await c.intent('acct_example', 'pi_example'); expect(bad.ok && bad.value.charge?.balance).toBeNull();
  });
  it('signatures bind raw bytes, account and mode; the inbox envelope contains no customer fields', () => {
    const body = JSON.stringify({ id: 'evt_example', type: 'checkout.session.completed', created: 1800000000, account: 'acct_example', livemode: false, data: { object: { ...CHECKOUT_ANSWER, customer_email: 'private@example.test' } } });
    const sign = (s: string) => `t=1800000000,v1=${createHmac('sha256', CONNECT_CONFIG.webhookSecret).update(`1800000000.${s}`).digest('hex')}`;
    expect(verifyConnectEvent(body, sign(body), CONNECT_CONFIG, 1800000000)).toEqual({ id: 'evt_example', type: 'checkout.session.completed', created: 1800000000, account: 'acct_example', live: false, objectId: 'cs_test_example', intentId: null });
    expect(verifyConnectEvent(body + ' ', sign(body), CONNECT_CONFIG, 1800000000)).toBeNull();
    expect(verifyConnectEvent(body, sign(body), { ...CONNECT_CONFIG, live: true }, 1800000000)).toBeNull();
    expect(verifyConnectEvent(body, sign(body), CONNECT_CONFIG, 1800000301)).toBeNull();
    const noAccount = body.replace(',"account":"acct_example"', '');
    expect(verifyConnectEvent(noAccount, sign(noAccount), CONNECT_CONFIG, 1800000000)).toBeNull();
  });
  it('composes only the issued invoice amount and provider link, without claiming it was sent or paid', () => {
    expect(paymentLinkText('F-2026-0001', decimal('100'), 'GBP', CHECKOUT_ANSWER.url)).toBe('Invoice F-2026-0001: 100 GBP. You can pay here: https://checkout.stripe.com/c/pay/cs_test_example');
  });
  it('expires the same session, reads refund and payout facts, and keeps an unavailable fee pending', async () => {
    const f = connectRecorder([
      { body: { ...CHECKOUT_ANSWER, status: 'expired', url: null } },
      { body: { id: 're_example', payment_intent: 'pi_example', amount: 2500, currency: 'gbp', created: 1800000000, status: 'pending', balance_transaction: null } },
      { body: { id: 'po_example', amount: 9700, currency: 'gbp', created: 1800000000, arrival_date: 1800086400, status: 'paid', balance_transaction: null } },
      { body: { id: 'pi_example', status: 'succeeded', metadata: { nomi_attempt: 'attempt-1' }, latest_charge: { ...CHARGE_ANSWER, balance_transaction: { ...CHARGE_ANSWER.balance_transaction, fee: 0, net: 10000, fee_details: [] } } } },
    ]);
    const c = connectClient(CONNECT_CONFIG, f.fetch);
    expect(await c.expireCheckout('acct_example', CHECKOUT_ANSWER.id)).toMatchObject({ ok: true, value: { status: 'expired', url: null } });
    expect(f.calls[0]!.headers['Idempotency-Key']).toBe(`nomi-expire-${CHECKOUT_ANSWER.id}`);
    expect(await c.refund('acct_example', 're_example')).toMatchObject({ ok: true, value: { amount: '25', status: 'pending', balance: null } });
    expect(await c.payout('acct_example', 'po_example')).toMatchObject({ ok: true, value: { amount: '97', status: 'paid' } });
    expect(await c.intent('acct_example', 'pi_example')).toMatchObject({ ok: true, value: { attemptId: 'attempt-1', charge: { balance: null } } });
  });
  it('reads the returned failure balance independently of fee data and retains the payout destination', async () => {
    const returned = { id: 'txn_returned', amount: 2500, currency: 'gbp', created: 1800086400, fee: 0, fee_details: [] };
    const f = connectRecorder([
      { body: { id: 're_failed', payment_intent: 'pi_example', amount: 2500, currency: 'gbp', created: 1800000000, status: 'failed', failure_balance_transaction: returned } },
      { body: { id: 'po_failed', amount: 2500, currency: 'gbp', created: 1800000000, arrival_date: 1800043200, status: 'failed', destination: 'ba_original', failure_balance_transaction: returned } },
    ]);
    const c = connectClient(CONNECT_CONFIG, f.fetch);
    expect(await c.refund('acct_example','re_failed')).toMatchObject({ok:true,value:{failureBalance:{id:'txn_returned',amount:'25',currency:'GBP',created:1800086400}}});
    expect(await c.payout('acct_example','po_failed')).toMatchObject({ok:true,value:{destination:'ba_original',failureBalance:{id:'txn_returned',amount:'25'}}});
    expect(f.calls.every(x=>x.url.includes('failure_balance_transaction'))).toBe(true);
  });
  it('deauthorizes only the named account with the platform OAuth client and confirms the returned account', async () => {
    const f = connectRecorder([{body:{stripe_user_id:'acct_example'}},{status:503,body:{error:'unavailable'}}]);
    const c=connectClient(CONNECT_CONFIG,f.fetch);
    expect(await c.deauthorize('acct_example')).toEqual({ok:true,value:true});
    expect(f.calls[0]!.url).toBe('https://connect.stripe.com/oauth/deauthorize');
    expect(new URLSearchParams(f.calls[0]!.body).get('client_id')).toBe(CONNECT_CONFIG.clientId);
    expect(new URLSearchParams(f.calls[0]!.body).get('stripe_user_id')).toBe('acct_example');
    expect(await c.deauthorize('acct_example')).toMatchObject({ok:false,reason:'unavailable'});
  });
  it('recovers a missing checkout by metadata across every page, never treating a partial list as absent', async () => {
    const unrelated={...CHECKOUT_ANSWER,id:'cs_test_unrelated',metadata:{nomi_attempt:'other'}};
    const f=connectRecorder([{body:{data:[unrelated],has_more:true}},{body:{data:[CHECKOUT_ANSWER],has_more:false}}]);
    const c=connectClient(CONNECT_CONFIG,f.fetch);
    expect(await c.findCheckout('acct_example','attempt-1',1799990000,1800086400)).toMatchObject({ok:true,value:{id:CHECKOUT_ANSWER.id}});
    expect(f.calls).toHaveLength(2);expect(f.calls[1]!.url).toContain('starting_after=cs_test_unrelated');
    expect(f.calls.every(x=>x.headers['Stripe-Account']==='acct_example')).toBe(true);
    const no=connectRecorder([{body:{data:[],has_more:false}}]);
    expect(await connectClient(CONNECT_CONFIG,no.fetch).findCheckout('acct_example','attempt-1',1799990000,1800086400)).toEqual({ok:true,value:null});
  });

  it('never proves a missing session from unavailable, incomplete, cyclic or ambiguous pages',async()=>{
    for(const answers of [
      [{status:503,body:{}}],
      [{body:{data:[],has_more:true}}],
      [{body:{data:[CHECKOUT_ANSWER],has_more:true}},{body:{data:[CHECKOUT_ANSWER],has_more:true}}],
      [{body:{data:[CHECKOUT_ANSWER,{...CHECKOUT_ANSWER,id:'cs_test_duplicate'}],has_more:false}}],
      [{body:{data:[{...CHECKOUT_ANSWER,url:'https://elsewhere.example'}],has_more:false}}],
    ]){
      const f=connectRecorder(answers);expect(await connectClient(CONNECT_CONFIG,f.fetch).findCheckout('acct_example','attempt-1',1799990000,1800086400)).toMatchObject({ok:false});
    }
    const wrong=connectRecorder([{body:{stripe_user_id:'acct_different'}}]);expect(await connectClient(CONNECT_CONFIG,wrong.fetch).deauthorize('acct_example')).toMatchObject({ok:false,reason:'invalid_answer'});
  });

});
