(function (root) {
  const CONFIG = Object.assign(
    {
      licensePublicKeyBase64: "",
      sponsorsUrl: typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("sponsors.json")
        : "sponsors.json",
      diagnosticsUrl: "/api/diag",
    },
    root.TODOX_CONFIG || {}
  );

  const STORAGE_KEYS = {
    LICENSE: "todox.licenseToken",
    THEME: "todox.theme",
    BGM: "todox.focusBgm",
    TELEMETRY: "todox.telemetry",
  };

  const PREMIUM_FEATURES = {
    themes: "themes",
    focusBgm: "focus_bgm",
    analytics: "local_analytics",
  };

  class PremiumManager {
    constructor() {
      const verifyLib = root.TodoxVerifyLicense;
      this.verifyLicenseToken = verifyLib ? verifyLib.verifyLicenseToken : null;
      this.LicenseVerificationError = verifyLib ? verifyLib.LicenseVerificationError : Error;
      this.publicKeyBase64 = CONFIG.licensePublicKeyBase64;
      this.license = null;
      this.listeners = new Set();
      this.status = "idle";
    }

    async init() {
      const stored = this.getStorage().getItem(STORAGE_KEYS.LICENSE);
      if (stored) {
        try {
          await this.applyLicense(stored, { silent: true });
        } catch (error) {
          this.clearLicense({ silent: true });
        }
      }
    }

    getStorage() {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          return window.localStorage;
        }
      } catch (error) {
        // ignore access errors
      }
      return {
        getItem() {
          return null;
        },
        setItem() {},
        removeItem() {},
      };
    }

    async applyLicense(token, options = {}) {
      if (!this.verifyLicenseToken) {
        throw new Error("License verification library unavailable");
      }
      this.status = options.silent ? this.status : "verifying";
      this.emit();
      const { payload } = await this.verifyLicenseToken(token, this.publicKeyBase64);
      this.license = {
        token,
        payload,
        features: new Set(Array.isArray(payload.features) ? payload.features : []),
        expiresAt: payload.exp * 1000,
      };
      this.getStorage().setItem(STORAGE_KEYS.LICENSE, token);
      this.status = "verified";
      this.emit();
      return payload;
    }

    clearLicense(options = {}) {
      this.license = null;
      this.getStorage().removeItem(STORAGE_KEYS.LICENSE);
      this.status = options.silent ? this.status : "cleared";
      if (!options.silent) {
        this.emit();
      }
    }

    onChange(callback) {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    emit() {
      this.listeners.forEach((cb) => {
        try {
          cb(this);
        } catch (error) {
          // swallow listener errors
        }
      });
    }

    isActive() {
      if (!this.license) {
        return false;
      }
      if (this.license.expiresAt <= Date.now()) {
        this.clearLicense({ silent: true });
        return false;
      }
      return true;
    }

    hasFeature(feature) {
      if (!this.isActive()) {
        return false;
      }
      return this.license.features.has(feature);
    }

    getStatus() {
      return this.status;
    }

    getLicensePayload() {
      return this.license ? this.license.payload : null;
    }

    getDiagnosticsUrl() {
      return CONFIG.diagnosticsUrl;
    }

    getSponsorUrl() {
      return CONFIG.sponsorsUrl;
    }

    async redeem(code) {
      try {
        const payload = await this.applyLicense(code);
        return { ok: true, payload };
      } catch (error) {
        this.status = 'idle';
        this.emit();
        let message = "コードの検証に失敗しました";
        if (error && error.code === "EXPIRED") {
          message = "コードの有効期限が切れています";
        }
        return { ok: false, error: message, originalError: error };
      }
    }

    getSelectedTheme() {
      return this.getStorage().getItem(STORAGE_KEYS.THEME) || "default";
    }

    setSelectedTheme(theme) {
      this.getStorage().setItem(STORAGE_KEYS.THEME, theme);
    }

    getSelectedBgm() {
      return this.getStorage().getItem(STORAGE_KEYS.BGM) || "none";
    }

    setSelectedBgm(bgm) {
      this.getStorage().setItem(STORAGE_KEYS.BGM, bgm);
    }

    isTelemetryEnabled() {
      return this.getStorage().getItem(STORAGE_KEYS.TELEMETRY) === "1";
    }

    setTelemetryEnabled(enabled) {
      if (enabled) {
        this.getStorage().setItem(STORAGE_KEYS.TELEMETRY, "1");
      } else {
        this.getStorage().removeItem(STORAGE_KEYS.TELEMETRY);
      }
    }
  }

  root.TODOX_PREMIUM = new PremiumManager();
  root.TODOX_CONFIG = CONFIG;
  root.TODOX_PREMIUM_FEATURES = PREMIUM_FEATURES;
})(typeof window !== "undefined" ? window : globalThis);
