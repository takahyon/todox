const test = require('node:test');
const assert = require('node:assert/strict');
const { FocusToggleStore } = require('../extension/focusToggle.js');

function createMockStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test('cycle transitions follow expected sequence', () => {
  const storage = createMockStorage();
  const store = new FocusToggleStore({
    storage,
    config: { shortcutEnabled: false, defaultMinutes: 12, defaultMode: 'soft' },
  });
  store.cycle();
  assert.equal(store.state.mode, 'soft');
  assert.equal(store.state.remainingMinutes, 12);
  store.cycle();
  assert.equal(store.state.mode, 'kichiku');
  store.cycle();
  assert.equal(store.state.mode, 'off');
});

test('toggle resumes last mode with stored duration', () => {
  const storage = createMockStorage();
  const store = new FocusToggleStore({
    storage,
    config: { shortcutEnabled: false, defaultMinutes: 10, defaultMode: 'soft' },
  });
  store.start('kichiku', 22);
  assert.equal(store.state.mode, 'kichiku');
  assert.equal(store.state.remainingMinutes, 22);
  store.stop();
  store.toggle();
  assert.equal(store.state.mode, 'kichiku');
  assert.equal(store.state.remainingMinutes, 22);
  store.stop();
});

test('preferences persist fab visibility and bgm track', () => {
  const storage = createMockStorage();
  const store = new FocusToggleStore({ storage, config: { shortcutEnabled: false } });
  store.setFabVisible(true);
  store.setBgmTrack('cafe');
  const raw = storage.getItem('todox.focus.preferences');
  assert.ok(raw, 'preferences should be stored');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.fabEnabled, true);
  assert.equal(parsed.bgmTrack, 'cafe');
});

test('restore preferences loads last selection', () => {
  const storage = createMockStorage();
  storage.setItem(
    'todox.focus.preferences',
    JSON.stringify({
      lastMode: 'kichiku',
      preferredDurations: { soft: 9, kichiku: 28 },
      fabEnabled: true,
      bgmTrack: 'white',
    }),
  );
  const store = new FocusToggleStore({ storage, config: { shortcutEnabled: false } });
  assert.equal(store.lastMode, 'kichiku');
  assert.equal(store.getBgmTrack(), 'white');
  assert.equal(store.isFabVisible(), true);
  store.toggle();
  assert.equal(store.state.mode, 'kichiku');
  assert.equal(store.state.remainingMinutes, 28);
  store.stop();
});

test('default mode respects off configuration', () => {
  const storage = createMockStorage();
  const store = new FocusToggleStore({
    storage,
    config: { shortcutEnabled: false, defaultMinutes: 14, defaultMode: 'off' },
  });
  assert.equal(store.state.mode, 'off');
  store.toggle();
  assert.equal(store.state.mode, 'soft');
  assert.equal(store.state.remainingMinutes, 14);
  store.stop();
});
