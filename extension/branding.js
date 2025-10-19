(function () {
  const DEFAULT_BRANDING = {
    developerName: "あいづたか@TakaAizu",
    developerUrl: "https://x.com/TakaAizu",
    promoHtml: "新アルバムをM3にて発売予定！",
  };

  window.TODOX_BRANDING = Object.assign({}, DEFAULT_BRANDING, window.TODOX_BRANDING || {});
})();
