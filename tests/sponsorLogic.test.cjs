const test = require('node:test');
const assert = require('node:assert/strict');
// Updated to point to merged sponsors utilities after cleanup.
const {
  isActiveSponsor,
  selectWeightedSponsor,
  canShowUnderFrequency,
  recordImpression,
} = require('../extension/lib/sponsors.js');

class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) ?? null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  clear() {
    this.store.clear();
  }
}

test('isActiveSponsor respects date ranges', () => {
  const now = new Date('2025-01-01T12:00:00Z').getTime();
  assert.equal(isActiveSponsor({ activeFrom: '2024-12-01', activeTo: '2025-02-01' }, now), true);
  assert.equal(isActiveSponsor({ activeFrom: '2025-02-01' }, now), false);
  assert.equal(isActiveSponsor({ activeTo: '2024-12-31' }, now), false);
});

test('selectWeightedSponsor honours weight values', () => {
  const items = [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 3 },
  ];
  const picks = new Map();
  for (let i = 0; i < 1000; i += 1) {
    const choice = selectWeightedSponsor(items, () => Math.random());
    picks.set(choice.id, (picks.get(choice.id) || 0) + 1);
  }
  assert.ok(picks.get('b') > picks.get('a'));
});

test('frequency caps respect session and daily limits', () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  const config = { perSession: 1, perDay: 2 };
  const now = new Date('2025-01-01T08:00:00Z').getTime();
  assert.equal(canShowUnderFrequency(config, { session, local }, now), true);
  recordImpression(config, { session, local }, now);
  assert.equal(canShowUnderFrequency(config, { session, local }, now), false);
  const later = new Date('2025-01-01T12:00:00Z').getTime();
  assert.equal(canShowUnderFrequency(config, { session: new MemoryStorage(), local }, later), true);
  recordImpression(config, { session: new MemoryStorage(), local }, later);
  const nextDay = new Date('2025-01-02T08:00:00Z').getTime();
  assert.equal(canShowUnderFrequency(config, { session: new MemoryStorage(), local }, nextDay), true);
});
