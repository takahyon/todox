(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TodoxState = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const STORAGE_KEY = "todox.tasks";
  const HISTORY_KEY = "todox.history";
  const LEGACY_STORAGE_KEY = "todoxTasks";
  const LEGACY_HISTORY_KEY = "todoxCompletedHistory";
  const HISTORY_LIMIT = 750;

  const DEFAULT_TASK_TITLES = [
    "今日のTODOを決める",
    "最優先タスクに30分集中",
    "受信トレイを整理",
    "チームに進捗を共有",
  ];

  function createDefaultTasks(now = Date.now()) {
    return DEFAULT_TASK_TITLES.map((text, index) => ({
      id: `default-${index}`,
      text,
      createdAt: now + index,
      completed: false,
      elapsedMs: 0,
    }));
  }

  function normaliseTasks(rawTasks, options = {}) {
    const { now = Date.now(), fallbackTasks = createDefaultTasks(now) } = options;
    const source = Array.isArray(rawTasks) ? rawTasks : fallbackTasks;
    return source
      .map((task, index) => ({
        id: typeof task?.id === "string" ? task.id : `task-${now}-${index}`,
        text: String(task?.text ?? "").trim(),
        createdAt: typeof task?.createdAt === "number" ? task.createdAt : now,
        completed: Boolean(task?.completed),
        completedAt: typeof task?.completedAt === "number" ? task.completedAt : undefined,
        elapsedMs: typeof task?.elapsedMs === "number" ? task.elapsedMs : 0,
        runningSince: typeof task?.runningSince === "number" ? task.runningSince : undefined,
        historyId: typeof task?.historyId === "string" ? task.historyId : undefined,
      }))
      .filter((task) => task.text.length > 0);
  }

  function normaliseHistory(rawHistory, options = {}) {
    const { now = Date.now(), limit = HISTORY_LIMIT, sortByCompletedAt = false } = options;
    if (!Array.isArray(rawHistory)) {
      return [];
    }
    const items = rawHistory
      .map((entry, index) => ({
        id: typeof entry?.id === "string" ? entry.id : `history-${now}-${index}`,
        text: String(entry?.text ?? "").trim(),
        createdAt: typeof entry?.createdAt === "number" ? entry.createdAt : now,
        completedAt: typeof entry?.completedAt === "number" ? entry.completedAt : now,
        elapsedMs: typeof entry?.elapsedMs === "number" ? entry.elapsedMs : 0,
      }))
      .filter((entry) => entry.text.length > 0);
    if (sortByCompletedAt) {
      items.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    }
    if (Number.isFinite(limit)) {
      return items.slice(0, limit);
    }
    return items;
  }

  function computeFocusAnalytics(history, now = Date.now()) {
    const summary = {
      todayMs: 0,
      weekMs: 0,
      totalMs: 0,
    };
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
      const completedAt = typeof entry?.completedAt === "number" ? entry.completedAt : 0;
      const elapsedMs = typeof entry?.elapsedMs === "number" ? entry.elapsedMs : 0;
      summary.totalMs += elapsedMs;
      if (completedAt >= startOfToday) {
        summary.todayMs += elapsedMs;
      }
      if (completedAt >= startOfWeek) {
        summary.weekMs += elapsedMs;
      }
    });

    return summary;
  }

  function formatMinutesFromMs(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes <= 0) {
      return "0分";
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}時間${minutes}分`;
    }
    return `${minutes}分`;
  }

  class StorageAdapter {
    constructor(options = {}) {
      this.storageKey = options.storageKey || STORAGE_KEY;
      this.historyKey = options.historyKey || HISTORY_KEY;
      this.legacyStorageKey = options.legacyStorageKey || LEGACY_STORAGE_KEY;
      this.legacyHistoryKey = options.legacyHistoryKey || LEGACY_HISTORY_KEY;
      this.historyLimit = options.historyLimit ?? HISTORY_LIMIT;
      this.useChromeSync = Boolean(typeof chrome !== "undefined" && chrome.storage?.sync);
      this.onChangeCallbacks = new Set();
      this.lastSerializedTasks = "";
      this.lastSerializedHistory = "";
      if (this.useChromeSync) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== "sync") {
            return;
          }
          let shouldNotify = false;
          if (Object.prototype.hasOwnProperty.call(changes, this.storageKey)) {
            const serialized = JSON.stringify(changes[this.storageKey].newValue ?? []);
            if (serialized !== this.lastSerializedTasks) {
              shouldNotify = true;
              this.lastSerializedTasks = serialized;
            }
          }
          if (Object.prototype.hasOwnProperty.call(changes, this.historyKey)) {
            const serialized = JSON.stringify(changes[this.historyKey].newValue ?? []);
            if (serialized !== this.lastSerializedHistory) {
              shouldNotify = true;
              this.lastSerializedHistory = serialized;
            }
          }
          if (shouldNotify) {
            this.onChangeCallbacks.forEach((cb) => cb());
          }
        });
      }
    }

    normaliseTasks(rawTasks) {
      const now = Date.now();
      const fallbackTasks = Array.isArray(rawTasks) ? undefined : createDefaultTasks(now);
      return normaliseTasks(rawTasks, { now, fallbackTasks });
    }

    normaliseHistory(rawHistory) {
      const now = Date.now();
      return normaliseHistory(rawHistory, { now, limit: this.historyLimit });
    }

    async load() {
      if (this.useChromeSync) {
        try {
          const data = await new Promise((resolve) => {
            chrome.storage.sync.get(
              [this.storageKey, this.historyKey, this.legacyStorageKey, this.legacyHistoryKey],
              (result) => {
                if (chrome.runtime?.lastError) {
                  console.error("TodoX failed to load storage", chrome.runtime.lastError);
                  resolve({});
                  return;
                }
                resolve(result);
              }
            );
          });
          const usedLegacyTasks =
            data[this.storageKey] === undefined &&
            Object.prototype.hasOwnProperty.call(data, this.legacyStorageKey);
          const usedLegacyHistory =
            data[this.historyKey] === undefined &&
            Object.prototype.hasOwnProperty.call(data, this.legacyHistoryKey);
          const tasks = this.normaliseTasks(data[this.storageKey] ?? data[this.legacyStorageKey]);
          const history = this.normaliseHistory(data[this.historyKey] ?? data[this.legacyHistoryKey]);
          this.lastSerializedTasks = JSON.stringify(tasks);
          this.lastSerializedHistory = JSON.stringify(history);
          if (usedLegacyTasks || usedLegacyHistory) {
            await this.save(tasks, history);
            chrome.storage.sync.remove([this.legacyStorageKey, this.legacyHistoryKey]);
          }
          return { tasks, history };
        } catch (error) {
          console.error("TodoX failed to read from chrome.storage", error);
        }
      }

      try {
        const tasksJson =
          window.localStorage?.getItem(this.storageKey) ?? window.localStorage?.getItem(this.legacyStorageKey);
        const historyJson =
          window.localStorage?.getItem(this.historyKey) ?? window.localStorage?.getItem(this.legacyHistoryKey);
        const tasks = this.normaliseTasks(tasksJson ? JSON.parse(tasksJson) : undefined);
        const history = this.normaliseHistory(historyJson ? JSON.parse(historyJson) : undefined);
        this.lastSerializedTasks = JSON.stringify(tasks);
        this.lastSerializedHistory = JSON.stringify(history);
        const usedLegacyLocal =
          (!window.localStorage?.getItem(this.storageKey) &&
            window.localStorage?.getItem(this.legacyStorageKey)) ||
          (!window.localStorage?.getItem(this.historyKey) && window.localStorage?.getItem(this.legacyHistoryKey));
        if (usedLegacyLocal) {
          await this.save(tasks, history);
          window.localStorage?.removeItem(this.legacyStorageKey);
          window.localStorage?.removeItem(this.legacyHistoryKey);
        }
        return { tasks, history };
      } catch (error) {
        console.error("TodoX failed to read from localStorage", error);
      }

      const fallbackTasks = this.normaliseTasks();
      return { tasks: fallbackTasks, history: [] };
    }

    async save(tasks, history) {
      const serialisedTasks = JSON.stringify(tasks);
      const serialisedHistory = JSON.stringify(history);
      this.lastSerializedTasks = serialisedTasks;
      this.lastSerializedHistory = serialisedHistory;

      if (this.useChromeSync) {
        await new Promise((resolve) => {
          chrome.storage.sync.set(
            {
              [this.storageKey]: tasks,
              [this.historyKey]: history,
            },
            () => {
              if (chrome.runtime?.lastError) {
                console.error("TodoX failed to save to chrome.storage", chrome.runtime.lastError);
              }
              resolve();
            }
          );
        });
        return;
      }

      try {
        window.localStorage?.setItem(this.storageKey, serialisedTasks);
        window.localStorage?.setItem(this.historyKey, serialisedHistory);
      } catch (error) {
        console.error("TodoX failed to save to localStorage", error);
      }
    }

    onExternalChange(callback) {
      this.onChangeCallbacks.add(callback);
      return () => this.onChangeCallbacks.delete(callback);
    }
  }

  return {
    STORAGE_KEY,
    HISTORY_KEY,
    LEGACY_STORAGE_KEY,
    LEGACY_HISTORY_KEY,
    HISTORY_LIMIT,
    DEFAULT_TASK_TITLES,
    createDefaultTasks,
    normaliseTasks,
    normaliseHistory,
    computeFocusAnalytics,
    formatMinutesFromMs,
    StorageAdapter,
  };
});
