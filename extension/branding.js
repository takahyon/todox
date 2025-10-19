(function () {
  function parseBoolean(value, fallback) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
      }
    }
    if (typeof value === "number") {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }
    return fallback;
  }

  function normalizeFocusMode(value, fallback) {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "soft" || normalized === "kichiku" || normalized === "off") {
        return normalized;
      }
    }
    return fallback;
  }

  const DEFAULT_BRANDING = {
    developerName: "あいづたか@TakaAizu",
    developerUrl: "https://x.com/TakaAizu",
    promoHtml: "新アルバムをM3にて発売予定！",
  };

  const existingConfig = (typeof window !== "undefined" && window.TODOX_CONFIG) || {};

  const DEFAULT_CONFIG = {
    licensePublicKeyBase64: "",
    licenseRedeemUrl: "",
    sponsorsUrl:
      typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("sponsors.json")
        : "sponsors.json",
    diagnosticsUrl: "/api/diag",
    focusShortcutEnabled: true,
    focusDefaultMode: "soft",
    focusDefaultMinutes: 15,
    focusFabEnabled: false,
  };

  const normalizedConfig = Object.assign({}, DEFAULT_CONFIG, existingConfig);

  normalizedConfig.focusShortcutEnabled = parseBoolean(
    existingConfig.focusShortcutEnabled,
    DEFAULT_CONFIG.focusShortcutEnabled
  );

  normalizedConfig.focusDefaultMode = normalizeFocusMode(
    existingConfig.focusDefaultMode,
    DEFAULT_CONFIG.focusDefaultMode
  );

  const parsedMinutes = Number(existingConfig.focusDefaultMinutes);
  normalizedConfig.focusDefaultMinutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0
    ? parsedMinutes
    : DEFAULT_CONFIG.focusDefaultMinutes;

  normalizedConfig.focusFabEnabled = parseBoolean(
    existingConfig.focusFabEnabled,
    DEFAULT_CONFIG.focusFabEnabled
  );

  window.TODOX_BRANDING = Object.assign({}, DEFAULT_BRANDING, window.TODOX_BRANDING || {});
  window.TODOX_CONFIG = normalizedConfig;
})();
