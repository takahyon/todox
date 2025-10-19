const STORAGE_KEY = "todoxTasks";
const STORAGE_HISTORY_KEY = "todoxCompletedHistory";

const focusSummaryEl = document.getElementById("focusSummary");
const historyListEl = document.getElementById("historyList");
const historyEmptyEl = document.getElementById("historyEmpty");
const tasksListEl = document.getElementById("tasksList");
const tasksEmptyEl = document.getElementById("tasksEmpty");
const exportButton = document.getElementById("exportButton");

const state = {
  tasks: [],
  history: []
};
let refreshInterval;
let detachStorageListener;

init();

function init() {
  exportButton.addEventListener("click", handleExport);
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleStorageChange);
    detachStorageListener = () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
    window.addEventListener("beforeunload", () => {
      if (detachStorageListener) {
        detachStorageListener();
        detachStorageListener = undefined;
      }
    }, { once: true });
  }
  loadState().then(() => {
    renderFocusSummary();
    renderHistory();
    renderCurrentTasks();
    ensureLiveUpdates();
  });
}

function loadState() {
  return new Promise((resolve) => {
    const fromChromeStorage = !!(typeof chrome !== "undefined" && chrome.storage?.sync);

    const handleResult = (storedTasks, storedHistory) => {
      state.tasks = normaliseTasks(storedTasks);
      state.history = normaliseHistory(storedHistory);
      resolve();
    };

    if (fromChromeStorage) {
      chrome.storage.sync.get([STORAGE_KEY, STORAGE_HISTORY_KEY], (result) => {
        if (chrome.runtime?.lastError) {
          console.error("TodoX failed to load history", chrome.runtime.lastError);
          handleResult([], []);
          return;
        }
        handleResult(result[STORAGE_KEY], result[STORAGE_HISTORY_KEY]);
      });
      return;
    }

    try {
      const storedTasks = window.localStorage?.getItem(STORAGE_KEY);
      const storedHistory = window.localStorage?.getItem(STORAGE_HISTORY_KEY);
      handleResult(
        storedTasks === null ? [] : JSON.parse(storedTasks),
        storedHistory === null ? [] : JSON.parse(storedHistory)
      );
    } catch (error) {
      console.error("TodoX failed to read local history", error);
      handleResult([], []);
    }
  });
}

function normaliseTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) {
    return [];
  }
  const now = Date.now();
  return rawTasks.map((task, index) => ({
    id: task?.id || `task-${now}-${index}`,
    text: String(task?.text || "").trim(),
    completed: Boolean(task?.completed),
    createdAt: typeof task?.createdAt === "number" ? task.createdAt : now,
    completedAt: typeof task?.completedAt === "number" ? task.completedAt : undefined,
    elapsedMs: typeof task?.elapsedMs === "number" ? task.elapsedMs : 0,
    runningSince: typeof task?.runningSince === "number" ? task.runningSince : undefined
  })).filter((task) => task.text.length > 0);
}

function normaliseHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  const now = Date.now();
  return rawHistory.map((entry, index) => ({
    id: entry?.id || `history-${now}-${index}`,
    text: String(entry?.text || "").trim(),
    createdAt: typeof entry?.createdAt === "number" ? entry.createdAt : now,
    completedAt: typeof entry?.completedAt === "number" ? entry.completedAt : now,
    elapsedMs: typeof entry?.elapsedMs === "number" ? entry.elapsedMs : 0
  })).filter((entry) => entry.text.length > 0)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

function renderFocusSummary() {
  const todayStart = startOfToday();
  const todayCompleted = state.history.filter((item) => (item.completedAt ?? 0) >= todayStart);
  const todayFocus = sumElapsed(todayCompleted);
  const totalFocus = sumElapsed(state.history);
  const activeTask = state.tasks.find((task) => task.runningSince);
  const upcomingTasks = state.tasks.filter((task) => !task.completed);

  const summaryParts = [];
  summaryParts.push(`<strong>${todayCompleted.length} 件</strong>のタスクを本日完了`);
  summaryParts.push(`今日のフォーカスタイム <strong>${formatDuration(todayFocus)}</strong>`);
  summaryParts.push(`累計フォーカスタイム <strong>${formatDuration(totalFocus)}</strong>`);

  if (activeTask) {
    summaryParts.push(`現在フォーカス中: <span class="todox-summary-pill">${escapeHtml(activeTask.text)}</span>`);
  } else if (upcomingTasks.length > 0) {
    summaryParts.push(`次に控えているタスク: <span class="todox-summary-pill">${escapeHtml(upcomingTasks[0].text)}</span>`);
  }

  focusSummaryEl.innerHTML = summaryParts.map((part) => `<span>${part}</span>`).join("");
}

