import App from './App.svelte';

// Mount into a root element that will exist in completed.html
const target = document.getElementById('todox-root') || document.body;

new App({ target });
