export const DB_KEY = 'RASTREO_PY_INSTITUCIONAL_V5';
export const API_BASE = '/api';

try {
  localStorage.removeItem('RASTREO_PY_INSTITUCIONAL_V4');
} catch {
  /* Almacenamiento bloqueado o modo privado */
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
