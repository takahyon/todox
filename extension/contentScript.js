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

const PREMIUM_FEATURE_MAP =
  typeof window !== "undefined" && window.TODOX_PREMIUM_FEATURES
    ? window.TODOX_PREMIUM_FEATURES
    : { themes: "themes", focusBgm: "focus_bgm", analytics: "local_analytics" };

class FocusBgmController {
  constructor() {
    this.audioContext = null;
    this.currentTrack = "none";
    this.active = false;
    this.source = null;
    this.buffers = {};
  }

  async ensureContext() {
    if (this.audioContext) {
      return this.audioContext;
    }
    const Context = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
    if (!Context) {
      return null;
    }
    this.audioContext = new Context();
    return this.audioContext;
  }

  async update(track, shouldBeActive) {
    this.currentTrack = track || "none";
    this.active = shouldBeActive;
    if (!this.active || !this.currentTrack || this.currentTrack === "none") {
      this.stop();
      return;
    }
    const ctx = await this.ensureContext();
    if (!ctx) {
      return;
    }
    if (typeof ctx.resume === "function") {
      try {
        await ctx.resume();
      } catch (error) {
        // ignore resume errors
      }
    }
    this.stop();
    const buffer = await this.getBuffer(ctx, this.currentTrack);
    if (!buffer) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(ctx.destination);
    try {
      source.start();
      this.source = source;
    } catch (error) {
      // ignore start errors
    }
  }

  stop() {
    if (this.source) {
      try {
        this.source.stop();
      } catch (error) {
        // ignore stop errors
      }
      try {
        this.source.disconnect();
      } catch (error) {
        // ignore disconnect errors
      }
      this.source = null;
    }
  }

