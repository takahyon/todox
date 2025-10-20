const TodoxState = typeof window !== 'undefined' ? window.TodoxState : null;
const STORAGE_KEY = TodoxState?.STORAGE_KEY ?? 'todox.tasks';
const HISTORY_KEY = TodoxState?.HISTORY_KEY ?? 'todox.history';
const LEGACY_STORAGE_KEY = TodoxState?.LEGACY_STORAGE_KEY ?? 'todoxTasks';
const LEGACY_HISTORY_KEY = TodoxState?.LEGACY_HISTORY_KEY ?? 'todoxCompletedHistory';
const normaliseTasksFn = (raw) => {
  if (TodoxState?.normaliseTasks) {
    const now = Date.now();
    const fallback = TodoxState.createDefaultTasks ? TodoxState.createDefaultTasks(now) : undefined;
    return TodoxState.normaliseTasks(raw, { now, fallbackTasks: fallback });
  }
  const now = Date.now();
  const fallbackTasks = [
    '今日のTODOを決める',
    '最優先タスクに30分集中',
    '受信トレイを整理',
    'チームに進捗を共有',
  ].map((text, index) => ({
    id: `fallback-${index}`,
    text,
    createdAt: now + index,
    completed: false,
    elapsedMs: 0,
  }));
  const source = Array.isArray(raw) ? raw : fallbackTasks;
  return source
    .map((task, index) => ({
      id: typeof task?.id === 'string' ? task.id : `task-${now}-${index}`,
      text: String(task?.text ?? '').trim(),
      createdAt: typeof task?.createdAt === 'number' ? task.createdAt : now,
      completedAt: typeof task?.completedAt === 'number' ? task.completedAt : undefined,
      elapsedMs: typeof task?.elapsedMs === 'number' ? task.elapsedMs : 0,
      completed: Boolean(task?.completed),
      runningSince: typeof task?.runningSince === 'number' ? task.runningSince : undefined,
    }))
    .filter((task) => task.text.length > 0);
};
const normaliseHistoryFn = (raw) => {
  if (TodoxState?.normaliseHistory) {
    const now = Date.now();
    return TodoxState.normaliseHistory(raw, { now, limit: Number.POSITIVE_INFINITY, sortByCompletedAt: true });
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const now = Date.now();
  return raw
    .map((entry, index) => ({
      id: typeof entry?.id === 'string' ? entry.id : `history-${now}-${index}`,
      text: String(entry?.text ?? '').trim(),
      createdAt: typeof entry?.createdAt === 'number' ? entry.createdAt : now,
      completedAt: typeof entry?.completedAt === 'number' ? entry.completedAt : now,
      elapsedMs: typeof entry?.elapsedMs === 'number' ? entry.elapsedMs : 0,
    }))
    .filter((entry) => entry.text.length > 0)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
};
const computeFocusAnalyticsFn = TodoxState?.computeFocusAnalytics ?? ((history, now = Date.now()) => {
  const summary = { todayMs: 0, weekMs: 0, totalMs: 0 };
  if (!Array.isArray(history) || history.length === 0) {
    return summary;
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  const startOfWeekDate = new Date(startOfToday);
  startOfWeekDate.setDate(startOfWeekDate.getDate() - 6);
  const startOfWeek = startOfWeekDate.getTime();

  history.forEach((entry) => {
    const completedAt = typeof entry?.completedAt === 'number' ? entry.completedAt : 0;
    const elapsedMs = typeof entry?.elapsedMs === 'number' ? entry.elapsedMs : 0;
    summary.totalMs += elapsedMs;
    if (completedAt >= startOfToday) {
      summary.todayMs += elapsedMs;
    }
    if (completedAt >= startOfWeek) {
      summary.weekMs += elapsedMs;
    }
  });

  return summary;
});

const BRANDING =
  typeof window !== 'undefined' && window.TODOX_BRANDING
    ? window.TODOX_BRANDING
    : {
      developerName: 'あいづたか@TakaAizu',
      developerUrl: 'https://x.com/TakaAizu',
      promoHtml: '<a href="https://x.com/TakaAizu/status/1976588524997550265">新アルバムをM3にて発売予定！</a>',
    };

const focusSummaryEl = document.getElementById('focusSummary');
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');
const tasksListEl = document.getElementById('tasksList');
const tasksEmptyEl = document.getElementById('tasksEmpty');
const exportButton = document.getElementById('exportButton');
const developerLink = document.getElementById('historyDeveloper');
const promoEl = document.getElementById('historyPromo');

const state = {
  tasks: [],
  history: [],
};

init();

function init() {
  applyBranding();
  exportButton?.addEventListener('click', handleExport);
  loadState().then(() => {
    render();
    attachStorageListener();
  });
}

function applyBranding() {
  if (developerLink) {
    developerLink.href = BRANDING.developerUrl;
    developerLink.textContent = BRANDING.developerName;
  }
  if (promoEl) {
    if (BRANDING.promoHtml) {
      promoEl.innerHTML = BRANDING.promoHtml;
      promoEl.hidden = false;
    } else {
      promoEl.hidden = true;
    }
  }
}

function attachStorageListener() {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
    return;
  }
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener('beforeunload', () => {
    chrome.storage.onChanged.removeListener(handleStorageChange);
  }, { once: true });
}

async function handleStorageChange(changes, area) {
  if (area !== 'sync') {
    return;
  }
  if (changes[STORAGE_KEY] || changes[HISTORY_KEY]) {
    const { tasks, history } = await loadState();
    state.tasks = tasks;
    state.history = history;
    render();
  }
}

async function loadState() {
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(
        [STORAGE_KEY, HISTORY_KEY, LEGACY_STORAGE_KEY, LEGACY_HISTORY_KEY],
        (result) => {
          if (chrome.runtime?.lastError) {
            console.error('TodoX history: failed to load', chrome.runtime.lastError);
            resolve({});
            return;
          }
          resolve(result);
        }
      );
    });
    const usedLegacyTasks =
      data[STORAGE_KEY] === undefined && Object.prototype.hasOwnProperty.call(data, LEGACY_STORAGE_KEY);
    const usedLegacyHistory =
      data[HISTORY_KEY] === undefined && Object.prototype.hasOwnProperty.call(data, LEGACY_HISTORY_KEY);
    const tasks = normaliseTasksFn(data[STORAGE_KEY] ?? data[LEGACY_STORAGE_KEY]);
    const history = normaliseHistoryFn(data[HISTORY_KEY] ?? data[LEGACY_HISTORY_KEY]);
    state.tasks = tasks;
    state.history = history;
    if (usedLegacyTasks || usedLegacyHistory) {
      await new Promise((resolve) => {
        chrome.storage.sync.set({ [STORAGE_KEY]: tasks, [HISTORY_KEY]: history }, () => resolve());
      });
      chrome.storage.sync.remove([LEGACY_STORAGE_KEY, LEGACY_HISTORY_KEY]);
    }
    return { tasks, history };
  }

  try {
    const tasksJson =
      window.localStorage?.getItem(STORAGE_KEY) ?? window.localStorage?.getItem(LEGACY_STORAGE_KEY) ?? '[]';
    const historyJson =
      window.localStorage?.getItem(HISTORY_KEY) ?? window.localStorage?.getItem(LEGACY_HISTORY_KEY) ?? '[]';
    const tasks = normaliseTasksFn(JSON.parse(tasksJson));
    const history = normaliseHistoryFn(JSON.parse(historyJson));
    state.tasks = tasks;
    state.history = history;
    const usedLegacyLocal =
      (!window.localStorage?.getItem(STORAGE_KEY) && window.localStorage?.getItem(LEGACY_STORAGE_KEY)) ||
      (!window.localStorage?.getItem(HISTORY_KEY) && window.localStorage?.getItem(LEGACY_HISTORY_KEY));
    if (usedLegacyLocal) {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(tasks));
      window.localStorage?.setItem(HISTORY_KEY, JSON.stringify(history));
      window.localStorage?.removeItem(LEGACY_STORAGE_KEY);
      window.localStorage?.removeItem(LEGACY_HISTORY_KEY);
    }
    return { tasks, history };
  } catch (error) {
    console.error('TodoX history: failed to read local data', error);
    state.tasks = [];
    state.history = [];
    return { tasks: [], history: [] };
  }
}

