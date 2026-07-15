/**
 * Nominal typing. `string` is not a `BusinessId`.
 *
 * In a system where business_id IS the tenant boundary (ADR-0005), passing the
 * wrong id is a security bug, not a typo. Branding makes it a compile error.
 */
declare const BRAND: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BRAND]: B };

/** Escape hatch. Only for parsers and the DB layer — never in core logic. */
export const unsafeBrand = <B extends string>() => <T>(value: T): Brand<T, B> =>
  value as Brand<T, B>;
