const SECTION_TITLES_TO_COLLAPSE = [
  "本日のニュース",
  "プレミアムにサブスクライブ",
  "今を見つけよう"
];

const STORAGE_KEY = "todoxTasks";
const STORAGE_HISTORY_KEY = "todoxCompletedHistory";
const MAX_TASKS = 6;
const HISTORY_LIMIT = 500;
const HEARTBEAT_INTERVAL_MS = 1500;
const LOCATION_CHECK_INTERVAL_MS = 800;
const STORAGE_POLL_INTERVAL_MS = 2000;
const X_ICON_SVG =
  '<svg class="todox-x-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.98 3.5h-3.11L12.9 10l4.71 6.5h3.03l-4.65-6.39L20.98 3.5Zm-8.85 0H3l5.94 8.19L3.25 20.5h3.11l4.94-6.81L16.8 20.5h3.13l-6.05-8.3L18.9 3.5h-3.06l-4.71 6.39L12.13 3.5Z"></path></svg>';

const defaultBase = Date.now();

const DEFAULT_TASKS = [
  {
    id: "plan-day",
    text: "今日のTODOを決める",
    completed: false,
    createdAt: defaultBase + 3,
    elapsedMs: 0
  },
  {
    id: "top-priority",
    text: "最優先タスクに30分集中",
    completed: false,
    createdAt: defaultBase + 2,
    elapsedMs: 0
  },
  {
    id: "inbox-zero",
    text: "受信トレイを整理",
    completed: false,
    createdAt: defaultBase + 1,
    elapsedMs: 0
  },
  {
    id: "check-in",
    text: "チームに進捗を共有",
    completed: false,
    createdAt: defaultBase,
    elapsedMs: 0
  }
];

let tasks = [];
let completedHistory = [];
let todoContainer;
let todoList;
let newTaskInput;
let progressIndicator;
let historyButton;
let isComposing = false;
let hasLoadedTasks = false;
let currentSidebar;
let sidebarObserver;
let sidebarDetectionObserver;
let activeTaskId;
let timerInterval;
const timerElements = new Map();
const focusButtons = new Map();
let heartbeatInterval;
let lastKnownHref = location.href;
let locationInterval;
let stateWatcherAttached = false;
let localStoragePollInterval;
let lastSerializedState = "";

function waitForSidebar() {
  const detectSidebar = () => {
    const sidebar = document.querySelector('aside[role="complementary"], aside[aria-label]');
    if (sidebar && sidebar !== currentSidebar) {
      initialiseTodoX(sidebar);
    }
  };

  detectSidebar();

  if (!sidebarDetectionObserver) {
    sidebarDetectionObserver = new MutationObserver(detectSidebar);
    sidebarDetectionObserver.observe(document.body, { childList: true, subtree: true });
  }

  ensureLocationWatcher();
}

function initialiseTodoX(sidebar) {
  stopHeartbeat();
  currentSidebar = sidebar;
  collapseSidebarSections(sidebar);
  injectTodoPanel(sidebar);
  const loader = hasLoadedTasks
    ? Promise.resolve()
    : loadState().then(() => {
        hasLoadedTasks = true;
      });

  loader.then(() => {
    reorderTasks();
    renderTasks();
    restoreActiveTimer();
    startStateWatcher();
  });
  observeSidebar(sidebar);
  startHeartbeat();
}

function observeSidebar(sidebar) {
  if (sidebarObserver) {
    sidebarObserver.disconnect();
  }

  sidebarObserver = new MutationObserver(() => {
    collapseSidebarSections(sidebar);
    ensureTodoPanel(sidebar);
  });

  sidebarObserver.observe(sidebar, { childList: true, subtree: true });
}

function ensureTodoPanel(sidebar) {
  if (!todoContainer || !sidebar.contains(todoContainer)) {
    injectTodoPanel(sidebar);
    if (hasLoadedTasks) {
      renderTasks();
      restoreActiveTimer();
    }
  }
}

