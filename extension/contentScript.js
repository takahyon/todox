const SECTION_TITLES_TO_COLLAPSE = [
  "本日のニュース",
  "プレミアムにサブスクライブ",
  "今を見つけよう"
];

const STORAGE_KEY = "todox.tasks";
const HISTORY_KEY = "todox.history";
const LEGACY_STORAGE_KEY = "todoxTasks";
const LEGACY_HISTORY_KEY = "todoxCompletedHistory";
const MAX_TASKS = 6;
const HISTORY_LIMIT = 750;
const COMPLETED_DISPLAY_LIMIT = 12;
const HEARTBEAT_INTERVAL_MS = 2000;
const LOCATION_POLL_INTERVAL_MS = 1000;
const TIMER_TICK_MS = 1000;
const SHOOT_ANIMATION_DURATION_MS = 600;

const BRANDING =
  typeof window !== "undefined" && window.TODOX_BRANDING
    ? window.TODOX_BRANDING
    : {
        developerName: "あいづたか@TakaAizu",
        developerUrl: "https://x.com/TakaAizu",
        promoHtml: "新アルバムをM3にて発売予定！",
      };

const X_ICON_SVG =
  '<svg class="todox-icon todox-icon--x" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.98 3.5h-3.11L12.9 10l4.71 6.5h3.03l-4.65-6.39L20.98 3.5Zm-8.85 0H3l5.94 8.19L3.25 20.5h3.11l4.94-6.81L16.8 20.5h3.13l-6.05-8.3L18.9 3.5h-3.06l-4.71 6.39L12.13 3.5Z"></path></svg>';

const DEFAULT_TASKS = [
  "今日のTODOを決める",
  "最優先タスクに30分集中",
  "受信トレイを整理",
  "チームに進捗を共有"
];

