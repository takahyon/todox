(function () {
  const DEFAULT_BRANDING = {
    developerName: "あいづたか@TakaAizu",
    developerUrl: "https://x.com/TakaAizu",
    promoHtml: "<a href='https://x.com/TakaAizu/status/1976588524997550265'>新アルバムをM3にて発売予定！</a>",
  };

  const DEFAULT_CONFIG = {
    licensePublicKeyBase64:
      (typeof window !== "undefined" && window.TODOX_CONFIG?.licensePublicKeyBase64) || "",
    licenseRedeemUrl:
      (typeof window !== "undefined" && window.TODOX_CONFIG?.licenseRedeemUrl) || "",
    sponsorsUrl:
      (typeof window !== "undefined" && window.TODOX_CONFIG?.sponsorsUrl) ||
      (typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("sponsors.json")
        : "sponsors.json"),
    diagnosticsUrl:
      (typeof window !== "undefined" && window.TODOX_CONFIG?.diagnosticsUrl) || "/api/diag",
  };

  window.TODOX_BRANDING = Object.assign({}, DEFAULT_BRANDING, window.TODOX_BRANDING || {});
  window.TODOX_CONFIG = Object.assign({}, DEFAULT_CONFIG, window.TODOX_CONFIG || {});
})();
