/** Light/dark theme toggle, shared by every page. The actual `data-theme` attribute is set
 *  synchronously by an inline script in each page's <head> (before any CSS paints, to avoid a
 *  flash of the wrong theme) — this module only wires up the toggle button and keeps its icon
 *  and localStorage in sync from then on. */

const STORAGE_KEY = 'openfile-theme';

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function updateButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const theme = currentTheme();
  const isDark = theme === 'dark';
  btn.textContent = isDark ? '🌙' : '☀️';
  btn.setAttribute('title', isDark ? 'Switch to light theme (dark mode)' : 'Switch to dark theme (light mode)');
  btn.setAttribute('aria-label', `Current theme: ${theme} mode`);
  btn.classList.toggle('light-mode', theme === 'light');
  btn.classList.toggle('dark-mode', theme === 'dark');
}

export function initTheme() {
  updateButton();
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next: 'light' | 'dark' = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private browsing, etc.) — theme just won't persist
    }
    updateButton();
  });
}