function renderHistory() {
  historyListEl.innerHTML = "";
  if (state.history.length === 0) {
    historyEmptyEl.hidden = false;
    return;
  }

  historyEmptyEl.hidden = true;

  state.history.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "todox-history__item";

    const title = document.createElement("h3");
    title.className = "todox-history__item-title";
    title.textContent = entry.text;

    const meta = document.createElement("p");
    meta.className = "todox-history__item-meta";

    const completedSpan = document.createElement("span");
    completedSpan.textContent = `完了 ${formatDateTime(entry.completedAt)}`;

    const durationSpan = document.createElement("span");
    durationSpan.textContent = `集中 ${formatDuration(entry.elapsedMs)}`;

    const createdSpan = document.createElement("span");
    createdSpan.textContent = `作成 ${formatDateTime(entry.createdAt)}`;

    meta.appendChild(completedSpan);
    meta.appendChild(durationSpan);
    meta.appendChild(createdSpan);

    item.appendChild(title);
    item.appendChild(meta);

    historyListEl.appendChild(item);
  });
}

function renderCurrentTasks() {
  tasksListEl.innerHTML = "";
  const activeTasks = state.tasks.filter((task) => !task.completed);

  if (activeTasks.length === 0) {
    tasksEmptyEl.hidden = false;
    return;
  }
  tasksEmptyEl.hidden = true;

  activeTasks.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  activeTasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "todox-history__item";
    if (task.runningSince) {
      item.classList.add("todox-history__item--active");
    }

    const title = document.createElement("h3");
    title.className = "todox-history__item-title";
    title.textContent = task.text;

    const meta = document.createElement("p");
    meta.className = "todox-history__item-meta";

    const createdSpan = document.createElement("span");
    createdSpan.textContent = `作成 ${formatDateTime(task.createdAt)}`;

    const elapsedSpan = document.createElement("span");
    elapsedSpan.textContent = `フォーカス ${formatDuration(getTaskElapsed(task))}`;

    meta.appendChild(createdSpan);
    meta.appendChild(elapsedSpan);

    if (task.runningSince) {
      const runningSpan = document.createElement("span");
      runningSpan.textContent = "進行中";
      meta.appendChild(runningSpan);
    }

    item.appendChild(title);
    item.appendChild(meta);
    tasksListEl.appendChild(item);
  });
}

function ensureLiveUpdates() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }
  if (state.tasks.some((task) => task.runningSince)) {
    refreshInterval = setInterval(() => {
      renderFocusSummary();
      renderCurrentTasks();
    }, 1000);
  }
}

function handleStorageChange(changes) {
  let didUpdate = false;
  if (changes[STORAGE_KEY]) {
    state.tasks = normaliseTasks(changes[STORAGE_KEY].newValue);
    didUpdate = true;
  }
  if (changes[STORAGE_HISTORY_KEY]) {
    state.history = normaliseHistory(changes[STORAGE_HISTORY_KEY].newValue);
    didUpdate = true;
  }
  if (didUpdate) {
    renderFocusSummary();
    renderHistory();
    renderCurrentTasks();
    ensureLiveUpdates();
  }
}

function handleExport() {
  const payload = {
    generatedAt: new Date().toISOString(),
    tasks: state.tasks.map(stripUndefined),
    completed: state.history.map(stripUndefined)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\.\d+Z$/, "");
  anchor.href = url;
  anchor.download = `todox-export-${timestamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function stripUndefined(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

function sumElapsed(items) {
  return items.reduce((total, item) => total + (item.elapsedMs || 0), 0);
}

function getTaskElapsed(task) {
  const base = task.elapsedMs || 0;
  if (task.runningSince) {
    return base + Math.max(0, Date.now() - task.runningSince);
  }
  return base;
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor((milliseconds || 0) / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const parts = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0"));
  if (hours === 0) {
    return `${parts[1]}:${parts[2]}`;
  }
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

function formatDateTime(timestamp) {
  if (typeof timestamp !== "number") {
    return "不明";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function escapeHtml(input) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return String(input).replace(/[&<>"']/g, (char) => map[char]);
}
