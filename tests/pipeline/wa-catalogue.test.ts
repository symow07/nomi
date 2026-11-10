import { describe, expect, it } from 'vitest';
import { catalogueEligibility, catalogueRequest, type CatalogueProduct } from '../../src/core/catalogue/whatsapp.js';

const product: CatalogueProduct = {
  id: 'product', name: 'Linen shirt', active: true, findable: true,
  amount: '24.50', currency: 'GBP', workspaceCurrency: 'GBP', tiered: false,
  vetted: true, explicitlyVetted: true, pricesToOwner: false, practice: false,
  description: 'A linen shirt', link: 'https://shop.example/shirt', availability: 'in stock',
  brand: 'The shop', condition: 'new', imageId: 'image', imageVersion: 'photo-version',
};

describe('The owner-selected WhatsApp catalogue', () => {
  it('keeps an exact single price and currency in the v27 PRODUCT_ITEM shape', () => {
    expect(catalogueEligibility(product)).toEqual([]);
    expect(catalogueRequest('CREATE', 'opaque-id', product, 'https://nomi.example/catalogue-media/opaque')).toEqual({
      method: 'CREATE', data: { id: 'opaque-id', title: 'Linen shirt', description: 'A linen shirt',
        link: 'https://shop.example/shirt', availability: 'in stock', brand: 'The shop', condition: 'new',
        price: '24.50 GBP', image_link: 'https://nomi.example/catalogue-media/opaque' },
    });
  });
  it.each([
    [{ active: false }, 'inactive'], [{ findable: false }, 'not_findable'],
    [{ amount: null }, 'price'], [{ amount: '0' }, 'price'], [{ amount: 'NaN' }, 'price'],
    [{ tiered: true }, 'tiers'], [{ currency: 'USD' }, 'currency'],
    [{ vetted: false }, 'not_vetted'], [{ explicitlyVetted: false }, 'not_vetted'],
    [{ pricesToOwner: true }, 'prices_to_owner'], [{ practice: true }, 'practice'],
    [{ availability: '' }, 'availability'], [{ availability: 'guessed' }, 'availability'],
    [{ link: '' }, 'link'], [{ link: 'javascript:alert(1)' }, 'link'], [{ link: 'https://secret@shop.example/' }, 'link'],
    [{ imageId: null }, 'image'], [{ imageVersion: null }, 'image'],
    [{ name: '' }, 'name'], [{ description: '' }, 'description'], [{ brand: '' }, 'brand'], [{ condition: '' }, 'condition'],
  ] as const)('refuses %j, with a named reason and no payload', (change, reason) => {
    const changed = { ...product, ...change };
    expect(catalogueEligibility(changed)).toContain(reason);
    expect(catalogueRequest('UPDATE', 'opaque-id', changed, 'https://nomi.example/photo')).toBeNull();
  });
  it('a removal carries only the stable identity, even after a product became ineligible', () => {
    expect(catalogueRequest('DELETE', 'opaque-id', { ...product, active: false }, '')).toEqual({ method: 'DELETE', data: { id: 'opaque-id' } });
  });
  it('reports all missing information together without inventing availability', () => {
    expect(catalogueEligibility({ ...product, availability: '', link: '', imageId: null }))
      .toEqual(['availability', 'link', 'image']);
  });
});
