(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TodoxSponsorLogic = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  function isActiveSponsor(item, now = Date.now()) {
    if (!item || typeof item !== "object") {
      return false;
    }
    const start = item.activeFrom ? Date.parse(item.activeFrom) : null;
    const end = item.activeTo ? Date.parse(item.activeTo) : null;
    if (Number.isFinite(start) && now < start) {
      return false;
    }
    if (Number.isFinite(end) && now > end) {
      return false;
    }
    return true;
  }

  function selectWeightedSponsor(items, random = Math.random) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    const weights = items.map((item) => Math.max(0, Number(item.weight) || 0));
    const total = weights.reduce((acc, weight) => acc + weight, 0);
    if (total <= 0) {
      return items[0];
    }
    const target = random() * total;
    let cumulative = 0;
    for (let i = 0; i < items.length; i += 1) {
      cumulative += weights[i];
      if (target <= cumulative) {
        return items[i];
      }
    }
    return items[items.length - 1];
  }

  function readJson(storage, key, fallback) {
    if (!storage || typeof storage.getItem !== "function") {
      return fallback;
    }
    try {
      const value = storage.getItem(key);
      if (!value) {
        return fallback;
      }
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    if (!storage || typeof storage.setItem !== "function") {
      return;
    }
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // ignore write errors
    }
  }

  function getTodayKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
  }

  function canShowUnderFrequency(frequencyCap, storages, now = Date.now()) {
    if (!frequencyCap) {
      return true;
    }
    const { perSession, perDay } = frequencyCap;
    if (typeof perSession === "number" && perSession > 0) {
      const sessionState = readJson(storages.session, "todox.sponsor.session", { count: 0 });
      if (sessionState.count >= perSession) {
        return false;
      }
    }
    if (typeof perDay === "number" && perDay > 0) {
      const today = getTodayKey(now);
      const dailyState = readJson(storages.local, "todox.sponsor.daily", { key: today, count: 0 });
      if (dailyState.key !== today) {
        return true;
      }
      if (dailyState.count >= perDay) {
        return false;
      }
    }
    return true;
  }

  function recordImpression(frequencyCap, storages, now = Date.now()) {
    if (!frequencyCap) {
      return;
    }
    const { perSession, perDay } = frequencyCap;
    if (typeof perSession === "number" && perSession > 0) {
      const state = readJson(storages.session, "todox.sponsor.session", { count: 0 });
      state.count = (state.count || 0) + 1;
      writeJson(storages.session, "todox.sponsor.session", state);
    }
    if (typeof perDay === "number" && perDay > 0) {
      const today = getTodayKey(now);
      const state = readJson(storages.local, "todox.sponsor.daily", { key: today, count: 0 });
      if (state.key !== today) {
        state.key = today;
        state.count = 0;
      }
      state.count = (state.count || 0) + 1;
      writeJson(storages.local, "todox.sponsor.daily", state);
    }
  }

  return {
    isActiveSponsor,
    selectWeightedSponsor,
    canShowUnderFrequency,
    recordImpression,
    _readJson: readJson,
    _writeJson: writeJson,
    _getTodayKey: getTodayKey,
  };
});