function collapseSidebarSections(sidebar) {
  SECTION_TITLES_TO_COLLAPSE.forEach((title) => {
    const heading = Array.from(sidebar.querySelectorAll('span'))
      .find((span) => span.textContent.trim() === title && !span.dataset.todoxProcessed);

    if (!heading) {
      return;
    }

    const section = heading.closest('section, div[data-testid="cellInnerDiv"], div[aria-label]');
    if (!section || section.dataset.todoxWrapped) {
      heading.dataset.todoxProcessed = "true";
      return;
    }

    const wrapper = document.createElement('details');
    wrapper.className = 'todox-collapsible';
    wrapper.open = false;

    const summary = document.createElement('summary');
    summary.className = 'todox-collapsible__summary';
    summary.textContent = title;

    wrapper.appendChild(summary);
    section.parentNode.insertBefore(wrapper, section);
    wrapper.appendChild(section);

    section.dataset.todoxWrapped = "true";
    heading.dataset.todoxProcessed = "true";
  });
}

function injectTodoPanel(sidebar) {
  if (todoContainer && !sidebar.contains(todoContainer)) {
    todoContainer = undefined;
    todoList = undefined;
    newTaskInput = undefined;
    progressIndicator = undefined;
    historyButton = undefined;
  }

  if (sidebar.querySelector('.todox-panel')) {
    todoContainer = sidebar.querySelector('.todox-panel');
    todoList = todoContainer.querySelector('.todox-list');
    newTaskInput = todoContainer.querySelector('.todox-input');
    progressIndicator = todoContainer.querySelector('.todox-panel__progress');
    historyButton = todoContainer.querySelector('.todox-history-button');
    if (!todoContainer.querySelector('.todox-panel__footer')) {
      const footer = document.createElement('footer');
      footer.className = 'todox-panel__footer';
      footer.innerHTML =
        'developed by <a href="https://x.com/TakaAizu" target="_blank" rel="noopener noreferrer">@TakaAizu</a>';
      todoContainer.appendChild(footer);
    }
    bindNewTaskInput();
    bindHistoryButton();
    return;
  }

  todoContainer = document.createElement('section');
  todoContainer.className = 'todox-panel';

  const header = document.createElement('header');
  header.className = 'todox-panel__header';

  const title = document.createElement('h2');
  title.textContent = 'TodoX';
  title.className = 'todox-panel__title';

  const headerMeta = document.createElement('div');
  headerMeta.className = 'todox-panel__meta';

  progressIndicator = document.createElement('span');
  progressIndicator.className = 'todox-panel__progress';
  progressIndicator.setAttribute('aria-live', 'polite');
  progressIndicator.textContent = '0/0 完了';

  const historyControl = document.createElement('button');
  historyControl.type = 'button';
  historyControl.className = 'todox-history-button';
  historyControl.textContent = '履歴を開く';
  historyControl.title = '完了したタスクを一覧表示・エクスポート';

  historyButton = historyControl;

  headerMeta.appendChild(progressIndicator);
  headerMeta.appendChild(historyControl);

  const shareHint = document.createElement('span');
  shareHint.className = 'todox-panel__hint';
  shareHint.textContent = '完了したタスクは𝕏にシェア & タイマー付きで記録されます';

  header.appendChild(title);
  header.appendChild(headerMeta);
  header.appendChild(shareHint);

  todoList = document.createElement('ul');
  todoList.className = 'todox-list';

  const newTaskItem = document.createElement('li');
  newTaskItem.className = 'todox-list__item todox-list__item--new';

  const plus = document.createElement('span');
  plus.className = 'todox-plus';
  plus.textContent = '+';

  newTaskInput = document.createElement('input');
  newTaskInput.type = 'text';
  newTaskInput.className = 'todox-input';
  newTaskInput.placeholder = 'ここに入力してEnterで追加';

  newTaskItem.appendChild(plus);
  newTaskItem.appendChild(newTaskInput);

  todoList.appendChild(newTaskItem);

  todoContainer.appendChild(header);
  todoContainer.appendChild(todoList);

  const footer = document.createElement('footer');
  footer.className = 'todox-panel__footer';
  footer.innerHTML =
    'developed by <a href="https://x.com/TakaAizu" target="_blank" rel="noopener noreferrer">@TakaAizu</a>';

  todoContainer.appendChild(footer);

  sidebar.insertBefore(todoContainer, sidebar.firstChild);

  bindNewTaskInput();
  bindHistoryButton();
}

