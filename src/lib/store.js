import { writable, derived } from 'svelte/store';
import { normaliseTasks, normaliseHistory } from './state.js';

const STORAGE_KEY = 'todox.tasks';
const HISTORY_KEY = 'todox.history';
const LEGACY_STORAGE_KEY = 'todoxTasks';
const LEGACY_HISTORY_KEY = 'todoxCompletedHistory';
const HISTORY_LIMIT = 750;

export const tasksStore = writable([]);
export const historyStore = writable([]);
export const activeTasksStore = derived(tasksStore, (tasks) => tasks.filter(t => !t.completed));
export const completedTasksStore = derived(tasksStore, (tasks) => tasks.filter(t => t.completed));
export const activeTaskStore = derived(tasksStore, (tasks) => tasks.find(t => t.runningSince));

export async function loadInitialState() {
  if (chrome?.storage?.sync) {
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get([
        STORAGE_KEY,
        HISTORY_KEY,
        LEGACY_STORAGE_KEY,
        LEGACY_HISTORY_KEY
      ], (result) => {
        if (chrome.runtime?.lastError) {
          console.warn('TodoX panel: sync load failed', chrome.runtime.lastError);
          resolve({});
          return;
        }
        resolve(result || {});
      });
    });
    const tasks = normaliseTasks(data[STORAGE_KEY] ?? data[LEGACY_STORAGE_KEY]);
    const history = normaliseHistory(data[HISTORY_KEY] ?? data[LEGACY_HISTORY_KEY]);
    tasksStore.set(tasks);
    historyStore.set(history);
    if (data[LEGACY_STORAGE_KEY] || data[LEGACY_HISTORY_KEY]) {
      persist();
      chrome.storage.sync.remove([LEGACY_STORAGE_KEY, LEGACY_HISTORY_KEY]);
    }
    return;
  }
  try {
    const tasksJson = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '[]';
    const historyJson = localStorage.getItem(HISTORY_KEY) ?? localStorage.getItem(LEGACY_HISTORY_KEY) ?? '[]';
    const tasks = normaliseTasks(JSON.parse(tasksJson));
    const history = normaliseHistory(JSON.parse(historyJson));
    tasksStore.set(tasks);
    historyStore.set(history);
    if (localStorage.getItem(LEGACY_STORAGE_KEY) || localStorage.getItem(LEGACY_HISTORY_KEY)) {
      persist();
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(LEGACY_HISTORY_KEY);
    }
  } catch (e) {
    console.error('TodoX panel: local load failed', e);
    tasksStore.set([]);
    historyStore.set([]);
  }
}

export async function persist() {
  let tasks;
  let history;
  tasksStore.subscribe(v => tasks = v)();
  historyStore.subscribe(v => history = v)();
  if (chrome?.storage?.sync) {
    await new Promise(resolve => {
      chrome.storage.sync.set({ [STORAGE_KEY]: tasks, [HISTORY_KEY]: history.slice(0, HISTORY_LIMIT) }, () => {
        if (chrome.runtime?.lastError) {
          console.warn('TodoX panel: sync save failed', chrome.runtime.lastError);
        }
        resolve();
      });
    });
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch (e) {
    console.error('TodoX panel: local save failed', e);
  }
}

export function subscribeExternalChanges() {
  if (!chrome?.storage?.sync) return () => {};
  const handler = (changes, area) => {
    if (area !== 'sync') return;
    if (changes[STORAGE_KEY] || changes[HISTORY_KEY]) {
      loadInitialState();
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