class StorageAdapter {
  constructor() {
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
        if (STORAGE_KEY in changes) {
          const serialized = JSON.stringify(changes[STORAGE_KEY].newValue ?? []);
          if (serialized !== this.lastSerializedTasks) {
            shouldNotify = true;
            this.lastSerializedTasks = serialized;
          }
        }
        if (HISTORY_KEY in changes) {
          const serialized = JSON.stringify(changes[HISTORY_KEY].newValue ?? []);
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

  async load() {
    if (this.useChromeSync) {
      try {
        const data = await new Promise((resolve) => {
          chrome.storage.sync.get(
            [STORAGE_KEY, HISTORY_KEY, LEGACY_STORAGE_KEY, LEGACY_HISTORY_KEY],
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
          data[STORAGE_KEY] === undefined && Object.prototype.hasOwnProperty.call(data, LEGACY_STORAGE_KEY);
        const usedLegacyHistory =
          data[HISTORY_KEY] === undefined && Object.prototype.hasOwnProperty.call(data, LEGACY_HISTORY_KEY);
        const tasks = this.normaliseTasks(data[STORAGE_KEY] ?? data[LEGACY_STORAGE_KEY]);
        const history = this.normaliseHistory(data[HISTORY_KEY] ?? data[LEGACY_HISTORY_KEY]);
        this.lastSerializedTasks = JSON.stringify(tasks);
        this.lastSerializedHistory = JSON.stringify(history);
        if (usedLegacyTasks || usedLegacyHistory) {
          await this.save(tasks, history);
          chrome.storage.sync.remove([LEGACY_STORAGE_KEY, LEGACY_HISTORY_KEY]);
        }
        return { tasks, history };
      } catch (error) {
        console.error("TodoX failed to read from chrome.storage", error);
      }
    }

    try {
      const tasksJson =
        window.localStorage?.getItem(STORAGE_KEY) ?? window.localStorage?.getItem(LEGACY_STORAGE_KEY);
      const historyJson =
        window.localStorage?.getItem(HISTORY_KEY) ?? window.localStorage?.getItem(LEGACY_HISTORY_KEY);
      const tasks = this.normaliseTasks(tasksJson ? JSON.parse(tasksJson) : undefined);
      const history = this.normaliseHistory(historyJson ? JSON.parse(historyJson) : undefined);
      this.lastSerializedTasks = JSON.stringify(tasks);
      this.lastSerializedHistory = JSON.stringify(history);
      const usedLegacyLocal =
        (!window.localStorage?.getItem(STORAGE_KEY) && window.localStorage?.getItem(LEGACY_STORAGE_KEY)) ||
        (!window.localStorage?.getItem(HISTORY_KEY) && window.localStorage?.getItem(LEGACY_HISTORY_KEY));
      if (usedLegacyLocal) {
        await this.save(tasks, history);
        window.localStorage?.removeItem(LEGACY_STORAGE_KEY);
        window.localStorage?.removeItem(LEGACY_HISTORY_KEY);
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
            [STORAGE_KEY]: tasks,
            [HISTORY_KEY]: history,
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
      window.localStorage?.setItem(STORAGE_KEY, serialisedTasks);
      window.localStorage?.setItem(HISTORY_KEY, serialisedHistory);
    } catch (error) {
      console.error("TodoX failed to save to localStorage", error);
    }
  }

  onExternalChange(callback) {
    this.onChangeCallbacks.add(callback);
    return () => this.onChangeCallbacks.delete(callback);
  }

  normaliseTasks(rawTasks) {
    const now = Date.now();
    const source = Array.isArray(rawTasks) ? rawTasks : DEFAULT_TASKS.map((text, index) => ({
      id: `default-${index}`,
      text,
      createdAt: now + index,
      completed: false,
      elapsedMs: 0,
    }));
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

  normaliseHistory(rawHistory) {
    if (!Array.isArray(rawHistory)) {
      return [];
    }
    const now = Date.now();
    return rawHistory
      .map((entry, index) => ({
        id: typeof entry?.id === "string" ? entry.id : `history-${now}-${index}`,
        text: String(entry?.text ?? "").trim(),
        createdAt: typeof entry?.createdAt === "number" ? entry.createdAt : now,
        completedAt: typeof entry?.completedAt === "number" ? entry.completedAt : now,
        elapsedMs: typeof entry?.elapsedMs === "number" ? entry.elapsedMs : 0,
      }))
      .filter((entry) => entry.text.length > 0)
      .slice(0, HISTORY_LIMIT);
  }
}

class TodoXApp {
  constructor() {
    this.storage = new StorageAdapter();
    this.tasks = [];
    this.history = [];
    this.sidebar = null;
    this.panel = null;
    this.activeListEl = null;
    this.completedSection = null;
    this.completedListEl = null;
    this.completedEmptyEl = null;
    this.completedMoreEl = null;
    this.progressEl = null;
    this.newTaskInput = null;
    this.isComposing = false;
    this.heartbeatInterval = null;
    this.locationInterval = null;
    this.timerInterval = null;
    this.activeTaskId = null;
    this.sidebarObserver = null;
    this.detachStorageListener = null;
    this.lastLocation = location.href;
    this.cleanupRegistered = false;
  }

  async start() {
    const { tasks, history } = await this.storage.load();
    this.tasks = tasks;
    this.history = history;
    this.sortTasks();

    this.attachStorageListener();
    this.registerCleanup();
    this.waitForSidebar();
    this.startLocationWatcher();
  }

  attachStorageListener() {
    if (!this.detachStorageListener) {
      this.detachStorageListener = this.storage.onExternalChange(async () => {
        const { tasks, history } = await this.storage.load();
        this.tasks = tasks;
        this.history = history;
        this.sortTasks();
        this.render();
      });
    }
  }

  registerCleanup() {
    if (this.cleanupRegistered) {
      return;
    }
    this.cleanupRegistered = true;
    window.addEventListener('beforeunload', () => {
      if (this.sidebarObserver) {
        this.sidebarObserver.disconnect();
        this.sidebarObserver = null;
      }
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      if (this.locationInterval) {
        clearInterval(this.locationInterval);
        this.locationInterval = null;
      }
      this.stopTimer();
      if (this.detachStorageListener) {
        this.detachStorageListener();
        this.detachStorageListener = null;
      }
    });
  }

  waitForSidebar() {
    const existingSidebar = this.findSidebar();
    if (existingSidebar) {
      this.attachToSidebar(existingSidebar);
    }

    if (!this.sidebarObserver) {
      this.sidebarObserver = new MutationObserver(() => {
        const sidebar = this.findSidebar();
        if (sidebar && sidebar !== this.sidebar) {
          this.attachToSidebar(sidebar);
        } else if (!sidebar) {
          this.sidebar = null;
        }
      });
      this.sidebarObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  findSidebar() {
    return document.querySelector('aside[role="complementary"], aside[aria-label]');
  }

  attachToSidebar(sidebar) {
    this.sidebar = sidebar;
    this.collapseSections(sidebar);
    this.ensurePanel(sidebar);
    this.render();
    this.startHeartbeat();
  }

  collapseSections(sidebar) {
    SECTION_TITLES_TO_COLLAPSE.forEach((title) => {
      const heading = Array.from(sidebar.querySelectorAll('span'))
        .find((span) => span.textContent?.trim() === title && !span.dataset.todoxWrapped);
      if (!heading) {
        return;
      }
      const section = heading.closest('section, div[data-testid="cellInnerDiv"], div[aria-label]');
      if (!section || section.dataset.todoxWrapped) {
        heading.dataset.todoxWrapped = "true";
        return;
      }
      const details = document.createElement('details');
      details.className = 'todox-collapsible';
      details.open = false;

      const summary = document.createElement('summary');
      summary.className = 'todox-collapsible__summary';
      summary.textContent = title;

      details.appendChild(summary);
      section.parentNode?.insertBefore(details, section);
      details.appendChild(section);
      section.dataset.todoxWrapped = "true";
      heading.dataset.todoxWrapped = "true";
    });
  }

  ensurePanel(sidebar) {
    if (this.panel && sidebar.contains(this.panel)) {
      return;
    }

    this.panel = this.createPanel();
    const firstSection = sidebar.querySelector('section, div[data-testid="cellInnerDiv"], div[aria-label]');
    if (firstSection) {
      firstSection.parentNode?.insertBefore(this.panel, firstSection);
    } else {
      sidebar.insertBefore(this.panel, sidebar.firstChild);
    }
  }

  createPanel() {
    const container = document.createElement('section');
    container.className = 'todox-panel';
    container.innerHTML = `
      <header class="todox-panel__header">
        <div class="todox-panel__title-row">
          <h2 class="todox-panel__title">TodoX</h2>
          <button class="todox-history-button" type="button">履歴を開く</button>
        </div>
        <p class="todox-panel__progress" aria-live="polite"></p>
        <p class="todox-panel__hint">Enter でタスク追加、⌘⏎ で即時フォーカス</p>
      </header>
      <ul class="todox-list todox-list--active"></ul>
      <section class="todox-done" aria-live="polite">
        <div class="todox-done__header">
          <h3 class="todox-done__title">DoneX</h3>
          <span class="todox-done__subtitle">今日のがんばり</span>
        </div>
        <p class="todox-done__empty" hidden>まだ完了したタスクはありません。</p>
        <ul class="todox-done__list"></ul>
        <p class="todox-done__more" hidden></p>
      </section>
      <footer class="todox-panel__footer">
        <p class="todox-panel__credit">
          developed by <a class="todox-panel__credit-link" target="_blank" rel="noopener noreferrer"></a>
        </p>
        <div class="todox-panel__promo" hidden></div>
      </footer>
    `;

    this.activeListEl = container.querySelector('.todox-list--active');
    this.completedSection = container.querySelector('.todox-done');
    this.completedListEl = container.querySelector('.todox-done__list');
    this.completedEmptyEl = container.querySelector('.todox-done__empty');
    this.completedMoreEl = container.querySelector('.todox-done__more');
    this.progressEl = container.querySelector('.todox-panel__progress');
    const historyButton = container.querySelector('.todox-history-button');
    historyButton?.addEventListener('click', () => this.openHistory());

    const creditLink = container.querySelector('.todox-panel__credit-link');
    if (creditLink) {
      creditLink.href = BRANDING.developerUrl;
      creditLink.textContent = BRANDING.developerName;
    }
    const promo = container.querySelector('.todox-panel__promo');
    if (promo && BRANDING.promoHtml) {
      promo.innerHTML = BRANDING.promoHtml;
      promo.hidden = false;
    }

    return container;
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      if (!this.sidebar) {
        const sidebar = this.findSidebar();
        if (sidebar) {
          this.attachToSidebar(sidebar);
        }
        return;
      }
      this.collapseSections(this.sidebar);
      this.ensurePanel(this.sidebar);
    }, HEARTBEAT_INTERVAL_MS);
  }

  startLocationWatcher() {
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
    }
    this.locationInterval = setInterval(() => {
      if (this.lastLocation !== location.href) {
        this.lastLocation = location.href;
        this.waitForSidebar();
      }
    }, LOCATION_POLL_INTERVAL_MS);
  }

  render() {
    if (!this.activeListEl || !this.completedListEl || !this.completedEmptyEl) {
      return;
    }

    this.sortTasks();

    const activeTasks = this.tasks.filter((task) => !task.completed);
    const completedTasks = this.tasks.filter((task) => task.completed);

    this.renderActiveTasks(activeTasks);
    this.renderCompletedTasks(completedTasks);
    this.updateProgress(activeTasks.length, completedTasks.length);
  }

  renderActiveTasks(activeTasks) {
    if (!this.activeListEl) {
      return;
    }

    this.activeListEl.innerHTML = '';

    const canAddTask = activeTasks.length < MAX_TASKS;
    const inputItem = document.createElement('li');
    inputItem.className = 'todox-list__item todox-list__item--new';
    const placeholderText = canAddTask
      ? 'ここに入力して Enter で追加'
      : 'フォーカス中のタスクが落ち着いたら追加しましょう';
    inputItem.innerHTML = `
      <span class="todox-plus" aria-hidden="true">＋</span>
      <input type="text" class="todox-input" placeholder="${placeholderText}" ${canAddTask ? '' : 'disabled'} />
      <div class="todox-actions">
        <button class="todox-action-button todox-action-button--focus" type="button" title="最初のタスクをフォーカス" ${canAddTask ? '' : 'disabled'}>▶︎</button>
      </div>
    `;
    this.newTaskInput = inputItem.querySelector('.todox-input');
    const quickFocusButton = inputItem.querySelector('.todox-action-button--focus');

    this.newTaskInput?.addEventListener('compositionstart', () => {
      this.isComposing = true;
    });
    this.newTaskInput?.addEventListener('compositionend', () => {
      this.isComposing = false;
    });
    this.newTaskInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (this.isComposing) {
          return;
        }
        event.preventDefault();
        this.handleNewTaskSubmit();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        const value = this.newTaskInput?.value.trim();
        if (value) {
          const task = this.addTask(value);
          if (task) {
            this.startFocus(task.id);
          }
        }
      }
    });

    quickFocusButton?.addEventListener('click', () => {
      const value = this.newTaskInput?.value.trim();
      if (!value) {
        return;
      }
      const task = this.addTask(value);
      if (task) {
        this.startFocus(task.id);
      }
    });

    this.activeListEl.appendChild(inputItem);

    if (activeTasks.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'todox-list__item todox-list__item--empty';
      emptyItem.innerHTML = '<span class="todox-empty-text">タスクはありません。今日やることを書き出しましょう！</span>';
      this.activeListEl.appendChild(emptyItem);
    }

    activeTasks.forEach((task) => {
      const item = this.renderActiveTask(task);
      this.activeListEl.appendChild(item);
    });
  }

  renderCompletedTasks(completedTasks) {
    if (!this.completedListEl || !this.completedEmptyEl || !this.completedSection) {
      return;
    }

    this.completedListEl.innerHTML = '';

    if (completedTasks.length === 0) {
      this.completedEmptyEl.hidden = false;
      this.completedSection.classList.add('todox-done--empty');
      if (this.completedMoreEl) {
        this.completedMoreEl.hidden = true;
      }
      return;
    }

    this.completedEmptyEl.hidden = true;
    this.completedSection.classList.remove('todox-done--empty');

    const displayCompleted = completedTasks.slice(0, COMPLETED_DISPLAY_LIMIT);
    displayCompleted.forEach((task) => {
      const item = this.renderCompletedTask(task);
      this.completedListEl.appendChild(item);
    });

    if (this.completedMoreEl) {
      const remaining = completedTasks.length - displayCompleted.length;
      if (remaining > 0) {
        this.completedMoreEl.textContent = `ほか ${remaining} 件の達成があります`; 
        this.completedMoreEl.hidden = false;
      } else {
        this.completedMoreEl.hidden = true;
      }
    }
  }

  renderActiveTask(task) {
    const item = document.createElement('li');
    item.className = 'todox-list__item';
    item.dataset.taskId = task.id;
    if (this.activeTaskId === task.id) {
      item.classList.add('todox-list__item--active');
    }

    const circleButton = document.createElement('button');
    circleButton.className = 'todox-circle-button';
    circleButton.type = 'button';
    circleButton.setAttribute('aria-label', '完了としてマーク');
    circleButton.addEventListener('click', () => {
      this.completeTask(task.id);
    });

    const content = document.createElement('div');
    content.className = 'todox-task-content';

    const text = document.createElement('p');
    text.className = 'todox-task-text';
    text.textContent = task.text;
    content.appendChild(text);

    const timer = document.createElement('span');
    timer.className = 'todox-task-timer';
    timer.textContent = this.formatTimer(task);
    content.appendChild(timer);

    const actions = document.createElement('div');
    actions.className = 'todox-actions';

    const focusButton = document.createElement('button');
    focusButton.className = 'todox-action-button todox-action-button--focus';
    focusButton.type = 'button';
    focusButton.textContent = this.activeTaskId === task.id ? '⏸' : '▶︎';
    focusButton.title = this.activeTaskId === task.id ? '一時停止' : 'フォーカス開始';
    focusButton.addEventListener('click', () => {
      if (this.activeTaskId === task.id) {
        this.stopFocus();
      } else {
        this.startFocus(task.id);
      }
    });

    const shareButton = document.createElement('button');
    shareButton.className = 'todox-action-button todox-action-button--share';
    shareButton.type = 'button';
    shareButton.innerHTML = X_ICON_SVG;
    shareButton.title = '𝕏 でシェア';
    shareButton.disabled = true;

    const deleteButton = document.createElement('button');
    deleteButton.className = 'todox-action-button';
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', 'タスクを削除');
    deleteButton.textContent = '🗑️';
    deleteButton.title = '削除';
    deleteButton.addEventListener('click', () => {
      this.deleteTask(task.id);
    });

    actions.appendChild(focusButton);
    actions.appendChild(shareButton);
    actions.appendChild(deleteButton);

    item.appendChild(circleButton);
    item.appendChild(content);
    item.appendChild(actions);

    return item;
  }

  renderCompletedTask(task) {
    const item = document.createElement('li');
    item.className = 'todox-done__item';
    item.dataset.taskId = task.id;

    const circleButton = document.createElement('button');
    circleButton.className = 'todox-circle-button todox-circle-button--completed';
    circleButton.type = 'button';
    circleButton.innerHTML = '✓';
    circleButton.setAttribute('aria-label', '未完了に戻す');
    circleButton.addEventListener('click', () => {
      this.uncompleteTask(task.id);
    });

    const content = document.createElement('div');
    content.className = 'todox-task-content todox-task-content--done';

    const text = document.createElement('p');
    text.className = 'todox-task-text';
    text.textContent = task.text;
    content.appendChild(text);

    const timer = document.createElement('span');
    timer.className = 'todox-task-timer';
    timer.textContent = `集中 ${this.formatTimer(task)}`;
    content.appendChild(timer);

    const actions = document.createElement('div');
    actions.className = 'todox-actions';

    const shareButton = document.createElement('button');
    shareButton.className = 'todox-action-button todox-action-button--share';
    shareButton.type = 'button';
    shareButton.innerHTML = X_ICON_SVG;
    shareButton.title = '𝕏 でシェア';
    shareButton.addEventListener('click', () => {
      this.shareTask(task);
    });

    actions.appendChild(shareButton);

    item.appendChild(circleButton);
    item.appendChild(content);
    item.appendChild(actions);

    if (task.justCompleted) {
      item.classList.add('todox-done__item--new');
      requestAnimationFrame(() => {
        item.classList.add('todox-done__item--enter');
        setTimeout(() => {
          item.classList.remove('todox-done__item--enter');
        }, SHOOT_ANIMATION_DURATION_MS);
      });
      delete task.justCompleted;
    }

    return item;
  }

  updateProgress(activeCount, completedCount) {
    if (!this.progressEl) {
      return;
    }
    const completed = typeof completedCount === 'number'
      ? completedCount
      : this.tasks.filter((task) => task.completed).length;
    const activeTotal = typeof activeCount === 'number'
      ? activeCount
      : this.tasks.filter((task) => !task.completed).length;
    const total = activeTotal + completed;
    const activeTask = this.activeTaskId
      ? this.tasks.find((task) => task.id === this.activeTaskId)
      : undefined;
    const focusText = activeTask ? `フォーカス中: ${activeTask.text}` : 'フォーカス待ち';
    const remainingText = activeTotal > 0 ? `残り ${activeTotal} 件` : '全タスク完了！';
    this.progressEl.textContent = `完了 ${completed}/${total} ・ ${remainingText} ・ ${focusText}`;
  }

  handleNewTaskSubmit() {
    const value = this.newTaskInput?.value.trim();
    if (!value) {
      return;
    }
    const task = this.addTask(value);
    if (task) {
      this.newTaskInput.value = '';
    }
  }

  addTask(text) {
    const activeCount = this.tasks.filter((task) => !task.completed).length;
    if (activeCount >= MAX_TASKS) {
      return null;
    }
    const now = Date.now();
    const task = {
      id: `task-${now}-${Math.random().toString(16).slice(2)}`,
      text,
      createdAt: now,
      completed: false,
      completedAt: undefined,
      elapsedMs: 0,
      runningSince: undefined,
      historyId: undefined,
    };
    this.tasks.push(task);
    this.sortTasks();
    this.render();
    this.persist();
    return task;
  }

  deleteTask(taskId) {
    const index = this.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      return;
    }
    if (this.activeTaskId === taskId) {
      this.stopFocus();
    }
    this.tasks.splice(index, 1);
    this.render();
    this.persist();
  }

  completeTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.completed) {
      return;
    }
    if (this.activeTaskId === taskId) {
      this.stopFocus();
    }
    const now = Date.now();
    task.completed = true;
    task.completedAt = now;
    task.runningSince = undefined;
    task.justCompleted = true;
    const historyEntry = {
      id: `history-${now}-${Math.random().toString(16).slice(2)}`,
      text: task.text,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      elapsedMs: task.elapsedMs,
    };
    task.historyId = historyEntry.id;
    this.history.unshift(historyEntry);
    this.history = this.history.slice(0, HISTORY_LIMIT);
    this.render();
    this.persist();
  }

  uncompleteTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || !task.completed) {
      return;
    }
    const previousHistoryId = task.historyId;
    task.completed = false;
    task.completedAt = undefined;
    task.historyId = undefined;
    delete task.justCompleted;
    if (previousHistoryId) {
      this.history = this.history.filter((entry) => entry.id !== previousHistoryId);
    }
    this.render();
    this.persist();
  }

  startFocus(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.completed) {
      return;
    }
    if (this.activeTaskId && this.activeTaskId !== taskId) {
      this.stopFocus();
    }
    this.activeTaskId = taskId;
    task.runningSince = Date.now();
    this.startTimer();
    this.render();
    this.persist();
  }

  stopFocus() {
    if (!this.activeTaskId) {
      return;
    }
    const task = this.tasks.find((t) => t.id === this.activeTaskId);
    if (task && task.runningSince) {
      const now = Date.now();
      task.elapsedMs += now - task.runningSince;
      task.runningSince = undefined;
    }
    this.activeTaskId = null;
    this.stopTimer();
    this.render();
    this.persist();
  }

  startTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    this.timerInterval = setInterval(() => {
      if (!this.activeTaskId) {
        return;
      }
      const task = this.tasks.find((t) => t.id === this.activeTaskId);
      if (!task || task.completed || !task.runningSince) {
        this.stopFocus();
        return;
      }
      const now = Date.now();
      const elapsed = task.elapsedMs + (now - task.runningSince);
      const item = this.activeListEl?.querySelector(`li[data-task-id="${task.id}"] .todox-task-timer`);
      if (item) {
        item.textContent = this.formatDuration(elapsed);
      }
    }, TIMER_TICK_MS);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  shareTask(task) {
    const focus = this.formatDuration(task.elapsedMs);
    const message = `TodoX でタスク完了！\n${task.text}\n集中時間: ${focus}`;
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener');
  }

  openHistory() {
    const pageUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL('completed.html')
      : 'completed.html';
    window.open(pageUrl, '_blank');
  }

  formatTimer(task) {
    let elapsed = task.elapsedMs;
    if (task.runningSince) {
      elapsed += Date.now() - task.runningSince;
    }
    return this.formatDuration(elapsed);
  }

  formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
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

  sortTasks() {
    this.tasks.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      if (a.completed) {
        return (b.completedAt ?? 0) - (a.completedAt ?? 0);
      }
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    });
  }

  async persist() {
    await this.storage.save(this.tasks, this.history);
  }
}

function startApp() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const app = new TodoXApp();
      app.start();
    });
  } else {
    const app = new TodoXApp();
    app.start();
  }
}

startApp();
