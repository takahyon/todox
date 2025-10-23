// Shared state & formatting utilities for TodoX (Svelte source)
export function normaliseTasks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((task) => ({
      id: typeof task?.id === 'string' ? task.id : crypto.randomUUID?.() || `task-${Date.now()}`,
      text: String(task?.text ?? '').trim(),
      createdAt: typeof task?.createdAt === 'number' ? task.createdAt : Date.now(),
      completedAt: typeof task?.completedAt === 'number' ? task.completedAt : undefined,
      elapsedMs: typeof task?.elapsedMs === 'number' ? task.elapsedMs : 0,
      completed: Boolean(task?.completed),
      runningSince: typeof task?.runningSince === 'number' ? task.runningSince : undefined,
    }))
    .filter((task) => task.text.length > 0);
}

export function normaliseHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => ({
      id: typeof entry?.id === 'string' ? entry.id : crypto.randomUUID?.() || `history-${Date.now()}`,
      text: String(entry?.text ?? '').trim(),
      createdAt: typeof entry?.createdAt === 'number' ? entry.createdAt : Date.now(),
      completedAt: typeof entry?.completedAt === 'number' ? entry.completedAt : Date.now(),
      elapsedMs: typeof entry?.elapsedMs === 'number' ? entry.elapsedMs : 0,
    }))
    .filter((entry) => entry.text.length > 0)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export function sumElapsed(items) {
  return items.reduce((total, entry) => total + (entry.elapsedMs ?? 0), 0);
}

export function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(String(hours).padStart(2, '0'));
  parts.push(String(minutes).padStart(2, '0'));
  parts.push(String(seconds).padStart(2, '0'));
  return parts.join(':');
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
