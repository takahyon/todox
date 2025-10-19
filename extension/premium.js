(function (root) {
  const CONFIG = Object.assign(
    {
      licensePublicKeyBase64: "",
      licenseRedeemUrl: "",
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

  async function safeExtractError(response) {
    try {
      const data = await response.clone().json();
      if (data && typeof data.error === "string") {
        if (data.hint) {
          return `${data.error} (${data.hint})`;
        }
        return data.error;
      }
    } catch (error) {
      // ignore parsing issues
    }
    if (response && typeof response.status === "number") {
      return `サーバーエラー (HTTP ${response.status})`;
    }
    return "コードの検証に失敗しました";
  }

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

    async redeem(rawCode) {
      const code = typeof rawCode === "string" ? rawCode.trim() : "";
      if (!code) {
        return { ok: false, error: "コードを入力してください" };
      }
      this.status = "verifying";
      this.emit();
      let token = code;
      if (CONFIG.licenseRedeemUrl) {
        try {
          const response = await fetch(CONFIG.licenseRedeemUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
            credentials: "omit",
          });
          if (!response.ok) {
            const hint = await safeExtractError(response);
            throw new Error(hint || "コードの検証に失敗しました");
          }
          const data = await response.json();
          if (!data || typeof data.licenseToken !== "string") {
            throw new Error("無効なライセンス応答です");
          }
          token = data.licenseToken;
        } catch (error) {
          this.status = "idle";
          this.emit();
          const message =
            error && typeof error.message === "string"
              ? error.message === "Failed to fetch"
                ? "サーバーに接続できませんでした"
                : error.message
              : "コードの検証に失敗しました";
          return { ok: false, error: message, originalError: error };
        }
      }
      try {
        const payload = await this.applyLicense(token);
        return { ok: true, payload };
      } catch (error) {
        this.status = "idle";
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
