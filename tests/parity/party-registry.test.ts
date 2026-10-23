import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRegistry, sirenLooksRight, nifLooksRight, registryLabelKey, type RegistryInput } from '../../src/core/books/registry.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * R3 (Phase 5; 0210; the owner, 2026-10-23) — a party's company registry number, country by country: the shape each
 * authority publishes is refused when wrong; a checksum no authority publishes only warns; across fields, a French
 * VAT number ends with the SIREN and a Spanish one is ES + the NIF; nothing is derived; a missing VAT number is fine.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const check = (o: Partial<RegistryInput> & { country: string | null }) =>
  checkRegistry({ registry: '', siret: '', registro: '', taxNumber: '', ...o });

describe('R3 · France: the SIREN, and the SIRET beside it', () => {
  it('nine digits, spaces as typed taken out; anything else refused', () => {
    expect(check({ country: 'FR', registry: '732 829 320' })).toEqual({ ok: true, value: { registry: '732829320', siret: null, registro: null }, warnings: [] });
    for (const bad of ['73282932', '7328293201', '73282932A']) expect(check({ country: 'FR', registry: bad }), bad).toEqual({ ok: false, errors: ['registry_shape'] });
  });

  it('the Luhn sum is NOT published by INSEE: a SIREN that fails it is kept, with a warning to confirm', () => {
    expect(sirenLooksRight('732829320')).toBe(true);
    expect(sirenLooksRight('123456789')).toBe(false);
    expect(check({ country: 'FR', registry: '123456789' })).toEqual({ ok: true, value: { registry: '123456789', siret: null, registro: null }, warnings: ['siren_check'] });
  });

  it('a SIRET is optional, fourteen digits, French, and begins with the SIREN', () => {
    expect(check({ country: 'FR', registry: '732829320', siret: '732 829 320 00074' }))
      .toMatchObject({ ok: true, value: { registry: '732829320', siret: '73282932000074' } });
    expect(check({ country: 'FR', registry: '732829320', siret: '55210055400013' })).toEqual({ ok: false, errors: ['siret_not_siren'] });
    expect(check({ country: 'FR', registry: '732829320', siret: '7328293200007' })).toEqual({ ok: false, errors: ['siret_shape'] });
    expect(check({ country: 'ES', registry: 'B12345674', siret: '73282932000074' })).toEqual({ ok: false, errors: ['siret_not_fr'] });
  });

  it('a French VAT number present ends with the SIREN; none at all is never wrong; no VAT key is computed', () => {
    expect(check({ country: 'FR', registry: '732829320', taxNumber: 'FR 44 732829320' }).ok).toBe(true);
    expect(check({ country: 'FR', registry: '732829320', taxNumber: 'FR44552100554' })).toEqual({ ok: false, errors: ['vat_not_siren'] });
    const none = check({ country: 'FR', registry: '732829320' });
    expect(none.ok && none.value).toEqual({ registry: '732829320', siret: null, registro: null });
  });
});

