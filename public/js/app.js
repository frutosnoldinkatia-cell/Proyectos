import { estado } from './estado.js';
import { DB_KEY, API_BASE, escapeHtml } from './config.js';
import { apiRequest } from './api.js';
import { getStore, saveStore } from './store.js';
import {
  showToast,
  hideToast,
  applyTheme,
  toggleTheme,
  labelButtons,
  toggleDrawer,
  toggleSimulateTimeModal,
  formatRelativeTime,
  NOTICE_TONES
} from './ui.js';

// Puente Window para compatibilidad durante la migración y soporte de manejadores inline
Object.assign(window, {
  estado,
  DB_KEY,
  API_BASE,
  escapeHtml,
  apiRequest,
  getStore,
  saveStore,
  showToast,
  hideToast,
  applyTheme,
  toggleTheme,
  labelButtons,
  toggleDrawer,
  toggleSimulateTimeModal,
  formatRelativeTime,
  NOTICE_TONES
});

export {
  estado,
  DB_KEY,
  API_BASE,
  escapeHtml,
  apiRequest,
  getStore,
  saveStore,
  showToast,
  hideToast,
  applyTheme,
  toggleTheme,
  labelButtons,
  toggleDrawer,
  toggleSimulateTimeModal,
  formatRelativeTime,
  NOTICE_TONES
};
