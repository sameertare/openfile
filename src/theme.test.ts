// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initTheme } from './theme';

function setupDom() {
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '<button id="theme-toggle"></button>';
  localStorage.clear();
}

describe('initTheme', () => {
  beforeEach(setupDom);

  it('sets the button icon/label for the initial (dark, default) theme', () => {
    initTheme();
    const btn = document.getElementById('theme-toggle')!;
    expect(btn.textContent).toBe('🌙');
    expect(btn.getAttribute('aria-label')).toBe('Current theme: dark mode');
  });

  it('reflects an already-set light theme on init', () => {
    document.documentElement.dataset.theme = 'light';
    initTheme();
    const btn = document.getElementById('theme-toggle')!;
    expect(btn.textContent).toBe('☀️');
    expect(btn.classList.contains('light-mode')).toBe(true);
  });

  it('toggles the theme attribute, button icon, and localStorage on click', () => {
    initTheme();
    const btn = document.getElementById('theme-toggle')!;
    btn.click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(btn.textContent).toBe('☀️');
    expect(localStorage.getItem('openfile-theme')).toBe('light');

    btn.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(btn.textContent).toBe('🌙');
    expect(localStorage.getItem('openfile-theme')).toBe('dark');
  });

  it('does nothing (and does not throw) when the toggle button is absent from the page', () => {
    document.body.innerHTML = '';
    expect(() => initTheme()).not.toThrow();
  });
});
