<script>
  import { tasksStore, activeTasksStore, completedTasksStore, activeTaskStore, persist } from '../lib/store.js';
  import { formatDuration } from '../lib/state.js';
  import { writable } from 'svelte/store';
  import { onMount } from 'svelte';

  export let maxTasks = 6;

  let newTaskText = '';
  let isComposing = false;
  const showCompleted = writable(true);
  let now = Date.now();
  let tickInterval;

  onMount(() => {
    tickInterval = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(tickInterval);
  });

  $: tasks = $tasksStore;
  $: activeTasks = $activeTasksStore;
  $: completedTasks = $completedTasksStore;
  $: activeTask = $activeTaskStore;
  $: progress = `${completedTasks.length}/${tasks.length}`;

  function addTask(text, startFocus = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (activeTasks.length >= maxTasks) return;
    const now = Date.now();
    tasksStore.update(list => {
      const newTask = {
        id: `task-${now}-${Math.random().toString(16).slice(2)}`,
        text: trimmed,
        createdAt: now,
        completed: false,
        elapsedMs: 0,
        runningSince: startFocus ? Date.now() : undefined,
      };
      return [...list, newTask];
    });
    persist();
    newTaskText = '';
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      if (isComposing) return;
      e.preventDefault();
      addTask(newTaskText);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      addTask(newTaskText, true);
    }
  }

  function toggleFocus(task) {
    tasksStore.update(list => list.map(t => {
      if (t.id === task.id) {
        if (t.runningSince) {
          // stop
          const now = Date.now();
            t.elapsedMs += now - t.runningSince;
            t.runningSince = undefined;
        } else {
          t.runningSince = Date.now();
        }
      } else if (t.runningSince) {
        // pause others
        const now = Date.now();
        t.elapsedMs += now - t.runningSince;
        t.runningSince = undefined;
      }
      return t;
    }));
    persist();
  }

  function complete(task) {
    tasksStore.update(list => list.map(t => {
      if (t.id === task.id) {
        if (t.runningSince) {
          const now = Date.now();
          t.elapsedMs += now - t.runningSince;
        }
        t.runningSince = undefined;
        t.completed = true;
        t.completedAt = Date.now();
      }
      return t;
    }));
    persist();
  }

  function uncomplete(task) {
    tasksStore.update(list => list.map(t => {
      if (t.id === task.id) {
        t.completed = false;
        t.completedAt = undefined;
      }
      return t;
    }));
    persist();
  }

  function remove(task) {
    tasksStore.update(list => list.filter(t => t.id !== task.id));
    persist();
  }

  function formatTimer(task) {
    let elapsed = task.elapsedMs;
    if (task.runningSince) {
      elapsed += now - task.runningSince;
    }
    return formatDuration(elapsed);
  }

  function archiveCompleted() {
    tasksStore.update(list => list.filter(t => !t.completed));
    persist();
  }
</script>

<section class="todox-panel" aria-label="TodoX">
  <header class="todox-panel__header">
    <div class="todox-panel__title-row">
      <h2 class="todox-panel__title">TodoX</h2>
      <div class="todox-panel__actions">
        <button type="button" class="todox-history-button" on:click={() => window.open(chrome?.runtime?.getURL ? chrome.runtime.getURL('completed.html') : 'completed.html', '_blank')}>履歴を開く</button>
      </div>
    </div>
    <p class="todox-panel__progress">完了 {progress} ・ 残り {activeTasks.length} ・ {activeTask ? `フォーカス中: ${activeTask.text}` : 'フォーカス待ち'}</p>
  </header>
  <div class="todox-panel__body">
    <ul class="todox-list todox-list--active">
      <li class="todox-list__item todox-list__item--new">
        <span class="todox-plus" aria-hidden="true">＋</span>
        <input
          class="todox-input"
          placeholder={activeTasks.length < maxTasks ? 'ここに入力して Enter で追加' : '集中中のタスクが落ち着いたら追加しましょう'}
          bind:value={newTaskText}
          on:keydown={handleKeydown}
          on:compositionstart={() => isComposing = true}
          on:compositionend={() => isComposing = false}
          {disabled: activeTasks.length >= maxTasks}
        />
        <div class="todox-actions">
          <button type="button" class="todox-action-button todox-action-button--focus" disabled={activeTasks.length >= maxTasks} on:click={() => addTask(newTaskText, true)}>▶︎</button>
        </div>
      </li>
      {#if activeTasks.length === 0}
        <li class="todox-list__item todox-list__item--empty"><span class="todox-empty-text">タスクはありません。今日やることを書き出しましょう！</span></li>
      {/if}
      {#each activeTasks as task}
        <li class="todox-list__item {task.runningSince ? 'todox-list__item--active' : ''}" data-task-id={task.id}>
          <button type="button" class="todox-circle-button" aria-label="完了としてマーク" on:click={() => complete(task)}></button>
          <div class="todox-task-content">
            <p class="todox-task-text">{task.text}</p>
            <span class="todox-task-timer">{formatTimer(task)}</span>
          </div>
          <div class="todox-actions">
            <button type="button" class="todox-action-button todox-action-button--focus" title={task.runningSince ? '一時停止' : 'フォーカス開始'} on:click={() => toggleFocus(task)}>{task.runningSince ? '⏸' : '▶︎'}</button>
            <button type="button" class="todox-action-button" aria-label="タスクを削除" title="削除" on:click={() => remove(task)}>🗑️</button>
          </div>
        </li>
      {/each}
    </ul>
    <section class="todox-done">
      <details open>
        <summary class="todox-done__summary">
          <div class="todox-done__header">
            <h3 class="todox-done__title">DoneX</h3>
            <span class="todox-done__subtitle">今日のがんばり</span>
            <button class="todox-done__archive" type="button" on:click={archiveCompleted}>✨ 昇華</button>
          </div>
        </summary>
        <div class="todox-done__content">
          {#if completedTasks.length === 0}
            <p class="todox-done__empty">まだ完了したタスクはありません。</p>
          {:else}
            <ul class="todox-done__list">
              {#each completedTasks.slice(0,12) as task}
                <li class="todox-done__item" data-task-id={task.id}>
                  <button type="button" class="todox-circle-button todox-circle-button--completed" aria-label="未完了に戻す" on:click={() => uncomplete(task)}>✓</button>
                  <div class="todox-task-content todox-task-content--done">
                    <p class="todox-task-text">{task.text}</p>
                    <span class="todox-task-timer">集中 {formatTimer(task)}</span>
                  </div>
                </li>
              {/each}
            </ul>
            {#if completedTasks.length > 12}
              <p class="todox-done__more">ほか {completedTasks.length - 12} 件の達成があります</p>
            {/if}
          {/if}
        </div>
      </details>
    </section>
  </div>
  <footer class="todox-panel__footer">
    <p class="todox-panel__credit">developed by <a class="todox-panel__credit-link" href="https://x.com/TakaAizu" target="_blank" rel="noopener noreferrer">Taka</a></p>
  </footer>
</section>
