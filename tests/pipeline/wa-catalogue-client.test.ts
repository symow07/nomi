import { describe, expect, it } from 'vitest';
import { catalogueClient } from '../../src/net/waCatalogue.js';

const item = { method: 'CREATE' as const, data: { id: 'item-one', title: 'Shirt', description: 'Linen', brand: 'Shop',
  availability: 'in stock', condition: 'new', price: '24.50 GBP', link: 'https://shop.example/shirt', image_link: 'https://nomi.example/photo' } };
const receipt = { handles: ['handle-one'], validation_status: [] };
const finished = { data: [{ handle: 'handle-one', status: 'finished', warnings: [], errors_total_count: 0, ids_of_invalid_requests: [] }] };
const fake = (response: unknown, code = 200) => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(response), { status: code });
  };
  return { requests, client: catalogueClient({ token: 'test-only-secret', fetchImpl }) };
};

describe('The catalogue transport, separate from message transport', () => {
  it('reads only the linked catalogue, with the token in a header', async () => {
    const { client, requests } = fake({ data: [{ id: '123', name: 'Shop' }] });
    expect(await client.linked('456')).toEqual({ ok: true, catalogId: '123' });
    expect(requests[0]!.url).toBe('https://graph.facebook.com/v27.0/456/product_catalogs?fields=id');
    expect(requests[0]!.init.headers).toEqual({ Authorization: 'Bearer test-only-secret' });
    expect(requests[0]!.url).not.toContain('test-only-secret');
  });
  it('uses one items_batch, explicit no-upsert, exact decimal and data.id', async () => {
    const { client, requests } = fake(receipt);
    expect(await client.submit('123', [item])).toEqual({ ok: true, handle: 'handle-one', invalid: {}, warnings: {} });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://graph.facebook.com/v27.0/123/items_batch');
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ item_type: 'PRODUCT_ITEM', allow_upsert: false, requests: [item] });
  });
  it('no selected item means no call', async () => {
    const { client, requests } = fake(receipt);
    expect(await client.submit('123', [])).toEqual({ ok: false, reason: 'empty' });
    expect(requests).toHaveLength(0);
  });
  it('bounds selected rows and request bytes before any call', async () => {
    const { client, requests } = fake(receipt);
    expect(await client.submit('123', Array.from({ length: 3001 }, (_, i) => ({ ...item, data: { ...item.data, id: String(i) } })))).toEqual({ ok: false, reason: 'too_large' });
    expect(await client.submit('123', [{ ...item, data: { ...item.data, description: 'x'.repeat(28 * 1024 * 1024) } }])).toEqual({ ok: false, reason: 'too_large' });
    expect(requests).toHaveLength(0);
  });
  it('requests the complete invalid-id list before recognizing a finished batch', async () => {
    const { client, requests } = fake(finished);
    expect(await client.status('123', 'handle-one', ['item-one'])).toEqual({ ok: true, finished: true, invalid: {}, warnings: {} });
    const url = new URL(requests[0]!.url);
    expect(url.searchParams.get('load_ids_of_invalid_requests')).toBe('true');
    expect(url.searchParams.get('fields')).toBe('handle,status,warnings,errors_total_count,ids_of_invalid_requests');
    expect(url.searchParams.get('handle')).toBe('handle-one');
  });
  it('keeps validation errors attached only to submitted identities', async () => {
    const { client } = fake({ ...receipt, validation_status: [{ retailer_id: 'item-one', errors: [{ message: 'Description missing' }], warnings: [] }] });
    expect(await client.submit('123', [item])).toMatchObject({ ok: true, invalid: { 'item-one': 'Description missing' } });
  });
  it('keeps per-item diagnostics even when validation rejects the whole batch', async () => {
    const { client } = fake({ handles: [], validation_status: [{ retailer_id: 'item-one', errors: [{ message: 'Description missing' }], warnings: [{ message: 'test-only-secret is redacted' }] }] });
    expect(await client.submit('123', [item])).toEqual({ ok: false, reason: 'not_ingested', invalid: { 'item-one': 'Description missing' }, warnings: { 'item-one': '[redacted] is redacted' } });
  });
  it('partial terminal failures never mark a failed item successful', async () => {
    const { client } = fake({ data: [{ ...finished.data[0], errors_total_count: 2, ids_of_invalid_requests: ['item-one', 'item-one'] }] });
    expect(await client.status('123', 'handle-one', ['item-one', 'item-two'])).toMatchObject({ ok: true, finished: true, invalid: { 'item-one': expect.any(String) } });
  });
  it.each([
    { data: [{ ...finished.data[0], errors_total_count: 1 }] },
    { data: [{ ...finished.data[0], errors_total_count: 0, ids_of_invalid_requests: ['item-one'] }] },
    { data: [{ ...finished.data[0], errors_total_count: 1, ids_of_invalid_requests: ['foreign'] }] },
    { data: [{ ...finished.data[0], handle: 'different' }] }, {},
  ])('refuses incomplete or foreign status evidence %j', async response => {
    const { client } = fake(response);
    expect(await client.status('123', 'handle-one', ['item-one'])).toEqual({ ok: false, reason: 'unknown' });
  });
  it('a receipt without a handle is not success', async () => {
    expect(await fake({ handles: [], validation_status: [] }).client.submit('123', [item])).toEqual({ ok: false, reason: 'not_ingested' });
  });
  it.each([190, 200])('authentication/permission refusal never stores the provider body or token (%s)', async code => {
    const { client } = fake({ error: { code, message: 'test-only-secret raw provider details' } }, 400);
    expect(await client.submit('123', [item])).toEqual({ ok: false, reason: 'connection' });
  });
  it('a timeout is unknown, with no write retry and no raw error', async () => {
    let calls = 0;
    const client = catalogueClient({ token: 'test-only-secret', fetchImpl: async () => { calls++; throw Error('test-only-secret'); } });
    expect(await client.submit('123', [item])).toEqual({ ok: false, reason: 'unknown' });
    expect(calls).toBe(1);
  });
});
