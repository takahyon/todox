<script>
  import { normaliseTasks, normaliseHistory, sumElapsed, startOfToday, formatDuration, formatDateTime } from '../lib/state.js';

  let tasks = [];
  let history = [];
  let loading = true;

  async function loadState() {
    // Try chrome.storage.sync first
    if (chrome?.storage?.sync) {
      const data = await new Promise((resolve) => {
        chrome.storage.sync.get([
          'todox.tasks',
          'todox.history',
          'todoxTasks',
          'todoxCompletedHistory'
        ], (result) => {
          if (chrome.runtime?.lastError) {
            console.warn('TodoX history: sync load failed; falling back', chrome.runtime.lastError);
            resolve({});
            return;
          }
          resolve(result || {});
        });
      });
      tasks = normaliseTasks(data['todox.tasks'] ?? data['todoxTasks']);
      history = normaliseHistory(data['todox.history'] ?? data['todoxCompletedHistory']);
    } else {
      try {
        const tasksJson = window.localStorage?.getItem('todox.tasks') ?? window.localStorage?.getItem('todoxTasks') ?? '[]';
        const historyJson = window.localStorage?.getItem('todox.history') ?? window.localStorage?.getItem('todoxCompletedHistory') ?? '[]';
        tasks = normaliseTasks(JSON.parse(tasksJson));
        history = normaliseHistory(JSON.parse(historyJson));
      } catch (e) {
        console.error('TodoX history: local fallback failed', e);
        tasks = [];
        history = [];
      }
    }
    loading = false;
  }

  loadState();

  $: todayStart = startOfToday();
  $: todayHistory = history.filter(h => (h.completedAt ?? 0) >= todayStart);
  $: todayFocus = sumElapsed(todayHistory);
  $: totalFocus = sumElapsed(history);
  $: active = tasks.find(t => t.runningSince);
  $: activeTasks = tasks.filter(t => !t.completed);
  $: upcoming = activeTasks; // alias for existing naming

  function handleExport() {
    const payload = {
      generatedAt: new Date().toISOString(),
      tasks,
      history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `todox-history-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
</script>

<main class="todox-history">
  <header class="todox-history__header">
    <div>
      <h1 class="todox-history__title">TodoX 履歴</h1>
      <p class="todox-history__subtitle">完了したタスクやフォーカスタイムを振り返って、次のアクションに活かしましょう。</p>
    </div>
    <button class="todox-history__export" type="button" on:click={handleExport} disabled={loading}>データをエクスポート</button>
  </header>

  <section class="todox-history__section">
    <h2 class="todox-history__section-title">今日のフォーカス</h2>
    {#if loading}
      <div class="todox-history__summary">読み込み中…</div>
    {:else}
      <div class="todox-history__summary">
        <span><strong>{todayHistory.length}</strong> 件完了 (本日)</span>
        <span>今日のフォーカス <strong>{formatDuration(todayFocus)}</strong></span>
        <span>累計フォーカス <strong>{formatDuration(totalFocus)}</strong></span>
        {#if active}
          <span>フォーカス中: <span class="todox-summary-pill">{active.text}</span></span>
        {:else if upcoming.length > 0}
          <span>次のタスク: <span class="todox-summary-pill">{upcoming[0].text}</span></span>
        {/if}
      </div>
    {/if}
  </section>

  <section class="todox-history__section">
    <h2 class="todox-history__section-title">完了タスク一覧</h2>
    {#if loading}
      <p class="todox-history__empty">読み込み中…</p>
    {:else if history.length === 0}
      <p class="todox-history__empty">まだ完了したタスクはありません。</p>
    {:else}
      <ul class="todox-history__list">
        {#each history as entry}
          <li class="todox-history__item">
            <h3 class="todox-history__item-title">{entry.text}</h3>
            <p class="todox-history__item-meta">
              <span>完了 {formatDateTime(entry.completedAt)}</span>
              <span>集中 {formatDuration(entry.elapsedMs)}</span>
              <span>作成 {formatDateTime(entry.createdAt)}</span>
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="todox-history__section">
    <h2 class="todox-history__section-title">現在のTODO</h2>
    {#if loading}
      <p class="todox-history__empty">読み込み中…</p>
    {:else}
  {#if activeTasks.length === 0}
        <p class="todox-history__empty">現在アクティブなTODOはありません。</p>
      {:else}
        <ul class="todox-history__list">
          {#each activeTasks as task}
            <li class="todox-history__task">
              <span class="todox-history__task-title">{task.text}</span>
              <span class="todox-history__task-meta">作成 {formatDateTime(task.createdAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/else}
  </section>

  <footer class="todox-history__footer">
    <p class="todox-history__credit">developed by <a href="https://x.com/TakaAizu" target="_blank" rel="noopener noreferrer">Taka</a></p>
    <div class="todox-history__promo" hidden></div>
  </footer>
</main>
