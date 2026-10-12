// Sincronización en vivo con el backend (polling) y firmas para detectar cambios.
import { loadAdminHistoryPhotos, renderAdminView, selectAdminTab } from './admin.js';
import { apiRequest } from './api.js';
import { API_BASE } from './config.js';
import { estado } from './estado.js';
import { filterFeedCases, renderCasePhotos, renderFeedView } from './feed.js';
import { filterLeadCaseCards, renderLeadCaseSelection } from './lead.js';
import { initMainLeafletMap } from './map.js';
import { renderMyCasesView } from './my-cases.js';
import { updateNotifBadge } from './notifications.js';
import { updatePublicMetricCards } from './stats.js';
import { getStore } from './store.js';
import { labelButtons, showToast } from './ui.js';

export function startPublicStatsPolling() {
  if (estado.publicStatsTimer) clearInterval(estado.publicStatsTimer);
  estado.publicStatsTimer = window.setInterval(async () => {
    if (window.rastreoCurrentView !== 'feed' || document.hidden) return;
    try {
      const statistics = await apiRequest('/estadisticas');
      window.currentStatistics = statistics;
      updatePublicMetricCards(statistics);
    } catch (error) {
      showToast('No se pudieron actualizar las estadísticas', error.message, 'error');
    }
  }, 60000);
}

// Cada cuánto se actualiza cada vista. El feed y la pista son públicos: en un
// evento hay ~100 celulares contra el mismo servidor, así que van cada 20 s. Mis
// casos y el panel admin los usa poca gente y conviene verlos al instante.
const LIVE_SYNC_MS = { feed: 20_000, lead: 20_000, 'my-cases': 5_000, admin: 5_000 };

export function startLiveSyncPolling(view) {
  if (estado.liveSyncTimer) clearInterval(estado.liveSyncTimer);
  const tick = async () => {
    // Con la pestaña oculta (o el celular bloqueado) no se pide nada.
    if (window.rastreoCurrentView !== view || document.hidden) return;
    if (estado.liveSyncInProgress) return;
    estado.liveSyncInProgress = true;
    try {
      if (view === 'admin') await refreshAdminDashboard();
      else if (view === 'my-cases') await refreshMyCases();
      else await refreshPublicCaseViews(view);
    } finally {
      estado.liveSyncInProgress = false;
    }
  };
  estado.liveSyncTick = tick;
  estado.liveSyncTimer = window.setInterval(tick, LIVE_SYNC_MS[view] || 20_000);
}

// Al volver a la pestaña se actualiza enseguida, sin esperar al próximo intervalo.
export function syncOnVisible() {
  if (!document.hidden) estado.liveSyncTick?.();
}

export function caseCollectionSignature(cases) {
  return JSON.stringify(cases.map(item => [
    item.id, item.estado, item.fechaCreacion, item.localizadoEn
  ]));
}

export function citizenDashboardSignature(cases, notifications) {
  return JSON.stringify([
    cases.map(item => [item.id, item.estado, item.proximoSeguimiento, item.motivoRechazo]),
    notifications.map(item => [item.id, item.leida])
  ]);
}

export function adminDashboardDataSignature(cases, clues, audit) {
  return JSON.stringify([
    cases.map(item => [item.id, item.estado, item.proximoSeguimiento, item.numeroDenuncia]),
    clues.map(item => [item.id, item.estado, item.fechaEnvio]),
    audit[0]?.fecha
  ]);
}

export async function refreshPublicCaseViews(view) {
  try {
    const [caseResult, clueResult] = await Promise.all([
      apiRequest('/casos'),
      apiRequest('/pistas')
    ]);
    replaceBackendCollections(caseResult.casos, clueResult.pistas);
    const signature = caseCollectionSignature(caseResult.casos);
    if (signature === estado.lastPublicCaseSignature) return;
    estado.lastPublicCaseSignature = signature;
    if (view === 'feed') {
      const list = document.getElementById('feedCaseList');
      if (!list) return;
      filterFeedCases(false);
      if (!document.getElementById('feedMapPanel').classList.contains('hidden')) {
        initMainLeafletMap();
      }
      const statistics = await apiRequest('/estadisticas');
      window.currentStatistics = statistics;
      updatePublicMetricCards(statistics);
    } else if (view === 'lead') {
      const search = document.getElementById('leadCaseSearch')?.value || '';
      if (document.getElementById('leadCaseChoices')) {
        document.getElementById('mainContent').innerHTML = renderLeadCaseSelection();
        const input = document.getElementById('leadCaseSearch');
        if (input) {
          input.value = search;
          filterLeadCaseCards();
        }
      }
    }
  } catch (error) {
    console.error('No se pudo sincronizar los casos públicos:', error.message);
  }
}