function render() {
  renderSummary();
  renderHistory();
  renderCurrentTasks();
}

function renderSummary() {
  const todayStart = startOfToday();
  const todayHistory = state.history.filter((item) => (item.completedAt ?? 0) >= todayStart);
  const analytics = computeFocusAnalyticsFn(state.history);
  const todayFocus = analytics.todayMs;
  const totalFocus = analytics.totalMs;
  const active = state.tasks.find((task) => task.runningSince);
  const upcoming = state.tasks.filter((task) => !task.completed);

  const parts = [];
  parts.push(`<span><strong>${todayHistory.length}</strong> 件完了 (本日)</span>`);
  parts.push(`<span>今日のフォーカス <strong>${formatDuration(todayFocus)}</strong></span>`);
  parts.push(`<span>累計フォーカス <strong>${formatDuration(totalFocus)}</strong></span>`);
  if (active) {
    parts.push(`<span>フォーカス中: <span class="todox-summary-pill">${escapeHtml(active.text)}</span></span>`);
  } else if (upcoming.length > 0) {
    parts.push(`<span>次のタスク: <span class="todox-summary-pill">${escapeHtml(upcoming[0].text)}</span></span>`);
  }

  focusSummaryEl.innerHTML = parts.join('');
}

function renderHistory() {
  historyListEl.innerHTML = '';
  if (state.history.length === 0) {
    historyEmptyEl.hidden = false;
    return;
  }
  historyEmptyEl.hidden = true;

  state.history.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'todox-history__item';

    const title = document.createElement('h3');
    title.className = 'todox-history__item-title';
    title.textContent = entry.text;

    const meta = document.createElement('p');
    meta.className = 'todox-history__item-meta';
    meta.innerHTML = `
      <span>完了 ${formatDateTime(entry.completedAt)}</span>
      <span>集中 ${formatDuration(entry.elapsedMs)}</span>
      <span>作成 ${formatDateTime(entry.createdAt)}</span>
    `;

    item.appendChild(title);
    item.appendChild(meta);
    historyListEl.appendChild(item);
  });
}

function renderCurrentTasks() {
  tasksListEl.innerHTML = '';
  const current = state.tasks.filter((task) => !task.completed);
  if (current.length === 0) {
    tasksEmptyEl.hidden = false;
    return;
  }
  tasksEmptyEl.hidden = true;

  current.forEach((task) => {
    const item = document.createElement('li');
    item.className = 'todox-history__task';
    item.innerHTML = `
      <span class="todox-history__task-title">${escapeHtml(task.text)}</span>
      <span class="todox-history__task-meta">作成 ${formatDateTime(task.createdAt)}</span>
    `;
    tasksListEl.appendChild(item);
  });
}

function handleExport() {
  const payload = {
    generatedAt: new Date().toISOString(),
    tasks: state.tasks,
    history: state.history,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `todox-history-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(String(hours).padStart(2, '0'));
  }
  parts.push(String(minutes).padStart(2, '0'));
  parts.push(String(seconds).padStart(2, '0'));
  return parts.join(':');
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
