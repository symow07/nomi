import {describe,it,expect} from 'vitest';
import {settingsDestination,settingsGroup,settingsHref} from '../../src/api/web/settingsNavigation.js';
describe('Approved Settings destinations',()=>{
 it('moves exact legacy pages, preserves local context and leaves commands alone',()=>{
  expect(settingsDestination('/app/settings/profile')).toBe('/app/settings/business/profile');
  expect(settingsDestination('/app/settings/closures')).toBe('/app/settings/business/hours');
  expect(settingsDestination('/app/settings/people')).toBe('/app/settings/team');
  expect(settingsDestination('/app/settings/account/password')).toBeNull();
  expect(settingsDestination('/app/settings/business')).toBeNull();
  expect(settingsHref('/app/channels/alerts?from=channels#phone')).toBe('/app/settings/personal/notifications?from=channels#whatsapp');
  expect(settingsHref('/app/business/selling/product_claims/confirm?draft=kept')).toBe('/app/settings/business/selling/product-claims/confirm?draft=kept');
  expect(settingsHref('https://example.test/app/settings/profile')).toBe('https://example.test/app/settings/profile');
 });
 it('selects one group, including legacy POST refusals, without nested Books navigation',()=>{
  expect(settingsGroup('/app/settings/books/accounts')).toBe('books');
  expect(settingsGroup('/app/settings/personal/account')).toBe('personal');
  expect(settingsGroup('/app/settings/closures/invalid/restore')).toBe('business');
  expect(settingsGroup('/app/settings/people/assistants')).toBe('assistant');
  expect(settingsGroup('/app/assistant/knowledge')).toBeNull();
 });
});