function bindHistoryButton() {
  if (!historyButton || historyButton.dataset.todoxBound === 'true') {
    return;
  }
  historyButton.addEventListener('click', openHistoryPage);
  historyButton.dataset.todoxBound = 'true';
}

const handleNewTaskKeydown = (event) => {
  if (event.key !== 'Enter' || event.shiftKey || isComposing || event.isComposing) {
    return;
  }

  event.preventDefault();
  const value = newTaskInput.value.trim();
  if (!value) {
    return;
  }

  addTask(value);
  newTaskInput.value = '';
};

function bindNewTaskInput() {
  if (!newTaskInput || newTaskInput.dataset.todoxBound === 'true') return;

  newTaskInput.addEventListener('keydown', handleNewTaskKeydown);
  newTaskInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  newTaskInput.addEventListener('compositionend', () => {
    isComposing = false;
  });
  newTaskInput.addEventListener('blur', () => {
    isComposing = false;
  });
  newTaskInput.dataset.todoxBound = 'true';
}

function loadState() {
  return new Promise((resolve) => {
    const fromChromeStorage = !!(typeof chrome !== 'undefined' && chrome.storage?.sync);
    const handleResult = (storedTasks, storedHistory) => {
      tasks = storedTasks === undefined ? [...DEFAULT_TASKS] : normaliseTasks(storedTasks);
      completedHistory = storedHistory === undefined ? [] : normaliseHistory(storedHistory);
      resolve();
    };

    if (fromChromeStorage) {
      chrome.storage.sync.get([STORAGE_KEY, STORAGE_HISTORY_KEY], (result) => {
        if (chrome.runtime?.lastError) {
          handleResult(undefined, undefined);
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
        storedTasks === null ? undefined : JSON.parse(storedTasks),
        storedHistory === null ? undefined : JSON.parse(storedHistory)
      );
    } catch (error) {
      console.error('TodoX failed to load state from localStorage', error);
      handleResult(undefined, undefined);
    }
  });
}

function persistTasks() {
  const payload = tasks.slice(0, MAX_TASKS);

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    chrome.storage.sync.set({ [STORAGE_KEY]: payload });
  } else {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('TodoX failed to persist tasks', error);
    }
  }
}

function persistHistory() {
  const payload = completedHistory.slice(0, HISTORY_LIMIT);
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    chrome.storage.sync.set({ [STORAGE_HISTORY_KEY]: payload });
  } else {
    try {
      window.localStorage?.setItem(STORAGE_HISTORY_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('TodoX failed to persist history', error);
    }
  }
}

function addTask(text) {
  const newTask = {
    id: `task-${Date.now()}`,
    text,
    completed: false,
    createdAt: Date.now(),
    elapsedMs: 0
  };

  tasks.unshift(newTask);
  tasks = tasks.slice(0, MAX_TASKS);
  reorderTasks();
  persistTasks();
  renderTasks();
}

function stopActiveTimer({ persist = true } = {}) {
  if (!activeTaskId) {
    return;
  }
  const task = tasks.find((item) => item.id === activeTaskId);
  if (!task) {
    activeTaskId = undefined;
    updateTimerLoop();
    return;
  }

  if (task.runningSince) {
    const now = Date.now();
    task.elapsedMs = (task.elapsedMs || 0) + Math.max(0, now - task.runningSince);
    delete task.runningSince;
  }
  task.active = false;
  activeTaskId = undefined;
  if (persist) {
    persistTasks();
  }
  updateTimerLoop();
}

function focusTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || task.completed) {
    return;
  }

  if (activeTaskId === taskId) {
    stopActiveTimer();
    updateTimerDisplays();
    return;
  }

  stopActiveTimer();

  task.runningSince = Date.now();
  task.active = true;
  activeTaskId = taskId;
  persistTasks();
  updateTimerLoop();
  updateTimerDisplays();
}

function toggleTaskCompletion(taskId) {
  if (activeTaskId === taskId) {
    stopActiveTimer({ persist: false });
  }

  const now = Date.now();
  let updatedTask;

  tasks = tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const completed = !task.completed;
    const accumulated = task.elapsedMs + (task.runningSince ? Math.max(0, now - task.runningSince) : 0);
    const nextTask = {
      ...task,
      completed,
      completedAt: completed ? now : undefined,
      elapsedMs: accumulated,
      runningSince: completed ? undefined : undefined,
      active: false
    };

    updatedTask = nextTask;
    return nextTask;
  });

  if (updatedTask) {
    if (updatedTask.completed) {
      recordCompletion(updatedTask);
    } else {
      removeFromHistory(updatedTask.id);
    }
  }

  reorderTasks();
  persistTasks();
  renderTasks();
}

function shareTask(task) {
  if (!task.completed) {
    return;
  }
  const base = 'https://x.com/intent/tweet';
  const duration = task.elapsedMs ? ` ⏱${formatDuration(task.elapsedMs)}` : '';
  const text = encodeURIComponent(`完了: ${task.text}${duration}`);
  const url = `${base}?text=${text}`;
  window.open(url, '_blank', 'noopener');
}

function removeTask(taskId) {
  if (activeTaskId === taskId) {
    stopActiveTimer({ persist: false });
  }
  tasks = tasks.filter((task) => task.id !== taskId);
  removeFromHistory(taskId);
  reorderTasks();
  persistTasks();
  renderTasks();
}

function normaliseTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) {
    return [...DEFAULT_TASKS];
  }

  const now = Date.now();
  const hydrated = rawTasks.slice(0, MAX_TASKS).map((task, index) => {
    const base = typeof task?.elapsedMs === 'number' ? task.elapsedMs : 0;
    const runningSince = typeof task?.runningSince === 'number' ? task.runningSince : undefined;
    const createdAt = typeof task?.createdAt === 'number' ? task.createdAt : now + index;
    const completedAt = typeof task?.completedAt === 'number' ? task.completedAt : undefined;
    return {
      id: task?.id || `task-${now}-${index}`,
      text: String(task?.text || '').trim(),
      completed: Boolean(task?.completed),
      createdAt,
      completedAt: task?.completed ? completedAt : undefined,
      elapsedMs: base,
      runningSince,
      active: Boolean(task?.active && runningSince)
    };
  }).filter((task) => task.text.length > 0);

  if (hydrated.length === 0) {
    return [];
  }

  const deduped = Array.from(new Map(hydrated.map((task) => [task.id, task])).values());
  return deduped.slice(0, MAX_TASKS);
}

function normaliseHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  const now = Date.now();
  return rawHistory.map((entry, index) => ({
    id: entry?.id || `history-${now}-${index}`,
    text: String(entry?.text || '').trim(),
    createdAt: typeof entry?.createdAt === 'number' ? entry.createdAt : now,
    completedAt: typeof entry?.completedAt === 'number' ? entry.completedAt : now,
    elapsedMs: typeof entry?.elapsedMs === 'number' ? entry.elapsedMs : 0
  })).filter((entry) => entry.text.length > 0);
}

function reorderTasks() {
  tasks = [...tasks]
    .sort((a, b) => {
      if (a.completed === b.completed) {
        const aTimestamp = a.completed ? (a.completedAt ?? a.createdAt) : a.createdAt;
        const bTimestamp = b.completed ? (b.completedAt ?? b.createdAt) : b.createdAt;
        return bTimestamp - aTimestamp;
      }
      return a.completed ? 1 : -1;
    })
    .slice(0, MAX_TASKS);
}

