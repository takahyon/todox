import TaskPanel from './TaskPanel.svelte';
import { subscribeExternalChanges } from '../lib/store.js';

// Mount point: create a container in the page (X.com sidebar area) if absent.
function ensureMount() {
  // Try to find existing sidebar; fallback to body
  let host = document.querySelector('[data-testid="sidebarColumn"]') || document.body;
  let container = host.querySelector('#todox-panel-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'todox-panel-root';
    container.style.cssText = 'position:relative; z-index:10;';
    host.prepend(container);
  }
  return container;
}

const mountEl = ensureMount();

const app = new TaskPanel({
  target: mountEl
});

// Listen for external chrome.storage changes to keep stores fresh.
subscribeExternalChanges();

// Hot Module Replacement support (dev only)
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    app.$destroy();
  });
}
