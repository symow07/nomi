import {describe,it,expect} from 'vitest';
import {safeBooksReturn} from '../../src/api/web/booksNavigation.js';
describe('Books report return boundaries',()=>{
 it('retains scoped multi-account paging and row identity while dropping unrelated input',()=>{
  const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
  expect(safeBooksReturn(`/app/books/reports/cash?cash=${a}&cash=${b}&page=4&state=review&token=secret#entry-${a}`)).toBe(`/app/books/reports/cash?cash=${a}&cash=${b}&page=4&state=review#entry-${a}`);
 });
 it('rejects external, protocol-relative, backslash-host and command destinations',()=>{
  for(const bad of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/app/books/invoices/secret/issue','/app/settings/books/accounts',undefined])expect(safeBooksReturn(bad)).toBeNull();
  expect(safeBooksReturn('/app/books/reports/suppliers/entries#line-11111111-1111-1111-1111-111111111111')).toBe('/app/books/reports/suppliers/entries#line-11111111-1111-1111-1111-111111111111');
  expect(safeBooksReturn('/app/books/bank?account=invalid&page=1.2&state=unknown#bad')).toBe('/app/books/bank');
 });
});
