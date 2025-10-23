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
const COLLAPSE_STATE_KEY = "todox.ui.collapsed";

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
      promoHtml: "<a href='https://x.com/TakaAizu/status/1976588524997550265'>新アルバムをM3にて発売予定！</a>",
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
    this.panelBody = null;
    this.panelPlaceholder = null;
    this.panelResizeObserver = null;
    this.boundResizeHandler = null;
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
    this.collapseButton = null;
    this.isCollapsed = this.loadCollapsePreference();
    this.bgmController = new FocusBgmController();
    this.pendingSponsorRequest = null;
    this.premium = typeof window !== "undefined" ? window.TODOX_PREMIUM : null;
    // Initialize sponsors manager. If the packaged SponsorsManager didn't run for
    // any reason (e.g. content script loading order issues), provide a lightweight
    // fallback implementation that loads sponsors.json directly.
    this.sponsorsManager = (function initSponsorsManager(premium) {
      if (typeof window !== "undefined" && window.TodoxSponsorsManager) {
        try {
          return new window.TodoxSponsorsManager({ premiumManager: premium });
        } catch (e) {
          // fall through to fallback
        }
      }

      // Fallback manager using the SponsorLogic helpers if available
      const SponsorLogic = typeof window !== 'undefined' ? window.TodoxSponsorLogic || {} : {};
      const {
        isActiveSponsor,
        selectWeightedSponsor,
        canShowUnderFrequency,
        recordImpression,
        canShowSponsor,
        recordSponsorImpression,
      } = SponsorLogic;

      class FallbackSponsorsManager {
        constructor(options = {}) {
          this.premiumManager = options.premiumManager || null;
          this.config = null;
          this.currentSponsor = null;
          this.lastFetchedAt = 0;
        }

        async init() {
          if (this.config && Date.now() - this.lastFetchedAt < 1000 * 60 * 5) return;
          try {
            const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
              ? chrome.runtime.getURL('sponsors.json')
              : 'sponsors.json';
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) this.config = await res.json();
          } catch (e) {
            this.config = { version: 1, items: [], frequencyCap: null };
          }
          this.lastFetchedAt = Date.now();
        }

        getStorages() {
          return { session: typeof sessionStorage !== 'undefined' ? sessionStorage : null, local: typeof localStorage !== 'undefined' ? localStorage : null };
        }

        isPremiumActive() {
          return this.premiumManager && typeof this.premiumManager.isActive === 'function'
            ? this.premiumManager.isActive()
            : false;
        }

        isDismissed(id) {
          try {
            return sessionStorage.getItem(`todox.sponsor.dismissed.${id}`) === '1';
          } catch (e) {
            return false;
          }
        }

        markDismissed(id) {
          try {
            sessionStorage.setItem(`todox.sponsor.dismissed.${id}`, '1');
          } catch (e) { }
        }

        async selectSponsor(now = Date.now()) {
          if (this.isPremiumActive()) {
            this.currentSponsor = null;
            return null;
          }
          await this.init();
          const cfg = this.config || { items: [], frequencyCap: null };
          if (!cfg || !Array.isArray(cfg.items) || cfg.items.length === 0) return null;
          const storages = this.getStorages();
          if (this.currentSponsor && this.currentSponsor.id && this._isSponsorValid(this.currentSponsor, cfg, now)) {
            return this.currentSponsor;
          }
          const active = cfg.items.filter((i) => (isActiveSponsor ? isActiveSponsor(i, now) : true));
          let candidates = active.filter((i) => !this.isDismissed(i.id));
          if (typeof canShowSponsor === 'function' && cfg.frequencyCap) {
            candidates = candidates.filter((i) => canShowSponsor(cfg.frequencyCap, storages, i.id, now));
          } else if (typeof canShowUnderFrequency === 'function' && cfg.frequencyCap) {
            if (!canShowUnderFrequency(cfg.frequencyCap, storages, now)) return null;
          }
          if (candidates.length === 0) return null;
          const choice = selectWeightedSponsor ? selectWeightedSponsor(candidates) : candidates[0];
          this.currentSponsor = choice;
          if (choice) {
            if (typeof recordSponsorImpression === 'function' && cfg.frequencyCap) {
              recordSponsorImpression(cfg.frequencyCap, storages, choice.id, now);
            } else if (typeof recordImpression === 'function') {
              recordImpression(cfg.frequencyCap, storages, now);
            }
          }
          return choice;
        }

        _isSponsorValid(sponsor, cfg, now = Date.now()) {
          if (!sponsor) return false;
          if (this.isDismissed(sponsor.id)) return false;
          if (isActiveSponsor && !isActiveSponsor(sponsor, now)) return false;
          if (!cfg.items.some((item) => item.id === sponsor.id)) return false;
          return true;
        }

        dismissCurrentSponsor() {
          if (this.currentSponsor && this.currentSponsor.id) {
            this.markDismissed(this.currentSponsor.id);
            this.currentSponsor = null;
          }
        }

        markDismissed(id) {
          try { sessionStorage.setItem(`todox.sponsor.dismissed.${id}`, '1'); } catch (e) { }
        }
      }

      return new FallbackSponsorsManager({ premiumManager: premium });
    })(this.premium);
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
      if (this.boundResizeHandler) {
        window.removeEventListener('resize', this.boundResizeHandler);
        this.boundResizeHandler = null;
      }
      if (this.panelResizeObserver) {
        try {
          this.panelResizeObserver.disconnect();
        } catch (error) {
          // ignore disconnect errors
        }
        this.panelResizeObserver = null;
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
    });
  }

  loadCollapsePreference() {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return localStorage.getItem(COLLAPSE_STATE_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  saveCollapsePreference(collapsed) {
    if (typeof window === "undefined") {
      return;
    }
    try {
      if (collapsed) {
        localStorage.setItem(COLLAPSE_STATE_KEY, "1");
      } else {
        localStorage.removeItem(COLLAPSE_STATE_KEY);
      }
    } catch (error) {
      // ignore persistence errors
    }
  }

  applyCollapseState(panelElement, collapsed) {
    const panel = panelElement || this.panel;
    if (!panel) {
      return;
    }
    panel.classList.toggle("todox-panel--collapsed", collapsed);
    panel.setAttribute("aria-expanded", String(!collapsed));
    if (this.collapseButton) {
      this.collapseButton.setAttribute("aria-expanded", String(!collapsed));
      this.collapseButton.setAttribute(
        "aria-label",
        collapsed ? "TodoXを展開する" : "TodoXを折りたたむ",
      );
      this.collapseButton.textContent = collapsed ? "＋" : "−";
    }
    this.updatePanelPlaceholderHeight();
  }

  setCollapsed(collapsed) {
    if (this.isCollapsed === collapsed) {
      return;
    }
    this.isCollapsed = collapsed;
    this.saveCollapsePreference(collapsed);
    this.applyCollapseState(this.panel, collapsed);
  }

  togglePanelCollapse() {
    this.setCollapsed(!this.isCollapsed);
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
    if (!this.panel) {
      this.panel = this.createPanel();
    }

    const parentNode = document.body || document.documentElement;
    if (this.panel && parentNode && !parentNode.contains(this.panel)) {
      parentNode.appendChild(this.panel);
    }

    this.ensurePanelPlaceholder(sidebar);
    this.updatePanelPlaceholderHeight();
  }

  ensurePanelPlaceholder(sidebar) {
    if (!sidebar) {
      return;
    }
    if (!this.panelPlaceholder) {
      const placeholder = document.createElement('div');
      placeholder.className = 'todox-panel__placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      this.panelPlaceholder = placeholder;
    }
    if (this.panelPlaceholder && !sidebar.contains(this.panelPlaceholder)) {
      const firstSection = sidebar.querySelector('section, div[data-testid="cellInnerDiv"], div[aria-label]');
      if (firstSection) {
        firstSection.parentNode?.insertBefore(this.panelPlaceholder, firstSection);
      } else {
        sidebar.insertBefore(this.panelPlaceholder, sidebar.firstChild);
      }
    }
  }

  updatePanelPlaceholderHeight() {
    if (!this.panel || !this.panelPlaceholder) {
      return;
    }
    const updateHeight = () => {
      const rect = this.panel.getBoundingClientRect();
      const offset = this.isCollapsed ? 12 : 16;
      const height = rect.height ? rect.height + offset : this.panel.offsetHeight + offset;
      this.panelPlaceholder.style.height = `${Math.max(height, 0)}px`;
      this.updatePanelAnchoring();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(updateHeight);
    } else {
      updateHeight();
    }
  }

  updatePanelAnchoring() {
    if (!this.panel || !this.panelPlaceholder || typeof window === 'undefined') {
      return;
    }

    const placeholderRect = this.panelPlaceholder.getBoundingClientRect();
    const viewportWidth = typeof window.innerWidth === 'number' ? window.innerWidth : 0;

    const placeholderWidth = placeholderRect.width || this.panelPlaceholder.offsetWidth;
    if (placeholderWidth) {
      let widthToApply = placeholderWidth;
      if (viewportWidth) {
        const availableWidth = viewportWidth - 32;
        if (availableWidth > 0) {
          widthToApply = Math.min(widthToApply, availableWidth);
        }
      }
      widthToApply = Math.min(widthToApply, 320);
      widthToApply = Math.max(widthToApply, Math.min(placeholderWidth, 240));
      this.panel.style.setProperty('--todox-anchor-width', `${Math.round(widthToApply)}px`);
    }

    if (viewportWidth && placeholderRect.width) {
      const rightEdge = placeholderRect.right || (placeholderRect.left + placeholderRect.width);
      const rightOffset = Math.max(viewportWidth - rightEdge, 16);
      if (Number.isFinite(rightOffset)) {
        this.panel.style.setProperty('--todox-anchor-right', `${rightOffset}px`);
      }
    }

    const topOffset = placeholderRect.top || this.panelPlaceholder.offsetTop;
    if (Number.isFinite(topOffset)) {
      const clampedTop = Math.max(topOffset, 16);
      this.panel.style.setProperty('--todox-anchor-top', `${clampedTop}px`);
    }

    this.updatePanelZIndex();
  }

  findSearchAnchorElement() {
    if (typeof document === 'undefined') {
      return null;
    }

    const searchSelectors = [
      'header[role="banner"] form[role="search"]',
      'header[role="banner"] [data-testid="SearchBox_Search_Input"]',
      'header[role="banner"] [data-testid="SearchBox_Search_Link"]',
      '[data-testid="SearchBox_Search_Input"]',
      'form[role="search"]',
    ];

    for (const selector of searchSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.closest('header[role="banner"]') || element.closest('[data-testid="toolBar"]') || element;
      }
    }

    return document.querySelector('header[role="banner"]');
  }

  updatePanelZIndex() {
    if (!this.panel || typeof window === 'undefined') {
      return;
    }

    const anchor = this.findSearchAnchorElement();
    if (!anchor) {
      this.panel.style.setProperty('--todox-panel-z-index', '3');
      return;
    }

    let current = anchor;
    let resolvedZIndex = null;

    while (current) {
      const style = window.getComputedStyle(current);
      if (!style) {
        break;
      }

      const position = style.position;
      const zIndexValue = Number.parseInt(style.zIndex, 10);

      if (position && position !== 'static' && Number.isFinite(zIndexValue)) {
        resolvedZIndex = zIndexValue;
        break;
      }

      current = current.parentElement;
    }

    if (typeof resolvedZIndex === 'number' && Number.isFinite(resolvedZIndex)) {
      const targetZ = Math.max(0, resolvedZIndex - 1);
      this.panel.style.setProperty('--todox-panel-z-index', `${targetZ}`);
    } else {
      this.panel.style.setProperty('--todox-panel-z-index', '3');
    }
  }

  createPanel() {
    const container = document.createElement('section');
    container.className = 'todox-panel';
    container.innerHTML = `
      <header class="todox-panel__header">
        <div class="todox-panel__title-row">
          <h2 class="todox-panel__title">TodoX</h2>
          <div class="todox-panel__actions">
            <button class="todox-history-button" type="button">履歴を開く</button>
            <button class="todox-collapse-button" type="button" aria-expanded="true" aria-label="TodoXを折りたたむ">−</button>
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
      <div class="todox-panel__body">
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
              <input type="checkbox" name="todox-telemetry" id="todox-telemetry" class="todox-telemetry-toggle__input" />
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
      </div>
    `;

    this.activeListEl = container.querySelector('.todox-list--active');
    this.panelBody = container.querySelector('.todox-panel__body');
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
    const historyButton = container.querySelector('.todox-history-button');
    this.collapseButton = container.querySelector('.todox-collapse-button');
    historyButton?.addEventListener('click', () => this.openHistory());
    this.collapseButton?.addEventListener('click', () => this.togglePanelCollapse());
    this.focusSponsorDismissButton?.addEventListener('click', () => {
      // If a sponsor id is present on the element, mark it dismissed explicitly.
      const sponsorId = this.focusSponsorEl?.dataset?.sponsorId;
      try {
        if (sponsorId && this.sponsorsManager && typeof this.sponsorsManager.markDismissed === 'function') {
          this.sponsorsManager.markDismissed(sponsorId);
        } else if (this.sponsorsManager && typeof this.sponsorsManager.dismissCurrentSponsor === 'function') {
          // fallback: try to dismiss current sponsor instance
          this.sponsorsManager.dismissCurrentSponsor();
        }
      } catch (e) {
        // ignore
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

    if (typeof window !== 'undefined') {
      if (!this.boundResizeHandler) {
        this.boundResizeHandler = () => this.updatePanelPlaceholderHeight();
        window.addEventListener('resize', this.boundResizeHandler, { passive: true });
      }
      if (typeof ResizeObserver !== 'undefined') {
        if (this.panelResizeObserver) {
          try {
            this.panelResizeObserver.disconnect();
          } catch (error) {
            // ignore disconnect errors
          }
        }
        this.panelResizeObserver = new ResizeObserver(() => this.updatePanelPlaceholderHeight());
        try {
          this.panelResizeObserver.observe(container);
        } catch (error) {
          // ignore observe errors
        }
      }
    }

    this.applyCollapseState(container, this.isCollapsed);
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
    const track = this.getSelectedBgm();
    const shouldPlay = this.canUseBgmFeature() && Boolean(this.activeTaskId);
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
    // clear any attached sponsor id
    try {
      if (this.focusSponsorEl && this.focusSponsorEl.dataset) {
        delete this.focusSponsorEl.dataset.sponsorId;
      }
    } catch (e) { }
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
        // attach sponsor id to DOM so dismiss can mark it even if currentSponsor isn't set yet
        if (this.focusSponsorEl) {
          this.focusSponsorEl.dataset.sponsorId = sponsor.id;
        }
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
        }).catch(() => { });
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
    this.updatePanelPlaceholderHeight();
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
      <input type="text" name="todox-new-task" class="todox-input" placeholder="${placeholderText}" ${canAddTask ? '' : 'disabled'} />
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
