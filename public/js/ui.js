import { estado } from './estado.js';

export function showToast(title, msg, type = 'info') {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  const titleEl = document.getElementById('toastTitle');
  const msgEl = document.getElementById('toastMessage');
  if (titleEl) titleEl.innerText = title;
  if (msgEl) msgEl.innerText = msg;
  toast.dataset.type = type;
  toast.classList.remove('hidden');
  if (estado.toastTimeout) clearTimeout(estado.toastTimeout);
  estado.toastTimeout = setTimeout(hideToast, 7000);
}

export function hideToast() {
  const toast = document.getElementById('toastNotification');
  if (toast) toast.classList.add('hidden');
  if (estado.toastTimeout) clearTimeout(estado.toastTimeout);
  estado.toastTimeout = null;
}

export function applyTheme(theme) {
  const selectedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selectedTheme;
  const button = document.getElementById('themeToggle');
  if (button) button.textContent = selectedTheme === 'dark' ? 'Tema claro' : 'Tema oscuro';
  const publicButton = document.getElementById('publicThemeToggle');
  if (publicButton) publicButton.textContent = selectedTheme === 'dark' ? 'Tema claro' : 'Tema oscuro';
}

export function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('rastreo_theme', nextTheme);
  applyTheme(nextTheme);
}

export function labelButtons(container = document) {
  container.querySelectorAll('button:not([aria-label])').forEach(button => {
    const label = button.textContent.trim();
    if (label) button.setAttribute('aria-label', label);
  });
}

export function toggleDrawer(open) {
  const drawer = document.getElementById('drawer');
  const overlay = document.getElementById('drawerOverlay');
  if (open) {
    if (drawer) drawer.classList.add('open');
    if (overlay) overlay.classList.remove('hidden');
  } else {
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.add('hidden');
  }
}

export function toggleSimulateTimeModal() {
  const modal = document.getElementById('simTimeModal');
  if (modal) modal.classList.toggle('hidden');
}

export const NOTICE_TONES = {
  SEGUIMIENTO: 'warning',
  SEGUIMIENTO_VENCIDO: 'warning',
  CASO_SIN_ACTUALIZAR: 'warning',
  CASO_PENDIENTE: 'warning',
  CASO_LOCALIZADO: 'success',
  PISTA_VALIDADA: 'success',
  CASO_VALIDADO: 'success',
  CASO_RECHAZADO: 'danger'
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

export function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relativeTimeFormatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTimeFormatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relativeTimeFormatter.format(days, 'day');
  return date.toLocaleDateString('es-PY', { day: 'numeric', month: 'short', year: 'numeric' });
}
