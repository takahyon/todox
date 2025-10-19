(function (root) {
  const SponsorLogic = root.TodoxSponsorLogic || {};
  const { isActiveSponsor, selectWeightedSponsor, canShowUnderFrequency, recordImpression } = SponsorLogic;

  class SponsorsManager {
    constructor(options = {}) {
      this.premiumManager = options.premiumManager;
      this.config = null;
      this.currentSponsor = null;
      this.dismissedIds = new Set();
      this.lastFetchedAt = 0;
      this.fetchPromise = null;
    }

    async init() {
      await this.loadConfig();
    }

    getStorages() {
      return {
        session: typeof sessionStorage !== "undefined" ? sessionStorage : null,
        local: typeof localStorage !== "undefined" ? localStorage : null,
      };
    }

    async loadConfig(force = false) {
      const now = Date.now();
      if (!force && this.config && now - this.lastFetchedAt < 1000 * 60 * 10) {
        return this.config;
      }
      if (this.fetchPromise) {
        return this.fetchPromise;
      }
      this.fetchPromise = this.fetchConfigFromSources()
        .then((config) => {
          this.config = config;
          this.lastFetchedAt = Date.now();
          return config;
        })
        .finally(() => {
          this.fetchPromise = null;
        });
      return this.fetchPromise;
    }

    async fetchConfigFromSources() {
      const urls = [];
      const premium = this.premiumManager;
      if (premium && typeof premium.getSponsorUrl === "function") {
        urls.push(premium.getSponsorUrl());
      }
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        urls.push(chrome.runtime.getURL("sponsors.json"));
      } else {
        urls.push("sponsors.json");
      }
      for (const url of urls) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) {
            continue;
          }
          const json = await response.json();
          if (json && Array.isArray(json.items)) {
            return json;
          }
        } catch (error) {
          // skip errors and try next source
        }
      }
      return { version: 1, items: [], frequencyCap: null };
    }

    isPremiumActive() {
      return this.premiumManager && typeof this.premiumManager.isActive === "function"
        ? this.premiumManager.isActive()
        : false;
    }

    isDismissed(id) {
      if (this.dismissedIds.has(id)) {
        return true;
      }
      try {
        if (typeof sessionStorage !== "undefined") {
          return sessionStorage.getItem(`todox.sponsor.dismissed.${id}`) === "1";
        }
      } catch (error) {
        // ignore storage access errors
      }
      return false;
    }

    markDismissed(id) {
      this.dismissedIds.add(id);
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(`todox.sponsor.dismissed.${id}`, "1");
        }
      } catch (error) {
        // ignore
      }
    }

    async selectSponsor(now = Date.now()) {
      if (this.isPremiumActive()) {
        this.currentSponsor = null;
        return null;
      }
      const config = await this.loadConfig();
      if (!config || !Array.isArray(config.items)) {
        return null;
      }
      if (!canShowUnderFrequency || !recordImpression) {
        return null;
      }
      const storages = this.getStorages();
      if (!canShowUnderFrequency(config.frequencyCap, storages, now)) {
        return null;
      }
      if (this.currentSponsor && this.isSponsorStillValid(this.currentSponsor, config, now)) {
        return this.currentSponsor;
      }
      const active = config.items.filter((item) => isActiveSponsor ? isActiveSponsor(item, now) : true);
      const candidates = active.filter((item) => !this.isDismissed(item.id));
      if (candidates.length === 0) {
        return null;
      }
      const choice = selectWeightedSponsor ? selectWeightedSponsor(candidates) : candidates[0];
      if (!choice) {
        return null;
      }
      this.currentSponsor = choice;
      recordImpression(config.frequencyCap, storages, now);
      return choice;
    }

    isSponsorStillValid(sponsor, config, now = Date.now()) {
      if (!sponsor) {
        return false;
      }
      if (this.isDismissed(sponsor.id)) {
        return false;
      }
      if (isActiveSponsor && !isActiveSponsor(sponsor, now)) {
        return false;
      }
      if (!config.items.some((item) => item.id === sponsor.id)) {
        return false;
      }
      return true;
    }

    dismissCurrentSponsor() {
      if (this.currentSponsor) {
        this.markDismissed(this.currentSponsor.id);
        this.currentSponsor = null;
      }
    }
  }

  root.TodoxSponsorsManager = SponsorsManager;
})(typeof window !== "undefined" ? window : globalThis);
