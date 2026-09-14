import { afterEach, expect, it, vi } from 'vitest';
import { adminDestination } from '../src/shared/adminSite.ts';
afterEach(() => vi.unstubAllGlobals());
it('preserves tournament administration after login on both hosts without external redirects', () => {
  vi.stubGlobal('window', { location: { hostname: 'admin.4amcasino.com', search: '' } });
  expect(adminDestination('?next=%2Ftournaments')).toBe('/tournaments');
  expect(adminDestination('?next=%2F%2Fevil.example')).toBe('/');
  vi.stubGlobal('window', { location: { hostname: '4amcasino.com', search: '' } });
  expect(adminDestination('?next=%2Fadmin%2Ftournaments')).toBe('/admin/tournaments');
  expect(adminDestination('?next=https%3A%2F%2Fevil.example')).toBe('/admin');
});
