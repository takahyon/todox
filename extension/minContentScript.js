// Minimal sidebar prep for TodoX Svelte panel
(function(){
  const TARGET_HEADINGS = ['本日のニュース','プレミアムにサブスクライブ','今を見つけよう'];
  function collapse(){
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    if(!sidebar) return;
    for(const h of sidebar.querySelectorAll('h2, h3, h4')){
      const t = h.textContent?.trim();
      if(t && TARGET_HEADINGS.includes(t)){
        const sec = h.closest('section, div');
        if(sec) sec.style.display='none';
      }
    }
  }
  function ensureRoot(){
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    if(!sidebar) return;
    if(!sidebar.querySelector('#todox-panel-root')){
      const el=document.createElement('div');
      el.id='todox-panel-root';
      sidebar.prepend(el);
    }
  }
  function tick(){ collapse(); ensureRoot(); }
  setInterval(tick,3000); tick();
})();