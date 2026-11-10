import { isPositive, moneyFromRow } from '../types/money.js';

export const CATALOGUE_AVAILABILITY = ['in stock', 'out of stock', 'available for order', 'discontinued'] as const;
export const CATALOGUE_CONDITION = ['new', 'refurbished', 'used'] as const;
export type CatalogueProduct = {
  id: string; name: string; active: boolean; findable: boolean; amount: string | null;
  currency: string; workspaceCurrency: string; tiered: boolean; vetted: boolean;
  explicitlyVetted: boolean; pricesToOwner: boolean; practice: boolean;
  description: string; link: string; availability: string; brand: string; condition: string;
  imageId: string | null; imageVersion: string | null;
};
export type CatalogueMethod = 'CREATE' | 'UPDATE' | 'DELETE';
export type CatalogueRequest = { method: CatalogueMethod; data: Record<string, string> };
export function catalogueEligibility(p: CatalogueProduct): string[] {
  const reasons: string[] = [];
  const price = p.amount === null ? null : moneyFromRow(p.amount, p.currency);
  if (!p.active) reasons.push('inactive');
  if (!p.findable) reasons.push('not_findable');
  if (!price || !isPositive(price)) reasons.push('price');
  if (p.tiered) reasons.push('tiers');
  if (p.currency !== p.workspaceCurrency) reasons.push('currency');
  if (!p.vetted || !p.explicitlyVetted) reasons.push('not_vetted');
  if (p.pricesToOwner) reasons.push('prices_to_owner');
  if (p.practice) reasons.push('practice');
  if (!(CATALOGUE_AVAILABILITY as readonly string[]).includes(p.availability)) reasons.push('availability');
  if (!productLink(p.link)) reasons.push('link');
  if (!p.imageId || !p.imageVersion) reasons.push('image');
  if (!p.name.trim() || p.name.length > 150) reasons.push('name');
  if (!p.description.trim() || p.description.length > 5000) reasons.push('description');
  if (!p.brand.trim() || p.brand.length > 100) reasons.push('brand');
  if (!(CATALOGUE_CONDITION as readonly string[]).includes(p.condition)) reasons.push('condition');
  return reasons;
}

function productLink(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2000 && url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export function catalogueRequest(method: CatalogueMethod, id: string, p: CatalogueProduct, image: string): CatalogueRequest | null {
  if (method === 'DELETE') return { method, data: { id } };
  if (catalogueEligibility(p).length) return null;
  return { method, data: { id, title: p.name, description: p.description, link: p.link,
    availability: p.availability, brand: p.brand, condition: p.condition,
    price: `${p.amount} ${p.currency}`, image_link: image } };
}
