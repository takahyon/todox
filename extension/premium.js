// Lightweight Premium module: license verification, theme/BGM/telemetry prefs.
// Public surface preserved via global variables for existing callers.
(function (root) {
  const CONFIG = Object.assign({
    licensePublicKeyBase64: "",
    licenseRedeemUrl: "",
    sponsorsUrl: typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("sponsors.json") : "sponsors.json",
    diagnosticsUrl: "/api/diag",
  }, root.TODOX_CONFIG || {});

  const K = { LICENSE: "todox.licenseToken", THEME: "todox.theme", BGM: "todox.focusBgm", TELEMETRY: "todox.telemetry" };
  const PREMIUM_FEATURES = { themes: "themes", focusBgm: "focus_bgm", analytics: "local_analytics" };

  const storage = (() => {
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch {};
    return { getItem(){return null;}, setItem(){}, removeItem(){} };
  })();

  function emit(self){ self.listeners.forEach(cb=>{ try{ cb(self); }catch{} }); }
  function setStatus(self, status, silent){ if(!silent){ self.status = status; emit(self); } else { self.status = status; } }

  async function extractError(response){
    try { const data = await response.clone().json(); if(data && typeof data.error==='string'){ return data.hint? `${data.error} (${data.hint})`: data.error; } } catch{};
    return response && response.status? `サーバーエラー (HTTP ${response.status})`: "コードの検証に失敗しました";
  }

  class PremiumManager {
    constructor(){
      const vlib = root.TodoxVerifyLicense || {}; 
      this.verifyLicenseToken = vlib.verifyLicenseToken || null;
      this.LicenseVerificationError = vlib.LicenseVerificationError || Error;
      this.publicKeyBase64 = CONFIG.licensePublicKeyBase64;
      this.license = null; this.listeners = new Set(); this.status = 'idle';
    }
    async init(){ const stored = storage.getItem(K.LICENSE); if(stored){ try{ await this.applyLicense(stored, true); } catch { this.clearLicense(true);} } }
    async applyLicense(token, silent){ if(!this.verifyLicenseToken) throw new Error('License verification library unavailable'); setStatus(this,'verifying',silent); const { payload } = await this.verifyLicenseToken(token, this.publicKeyBase64); this.license = { token, payload, features: new Set(Array.isArray(payload.features)? payload.features: []), expiresAt: payload.exp*1000 }; storage.setItem(K.LICENSE, token); setStatus(this,'verified',silent); return payload; }
    clearLicense(silent){ this.license=null; storage.removeItem(K.LICENSE); setStatus(this,'cleared',silent); }
    onChange(cb){ this.listeners.add(cb); return ()=> this.listeners.delete(cb); }
    isActive(){ if(!this.license) return false; if(this.license.expiresAt <= Date.now()){ this.clearLicense(true); return false;} return true; }
    hasFeature(f){ return this.isActive() && this.license.features.has(f); }
    getStatus(){ return this.status; }
    getLicensePayload(){ return this.license? this.license.payload: null; }
    getDiagnosticsUrl(){ return CONFIG.diagnosticsUrl; }
    getSponsorUrl(){ return CONFIG.sponsorsUrl; }
    async redeem(raw){ const code = typeof raw==='string'? raw.trim(): ''; if(!code) return { ok:false, error:'コードを入力してください' }; setStatus(this,'verifying'); let token=code; if(CONFIG.licenseRedeemUrl){ try{ const res = await fetch(CONFIG.licenseRedeemUrl,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }), credentials:'omit' }); if(!res.ok){ throw new Error(await extractError(res)); } const data = await res.json(); if(!data || typeof data.licenseToken!=='string') throw new Error('無効なライセンス応答です'); token = data.licenseToken; } catch(err){ setStatus(this,'idle'); const msg = err?.message === 'Failed to fetch'? 'サーバーに接続できませんでした': (err?.message || 'コードの検証に失敗しました'); return { ok:false, error: msg, originalError: err }; } }
      try { const payload = await this.applyLicense(token); return { ok:true, payload }; } catch(err){ setStatus(this,'idle'); const msg = err && err.code === 'EXPIRED'? 'コードの有効期限が切れています': 'コードの検証に失敗しました'; return { ok:false, error: msg, originalError: err }; } }
    getSelectedTheme(){ return storage.getItem(K.THEME) || 'default'; }
    setSelectedTheme(t){ storage.setItem(K.THEME, t); }
    getSelectedBgm(){ return storage.getItem(K.BGM) || 'none'; }
    setSelectedBgm(b){ storage.setItem(K.BGM, b); }
    isTelemetryEnabled(){ return storage.getItem(K.TELEMETRY)==='1'; }
    setTelemetryEnabled(en){ en? storage.setItem(K.TELEMETRY,'1'): storage.removeItem(K.TELEMETRY); }
  }

  const premium = new PremiumManager();
  premium.init();
  root.TODOX_PREMIUM = premium;
  root.TODOX_CONFIG = CONFIG;
  root.TODOX_PREMIUM_FEATURES = PREMIUM_FEATURES;
})(typeof window !== 'undefined'? window: globalThis);
