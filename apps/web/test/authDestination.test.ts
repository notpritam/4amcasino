import { expect, it } from 'vitest';
import { authDestination } from '../src/shared/authDestination.ts';
it('retains tournament invitations across sign-in without enabling external redirects', () => {
  expect(authDestination('?next=%2Ftournaments%2Fabc_123')).toBe('/tournaments/abc_123');
  expect(authDestination('?next=%2Fagents')).toBe('/agents');
  for (const next of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/tournaments/../admin',
    '/tournaments/a?next=evil',
    '/api/me',
  ]) {
    expect(authDestination(`?next=${encodeURIComponent(next)}`)).toBeNull();
  }
});
