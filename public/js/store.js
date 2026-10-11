import { DB_KEY } from './config.js';

export function getStore() {
  let store = { notificaciones: [] };
  try {
    const data = localStorage.getItem(DB_KEY);
    if (data) {
      store = JSON.parse(data) || {};
    }
  } catch {
    /* Ignorar datos corruptos o almacenamiento bloqueado */
  }

  delete store.users;
  delete store.codigosOTP;
  delete store.currentUser;
  delete store.casos;
  delete store.pistas;

  store.currentUser = window.backendCurrentUser || null;
  store.casos = window.backendCaseData?.casos || [];
  store.pistas = window.backendCaseData?.pistas || [];
  store.notificaciones = Array.isArray(store.notificaciones) ? store.notificaciones : [];

  localStorage.removeItem('rastreo_usuarios');
  localStorage.removeItem('rastreo_codigos');
  sessionStorage.removeItem('rastreo_sesion');
  return store;
}

export function saveStore(store) {
  try {
    // En localStorage solo se persisten notificaciones (y metadatos locales);
    // casos y pistas NUNCA se guardan en localStorage porque vienen del backend y saturarían la cuota.
    const { users, codigosOTP, currentUser, casos, pistas, ...appData } = store;
    localStorage.setItem(DB_KEY, JSON.stringify(appData));
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22) {
      console.warn('Espacio insuficiente en localStorage (QuotaExceededError). Se omitió el guardado local del estado.');
    } else {
      console.error('Error al guardar en localStorage:', error);
    }
  }
}