function renderTasks() {
  if (!todoList) {
    updateStateSnapshot();
    return;
  }

  timerElements.clear();
  focusButtons.clear();

  const existingItems = Array.from(todoList.querySelectorAll('.todox-list__item'))
    .filter((item) => !item.classList.contains('todox-list__item--new'));
  existingItems.forEach((item) => item.remove());

  if (tasks.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'todox-list__item todox-list__item--empty';
    emptyItem.innerHTML = '<span class="todox-empty-text">タスクはまだありません</span>';
    todoList.appendChild(emptyItem);
  }

  tasks.forEach((task) => {
    const item = document.createElement('li');
    item.className = 'todox-list__item';
    item.dataset.taskId = task.id;
    if (task.completed) {
      item.classList.add('todox-list__item--completed');
    }

    const completeButton = document.createElement('button');
    completeButton.className = 'todox-circle-button';
    completeButton.setAttribute('aria-label', 'タスクを完了');
    completeButton.setAttribute('aria-pressed', task.completed ? 'true' : 'false');
    completeButton.innerHTML = '<span class="todox-circle"></span><span class="todox-check">✓</span>';
    completeButton.addEventListener('click', () => {
      completeButton.classList.add('todox-circle-button--pulse');
      completeButton.disabled = true;
      setTimeout(() => {
        toggleTaskCompletion(task.id);
        completeButton.disabled = false;
      }, 220);
      setTimeout(() => completeButton.classList.remove('todox-circle-button--pulse'), 420);
    });

    const content = document.createElement('div');
    content.className = 'todox-task-content';

    const text = document.createElement('span');
    text.className = 'todox-task-text';
    text.textContent = task.text;

    const timer = document.createElement('span');
    timer.className = 'todox-task-timer';
    timer.textContent = formatDuration(getTaskElapsed(task));

    timerElements.set(task.id, timer);

    content.appendChild(text);
    content.appendChild(timer);

    const actions = document.createElement('div');
    actions.className = 'todox-actions';

    const focusButton = document.createElement('button');
    focusButton.className = 'todox-action-button todox-action-button--focus';
    focusButton.setAttribute('aria-label', 'このタスクに集中');
    focusButton.disabled = task.completed;
    focusButton.innerHTML = task.runningSince ? '⏸' : '▶';
    focusButton.title = task.completed
      ? '完了済みのタスクはフォーカスできません'
      : task.runningSince
        ? '一時停止'
        : 'このタスクでフォーカスを開始';
    focusButton.addEventListener('click', () => focusTask(task.id));
    focusButtons.set(task.id, focusButton);

    const shareButton = document.createElement('button');
    shareButton.className = 'todox-action-button todox-action-button--share';
    shareButton.setAttribute('aria-label', '𝕏にシェア');
    shareButton.innerHTML = X_ICON_SVG;
    shareButton.disabled = !task.completed;
    shareButton.title = task.completed ? '完了を𝕏にシェア' : '完了するとシェアできます';
    shareButton.classList.toggle('todox-action-button--disabled', !task.completed);
    shareButton.addEventListener('click', () => shareTask(task));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'todox-action-button';
    deleteButton.setAttribute('aria-label', 'タスクを削除');
    deleteButton.textContent = '✕';
    deleteButton.addEventListener('click', () => removeTask(task.id));

    actions.appendChild(focusButton);
    actions.appendChild(shareButton);
    actions.appendChild(deleteButton);

    item.appendChild(completeButton);
    item.appendChild(content);
    item.appendChild(actions);

    todoList.appendChild(item);
  });

  updateProgressIndicator();
  updateHistoryButton();
  updateTimerDisplays();
  updateStateSnapshot();
}

