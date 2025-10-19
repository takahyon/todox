(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TodoxFocusToggle = factory(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  const DEFAULTS = {
    shortcutEnabled: true,
    defaultMode: "soft",
    defaultMinutes: 15,
    fabEnabled: false,
  };

  const STORAGE_KEY = "todox.focus.preferences";
  const ESC_RESET_MS = 1500;

  const MODE_SEQUENCE = ["soft", "kichiku"];

  const MODE_LIMITS = {
    soft: { min: 5, max: 15 },
    kichiku: { min: 10, max: 30 },
  };

  function clampDuration(mode, minutes) {
    const limits = MODE_LIMITS[mode] || MODE_LIMITS.soft;
    const value = Number.isFinite(minutes) ? Math.round(minutes) : limits.min;
    if (value < limits.min) {
      return limits.min;
    }
    if (value > limits.max) {
      return limits.max;
    }
    return value;
  }

  function getDefaultStorage() {
    try {
      if (typeof root.localStorage !== "undefined") {
        return root.localStorage;
      }
    } catch (error) {
      // fall through to memory storage
    }
    const memory = new Map();
    return {
      getItem(key) {
        return memory.has(key) ? memory.get(key) : null;
      },
      setItem(key, value) {
        memory.set(key, value);
      },
      removeItem(key) {
        memory.delete(key);
      },
    };
  }

  class FocusToggleStore {
    constructor(options = {}) {
      const config = Object.assign({}, DEFAULTS, options.config || {});
      this.config = config;
      this.storage = options.storage || getDefaultStorage();
      this.state = { mode: "off", remainingMinutes: 0 };
      this.listeners = new Set();
      this.interval = null;
      this.endTimestamp = null;
      this.lastMode = config.defaultMode === "kichiku" ? "kichiku" : "soft";
      this.preferredDurations = {
        soft: clampDuration("soft", config.defaultMinutes),
        kichiku: clampDuration("kichiku", Math.max(config.defaultMinutes, MODE_LIMITS.kichiku.min)),
      };
      this.fabEnabled = Boolean(config.fabEnabled);
      this.shortcutEnabled = config.shortcutEnabled !== false;
      this.bgmTrack = "none";
      this.lastEscAt = 0;
      this.document = typeof root.document !== "undefined" ? root.document : null;
      this.visibilityHandler = this.handleVisibilityChange.bind(this);
      this.keyHandler = this.handleKeydown.bind(this);
      this.restorePreferences();
      if (this.document && this.shortcutEnabled) {
        this.document.addEventListener("keydown", this.keyHandler, true);
      }
      if (this.document) {
        this.document.addEventListener("visibilitychange", this.visibilityHandler, true);
      }
    }

    restorePreferences() {
      try {
        const raw = this.storage.getItem(STORAGE_KEY);
        if (!raw) {
          return;
        }
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (parsed.lastMode === "soft" || parsed.lastMode === "kichiku") {
            this.lastMode = parsed.lastMode;
          }
          if (parsed.preferredDurations && typeof parsed.preferredDurations === "object") {
            const soft = clampDuration("soft", parsed.preferredDurations.soft);
            const kichiku = clampDuration("kichiku", parsed.preferredDurations.kichiku);
            if (Number.isFinite(soft)) {
              this.preferredDurations.soft = soft;
            }
            if (Number.isFinite(kichiku)) {
              this.preferredDurations.kichiku = kichiku;
            }
          }
          if (typeof parsed.fabEnabled === "boolean") {
            this.fabEnabled = parsed.fabEnabled;
          }
          if (typeof parsed.bgmTrack === "string") {
            this.bgmTrack = parsed.bgmTrack;
          }
        }
      } catch (error) {
        // ignore malformed storage
      }
    }

    persistPreferences() {
      try {
        const payload = {
          lastMode: this.lastMode,
          preferredDurations: this.preferredDurations,
          fabEnabled: this.fabEnabled,
          bgmTrack: this.bgmTrack,
        };
        this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        // ignore persistence failures
      }
    }

    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      this.listeners.add(listener);
      listener(this.state);
      return () => {
        this.listeners.delete(listener);
      };
    }

    notify() {
      this.listeners.forEach((listener) => {
        try {
          listener(this.state);
        } catch (error) {
          // swallow listener errors
        }
      });
    }

    getState() {
      return this.state;
    }

    setFabVisible(flag) {
      const next = Boolean(flag);
      if (this.fabEnabled === next) {
        return;
      }
      this.fabEnabled = next;
      this.persistPreferences();
      this.notify();
    }

    isFabVisible() {
      return this.fabEnabled;
    }

    setBgmTrack(track) {
      if (typeof track !== "string") {
        return;
      }
      this.bgmTrack = track;
      this.persistPreferences();
      this.notify();
    }

    getBgmTrack() {
      return this.bgmTrack;
    }

    toggle() {
      if (this.state.mode === "off") {
        const mode = this.lastMode || "soft";
        const fallbackLimits = MODE_LIMITS[mode] || MODE_LIMITS.soft;
        const minutes = this.preferredDurations[mode] || fallbackLimits.min;
        this.start(mode, minutes);
      } else {
        this.stop("toggle");
      }
    }

    cycle() {
      if (this.state.mode === "off") {
        const minutes = this.preferredDurations.soft || MODE_LIMITS.soft.min;
        this.start("soft", minutes);
        return;
      }
      if (this.state.mode === "soft") {
        const minutes = this.preferredDurations.kichiku || MODE_LIMITS.kichiku.min;
        this.start("kichiku", minutes);
        return;
      }
      this.stop("cycle");
    }

    stop(reason = "manual") {
      if (this.state.mode === "off") {
        return;
      }
      this.state.mode = "off";
      this.state.remainingMinutes = 0;
      this.endTimestamp = null;
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      this.persistPreferences();
      this.notify();
      if (typeof this.config.onStop === "function") {
        try {
          this.config.onStop({ reason });
        } catch (error) {
          // ignore
        }
      }
    }

    start(mode, minutes) {
      const targetMode = mode === "kichiku" ? "kichiku" : "soft";
      const clamped = clampDuration(targetMode, minutes);
      this.state.mode = targetMode;
      this.state.remainingMinutes = clamped;
      this.endTimestamp = Date.now() + clamped * 60000;
      this.lastMode = targetMode;
      this.preferredDurations[targetMode] = clamped;
      if (this.interval) {
        clearInterval(this.interval);
      }
      this.interval = setInterval(() => this.updateRemaining(), 1000);
      if (typeof this.interval.unref === "function") {
        this.interval.unref();
      }
      this.persistPreferences();
      this.notify();
      if (typeof this.config.onStart === "function") {
        try {
          this.config.onStart({ mode: targetMode, minutes: clamped });
        } catch (error) {
          // ignore
        }
      }
    }

    updateRemaining() {
      if (this.state.mode === "off" || !this.endTimestamp) {
        return;
      }
      const diffMs = this.endTimestamp - Date.now();
      if (diffMs <= 0) {
        this.stop("elapsed");
        return;
      }
      const remaining = Math.max(0, Math.ceil(diffMs / 60000));
      if (remaining !== this.state.remainingMinutes) {
        this.state.remainingMinutes = remaining;
        this.notify();
      }
    }

    handleVisibilityChange() {
      if (this.state.mode === "off" || !this.endTimestamp) {
        return;
      }
      if (this.document && this.document.visibilityState === "visible") {
        this.updateRemaining();
      }
    }

    handleKeydown(event) {
      if (!event) {
        return;
      }
      const target = event.target;
      const tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
      const isEditable =
        (target && typeof target.isContentEditable === "boolean" && target.isContentEditable) ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select";
      if (event.key === "Escape") {
        const now = Date.now();
        if (now - this.lastEscAt <= ESC_RESET_MS) {
          this.stop("escape");
          this.lastEscAt = 0;
        } else {
          this.lastEscAt = now;
        }
        return;
      }
      if (isEditable) {
        return;
      }
      if (!this.shortcutEnabled) {
        return;
      }
      const isMac = typeof root.navigator !== "undefined" && /mac/i.test(root.navigator.platform || "");
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (modifier && event.shiftKey && (event.key === "K" || event.key === "k")) {
        this.toggle();
        event.preventDefault();
      }
    }
  }

  let singleton = null;

  function init(config = {}) {
    if (!singleton) {
      singleton = new FocusToggleStore({ config });
    } else {
      singleton.config = Object.assign({}, singleton.config, config || {});
      if (typeof config.shortcutEnabled !== "undefined") {
        singleton.shortcutEnabled = config.shortcutEnabled !== false;
      }
      if (typeof config.fabEnabled !== "undefined") {
        singleton.fabEnabled = Boolean(config.fabEnabled);
        singleton.persistPreferences();
        singleton.notify();
      }
    }
    return singleton;
  }

  function useFocusToggle() {
    if (!singleton) {
      singleton = new FocusToggleStore();
    }
    const store = singleton;
    return {
      state: store.getState(),
      actions: {
        toggle: () => store.toggle(),
        cycle: () => store.cycle(),
        start: (mode, minutes) => store.start(mode, minutes),
        stop: () => store.stop(),
        setFabVisible: (flag) => store.setFabVisible(flag),
        isFabVisible: () => store.isFabVisible(),
        setBgmTrack: (track) => store.setBgmTrack(track),
        getBgmTrack: () => store.getBgmTrack(),
        getLastSelection: () => ({
          mode: store.lastMode,
          durations: Object.assign({}, store.preferredDurations),
        }),
        subscribe: (listener) => store.subscribe(listener),
      },
      subscribe: (listener) => store.subscribe(listener),
    };
  }

  return {
    init,
    useFocusToggle,
    FocusToggleStore,
  };
});
