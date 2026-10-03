import { usd } from '../../src/core/types/money.js';
import type { FactoryView } from '../../src/api/web/factory.js';
import type { ChannelView } from '../../src/api/web/channels.js';

/**
 * THE WARMTH RUN, phase 7 — a business as My business's menu and screens are
 * drawn from: one finished workspace (a connected WhatsApp, a channel answering
 * elsewhere, products priced, limits set, a menu's values read), and one on its
 * first day. Each test changes what it is about and nothing else.
 */
const whatsapp = (connected: boolean): ChannelView => ({
  kind: 'whatsapp', connected, status: connected ? 'connected' : 'not_connected',
  healthOk: connected, displayId: connected ? '+971 50 ••• 4444' : null,
  lastActivityAt: null, problem: null, activated: false,
});

export const SET_UP: FactoryView = {
  profile: {
    name: 'Yiwu Sunrise Housewares', description: 'Vacuum cups and kitchen goods since 2011.',
    location: 'Yiwu, Zhejiang', workingHours: 'Mon–Sat 9:00–18:00',
    contactEmail: 'sales@sunrise.example', contactPhone: null, languagesServed: ['en', 'zh'],
  },
  products: { total: 12, needPrice: 0, names: [{ name: 'Vacuum cup', nameZh: '保温杯' }] },
  promises: { certs: ['food_grade'], floorLow: usd(0.75), floorHigh: usd(0.75), ceilingPct: 8, ceilingVaries: false, askPct: 5, askVaries: false },
  connection: {
    channel: whatsapp(true), ownerPhone: '971500001111', country: 'CN', channelsUsed: ['whatsapp', 'instagram'],
    others: [{ channel: 'instagram', state: 'connected', as: '@sunrise' }, { channel: 'email', state: 'not_connected' }],
  },
  nextStep: null,
  readiness: { canActivate: true, blockers: [], lifecycle: 'ready', live: false, activatedAt: null, activatedBy: null,
    recipients: [{ phone: '971500001111', label: 'my phone' }], pilotMode: true },
  rehearsal: { findings: [], violations: [], probesRun: 26, productsChecked: 12, productsTotal: 12 },
  prices: { currency: 'USD', businessDefault: { floor: usd(0.35), maxDiscountPct: 10, askAbovePct: 7 }, products: [], unanswered: 0,
    volume: [{ id: 'v1', productId: null, productLabel: null, minQty: 10000, discountPct: 4, asksFirst: false }] },
  menu: {
    kind: 'manufacturer', howYouSell: { answered: 3, total: 8 }, terms: { incoterm: 'FOB', payment: '30% deposit, balance before shipping' },
    samples: { price: usd(0), waiting: 0 }, closure: { label: 'Spring Festival', from: new Date('2027-02-01T00:00:00Z'), to: new Date('2027-02-10T00:00:00Z') },
    rate: { from: 'USD', to: 'CNY', rate: 7.1, statedAt: new Date('2026-09-01T00:00:00Z') },
  },
};

export const FIRST_DAY: FactoryView = {
  profile: { name: '', description: null, location: null, workingHours: null, contactEmail: null, contactPhone: null, languagesServed: [] },
  products: { total: 0, needPrice: 0, names: [] },
  promises: { certs: [], floorLow: null, floorHigh: null, ceilingPct: null, ceilingVaries: false },
  connection: { channel: whatsapp(false), ownerPhone: null, country: null, channelsUsed: [], others: [] },
  nextStep: 'profile',
  readiness: { canActivate: false, blockers: ['no_channel', 'no_allowlist'], recipients: [], lifecycle: 'not_connected',
    live: false, activatedAt: null, activatedBy: null },
  rehearsal: { findings: [], violations: [], probesRun: 0, productsChecked: 0, productsTotal: 0 },
  prices: { businessDefault: null, products: [], unanswered: 0, volume: [], currency: 'USD' },
  menu: { kind: null, howYouSell: { answered: 0, total: 9 }, terms: null, samples: { price: null, waiting: 0 }, closure: null, rate: null },
};
