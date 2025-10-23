// Combined SponsorsManager and SponsorLogic (frequency cap + weighted selection)
// Exposes: window.TodoxSponsorLogic, window.TodoxSponsorsManager
(function(root){
  function isActiveSponsor(item, now = Date.now()) {
    if (!item || typeof item !== 'object') return false;
    const start = item.activeFrom ? Date.parse(item.activeFrom) : null;
    const end = item.activeTo ? Date.parse(item.activeTo) : null;
    if (Number.isFinite(start) && now < start) return false;
    if (Number.isFinite(end) && now > end) return false;
    return true;
  }
  function selectWeightedSponsor(items, random = Math.random) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const weights = items.map(i => Math.max(0, Number(i.weight) || 0));
    const total = weights.reduce((a,b)=>a+b,0);
    if (total <= 0) return items[0];
    const target = random() * total; let acc = 0;
    for (let i=0;i<items.length;i++){ acc += weights[i]; if (target <= acc) return items[i]; }
    return items[items.length-1];
  }
  function readJson(storage, key, fallback){
    if(!storage||typeof storage.getItem!=='function') return fallback;
    try { const v = storage.getItem(key); if(!v) return fallback; return JSON.parse(v);} catch { return fallback; }
  }
  function writeJson(storage, key, value){
    if(!storage||typeof storage.setItem!=='function') return; try { storage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function getTodayKey(now = Date.now()){ return new Date(now).toISOString().slice(0,10); }
  function canShowUnderFrequency(frequencyCap, storages, now = Date.now()){
    if(!frequencyCap) return true; const { perSession, perDay } = frequencyCap;
    if (typeof perSession==='number'&&perSession>0){ const s = readJson(storages.session,'todox.sponsor.session',{count:0}); if(s.count>=perSession) return false; }
    if (typeof perDay==='number'&&perDay>0){ const today = getTodayKey(now); const d = readJson(storages.local,'todox.sponsor.daily',{key:today,count:0}); if(d.key===today && d.count>=perDay) return false; }
    return true;
  }
  function recordImpression(frequencyCap, storages, now = Date.now()){
    if(!frequencyCap) return; const { perSession, perDay } = frequencyCap;
    if (typeof perSession==='number'&&perSession>0){ const s = readJson(storages.session,'todox.sponsor.session',{count:0}); s.count=(s.count||0)+1; writeJson(storages.session,'todox.sponsor.session',s); }
    if (typeof perDay==='number'&&perDay>0){ const today=getTodayKey(now); const d = readJson(storages.local,'todox.sponsor.daily',{key:today,count:0}); if(d.key!==today){ d.key=today; d.count=0;} d.count=(d.count||0)+1; writeJson(storages.local,'todox.sponsor.daily',d); }
  }
  class SponsorsManager {
    constructor(options={}){ this.premiumManager=options.premiumManager||null; this.config=null; this.currentSponsor=null; this.dismissed=new Set(); this.lastFetchedAt=0; this.fetchPromise=null; }
    getStorages(){ return { session: typeof sessionStorage!=='undefined'?sessionStorage:null, local: typeof localStorage!=='undefined'?localStorage:null}; }
    isPremiumActive(){ return this.premiumManager && typeof this.premiumManager.isActive==='function' ? this.premiumManager.isActive() : false; }
    isDismissed(id){ if(this.dismissed.has(id)) return true; try { return sessionStorage.getItem(`todox.sponsor.dismissed.${id}`)==='1'; } catch { return false; } }
    dismissCurrentSponsor(){ if(this.currentSponsor){ this.markDismissed(this.currentSponsor.id); this.currentSponsor=null; } }
    markDismissed(id){ this.dismissed.add(id); try { sessionStorage.setItem(`todox.sponsor.dismissed.${id}`,'1'); } catch {} }
    async init(){ await this.loadConfig(); }
    async loadConfig(force=false){ const now=Date.now(); if(!force && this.config && now - this.lastFetchedAt < 600000) return this.config; if(this.fetchPromise) return this.fetchPromise; this.fetchPromise=this.fetchConfig().then(cfg=>{ this.config=cfg; this.lastFetchedAt=Date.now(); return cfg; }).finally(()=>{ this.fetchPromise=null; }); return this.fetchPromise; }
    async fetchConfig(){ const urls=[]; const prem=this.premiumManager; if(prem && typeof prem.getSponsorUrl==='function') urls.push(prem.getSponsorUrl()); if(typeof chrome!=='undefined' && chrome.runtime?.getURL) urls.push(chrome.runtime.getURL('sponsors.json')); else urls.push('sponsors.json'); for(const url of urls){ try { const res = await fetch(url,{cache:'no-store'}); if(res.ok){ const json=await res.json(); if(json && Array.isArray(json.items)) return json; } } catch{} } return { version:1, items:[], frequencyCap:null }; }
    isSponsorStillValid(sponsor, cfg, now=Date.now()){ if(!sponsor) return false; if(this.isDismissed(sponsor.id)) return false; if(isActiveSponsor && !isActiveSponsor(sponsor, now)) return false; if(!cfg.items.some(i=>i.id===sponsor.id)) return false; return true; }
    async selectSponsor(now=Date.now()){ if(this.isPremiumActive()){ this.currentSponsor=null; return null; } const cfg=await this.loadConfig(); if(!cfg || !Array.isArray(cfg.items) || cfg.items.length===0) return null; const storages=this.getStorages(); if(this.currentSponsor && this.isSponsorStillValid(this.currentSponsor, cfg, now)) return this.currentSponsor; let candidates=cfg.items.filter(i=>isActiveSponsor?isActiveSponsor(i, now):true).filter(i=>!this.isDismissed(i.id)); if(cfg.frequencyCap){ if(typeof canShowUnderFrequency==='function'){ if(!canShowUnderFrequency(cfg.frequencyCap, storages, now)) return null; } }
      if(candidates.length===0) return null; const choice=selectWeightedSponsor?selectWeightedSponsor(candidates):candidates[0]; this.currentSponsor=choice; if(choice && cfg.frequencyCap){ recordImpression(cfg.frequencyCap, storages, now); } return choice; }
  }
  root.TodoxSponsorLogic = { isActiveSponsor, selectWeightedSponsor, canShowUnderFrequency, recordImpression, _readJson: readJson, _writeJson: writeJson, _getTodayKey: getTodayKey };
  root.TodoxSponsorsManager = SponsorsManager;
})(typeof window!=='undefined'?window:globalThis);