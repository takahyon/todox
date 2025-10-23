// Minimal stub only. Full UI now handled by Svelte (panel.js) and history (completed.js).
// Responsibility: create mount root and collapse target sections. NOTHING ELSE.
(function(){
  const HEADINGS = ['本日のニュース','プレミアムにサブスクライブ','今を見つけよう'];
  function collapse(){
    const sidebar=document.querySelector('[data-testid="sidebarColumn"]');
    if(!sidebar) return; const hs=sidebar.querySelectorAll('h2,h3,h4');
    for(const h of hs){ const label=h.textContent?.trim(); if(label && HEADINGS.includes(label)){ const sec=h.closest('section,div'); if(sec) sec.style.display='none'; } }
  }
  function ensureRoot(){
    const sidebar=document.querySelector('[data-testid="sidebarColumn"]');
    if(!sidebar) return; if(!sidebar.querySelector('#todox-panel-root')){ const el=document.createElement('div'); el.id='todox-panel-root'; sidebar.prepend(el); }
  }
  function tick(){ collapse(); ensureRoot(); }
  setInterval(tick,3000); tick();
})();
