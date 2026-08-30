import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { platformUserId, setPlatformUserId, isPlatform } from '../src/platform.js';

describe('platform state', () => {
  it('is unset until written, then round-trips', () => {
    const db = openDb(':memory:');
    expect(platformUserId(db)).toBeNull();
    expect(isPlatform(db, 5)).toBe(false);
    setPlatformUserId(db, 5);
    expect(platformUserId(db)).toBe(5);
    expect(isPlatform(db, 5)).toBe(true);
    expect(isPlatform(db, 6)).toBe(false);
  });

  it('setPlatformUserId is idempotent (upsert)', () => {
    const db = openDb(':memory:');
    setPlatformUserId(db, 5);
    setPlatformUserId(db, 7);
    expect(platformUserId(db)).toBe(7);
  });
});