describe('R3 · Spain: the NIF, and the Registro Mercantil entry', () => {
  it('ALL THREE FORMS pass silently: a company\'s, a person\'s (an autónomo invoices under it), a foreign resident\'s NIE', () => {
    expect(check({ country: 'ES', registry: 'b12345674' })).toEqual({ ok: true, value: { registry: 'B12345674', siret: null, registro: null }, warnings: [] });
    expect(check({ country: 'ES', registry: '12345678Z' })).toMatchObject({ ok: true, warnings: [] });
    expect(check({ country: 'ES', registry: 'x1234567l' })).toMatchObject({ ok: true, value: { registry: 'X1234567L' }, warnings: [] });
  });

  it('any other nine capitals and digits are KEPT with a warning, never refused (a reform must not refuse a customer)', () => {
    for (const odd of ['K1234567A', 'B12C4567D', '1234567AB', 'ZZZZZZZZZ']) {
      const r = check({ country: 'ES', registry: odd });
      expect(r.ok, odd).toBe(true);
      expect(r.ok && r.warnings, odd).toContain('nif_shape');
    }
    for (const bad of ['B1234567', 'B123456745', 'B-1234567']) expect(check({ country: 'ES', registry: bad }), bad).toEqual({ ok: false, errors: ['registry_shape'] });
  });

  it('the control character is NOT published by AEAT: a wrong one is kept, with a warning; nothing is "fixed"', () => {
    expect(nifLooksRight('B12345674')).toBe(true);
    expect(nifLooksRight('Q2826000H')).toBe(true);
    expect(nifLooksRight('B12345678')).toBe(false);
    expect(nifLooksRight('12345678Z')).toBeNull();    // not the entity form: nothing is said of it
    expect(check({ country: 'ES', registry: 'B12345678' })).toEqual({ ok: true, value: { registry: 'B12345678', siret: null, registro: null }, warnings: ['nif_check'] });
  });

  it('a Spanish VAT number present is ES + the NIF; the Registro Mercantil entry is free text, Spanish only', () => {
    expect(check({ country: 'ES', registry: 'B12345674', taxNumber: 'ES B12345674' }).ok).toBe(true);
    expect(check({ country: 'ES', registry: 'B12345674', taxNumber: 'ESA58818501' })).toEqual({ ok: false, errors: ['vat_not_nif'] });
    expect(check({ country: 'ES', registry: 'B12345674', registro: 'Registro Mercantil de Madrid, Tomo 1234, Folio 56, Hoja M-78901' }))
      .toMatchObject({ ok: true, value: { registro: 'Registro Mercantil de Madrid, Tomo 1234, Folio 56, Hoja M-78901' } });
    expect(check({ country: 'FR', registry: '732829320', registro: 'Tomo 1' })).toEqual({ ok: false, errors: ['registro_not_es'] });
  });

  it('labelled NIF, never CIF (repealed by RD 1065/2007); "CIF" only as a hint', () => {
    expect(t('en', registryLabelKey('ES'))).toBe('NIF');
    for (const l of ['en', 'zh', 'ar', 'es', 'fr'] as const) {
      expect(t(l, 'books.party.registry.es'), l).toBe('NIF');
      expect(t(l, 'books.party.registryHelp'), l).toContain('CIF');
    }
  });
});

describe('R3 · the United Kingdom: the company number, and no checksum', () => {
  it('eight digits, or two capitals and six digits — any two capitals; a short number is zero-padded', () => {
    expect(check({ country: 'GB', registry: '1234567' })).toMatchObject({ ok: true, value: { registry: '01234567' } });
    for (const ok of ['SC123456', 'NI123456', 'FE000123', 'OE012345', 'PC000123', 'SG000123', 'zz123456']) {
      expect(check({ country: 'GB', registry: ok }).ok, ok).toBe(true);
    }
    for (const bad of ['123456789', 'S1234567', 'SCX12345']) expect(check({ country: 'GB', registry: bad }), bad).toEqual({ ok: false, errors: ['registry_shape'] });
  });

  it('nothing ties a UK VAT number to the company number, and nothing warns', () => {
    expect(check({ country: 'GB', registry: '01234567', taxNumber: 'GB 123 4567 89' })).toEqual({ ok: true, value: { registry: '01234567', siret: null, registro: null }, warnings: [] });
  });
});

describe('R3 · elsewhere, and the database', () => {
  it('another country\'s number is kept as typed: no rule because no source', () => {
    expect(check({ country: 'DE', registry: 'HRB 12345 B' })).toEqual({ ok: true, value: { registry: 'HRB 12345 B', siret: null, registro: null }, warnings: [] });
    expect(check({ country: null, registry: 'x'.repeat(41) })).toEqual({ ok: false, errors: ['registry_long'] });
  });

  it('the database holds the hard rules, no checksum, and copies the three onto an invoice and a credit note at issue', () => {
    const m = readFileSync(`${ROOT}migrations/0210_party_registry.sql`, 'utf8');
    expect(m).toContain("country is distinct from 'FR' or registry_number ~ '^[0-9]{9}$'");
    expect(m).toContain("country is distinct from 'GB' or registry_number ~ '^([0-9]{8}|[A-Z]{2}[0-9]{6})$'");
    expect(m).toContain("left(siret, 9) = registry_number");
    expect(m).toContain("'ES' || registry_number");
    expect(m).not.toMatch(/luhn|mod 10|% 10/i);
    expect(m).toContain('new.party_registry_number := p.registry_number; new.party_siret := p.siret; new.party_registro_mercantil := p.registro_mercantil;');
    expect(m).toContain('new.party_registry_number := i.party_registry_number; new.party_siret := i.party_siret; new.party_registro_mercantil := i.party_registro_mercantil;');
  });
});