  async getBuffer(ctx, track) {
    if (this.buffers[track]) {
      return this.buffers[track];
    }
    const duration = track === "cafe" ? 8 : 4;
    const buffer = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    if (track === "cafe") {
      let lastValue = 0;
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1;
        lastValue = (lastValue + 0.02 * white) / 1.02;
        data[i] = Math.max(-1, Math.min(1, lastValue)) * 0.3;
      }
    } else if (track === "white") {
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * 0.2;
      }
    } else {
      return null;
    }
    this.buffers[track] = buffer;
    return buffer;
  }
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
    this.completedContainer = null;
    this.completedCelebrationEl = null;
    this.progressEl = null;
    this.newTaskInput = null;
    this.isComposing = false;
    this.heartbeatInterval = null;
    this.locationInterval = null;
    this.timerInterval = null;
    this.activeTaskId = null;
    this.sidebarObserver = null;
    this.detachStorageListener = null;
    this.detachPremiumListener = null;
    this.lastLocation = location.href;
    this.cleanupRegistered = false;
    this.focusSponsorEl = null;
    this.focusSponsorLink = null;
    this.focusSponsorDismissButton = null;
    this.settingsDetails = null;
    this.redeemInput = null;
    this.redeemStatusEl = null;
    this.redeemMessageEl = null;
    this.themeSelect = null;
    this.bgmSelect = null;
    this.analyticsSection = null;
    this.analyticsValues = {
      today: null,
      week: null,
      average: null,
    };
    this.telemetryToggle = null;
    this.archiveButton = null;
    this.bgmController = new FocusBgmController();
    this.pendingSponsorRequest = null;
    this.premium = typeof window !== "undefined" ? window.TODOX_PREMIUM : null;
    this.sponsorsManager =
      typeof window !== "undefined" && window.TodoxSponsorsManager
        ? new window.TodoxSponsorsManager({ premiumManager: this.premium })
        : null;
    this.focusToggleApi = null;
    this.focusToggleState = { mode: "off", remainingMinutes: 0 };
    this.focusToggleUnsubscribe = null;
    this.focusToggleButton = null;
    this.focusToggleBadge = null;
    this.focusPopover = null;
    this.focusPopoverForm = null;
    this.focusPopoverModeRadios = null;
    this.focusPopoverDurationRadios = null;
    this.focusPopoverCustomInput = null;
    this.focusPopoverBgmSelect = null;
    this.focusPopoverFabToggle = null;
    this.focusPopoverCloseButton = null;
    this.focusPopoverOpen = false;
    this.focusPopoverPreventNextClick = false;
    this.focusPopoverOutsideHandler = null;
    this.focusLongPressTimer = null;
    this.focusOverlay = null;
    this.focusOverlayLabel = null;
    this.focusOverlayTimer = null;
    this.focusOverlayStopButton = null;
    this.focusOverlaySponsor = null;
    this.focusOverlaySponsorLink = null;
    this.focusOverlaySponsorDismiss = null;
    this.focusOverlaySponsorRequest = null;
    this.focusFab = null;
    this.focusConfig = this.resolveFocusConfig();
  }

  async start() {
    if (this.premium && typeof this.premium.init === 'function') {
      try {
        await this.premium.init();
      } catch (error) {
        console.error('TodoX failed to initialise premium manager', error);
      }
      if (typeof this.premium.onChange === 'function' && !this.detachPremiumListener) {
        this.detachPremiumListener = this.premium.onChange(() => {
          this.updatePremiumUI();
          this.refreshSponsorBanner();
          this.updateFocusAudio();
        });
      }
    }
    if (this.sponsorsManager && typeof this.sponsorsManager.init === 'function') {
      try {
        await this.sponsorsManager.init();
      } catch (error) {
        console.warn('TodoX failed to load sponsors configuration', error);
      }
    }

    this.initFocusToggle();

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
      if (this.detachPremiumListener) {
        this.detachPremiumListener();
        this.detachPremiumListener = null;
      }
      if (this.detachStorageListener) {
        this.detachStorageListener();
        this.detachStorageListener = null;
      }
      if (this.focusToggleUnsubscribe) {
        try {
          this.focusToggleUnsubscribe();
        } catch (error) {
          // ignore cleanup errors
        }
        this.focusToggleUnsubscribe = null;
      }
      if (this.focusPopoverOutsideHandler) {
        document.removeEventListener('mousedown', this.focusPopoverOutsideHandler);
        this.focusPopoverOutsideHandler = null;
      }
    });
  }

  resolveFocusConfig() {
    const config = (typeof window !== 'undefined' && window.TODOX_CONFIG) || {};
    const shortcutEnabled = typeof config.focusShortcutEnabled === 'boolean' ? config.focusShortcutEnabled : true;
    const modeValue =
      typeof config.focusDefaultMode === 'string' ? config.focusDefaultMode.trim().toLowerCase() : '';
    const defaultMode =
      modeValue === 'kichiku' || modeValue === 'soft'
        ? modeValue
        : modeValue === 'off'
        ? 'off'
        : 'soft';
    const parsedMinutes = Number(config.focusDefaultMinutes);
    const defaultMinutes = Number.isFinite(parsedMinutes) ? parsedMinutes : 15;
    const fabEnabled = typeof config.focusFabEnabled === 'boolean' ? config.focusFabEnabled : false;
    return {
      shortcutEnabled,
      defaultMode,
      defaultMinutes,
      fabEnabled,
    };
  }

  initFocusToggle() {
    if (typeof window === 'undefined' || !window.TodoxFocusToggle) {
      return;
    }
    try {
      window.TodoxFocusToggle.init(this.focusConfig);
    } catch (error) {
      console.warn('TodoX failed to initialise focus toggle store', error);
    }
    try {
      this.focusToggleApi = window.TodoxFocusToggle.useFocusToggle();
    } catch (error) {
      console.warn('TodoX failed to acquire focus toggle API', error);
      this.focusToggleApi = null;
    }
    if (!this.focusToggleApi) {
      return;
    }
    const subscribe =
      typeof this.focusToggleApi.subscribe === 'function'
        ? this.focusToggleApi.subscribe
        : this.focusToggleApi.actions && typeof this.focusToggleApi.actions.subscribe === 'function'
        ? this.focusToggleApi.actions.subscribe
        : null;
    if (subscribe && !this.focusToggleUnsubscribe) {
      try {
        this.focusToggleUnsubscribe = subscribe((state) => {
          this.focusToggleState = state;
          this.handleFocusStateChange(state);
        });
      } catch (error) {
        console.warn('TodoX focus toggle subscription failed', error);
      }
    }
    if (this.focusToggleApi.state) {
      this.focusToggleState = this.focusToggleApi.state;
      this.handleFocusStateChange(this.focusToggleState);
    }
  }

  handleFocusStateChange(state) {
    if (!state) {
      return;
    }
    this.updateFocusToggleUI();
    this.updateFocusOverlay();
    this.updateFocusFab();
    this.updateFocusAudio();
    this.refreshFocusSponsor();
  }

  setupFocusToggleButton() {
    if (!this.focusToggleButton) {
      return;
    }
    this.focusToggleButton.addEventListener('click', (event) => {
      if (this.focusPopoverPreventNextClick) {
        this.focusPopoverPreventNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.handleFocusButtonClick(event);
    });
    this.focusToggleButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleFocusButtonClick(event);
      } else if (event.key === 'ArrowDown' && event.altKey) {
        event.preventDefault();
        this.openFocusPopover(this.focusToggleButton);
      }
    });
    this.focusToggleButton.addEventListener('pointerdown', (event) => {
      this.handleFocusPointerDown(event);
    });
    this.focusToggleButton.addEventListener('pointerup', () => {
      this.clearFocusLongPressTimer();
    });
    this.focusToggleButton.addEventListener('pointerleave', () => {
      this.clearFocusLongPressTimer();
    });
    this.focusToggleButton.addEventListener('pointercancel', () => {
      this.clearFocusLongPressTimer();
    });
  }

  handleFocusPointerDown(event) {
    if (!event) {
      return;
    }
    if (event.button !== 0 && event.pointerType !== 'touch') {
      return;
    }
    if (!this.focusToggleButton) {
      return;
    }
    this.clearFocusLongPressTimer();
    this.focusLongPressTimer = setTimeout(() => {
      this.focusPopoverPreventNextClick = true;
      this.openFocusPopover(this.focusToggleButton);
    }, 400);
  }

  clearFocusLongPressTimer() {
    if (this.focusLongPressTimer) {
      clearTimeout(this.focusLongPressTimer);
      this.focusLongPressTimer = null;
    }
  }

  handleFocusButtonClick(event) {
    if (!this.focusToggleApi || !this.focusToggleApi.actions) {
      return;
    }
    this.clearFocusLongPressTimer();
    if (this.focusPopoverOpen) {
      this.closeFocusPopover();
    }
    const mode = this.focusToggleState?.mode || 'off';
    if (mode === 'off') {
      if (event && event.shiftKey && typeof this.focusToggleApi.actions.cycle === 'function') {
        this.focusToggleApi.actions.cycle();
      } else if (typeof this.focusToggleApi.actions.cycle === 'function') {
        this.focusToggleApi.actions.cycle();
      }
      return;
    }
    if (event && event.shiftKey && typeof this.focusToggleApi.actions.cycle === 'function') {
      this.focusToggleApi.actions.cycle();
    } else if (typeof this.focusToggleApi.actions.stop === 'function') {
      this.focusToggleApi.actions.stop();
    }
  }

  ensureFocusPopover() {
    if (this.focusPopover) {
      return this.focusPopover;
    }
    const popover = document.createElement('div');
    popover.className = 'todox-focus-popover';
    popover.role = 'dialog';
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('hidden', '');
    popover.innerHTML = `
      <form class="todox-focus-popover__form">
        <header class="todox-focus-popover__header">
          <h3 class="todox-focus-popover__title">Focus モード</h3>
          <button type="button" class="todox-focus-popover__close" aria-label="閉じる">×</button>
        </header>
        <fieldset class="todox-focus-popover__group">
          <legend>モード</legend>
          <label class="todox-focus-popover__option">
            <input type="radio" name="focusMode" value="soft" />
            <span>Soft</span>
          </label>
          <label class="todox-focus-popover__option">
            <input type="radio" name="focusMode" value="kichiku" />
            <span>Kichiku</span>
          </label>
        </fieldset>
        <fieldset class="todox-focus-popover__group">
          <legend>時間 (分)</legend>
          <div class="todox-focus-popover__durations"></div>
          <label class="todox-focus-popover__option todox-focus-popover__option--custom">
            <input type="number" name="customMinutes" min="1" max="120" inputmode="numeric" />
            <span>カスタム</span>
          </label>
        </fieldset>
        <fieldset class="todox-focus-popover__group todox-focus-popover__group--bgm" hidden>
          <legend>BGM</legend>
          <label class="todox-focus-popover__option">
            <span class="todox-focus-popover__select-label">トラック</span>
            <select name="focusBgm">
              <option value="none">BGMなし</option>
              <option value="cafe">Cafe ambience</option>
              <option value="white">White noise</option>
            </select>
          </label>
        </fieldset>
        <label class="todox-focus-popover__fab">
          <input type="checkbox" name="focusFab" />
          <span>フローティングボタンを表示</span>
        </label>
        <footer class="todox-focus-popover__footer">
          <button type="submit" class="todox-focus-popover__primary">開始</button>
          <button type="button" class="todox-focus-popover__cancel">キャンセル</button>
        </footer>
      </form>
    `;
    document.body.appendChild(popover);
    this.focusPopover = popover;
    this.focusPopoverForm = popover.querySelector('.todox-focus-popover__form');
    this.focusPopoverModeRadios = Array.from(popover.querySelectorAll('input[name="focusMode"]'));
    this.focusPopoverDurationRadios = [];
    this.focusPopoverCustomInput = popover.querySelector('input[name="customMinutes"]');
    this.focusPopoverBgmSelect = popover.querySelector('select[name="focusBgm"]');
    this.focusPopoverFabToggle = popover.querySelector('input[name="focusFab"]');
    this.focusPopoverCloseButton = popover.querySelector('.todox-focus-popover__close');
    const cancelButton = popover.querySelector('.todox-focus-popover__cancel');
    this.focusPopoverForm?.addEventListener('submit', (event) => this.handleFocusPopoverSubmit(event));
    cancelButton?.addEventListener('click', () => this.closeFocusPopover());
    this.focusPopoverCloseButton?.addEventListener('click', () => this.closeFocusPopover());
    popover.addEventListener('keydown', (event) => this.handleFocusPopoverKeydown(event));
    if (!this.focusPopoverOutsideHandler) {
      this.focusPopoverOutsideHandler = (event) => {
        if (!this.focusPopoverOpen) {
          return;
        }
        if (this.focusPopover && !this.focusPopover.contains(event.target)) {
          this.closeFocusPopover();
        }
      };
      document.addEventListener('mousedown', this.focusPopoverOutsideHandler);
    }
    return popover;
  }

  openFocusPopover(anchor) {
    if (!this.focusToggleApi || !this.focusToggleApi.actions) {
      return;
    }
    const popover = this.ensureFocusPopover();
    if (!popover) {
      return;
    }
    this.populateFocusPopover();
    popover.removeAttribute('hidden');
    this.focusPopoverOpen = true;
    this.positionFocusPopover(anchor, popover);
    const focusTarget = this.focusPopoverForm?.querySelector('input[name="focusMode"]:checked');
    (focusTarget || this.focusPopoverForm)?.focus();
  }

  closeFocusPopover() {
    if (!this.focusPopoverOpen || !this.focusPopover) {
      return;
    }
    this.focusPopover.setAttribute('hidden', '');
    this.focusPopoverOpen = false;
    this.focusPopoverPreventNextClick = false;
    if (this.focusToggleButton) {
      this.focusToggleButton.focus();
    }
  }

  populateFocusPopover() {
    if (!this.focusToggleApi || !this.focusToggleApi.actions) {
      return;
    }
    const state = this.focusToggleState || { mode: 'off', remainingMinutes: 0 };
    const lastSelection = this.focusToggleApi.actions.getLastSelection
      ? this.focusToggleApi.actions.getLastSelection()
      : { mode: 'soft', durations: { soft: 15, kichiku: 15 } };
    const activeMode = state.mode !== 'off' ? state.mode : lastSelection.mode || 'soft';
    this.focusPopoverModeRadios?.forEach((radio) => {
      if (radio) {
        radio.checked = radio.value === activeMode;
      }
    });
    const durationsContainer = this.focusPopover?.querySelector('.todox-focus-popover__durations');
    if (durationsContainer) {
      durationsContainer.innerHTML = '';
      const baseDurations = [5, 10, 15, 20, 25, 30];
      baseDurations.forEach((minutes) => {
        const id = `focus-duration-${minutes}`;
        const label = document.createElement('label');
        label.className = 'todox-focus-popover__option';
        label.innerHTML = `
          <input type="radio" name="focusDuration" value="${minutes}" id="${id}" />
          <span>${minutes}分</span>
        `;
        durationsContainer.appendChild(label);
      });
      this.focusPopoverDurationRadios = Array.from(
        durationsContainer.querySelectorAll('input[name="focusDuration"]'),
      );
    }
    const preferred = lastSelection?.durations || {};
    const preferredMinutes = Number(preferred[activeMode]) || 15;
    let matched = false;
    this.focusPopoverDurationRadios?.forEach((input) => {
      if (!input) {
        return;
      }
      if (Number(input.value) === preferredMinutes) {
        input.checked = true;
        matched = true;
      } else {
        input.checked = false;
      }
    });
    if (this.focusPopoverCustomInput) {
      this.focusPopoverCustomInput.value = matched ? '' : String(preferredMinutes);
      this.focusPopoverCustomInput.disabled = !this.premium?.isActive?.();
    }
    if (this.focusPopoverFabToggle && this.focusToggleApi.actions.isFabVisible) {
      const visible = this.focusToggleApi.actions.isFabVisible();
      this.focusPopoverFabToggle.checked = Boolean(visible);
    }
    const bgmGroup = this.focusPopover?.querySelector('.todox-focus-popover__group--bgm');
    if (bgmGroup) {
      const canUseBgm = this.canUseBgmFeature();
      bgmGroup.hidden = !canUseBgm;
      if (canUseBgm && this.focusPopoverBgmSelect && this.focusToggleApi.actions.getBgmTrack) {
        this.focusPopoverBgmSelect.value = this.focusToggleApi.actions.getBgmTrack();
      }
      if (!canUseBgm && this.focusPopoverBgmSelect) {
        this.focusPopoverBgmSelect.value = 'none';
      }
    }
  }

  positionFocusPopover(anchor, popover) {
    if (!anchor || !popover) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 280;
    const height = popover.offsetHeight || 240;
    let top = rect.bottom + 8;
    let left = rect.left;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (left + width > viewportWidth - 12) {
      left = Math.max(12, viewportWidth - width - 12);
    }
    if (top + height > viewportHeight - 12) {
      top = Math.max(12, rect.top - height - 8);
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  handleFocusPopoverKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeFocusPopover();
    }
    if (event.key === 'Enter' && event.target === this.focusPopover) {
      event.preventDefault();
      this.focusPopoverForm?.requestSubmit();
    }
  }

  handleFocusPopoverSubmit(event) {
    event.preventDefault();
    if (!this.focusToggleApi || !this.focusToggleApi.actions) {
      this.closeFocusPopover();
      return;
    }
    const modeRadio = this.focusPopoverForm?.querySelector('input[name="focusMode"]:checked');
    const durationRadio = this.focusPopoverForm?.querySelector('input[name="focusDuration"]:checked');
    const mode = modeRadio ? modeRadio.value : 'soft';
    let minutes = durationRadio ? Number(durationRadio.value) : NaN;
    const customValue = this.focusPopoverCustomInput ? Number(this.focusPopoverCustomInput.value) : NaN;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      minutes = customValue;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      minutes = mode === 'kichiku' ? 20 : 15;
    }
    if (this.focusPopoverBgmSelect && this.focusToggleApi.actions.setBgmTrack) {
      this.focusToggleApi.actions.setBgmTrack(this.focusPopoverBgmSelect.value || 'none');
    }
    if (this.focusPopoverFabToggle && this.focusToggleApi.actions.setFabVisible) {
      this.focusToggleApi.actions.setFabVisible(this.focusPopoverFabToggle.checked);
    }
    if (typeof this.focusToggleApi.actions.start === 'function') {
      this.focusToggleApi.actions.start(mode, minutes);
    }
    this.closeFocusPopover();
  }

  updateFocusToggleUI() {
    if (!this.focusToggleButton || !this.focusToggleApi) {
      return;
    }
    const labelEl = this.focusToggleButton.querySelector('.todox-focus-toggle__text');
    const mode = this.focusToggleState?.mode || 'off';
    const remaining = this.focusToggleState?.remainingMinutes || 0;
    const isActive = mode !== 'off';
    this.focusToggleButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    this.focusToggleButton.dataset.mode = mode;
    let label = 'Focus';
    let tooltip = 'フォーカスモードを開始';
    if (mode === 'soft') {
      label = 'Focus · Soft';
      tooltip = `Soft Focus · ${String(remaining).padStart(2, '0')}m left`;
    } else if (mode === 'kichiku') {
      label = 'Focus · Lock';
      tooltip = `Kichiku · ${String(remaining).padStart(2, '0')}m left`;
    }
    if (labelEl) {
      labelEl.textContent = label;
    }
    if (this.focusToggleBadge) {
      if (isActive) {
        this.focusToggleBadge.hidden = false;
        this.focusToggleBadge.textContent = String(Math.max(0, remaining)).padStart(2, '0');
      } else {
        this.focusToggleBadge.hidden = true;
      }
    }
    this.focusToggleButton.title = tooltip;
    const ariaLabelBase = mode === 'off' ? 'フォーカスモードを開始' : 'フォーカスモードを終了';
    this.focusToggleButton.setAttribute('aria-label', `${ariaLabelBase}${mode === 'off' ? '' : ` (${label})`}`);
  }

  ensureFocusOverlay() {
    if (this.focusOverlay) {
      return this.focusOverlay;
    }
    const overlay = document.createElement('div');
    overlay.className = 'todox-focus-overlay';
    overlay.setAttribute('hidden', '');
    overlay.innerHTML = `
      <div class="todox-focus-overlay__backdrop" aria-hidden="true"></div>
      <div class="todox-focus-overlay__panel" role="dialog" aria-modal="true">
        <p class="todox-focus-overlay__label">Focus</p>
        <p class="todox-focus-overlay__timer">00分</p>
        <button type="button" class="todox-focus-overlay__stop">解除</button>
        <div class="todox-focus-overlay__sponsor" hidden>
          <span class="todox-focus-overlay__sponsor-badge" aria-hidden="true">💖</span>
          <a class="todox-focus-overlay__sponsor-link" target="_blank" rel="noopener noreferrer"></a>
          <button type="button" class="todox-focus-overlay__sponsor-dismiss" aria-label="スポンサーを閉じる">×</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.focusOverlay = overlay;
    this.focusOverlayLabel = overlay.querySelector('.todox-focus-overlay__label');
    this.focusOverlayTimer = overlay.querySelector('.todox-focus-overlay__timer');
    this.focusOverlayStopButton = overlay.querySelector('.todox-focus-overlay__stop');
    this.focusOverlaySponsor = overlay.querySelector('.todox-focus-overlay__sponsor');
    this.focusOverlaySponsorLink = overlay.querySelector('.todox-focus-overlay__sponsor-link');
    this.focusOverlaySponsorDismiss = overlay.querySelector('.todox-focus-overlay__sponsor-dismiss');
    this.focusOverlayStopButton?.addEventListener('click', () => {
      if (this.focusToggleApi?.actions?.stop) {
        this.focusToggleApi.actions.stop();
      }
    });
    this.focusOverlaySponsorDismiss?.addEventListener('click', () => {
      if (this.sponsorsManager && typeof this.sponsorsManager.dismissCurrentSponsor === 'function') {
        this.sponsorsManager.dismissCurrentSponsor();
      }
      this.hideFocusSponsor();
    });
    return overlay;
  }

  updateFocusOverlay() {
    if (!this.focusToggleApi) {
      return;
    }
    const overlay = this.ensureFocusOverlay();
    if (!overlay) {
      return;
    }
    const mode = this.focusToggleState?.mode || 'off';
    const remaining = this.focusToggleState?.remainingMinutes || 0;
    overlay.dataset.mode = mode;
    if (mode === 'off') {
      overlay.setAttribute('hidden', '');
      document.body.classList.remove('todox-focus-soft', 'todox-focus-kichiku');
      this.hideFocusSponsor();
      return;
    }
    overlay.removeAttribute('hidden');
    const labelText = mode === 'kichiku' ? 'Kichiku モード' : 'Soft Focus';
    if (this.focusOverlayLabel) {
      this.focusOverlayLabel.textContent = labelText;
    }
    if (this.focusOverlayTimer) {
      this.focusOverlayTimer.textContent = `残り ${String(Math.max(0, remaining)).padStart(2, '0')}分`;
    }
    if (this.focusOverlayStopButton) {
      this.focusOverlayStopButton.hidden = mode !== 'kichiku';
    }
    document.body.classList.toggle('todox-focus-soft', mode === 'soft');
    document.body.classList.toggle('todox-focus-kichiku', mode === 'kichiku');
  }

  refreshFocusSponsor() {
    if (!this.focusOverlaySponsor) {
      return;
    }
    if (!this.focusToggleState || this.focusToggleState.mode !== 'kichiku') {
      this.hideFocusSponsor();
      return;
    }
    if (this.premium?.isActive?.()) {
      this.hideFocusSponsor();
      return;
    }
    if (!this.sponsorsManager || typeof this.sponsorsManager.selectSponsor !== 'function') {
      this.hideFocusSponsor();
      return;
    }
    if (this.focusOverlaySponsor && !this.focusOverlaySponsor.hidden && this.focusOverlaySponsorLink?.textContent) {
      return;
    }
    const requestId = Symbol('focusSponsor');
    this.focusOverlaySponsorRequest = requestId;
    Promise.resolve(this.sponsorsManager.selectSponsor())
      .then((sponsor) => {
        if (this.focusOverlaySponsorRequest !== requestId) {
          return;
        }
        if (!sponsor || !sponsor.label || !sponsor.url) {
          this.hideFocusSponsor();
          return;
        }
        if (this.focusOverlaySponsorLink) {
          this.focusOverlaySponsorLink.textContent = sponsor.label;
          this.focusOverlaySponsorLink.href = sponsor.url;
        }
        if (this.focusOverlaySponsor) {
          this.focusOverlaySponsor.hidden = false;
        }
      })
      .catch(() => {
        this.hideFocusSponsor();
      });
  }

  hideFocusSponsor() {
    this.focusOverlaySponsorRequest = null;
    if (this.focusOverlaySponsor) {
      this.focusOverlaySponsor.hidden = true;
    }
    if (this.focusOverlaySponsorLink) {
      this.focusOverlaySponsorLink.textContent = '';
      this.focusOverlaySponsorLink.removeAttribute('href');
    }
  }

  ensureFocusFab() {
    if (this.focusFab) {
      return this.focusFab;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'todox-focus-fab';
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `
      <span class="todox-focus-fab__icon" aria-hidden="true">🎯</span>
      <span class="todox-focus-fab__label">Focus</span>
      <span class="todox-focus-fab__badge" hidden>00</span>
    `;
    button.addEventListener('click', (event) => {
      if (this.focusPopoverPreventNextClick) {
        this.focusPopoverPreventNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.handleFocusButtonClick(event);
    });
    button.addEventListener('pointerdown', (event) => this.handleFocusPointerDown(event));
    button.addEventListener('pointerup', () => this.clearFocusLongPressTimer());
    button.addEventListener('pointerleave', () => this.clearFocusLongPressTimer());
    button.addEventListener('pointercancel', () => this.clearFocusLongPressTimer());
    document.body.appendChild(button);
    this.focusFab = button;
    return button;
  }

  updateFocusFab() {
    if (!this.focusToggleApi || !this.focusToggleApi.actions) {
      if (this.focusFab) {
        this.focusFab.hidden = true;
      }
      return;
    }
    const isVisible = this.focusToggleApi.actions.isFabVisible
      ? this.focusToggleApi.actions.isFabVisible()
      : false;
    if (!isVisible) {
      if (this.focusFab) {
        this.focusFab.hidden = true;
      }
      return;
    }
    const fab = this.ensureFocusFab();
    if (!fab) {
      return;
    }
    const labelEl = fab.querySelector('.todox-focus-fab__label');
    const badge = fab.querySelector('.todox-focus-fab__badge');
    const mode = this.focusToggleState?.mode || 'off';
    const remaining = this.focusToggleState?.remainingMinutes || 0;
    const isActive = mode !== 'off';
    fab.hidden = false;
    fab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    let label = 'Focus';
    if (mode === 'soft') {
      label = 'Soft';
    } else if (mode === 'kichiku') {
      label = 'Lock';
    }
    if (labelEl) {
      labelEl.textContent = label;
    }
    if (badge) {
      if (isActive) {
        badge.hidden = false;
        badge.textContent = String(Math.max(0, remaining)).padStart(2, '0');
      } else {
        badge.hidden = true;
      }
    }
    fab.title = this.focusToggleButton ? this.focusToggleButton.title : 'Focus';
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
    this.updatePremiumUI();
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
          <div class="todox-panel__title-actions">
            <button
              class="todox-focus-toggle"
              type="button"
              aria-pressed="false"
              aria-haspopup="dialog"
              aria-label="フォーカスモードを開始"
            >
              <span class="todox-focus-toggle__icon" aria-hidden="true">🎯</span>
              <span class="todox-focus-toggle__text">Focus</span>
              <span class="todox-focus-toggle__badge" hidden>00</span>
            </button>
            <button class="todox-history-button" type="button">履歴を開く</button>
          </div>
        </div>
        <p class="todox-panel__progress" aria-live="polite"></p>
        <p class="todox-panel__hint">Enter でタスク追加、⌘⏎ で即時フォーカス</p>
        <div class="todox-focus-sponsor" hidden>
          <span class="todox-focus-sponsor__badge" aria-hidden="true">💖</span>
          <a class="todox-focus-sponsor__link" target="_blank" rel="noopener noreferrer"></a>
          <button class="todox-focus-sponsor__dismiss" type="button" aria-label="スポンサーを閉じる">×</button>
        </div>
      </header>
      <ul class="todox-list todox-list--active"></ul>
      <section class="todox-done" aria-live="polite">
        <details class="todox-done__details" open>
          <summary class="todox-done__summary">
            <div class="todox-done__header">
              <h3 class="todox-done__title">DoneX</h3>
              <span class="todox-done__subtitle">今日のがんばり</span>
              <button class="todox-done__archive" type="button">✨ 昇華</button>
            </div>
          </summary>
          <div class="todox-done__content">
            <p class="todox-done__empty" hidden>まだ完了したタスクはありません。</p>
            <ul class="todox-done__list"></ul>
            <p class="todox-done__more" hidden></p>
            <div class="todox-done__celebration" aria-hidden="true"></div>
          </div>
        </details>
      </section>
      <details class="todox-settings">
        <summary class="todox-settings__summary" aria-label="設定を開く">
          <span>⚙️ 設定</span>
        </summary>
        <div class="todox-settings__content">
          <section class="todox-settings__section todox-settings__section--premium">
            <h3 class="todox-settings__heading">TodoX+ プレミアム</h3>
            <p class="todox-settings__status">未アンロック</p>
            <form class="todox-redeem-form">
              <label class="todox-redeem-form__label">
                <span class="todox-redeem-form__text">🎁 コードを入力</span>
                <input class="todox-redeem-form__input" type="text" name="code" autocomplete="off" placeholder="例: XXXX.YYYY" aria-label="TodoX+ コード" />
              </label>
              <button class="todox-redeem-form__button" type="submit">Redeem</button>
            </form>
            <p class="todox-redeem-form__message" aria-live="polite"></p>
          </section>
          <section class="todox-settings__section todox-settings__section--theme">
            <h3 class="todox-settings__heading">🎨 テーマ</h3>
            <select class="todox-theme-select" aria-label="テーマを選択">
              <option value="default">Standard</option>
              <option value="dark">Dark</option>
              <option value="cafe">Cafe</option>
              <option value="sepia">Sepia</option>
            </select>
            <p class="todox-settings__helper">プレミアムでテーマを変更できます。</p>
          </section>
          <section class="todox-settings__section todox-settings__section--bgm">
            <h3 class="todox-settings__heading">🎧 フォーカスBGM</h3>
            <select class="todox-bgm-select" aria-label="フォーカスBGMを選択">
              <option value="none">BGMなし</option>
              <option value="cafe">Cafe ambience</option>
              <option value="white">White noise</option>
            </select>
            <p class="todox-settings__helper">フォーカス開始時に再生します。</p>
          </section>
          <section class="todox-settings__section todox-settings__section--analytics" hidden>
            <h3 class="todox-settings__heading">📈 フォーカス分析</h3>
            <dl class="todox-analytics">
              <div class="todox-analytics__row">
                <dt>今日</dt>
                <dd class="todox-analytics__value todox-analytics__value--today">-</dd>
              </div>
              <div class="todox-analytics__row">
                <dt>今週</dt>
                <dd class="todox-analytics__value todox-analytics__value--week">-</dd>
              </div>
              <div class="todox-analytics__row">
                <dt>平均/日</dt>
                <dd class="todox-analytics__value todox-analytics__value--average">-</dd>
              </div>
            </dl>
          </section>
          <section class="todox-settings__section todox-settings__section--telemetry">
            <label class="todox-telemetry-toggle">
              <input type="checkbox" class="todox-telemetry-toggle__input" />
              <span>匿名の利用状況を共有して品質向上に協力する (任意)</span>
            </label>
          </section>
        </div>
      </details>
      <footer class="todox-panel__footer">
        <p class="todox-panel__credit">
          developed by <a class="todox-panel__credit-link" target="_blank" rel="noopener noreferrer"></a>
        </p>
        <div class="todox-panel__promo" hidden></div>
      </footer>
    `;

    this.activeListEl = container.querySelector('.todox-list--active');
    this.completedContainer = container.querySelector('.todox-done');
    this.completedSection = container.querySelector('.todox-done__details');
    this.completedListEl = container.querySelector('.todox-done__list');
    this.completedEmptyEl = container.querySelector('.todox-done__empty');
    this.completedMoreEl = container.querySelector('.todox-done__more');
    this.completedCelebrationEl = container.querySelector('.todox-done__celebration');
    this.progressEl = container.querySelector('.todox-panel__progress');
    this.focusSponsorEl = container.querySelector('.todox-focus-sponsor');
    this.focusSponsorLink = container.querySelector('.todox-focus-sponsor__link');
    this.focusSponsorDismissButton = container.querySelector('.todox-focus-sponsor__dismiss');
    this.settingsDetails = container.querySelector('.todox-settings');
    this.redeemInput = container.querySelector('.todox-redeem-form__input');
    this.redeemStatusEl = container.querySelector('.todox-settings__status');
    this.redeemMessageEl = container.querySelector('.todox-redeem-form__message');
    this.themeSelect = container.querySelector('.todox-theme-select');
    this.bgmSelect = container.querySelector('.todox-bgm-select');
    this.analyticsSection = container.querySelector('.todox-settings__section--analytics');
    this.analyticsValues = {
      today: container.querySelector('.todox-analytics__value--today'),
      week: container.querySelector('.todox-analytics__value--week'),
      average: container.querySelector('.todox-analytics__value--average'),
    };
    this.telemetryToggle = container.querySelector('.todox-telemetry-toggle__input');
    this.archiveButton = container.querySelector('.todox-done__archive');
    this.focusToggleButton = container.querySelector('.todox-focus-toggle');
    this.focusToggleBadge = container.querySelector('.todox-focus-toggle__badge');
    const historyButton = container.querySelector('.todox-history-button');
    historyButton?.addEventListener('click', () => this.openHistory());
    if (this.focusToggleButton) {
      this.setupFocusToggleButton();
      this.updateFocusToggleUI();
    }
    this.focusSponsorDismissButton?.addEventListener('click', () => {
      if (this.sponsorsManager && typeof this.sponsorsManager.dismissCurrentSponsor === 'function') {
        this.sponsorsManager.dismissCurrentSponsor();
      }
      this.hideSponsorBanner();
    });
    const redeemForm = container.querySelector('.todox-redeem-form');
    redeemForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleRedeemSubmit();
    });
    this.themeSelect?.addEventListener('change', () => {
      this.handleThemeChange();
    });
    this.bgmSelect?.addEventListener('change', () => {
      this.handleBgmChange();
    });
    this.telemetryToggle?.addEventListener('change', () => {
      this.handleTelemetryToggle();
    });
    this.archiveButton?.addEventListener('click', () => {
      this.archiveCompletedTasks();
    });

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

  canUseThemeFeature() {
    return Boolean(this.premium?.hasFeature?.(PREMIUM_FEATURE_MAP.themes));
  }

  canUseBgmFeature() {
    return Boolean(this.premium?.hasFeature?.(PREMIUM_FEATURE_MAP.focusBgm));
  }

  canUseAnalyticsFeature() {
    return Boolean(this.premium?.hasFeature?.(PREMIUM_FEATURE_MAP.analytics));
  }

  async handleRedeemSubmit() {
    const code = this.redeemInput?.value.trim();
    if (!code) {
      this.setRedeemMessage('コードを入力してください', 'info');
      return;
    }
    this.setRedeemMessage('検証中…', 'info');
    const result = await this.premium?.redeem?.(code);
    if (result?.ok) {
      this.redeemInput.value = '';
      this.setRedeemMessage('TodoX+ がアンロックされました 🎉', 'success');
      this.updatePremiumUI();
    } else {
      this.setRedeemMessage(result?.error || 'コードの検証に失敗しました', 'error');
    }
  }

  setRedeemMessage(message, tone) {
    if (!this.redeemMessageEl) {
      return;
    }
    this.redeemMessageEl.textContent = message;
    this.redeemMessageEl.dataset.todoxTone = tone || '';
  }

  handleThemeChange() {
    if (!this.themeSelect) {
      return;
    }
    const value = this.themeSelect.value;
    if (!this.canUseThemeFeature()) {
      this.themeSelect.value = this.getActiveTheme();
      this.setRedeemMessage('テーマ変更は TodoX+ で利用できます', 'info');
      return;
    }
    this.premium?.setSelectedTheme?.(value);
    this.applyTheme(value);
  }

  handleBgmChange() {
    if (!this.bgmSelect) {
      return;
    }
    const value = this.bgmSelect.value;
    if (!this.canUseBgmFeature()) {
      this.bgmSelect.value = this.getSelectedBgm();
      this.setRedeemMessage('フォーカスBGMは TodoX+ で利用できます', 'info');
      return;
    }
    this.premium?.setSelectedBgm?.(value);
    this.updateFocusAudio();
  }

  handleTelemetryToggle() {
    if (!this.telemetryToggle) {
      return;
    }
    const enabled = this.telemetryToggle.checked;
    this.premium?.setTelemetryEnabled?.(enabled);
    this.setRedeemMessage(enabled ? '匿名診断の共有にご協力ありがとうございます！' : '匿名診断の共有をオフにしました', 'info');
  }

  getActiveTheme() {
    if (this.canUseThemeFeature()) {
      return this.premium?.getSelectedTheme?.() || 'default';
    }
    return 'default';
  }

  getSelectedBgm() {
    if (this.canUseBgmFeature()) {
      return this.premium?.getSelectedBgm?.() || 'none';
    }
    return 'none';
  }

  applyTheme(theme) {
    if (!this.panel) {
      return;
    }
    const themes = ['default', 'dark', 'cafe', 'sepia'];
    this.panel.classList.remove('todox-theme--dark', 'todox-theme--cafe', 'todox-theme--sepia');
    if (theme && theme !== 'default' && themes.includes(theme)) {
      this.panel.classList.add(`todox-theme--${theme}`);
    }
  }

  updatePremiumUI() {
    const isActive = this.premium?.isActive?.() || false;
    const payload = this.premium?.getLicensePayload?.() || null;
    const status = this.premium?.getStatus?.();
    if (this.redeemStatusEl) {
      const expiresAt = payload?.exp ? new Date(payload.exp * 1000) : null;
      let statusText = '未アンロック';
      if (isActive) {
        statusText = `TodoX+ 有効中 (〜${expiresAt ? expiresAt.toLocaleDateString() : '無期限'})`;
      } else if (status === 'verifying') {
        statusText = 'コードを検証中…';
      }
      this.redeemStatusEl.textContent = statusText;
      this.redeemStatusEl.classList.toggle('todox-settings__status--active', isActive);
    }
    if (this.themeSelect) {
      const theme = this.getActiveTheme();
      this.themeSelect.value = theme;
      this.themeSelect.disabled = !this.canUseThemeFeature();
    }
    if (this.bgmSelect) {
      const bgm = this.getSelectedBgm();
      this.bgmSelect.value = bgm;
      this.bgmSelect.disabled = !this.canUseBgmFeature();
    }
    if (this.analyticsSection) {
      this.analyticsSection.hidden = !this.canUseAnalyticsFeature();
    }
    if (this.telemetryToggle) {
      const enabled = this.premium?.isTelemetryEnabled?.() || false;
      this.telemetryToggle.checked = enabled;
    }
    this.applyTheme(this.getActiveTheme());
    this.updateAnalytics();
    this.updateFocusAudio();
    this.refreshSponsorBanner();
  }

  async updateFocusAudio() {
    const canPlay = this.canUseBgmFeature();
    if (!canPlay) {
      await this.bgmController.update('none', false);
      return;
    }
    const focusActive = this.focusToggleState?.mode && this.focusToggleState.mode !== 'off';
    let track = this.getSelectedBgm();
    if (focusActive && this.focusToggleApi?.actions?.getBgmTrack) {
      const focusTrack = this.focusToggleApi.actions.getBgmTrack();
      if (focusTrack && focusTrack !== 'none') {
        track = focusTrack;
      }
    }
    const shouldPlay = Boolean(this.activeTaskId || focusActive);
    await this.bgmController.update(track, shouldPlay);
  }

  hideSponsorBanner() {
    if (!this.focusSponsorEl) {
      return;
    }
    this.focusSponsorEl.hidden = true;
    if (this.focusSponsorLink) {
      this.focusSponsorLink.textContent = '';
      this.focusSponsorLink.removeAttribute('href');
    }
  }

  async refreshSponsorBanner() {
    if (!this.focusSponsorEl) {
      return;
    }
    if (!this.activeTaskId || this.premium?.isActive?.()) {
      this.hideSponsorBanner();
      return;
    }
    const requestId = Symbol('sponsor');
    this.pendingSponsorRequest = requestId;
    try {
      const sponsor = await this.sponsorsManager?.selectSponsor?.();
      if (this.pendingSponsorRequest !== requestId) {
        return;
      }
      if (!sponsor || !sponsor.label || !sponsor.url) {
        this.hideSponsorBanner();
        return;
      }
      if (this.focusSponsorLink) {
        this.focusSponsorLink.textContent = sponsor.label;
        this.focusSponsorLink.href = sponsor.url;
      }
      this.focusSponsorEl.hidden = false;
    } catch (error) {
      this.hideSponsorBanner();
    }
  }

  archiveCompletedTasks() {
    const completedTasks = this.tasks.filter((task) => task.completed);
    if (completedTasks.length === 0) {
      this.triggerArchiveCelebration('完了タスクはありません');
      return;
    }
    this.tasks = this.tasks.filter((task) => !task.completed);
    this.render();
    this.persist();
    this.triggerArchiveCelebration('DoneX を昇華しました ✨');
  }

  triggerArchiveCelebration(message) {
    if (!this.completedCelebrationEl) {
      return;
    }
    this.completedCelebrationEl.textContent = message;
    this.completedCelebrationEl.classList.add('todox-done__celebration--active');
    setTimeout(() => {
      this.completedCelebrationEl?.classList.remove('todox-done__celebration--active');
    }, 1200);
  }

  updateAnalytics() {
    if (!this.analyticsSection || this.analyticsSection.hidden) {
      return;
    }
    const summary = computeFocusAnalytics(this.history);
    const average = summary.weekMs > 0 ? summary.weekMs / 7 : 0;
    if (this.analyticsValues.today) {
      this.analyticsValues.today.textContent = formatMinutesFromMs(summary.todayMs);
    }
    if (this.analyticsValues.week) {
      this.analyticsValues.week.textContent = formatMinutesFromMs(summary.weekMs);
    }
    if (this.analyticsValues.average) {
      this.analyticsValues.average.textContent = formatMinutesFromMs(average);
    }
  }

  maybeSendDiagnostics(event, data) {
    if (!this.premium?.isTelemetryEnabled?.()) {
      return;
    }
    const url = this.premium?.getDiagnosticsUrl?.();
    if (!url) {
      return;
    }
    const payload = {
      event,
      ...data,
    };
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch (error) {
      // ignore diagnostics errors
    }
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
    this.updateAnalytics();
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
    if (!this.completedListEl || !this.completedEmptyEl) {
      return;
    }

    this.completedListEl.innerHTML = '';

    if (completedTasks.length === 0) {
      this.completedEmptyEl.hidden = false;
      this.completedSection?.classList.add('todox-done--empty');
      this.completedContainer?.classList.add('todox-done--empty');
      if (this.completedMoreEl) {
        this.completedMoreEl.hidden = true;
      }
      return;
    }

    this.completedEmptyEl.hidden = true;
    this.completedSection?.classList.remove('todox-done--empty');
    this.completedContainer?.classList.remove('todox-done--empty');

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
    this.maybeSendDiagnostics('taskCompleted', {
      taskId,
      focusMs: task.elapsedMs,
      totalCompleted: this.history.length,
    });
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
    this.updateFocusAudio();
    this.refreshSponsorBanner();
    this.maybeSendDiagnostics('focusStart', { taskId });
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
    const finishedTaskId = this.activeTaskId;
    this.activeTaskId = null;
    this.stopTimer();
    this.render();
    this.persist();
    this.updateFocusAudio();
    this.refreshSponsorBanner();
    this.maybeSendDiagnostics('focusStop', {
      taskId: finishedTaskId,
      focusMs: task ? task.elapsedMs : 0,
    });
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
    const message = `TodoXでタスク昇華✨\n${task.text}\n集中時間: ${focus}\n#TodoX`;
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