function updateProgressIndicator() {
  if (!progressIndicator) {
    return;
  }

  const completed = tasks.filter((task) => task.completed).length;
  const total = tasks.length;
  progressIndicator.textContent = `${completed}/${total} 完了`;
}

function updateHistoryButton() {
  if (!historyButton) {
    return;
  }
  const count = completedHistory.length;
  historyButton.textContent = count > 0 ? `履歴を開く (${count})` : '履歴を開く';
}

function updateTimerDisplays() {
  timerElements.forEach((element, taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !element) {
      return;
    }
    element.textContent = formatDuration(getTaskElapsed(task));
  });

  focusButtons.forEach((button, taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !button) {
      return;
    }
    const isRunning = Boolean(task.runningSince);
    button.innerHTML = isRunning ? '⏸' : '▶';
    button.disabled = task.completed;
    button.title = task.completed
      ? '完了済みのタスクはフォーカスできません'
      : isRunning
        ? '一時停止'
        : 'このタスクでフォーカスを開始';
    button.setAttribute('aria-label', task.completed
      ? '完了済みのタスクはフォーカスできません'
      : isRunning
        ? 'フォーカスを一時停止'
        : 'このタスクに集中');
    button.classList.toggle('todox-action-button--active', isRunning);
  });
}

function updateTimerLoop() {
  const shouldRun = Boolean(tasks.find((task) => task.runningSince));
  if (shouldRun && !timerInterval) {
    timerInterval = setInterval(() => {
      updateTimerDisplays();
    }, 1000);
  } else if (!shouldRun && timerInterval) {
    clearInterval(timerInterval);
    timerInterval = undefined;
  }
}

function restoreActiveTimer() {
  const runningTask = tasks.find((task) => task.runningSince);
  if (runningTask) {
    activeTaskId = runningTask.id;
    updateTimerLoop();
  } else {
    activeTaskId = undefined;
    updateTimerLoop();
  }
  updateTimerDisplays();
}

