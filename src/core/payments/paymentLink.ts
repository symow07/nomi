import { compareDecimal, decimal, divDecimal, fromInteger, mulDecimal, signOf, subDecimal, type Decimal } from '../types/decimal.js';

/** This first payment-link release accepts the supported charts and two-decimal currencies only. */
export function minorAmount(value: unknown): Decimal | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? divDecimal(fromInteger(value), decimal('100'), 2) : null;
}
export function minorUnits(value: Decimal): string | null {
  const units = mulDecimal(value, decimal('100'));
  return signOf(value) > 0 && /^\d+$/.test(units) && compareDecimal(units, decimal('99999999')) <= 0 ? units : null;
}

export type LinkRefusal = 'country' | 'practice' | 'disconnected' | 'account_country' | 'not_ready' | 'not_issued' | 'nothing_due' | 'currency' | 'amount';
export function linkRefusal(i: { country: string; accountCountry: string; ready: boolean; connected: boolean; invoiceState: string; owed: Decimal; currency: string; accountCurrency: string; practice: boolean }): LinkRefusal | null {
  if (!['GB', 'US'].includes(i.country)) return 'country';
  if (i.practice) return 'practice';
  if (!i.connected) return 'disconnected';
  if (i.accountCountry !== i.country) return 'account_country';
  if (!i.ready) return 'not_ready';
  if (i.invoiceState !== 'issued') return 'not_issued';
  if (signOf(i.owed) <= 0) return 'nothing_due';
  if (i.currency !== i.accountCurrency) return 'currency';
  return minorUnits(i.owed) === null ? 'amount' : null;
}

export type ConnectedAccount = { readonly id: string; readonly country: string; readonly currency: string; readonly ready: boolean };
export type Checkout = { readonly id: string; readonly url: string | null; readonly status: 'open' | 'complete' | 'expired'; readonly paid: boolean; readonly amount: Decimal; readonly currency: string; readonly intentId: string | null; readonly expiresAt: number; readonly attemptId: string | null };
export type BalanceFact = { readonly id: string; readonly gross: Decimal; readonly fee: Decimal; readonly net: Decimal; readonly currency: string; readonly created: number };
export type ChargeFact = { readonly id: string; readonly paid: boolean; readonly captured: boolean; readonly amount: Decimal; readonly currency: string; readonly created: number; readonly balance: BalanceFact | null };
export type IntentFact = { readonly id: string; readonly attemptId: string | null; readonly succeeded: boolean; readonly charge: ChargeFact | null };
export type RefundFact = { readonly id: string; readonly intentId: string | null; readonly status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action'; readonly amount: Decimal; readonly currency: string; readonly created: number; readonly balance: BalanceFact | null };
export type PayoutFact = { readonly id: string; readonly status: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled'; readonly amount: Decimal; readonly currency: string; readonly created: number; readonly arrival: number; readonly balance: BalanceFact | null };
export type ConnectEvent = { readonly id: string; readonly type: string; readonly account: string; readonly live: boolean; readonly created: number; readonly objectId: string; readonly intentId: string | null };

/** An invalid or unreadable fee remains unknown; no guessed zero reaches the books. */
export function balanceTies(gross: Decimal, fee: Decimal, net: Decimal): boolean {
  return signOf(fee) >= 0 && compareDecimal(subDecimal(gross, fee), net) === 0;
}

/** An owner's explicit send, never an assistant sentence or a delivery receipt. */
export function paymentLinkText(invoice: string, amount: Decimal, currency: string, url: string): string {
  return `Invoice ${invoice}: ${amount} ${currency}. You can pay here: ${url}`;
}
