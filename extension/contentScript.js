const SECTION_TITLES_TO_COLLAPSE = [
  "本日のニュース",
  "プレミアムにサブスクライブ",
  "今を見つけよう"
];

const STORAGE_KEY = "todoxTasks";
const MAX_TASKS = 6;

const defaultBase = Date.now();

const DEFAULT_TASKS = [
  {
    id: "plan-day",
    text: "今日のTODOを決める",
    completed: false,
    createdAt: defaultBase + 3
  },
  {
    id: "top-priority",
    text: "最優先タスクに30分集中",
    completed: false,
    createdAt: defaultBase + 2
  },
  {
    id: "inbox-zero",
    text: "受信トレイを整理",
    completed: false,
    createdAt: defaultBase + 1
  },
  {
    id: "check-in",
    text: "チームに進捗を共有",
    completed: false,
    createdAt: defaultBase
  }
];

let tasks = [];
let todoContainer;
let todoList;
let newTaskInput;
let progressIndicator;
let isComposing = false;

function waitForSidebar() {
  const sidebar = document.querySelector('aside[role="complementary"], aside[aria-label]');
  if (sidebar) {
    initialiseTodoX(sidebar);
    return;
  }

  const observer = new MutationObserver(() => {
    const detected = document.querySelector('aside[role="complementary"], aside[aria-label]');
    if (detected) {
      observer.disconnect();
      initialiseTodoX(detected);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function initialiseTodoX(sidebar) {
  collapseSidebarSections(sidebar);
  injectTodoPanel(sidebar);
  loadTasks().then(() => {
    reorderTasks();
    renderTasks();
  });
  observeSidebar(sidebar);
}

function observeSidebar(sidebar) {
  const observer = new MutationObserver(() => {
    collapseSidebarSections(sidebar);
  });

  observer.observe(sidebar, { childList: true, subtree: true });
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
  if (sidebar.querySelector('.todox-panel')) {
    todoContainer = sidebar.querySelector('.todox-panel');
    todoList = todoContainer.querySelector('.todox-list');
    newTaskInput = todoContainer.querySelector('.todox-input');
    progressIndicator = todoContainer.querySelector('.todox-panel__progress');
    bindNewTaskInput();
    return;
  }

  todoContainer = document.createElement('section');
  todoContainer.className = 'todox-panel';

  const header = document.createElement('header');
  header.className = 'todox-panel__header';

  const title = document.createElement('h2');
  title.textContent = 'Focus Today';
  title.className = 'todox-panel__title';

  progressIndicator = document.createElement('span');
  progressIndicator.className = 'todox-panel__progress';
  progressIndicator.setAttribute('aria-live', 'polite');
  progressIndicator.textContent = '0/0 完了';

  const shareHint = document.createElement('span');
  shareHint.className = 'todox-panel__hint';
  shareHint.textContent = '達成したタスクはXにシェアできます';

  header.appendChild(title);
  header.appendChild(progressIndicator);
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

  sidebar.insertBefore(todoContainer, sidebar.firstChild);

  bindNewTaskInput();
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

function loadTasks() {
  return new Promise((resolve) => {
    const fromChromeStorage = !!(typeof chrome !== 'undefined' && chrome.storage?.sync);

    if (fromChromeStorage) {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        if (chrome.runtime?.lastError) {
          tasks = [...DEFAULT_TASKS];
          resolve(tasks);
          return;
        }

        const storedTasks = result[STORAGE_KEY];
        tasks = storedTasks === undefined
          ? [...DEFAULT_TASKS]
          : normaliseTasks(storedTasks);
        resolve(tasks);
      });
      return;
    }

    try {
      const stored = window.localStorage?.getItem(STORAGE_KEY);
      tasks = stored === null
        ? [...DEFAULT_TASKS]
        : normaliseTasks(JSON.parse(stored));
      resolve(tasks);
    } catch (error) {
      console.error('TodoX failed to load tasks from localStorage', error);
      tasks = [...DEFAULT_TASKS];
      resolve(tasks);
    }
  });
}

function persistTasks() {
  const payload = tasks.slice(0, MAX_TASKS);

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    chrome.storage.sync.set({ [STORAGE_KEY]: payload });
    return;
  }

  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('TodoX failed to persist tasks', error);
  }
}

function addTask(text) {
  const newTask = {
    id: `task-${Date.now()}`,
    text,
    completed: false,
    createdAt: Date.now()
  };

  tasks.unshift(newTask);
  tasks = tasks.slice(0, MAX_TASKS);
  reorderTasks();
  persistTasks();
  renderTasks();
}

function toggleTaskCompletion(taskId) {
  tasks = tasks.map((task) =>
    task.id === taskId
      ? { ...task, completed: !task.completed, completedAt: Date.now() }
      : task
  );
  reorderTasks();
  persistTasks();
  renderTasks();
}

function shareTask(task) {
  if (!task.completed) {
    return;
  }
  const base = 'https://x.com/intent/tweet';
  const text = encodeURIComponent(`完了: ${task.text}`);
  const url = `${base}?text=${text}`;
  window.open(url, '_blank', 'noopener');
}

function removeTask(taskId) {
  tasks = tasks.filter((task) => task.id !== taskId);
  reorderTasks();
  persistTasks();
  renderTasks();
}

function normaliseTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) {
    return [...DEFAULT_TASKS];
  }

  const now = Date.now();
  const hydrated = rawTasks.slice(0, MAX_TASKS).map((task, index) => ({
    id: task?.id || `task-${now}-${index}`,
    text: String(task?.text || '').trim(),
    completed: Boolean(task?.completed),
    createdAt: typeof task?.createdAt === 'number' ? task.createdAt : now + index,
    completedAt: typeof task?.completedAt === 'number' ? task.completedAt : undefined
  })).filter((task) => task.text.length > 0);

  if (hydrated.length === 0) {
    return [];
  }

  const deduped = Array.from(new Map(hydrated.map((task) => [task.id, task])).values());
  return deduped.slice(0, MAX_TASKS);
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

    const text = document.createElement('span');
    text.className = 'todox-task-text';
    text.textContent = task.text;

    const actions = document.createElement('div');
    actions.className = 'todox-actions';

    const shareButton = document.createElement('button');
    shareButton.className = 'todox-action-button';
    shareButton.setAttribute('aria-label', 'Xにシェア');
    shareButton.textContent = '↗';
    shareButton.disabled = !task.completed;
    shareButton.title = task.completed ? '完了をXにシェア' : '完了するとシェアできます';
    shareButton.classList.toggle('todox-action-button--disabled', !task.completed);
    shareButton.addEventListener('click', () => shareTask(task));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'todox-action-button';
    deleteButton.setAttribute('aria-label', 'タスクを削除');
    deleteButton.textContent = '✕';
    deleteButton.addEventListener('click', () => removeTask(task.id));

    actions.appendChild(shareButton);
    actions.appendChild(deleteButton);

    item.appendChild(completeButton);
    item.appendChild(text);
    item.appendChild(actions);

    todoList.appendChild(item);
  });

  updateProgressIndicator();
}

function updateProgressIndicator() {
  if (!progressIndicator) {
    return;
  }

  const completed = tasks.filter((task) => task.completed).length;
  const total = tasks.length;
  progressIndicator.textContent = `${completed}/${total} 完了`;
}

waitForSidebar();