function getTaskElapsed(task) {
  const base = task.elapsedMs || 0;
  if (task.runningSince) {
    return base + Math.max(0, Date.now() - task.runningSince);
  }
  return base;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const parts = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0'));
  if (hours === 0) {
    return `${parts[1]}:${parts[2]}`;
  }
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

function recordCompletion(task) {
  const entry = {
    id: task.id,
    text: task.text,
    createdAt: task.createdAt,
    completedAt: task.completedAt ?? Date.now(),
    elapsedMs: task.elapsedMs || 0
  };
  const existingIndex = completedHistory.findIndex((item) => item.id === entry.id);
  if (existingIndex >= 0) {
    completedHistory.splice(existingIndex, 1);
  }
  completedHistory.unshift(entry);
  completedHistory = completedHistory.slice(0, HISTORY_LIMIT);
  persistHistory();
  updateHistoryButton();
}

function removeFromHistory(taskId) {
  const beforeLength = completedHistory.length;
  completedHistory = completedHistory.filter((entry) => entry.id !== taskId);
  if (completedHistory.length !== beforeLength) {
    persistHistory();
    updateHistoryButton();
  }
}

function openHistoryPage() {
  const baseUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('completed.html')
    : 'completed.html';
  window.open(baseUrl, '_blank', 'noopener');
}

function ensureLocationWatcher() {
  if (locationInterval) {
    return;
  }
  locationInterval = setInterval(() => {
    if (location.href === lastKnownHref) {
      return;
    }
    lastKnownHref = location.href;
    stopHeartbeat();
    currentSidebar = undefined;
    waitForSidebar();
  }, LOCATION_CHECK_INTERVAL_MS);
}

function startHeartbeat() {
  if (!currentSidebar) {
    return;
  }
  stopHeartbeat();
  collapseSidebarSections(currentSidebar);
  ensureTodoPanel(currentSidebar);
  heartbeatInterval = setInterval(() => {
    if (!currentSidebar || !document.contains(currentSidebar)) {
      currentSidebar = undefined;
      waitForSidebar();
      return;
    }
    collapseSidebarSections(currentSidebar);
    ensureTodoPanel(currentSidebar);
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = undefined;
  }
}

function startStateWatcher() {
  if (stateWatcherAttached) {
    return;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    const handleSyncChange = (changes, areaName) => {
      if (areaName && areaName !== 'sync') {
        return;
      }
      let nextTasks;
      let nextHistory;
      let didUpdate = false;
      if (changes[STORAGE_KEY]) {
        nextTasks = normaliseTasks(changes[STORAGE_KEY].newValue);
        didUpdate = true;
      }
      if (changes[STORAGE_HISTORY_KEY]) {
        nextHistory = normaliseHistory(changes[STORAGE_HISTORY_KEY].newValue);
        didUpdate = true;
      }
      if (didUpdate) {
        applyExternalState(nextTasks ?? tasks, nextHistory ?? completedHistory);
      }
    };
    chrome.storage.onChanged.addListener(handleSyncChange);
    window.addEventListener('beforeunload', () => {
      try {
        chrome.storage.onChanged.removeListener(handleSyncChange);
      } catch (error) {
        console.error('TodoX failed to detach storage listener', error);
      }
    }, { once: true });
    stateWatcherAttached = true;
    return;
  }

  window.addEventListener('storage', handleLocalStorageEvent);
  stateWatcherAttached = true;
  startLocalStoragePolling();
}

function handleLocalStorageEvent(event) {
  if (!event.key || (event.key !== STORAGE_KEY && event.key !== STORAGE_HISTORY_KEY)) {
    return;
  }
  syncFromLocalStorage();
}

function startLocalStoragePolling() {
  if (localStoragePollInterval) {
    return;
  }
  syncFromLocalStorage();
  localStoragePollInterval = setInterval(() => {
    syncFromLocalStorage();
  }, STORAGE_POLL_INTERVAL_MS);
}

function syncFromLocalStorage() {
  try {
    const tasksRaw = window.localStorage?.getItem(STORAGE_KEY);
    const historyRaw = window.localStorage?.getItem(STORAGE_HISTORY_KEY);
    const nextTasks = normaliseTasks(tasksRaw === null ? undefined : JSON.parse(tasksRaw));
    const nextHistory = normaliseHistory(historyRaw === null ? undefined : JSON.parse(historyRaw));
    applyExternalState(nextTasks, nextHistory);
  } catch (error) {
    console.error('TodoX failed to sync localStorage state', error);
  }
}

function applyExternalState(nextTasks, nextHistory) {
  const safeTasks = Array.isArray(nextTasks) ? nextTasks : [];
  const safeHistory = Array.isArray(nextHistory) ? nextHistory : [];
  const incomingSnapshot = snapshotStateFrom(safeTasks, safeHistory);
  if (incomingSnapshot === lastSerializedState) {
    return;
  }
  tasks = safeTasks;
  completedHistory = safeHistory;
  reorderTasks();
  renderTasks();
  restoreActiveTimer();
}

function snapshotStateFrom(nextTasks, nextHistory) {
  const safeTasks = Array.isArray(nextTasks) ? nextTasks : [];
  const safeHistory = Array.isArray(nextHistory) ? nextHistory : [];
  return JSON.stringify({
    tasks: safeTasks.map(stripTaskForSnapshot),
    history: safeHistory.map(stripHistoryForSnapshot)
  });
}

function stripTaskForSnapshot(task) {
  return {
    id: task.id,
    text: task.text,
    completed: task.completed,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    elapsedMs: task.elapsedMs,
    runningSince: task.runningSince || undefined
  };
}

function stripHistoryForSnapshot(entry) {
  return {
    id: entry.id,
    text: entry.text,
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
    elapsedMs: entry.elapsedMs
  };
}

function updateStateSnapshot() {
  if (!tasks || !completedHistory) {
    return;
  }
  lastSerializedState = snapshotStateFrom(tasks, completedHistory);
}

waitForSidebar();