export async function refreshMyCases() {
  try {
    const [caseResult, notificationResult] = await Promise.all([
      apiRequest('/mis-casos'),
      apiRequest('/notificaciones')
    ]);
    if (window.rastreoCurrentView !== 'my-cases') return;
    const signature = citizenDashboardSignature(caseResult.casos, notificationResult.notificaciones);
    if (signature === estado.lastMyCasesSignature) return;
    estado.lastMyCasesSignature = signature;
    document.getElementById('mainContent').innerHTML =
      renderMyCasesView(caseResult.casos, notificationResult.notificaciones);
    labelButtons(document.getElementById('mainContent'));
    updateNotifBadge();
  } catch (error) {
    console.error('No se pudieron sincronizar los casos ciudadanos:', error.message);
  }
}

export async function loadAdminDashboardData() {
  const caseResult = await apiRequest('/admin/casos');
  const [historyResult, clueResult, auditResult] = await Promise.allSettled([
    apiRequest('/admin/historial-localizados'),
    apiRequest('/admin/pistas'),
    apiRequest('/admin/auditoria')
  ]);
  const optionalResults = [
    [historyResult, '/admin/historial-localizados', { casos: [], pagina: 1, limite: 20, total: 0 }],
    [clueResult, '/admin/pistas', { pistas: [] }],
    [auditResult, '/admin/auditoria', { eventos: [] }]
  ];
  const values = optionalResults.map(([result, endpoint, fallback]) => {
    if (result.status === 'fulfilled') return result.value;
    console.error(`No se pudo cargar ${API_BASE}${endpoint}; se mostrará el panel sin esta sección auxiliar.`, {
      status: result.reason?.status || 'network',
      message: result.reason?.message || String(result.reason)
    });
    return fallback;
  });
  return {
    cases: caseResult.casos,
    history: values[0],
    clues: values[1].pistas,
    audit: values[2].eventos
  };
}

export async function refreshAdminDashboard() {
  try {
    const { cases, history, clues, audit } = await loadAdminDashboardData();
    if (window.rastreoCurrentView !== 'admin') return;
    const activePanel = document.querySelector('[data-admin-panel]:not(.hidden)')?.dataset.adminPanel || 'overview';
    replaceBackendCollections(cases, []);
    const dueCases = cases.filter(c =>
      !['CERRADO', 'LOCALIZADO', 'RECHAZADO'].includes(c.estado)
      && ((c.estado === 'EN_SEGUIMIENTO' && c.seguimientoEtapa >= 2)
        || (c.proximoSeguimiento && new Date(c.proximoSeguimiento).getTime() < Date.now()))
    ).length;
    const outstanding = cases.filter(c => c.estado === 'PENDIENTE').length
    + dueCases
    + clues.filter(clue => clue.estado === 'PENDIENTE').length;
    const badge = document.getElementById('adminPanelBadge');
    badge.textContent = String(outstanding);
    badge.classList.toggle('hidden', outstanding === 0);
    const signature = adminDashboardDataSignature(cases, clues, audit);
    if (signature === estado.lastAdminDashboardSignature) return;
    estado.lastAdminDashboardSignature = signature;
    const main = document.getElementById('mainContent');
    main.innerHTML = renderAdminView(history, clues, audit);
    const activeTab = main.querySelector(`[data-admin-tab="${activePanel}"]`);
    selectAdminTab(activePanel, activeTab);
    loadAdminHistoryPhotos(main);
    labelButtons(main);
  } catch (error) {
    console.error('No se pudo sincronizar la bandeja administrativa.', {
      endpoint: error.endpoint || `${API_BASE}/admin/casos`,
      status: error.status || 'network',
      message: error.message
    });
  }
}

export function scheduleLocatedExpiry() {
  if (estado.locatedExpiryTimer) clearTimeout(estado.locatedExpiryTimer);
  const nextExpiry = getStore().casos
    .filter(c => c.estado === 'LOCALIZADO' && c.visibleHasta)
    .map(c => new Date(c.visibleHasta).getTime())
    .filter(timestamp => Number.isFinite(timestamp) && timestamp > Date.now())
    .sort((left, right) => left - right)[0];
  if (!nextExpiry) return;

  const delay = Math.min(nextExpiry - Date.now() + 50, 2147483647);
  estado.locatedExpiryTimer = setTimeout(async () => {
    if (window.rastreoCurrentView !== 'feed') return;
    try {
      const [caseResult, clueResult] = await Promise.all([
        apiRequest('/casos'),
        apiRequest('/pistas')
      ]);
      replaceBackendCollections(caseResult.casos, clueResult.pistas);
      estado.lastPublicCaseSignature = caseCollectionSignature(caseResult.casos);
      const main = document.getElementById('mainContent');
      main.innerHTML = renderFeedView();
      renderCasePhotos(caseResult.casos);
      initMainLeafletMap();
      scheduleLocatedExpiry();
    } catch (error) {
      showToast('No se pudo actualizar la vista pública', error.message);
    }
  }, delay);
}

// ENRUTADOR Y GESTIÓN DE VISTAS SPA
// Cache en memoria de lo ultimo que devolvio el backend. Vive aca y no
// dentro de navigateTo porque tambien la usan las sincronizaciones
// periodicas, que corren fuera de ese alcance.
export function replaceBackendCollections(casos, pistas) {
  window.backendCaseData = { casos, pistas };
}
