// Rutas (hash), navegación con control de acceso y vistas que piden cuenta.
import { loadAdminHistoryPhotos, renderAdminView, selectAdminTab } from './admin.js';
import { apiRequest } from './api.js';
import { renderAuthScreen, renderLegalTerms, renderOTPView, updateHeaderUser } from './auth.js';
import { API_BASE, escapeHtml } from './config.js';
import { estado } from './estado.js';
import { closeCaseDetail, filterFeedCases, openCaseDetail, renderFeedView } from './feed.js';
import { clearLeadPhotoSelection, initLeadLeafletMap, renderLeadCaseSelection, renderLeadView } from './lead.js';
import { initMainLeafletMap } from './map.js';
import { renderMyCasesView } from './my-cases.js';
import { renderNotifList, updateNotifBadge } from './notifications.js';
import { initReportLeafletMap, initReportLocationSelects, removeReportPhoto, renderReportView } from './report.js';
import { renderStatsView } from './stats.js';
import { getStore } from './store.js';
import { adminDashboardDataSignature, caseCollectionSignature, citizenDashboardSignature, loadAdminDashboardData, replaceBackendCollections, scheduleLocatedExpiry, startLiveSyncPolling, startPublicStatsPolling } from './sync.js';
import { labelButtons, showToast, toggleDrawer } from './ui.js';

// Direccion que la app considera activa. Evita que un pushState y el
// evento de historial se pisen entre si y entren en bucle.
export function consumePendingDestination() {
  const destino = estado.pendingDestination;
  estado.pendingDestination = null;
  return destino;
}

export function buildRoute(view, params = {}) {
  switch (view) {
    case 'report': return '#/reportar';
    case 'lead': return params.caseId ? `#/pista/${encodeURIComponent(params.caseId)}` : '#/pista';
    case 'case': return `#/caso/${encodeURIComponent(params.caseId)}`;
    case 'stats': return '#/estadisticas';
    case 'my-cases': return '#/mis-casos';
    case 'alerts': return '#/alertas';
    case 'admin': return params.tab && params.tab !== 'overview' ? `#/panel/${encodeURIComponent(params.tab)}` : '#/panel';
    case 'auth': return params.authMode === 'register' ? '#/crear-cuenta' : '#/ingresar';
    case 'otp': return '#/verificar';
    case 'legal': return '#/bases';
    default: return '#/';
  }
}

export function parseRoute(hash = location.hash) {
  // Enlaces viejos compartidos antes del ruteo: #caso=<id>
  if (hash.startsWith('#caso=')) {
    const legacyId = new URLSearchParams(hash.slice(1)).get('caso');
    if (legacyId) return { view: 'feed', params: {}, caseId: legacyId };
  }
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const head = segments[0];
  let tail = '';
  try {
    tail = segments[1] ? decodeURIComponent(segments[1]) : '';
  } catch (error) {
    tail = '';
  }
  switch (head) {
    case 'reportar': return { view: 'report', params: {} };
    case 'pista': return { view: 'lead', params: tail ? { caseId: tail } : {} };
    case 'caso': return tail ? { view: 'feed', params: {}, caseId: tail } : { view: 'feed', params: {} };
    case 'estadisticas': return { view: 'stats', params: {} };
    case 'mis-casos': return { view: 'my-cases', params: {} };
    case 'alertas': return { view: 'alerts', params: {} };
    case 'panel': return { view: 'admin', params: tail ? { tab: tail } : {} };
    case 'ingresar': return { view: 'auth', params: { authMode: 'login' } };
    case 'crear-cuenta': return { view: 'auth', params: { authMode: 'register' } };
    case 'verificar': return { view: 'otp', params: {} };
    case 'bases': return { view: 'legal', params: {} };
    default: return { view: 'feed', params: {} };
  }
}

// Identifica que hay que volver a dibujar. La ficha de caso queda
// fuera a proposito: se superpone al feed, no lo reemplaza.
export function routeRenderKey(view, params = {}) {
  return `${view}|${params.caseId || ''}|${params.authMode || ''}`;
}

export function syncUrl(view, params = {}, { replace = false, caseId = '' } = {}) {
  const url = caseId ? buildRoute('case', { caseId }) : buildRoute(view, params);
  if (url === estado.currentRouteUrl) return;
  estado.currentRouteUrl = url;
  try {
    if (replace) history.replaceState({ url }, '', url);
    else history.pushState({ url }, '', url);
  } catch (error) {
    console.error('No se pudo actualizar la direccion del navegador.', error);
  }
}

// Lee la direccion actual y deja la pantalla acorde. Es el unico
// camino que usan el boton atras, el adelante y la carga inicial.
export async function applyCurrentRoute() {
  let route = parseRoute();
  const store = getStore();

  // Las bases solo existen como pantalla mientras falte aceptarlas.
  if (route.view === 'legal' && !(store.currentUser && !store.currentUser.acepto_terminos)) {
    route = { view: 'feed', params: {} };
  }
  // La verificacion por codigo no se puede retomar en frio: el correo
  // vive en memoria y no se pone en la URL.
  if (route.view === 'otp' && !estado.activeOtpEmail) {
    route = { view: 'auth', params: { authMode: 'login' } };
  }

  const target = route.caseId
    ? buildRoute('case', { caseId: route.caseId })
    : buildRoute(route.view, route.params);

  // Cuando el router corrige la direccion pedida (ruta inexistente,
  // bases ya aceptadas, verificacion sin flujo activo) hay que
  // reescribir la barra antes de dibujar. Si no, la URL dice una cosa
  // y la pantalla muestra otra. La raiz admite las dos formas, '' y
  // '#/', y no se reescribe para no ensuciar el enlace limpio.
  const actualHash = location.hash || '#/';
  if (target !== actualHash && !(target === '#/' && actualHash === '#/')) {
    try {
      history.replaceState({ url: target }, '', target);
    } catch (error) {
      console.error('No se pudo corregir la direccion del navegador.', error);
    }
  }

  if (target === estado.currentRouteUrl) return;
  estado.currentRouteUrl = target;

  const token = ++estado.routeApplyToken;
  const alreadyRendered = window.rastreoCurrentView
    && routeRenderKey(route.view, route.params)
      === routeRenderKey(window.rastreoCurrentView, window.rastreoCurrentParams || {});

  if (!alreadyRendered) {
    await navigateTo(route.view, route.params, { fromHistory: true });
    if (token !== estado.routeApplyToken) return;
  } else if (route.view === 'admin') {
    // La pestaña no forma parte de routeRenderKey: se cambia sin recargar el panel.
    selectAdminTab(route.params.tab || 'overview', null, { silent: true });
  }
  if (route.caseId) openCaseDetail(route.caseId, { fromHistory: true });
  else closeCaseDetail({ fromHistory: true });
}

// Pantallas visibles sin sesión. El resto exige cuenta (docs/ROLES_Y_PERMISOS.txt).
export const PUBLIC_VIEWS = ['feed', 'stats'];

export async function navigateTo(view, params = {}, options = {}) {
  if (estado.locatedExpiryTimer) {
    clearTimeout(estado.locatedExpiryTimer);
    estado.locatedExpiryTimer = null;
  }
  if (estado.publicStatsTimer) {
    clearInterval(estado.publicStatsTimer);
    estado.publicStatsTimer = null;
  }
  if (estado.liveSyncTimer) {
    clearInterval(estado.liveSyncTimer);
    estado.liveSyncTimer = null;
  }
  const store = getStore();
  const main = document.getElementById('mainContent');
  const header = document.getElementById('topHeader');
  if (view === 'home') {
    view = 'feed';
  }
  // Si la app termina mostrando algo distinto a lo pedido (sesion
  // caducada, permiso faltante), la direccion tiene que corregirse
  // aunque la navegacion venga del historial: si no, la barra del
  // navegador queda diciendo una cosa y la pantalla muestra otra.
  const requestedView = view;

  if (!store.currentUser && ACCESS_GATED_VIEWS[view]) {
    // Se recuerda adonde queria ir para devolverlo ahi despues del login.
    estado.pendingDestination = { view, params };
    window.rastreoCurrentView = view;
    window.rastreoCurrentParams = params;
    document.querySelectorAll('[data-nav-view]').forEach(button => {
      if (button.dataset.navView === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    header.classList.remove('hidden');
    document.getElementById('publicThemeToggle').classList.add('hidden');
    updateHeaderUser();
    main.innerHTML = renderAccessView(view);
    labelButtons(main);
    if (!options.fromHistory) syncUrl(view, params, { replace: options.replace });
    return;
  }

  if (!store.currentUser && view !== 'otp' && !PUBLIC_VIEWS.includes(view)) {
    header.classList.add('hidden');
    main.innerHTML = renderAuthScreen(params.authMode || 'login', params.identifier || '');
    document.getElementById('publicThemeToggle').classList.remove('hidden');
    labelButtons(main);
    window.rastreoCurrentView = 'auth';
    window.rastreoCurrentParams = { authMode: params.authMode || 'login' };
    const authRedirect = requestedView !== 'auth';
    if (!options.fromHistory || authRedirect) {
      syncUrl('auth', window.rastreoCurrentParams, { replace: options.replace || authRedirect });
    }
    return;
  }

  if (view === 'alerts' && store.currentUser) {
    await navigateTo('feed', {}, options);
    const notifModal = document.getElementById('notifModal');
    notifModal.classList.remove('hidden');
    renderNotifList();
    return;
  }

  if (store.currentUser && !store.currentUser.acepto_terminos) {
    header.classList.add('hidden');
    main.innerHTML = renderLegalTerms();
    document.getElementById('publicThemeToggle').classList.remove('hidden');
    labelButtons(main);
    window.rastreoCurrentView = 'legal';
    window.rastreoCurrentParams = {};
    if (!options.fromHistory || requestedView !== 'legal') syncUrl('legal', {}, { replace: true });
    return;
  }

  if (store.currentUser) {
    header.classList.remove('hidden');
    document.getElementById('publicThemeToggle').classList.add('hidden');
    updateHeaderUser();
  } else {
    const showPublicNavigation = PUBLIC_VIEWS.includes(view);
    header.classList.toggle('hidden', !showPublicNavigation);
    document.getElementById('publicThemeToggle').classList.toggle('hidden', showPublicNavigation);
    updateHeaderUser();
  }

  if (store.currentUser && ['auth', 'otp'].includes(view)) {
    view = 'feed';
  }

  const isAdmin = store.currentUser && ['administrador', 'ADMINISTRADOR'].includes(store.currentUser.rol);

  if (isAdmin && ['report', 'my-cases'].includes(view)) {
    showToast('Acceso no disponible', 'La cuenta de administrador no reporta ni gestiona casos propios.', 'error');
    view = 'feed';
  }

  if (view === 'admin' && !isAdmin) {
    showToast('Acceso restringido', 'Acceso restringido únicamente para personal autorizado del Ente Regulador.', 'error');
    view = 'feed';
  }
  window.rastreoCurrentView = view;
  window.rastreoCurrentParams = params;
  const wasRedirected = view !== requestedView;
  if (!options.fromHistory || wasRedirected) {
    syncUrl(view, params, { replace: options.replace || wasRedirected });
  }
  document.querySelectorAll('[data-nav-view]').forEach(button => {
    if (button.dataset.navView === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  let statistics = window.currentStatistics || null;
  let adminHistory = null;
  let adminClues = [];
  let adminAudit = [];
  let myCases = [];
  let myNotifications = [];
  if (view === 'feed' || view === 'lead') {
    try {
      const [caseResult, clueResult] = await Promise.all([
        apiRequest('/casos'),
        apiRequest('/pistas')
      ]);
      replaceBackendCollections(caseResult.casos, clueResult.pistas);
      estado.lastPublicCaseSignature = caseCollectionSignature(caseResult.casos);
    } catch (error) {
      showToast('Error al cargar los casos', error.message);
      return;
    }
    if (view === 'feed') {
      try {
        statistics = await apiRequest('/estadisticas');
        window.currentStatistics = statistics;
      } catch (error) {
        window.currentStatistics = null;
        showToast('Estadísticas no disponibles', error.message, 'error');
      }
    }
  } else if (view === 'stats') {
    try {
      statistics = await apiRequest('/estadisticas');
    } catch (error) {
      showToast('Error al cargar estadísticas', error.message);
      return;
    }
  } else if (view === 'admin') {
    try {
      const dashboard = await loadAdminDashboardData();
      replaceBackendCollections(dashboard.cases, []);
      adminHistory = dashboard.history;
      adminClues = dashboard.clues;
      adminAudit = dashboard.audit;
      estado.lastAdminDashboardSignature = adminDashboardDataSignature(
        dashboard.cases, adminClues, adminAudit
      );
      const dueCaseCount = dashboard.cases.filter(c =>
        !['CERRADO', 'LOCALIZADO', 'RECHAZADO'].includes(c.estado)
        && ((c.estado === 'EN_SEGUIMIENTO' && c.seguimientoEtapa >= 2)
          || (c.proximoSeguimiento && new Date(c.proximoSeguimiento).getTime() < Date.now()))
      ).length;
      const pendingWork = dashboard.cases.filter(c => c.estado === 'PENDIENTE').length
        + dueCaseCount
        + adminClues.filter(clue => clue.estado === 'PENDIENTE').length;
      const panelBadge = document.getElementById('adminPanelBadge');
      panelBadge.textContent = String(pendingWork);
      panelBadge.classList.toggle('hidden', pendingWork === 0);
    } catch (error) {
      console.error('No se pudo cargar el panel administrativo.', {
        endpoint: error.endpoint || `${API_BASE}/admin/casos`,
        status: error.status || 'network',
        message: error.message
      });
      const statusDescription = error.status === 404
        ? 'El servidor no encontró la ruta administrativa. Verifica que el backend actualizado esté desplegado.'
        : error.status === 403
          ? 'La cuenta autenticada no tiene permisos administrativos.'
          : error.message;
      main.innerHTML = `<section class="card admin-load-error" role="alert">
        <h1>No se pudo cargar el panel</h1>
        <p>${escapeHtml(statusDescription)}</p>
        <p class="muted">Ruta consultada: ${escapeHtml(error.endpoint || `${API_BASE}/admin/casos`)}</p>
        <button type="button" class="btn btn-primary" onclick="navigateTo('admin')">Reintentar</button>
      </section>`;
      labelButtons(main);
      return;
    }
  } else if (view === 'my-cases') {
    try {
      const [caseResult, notificationResult] = await Promise.all([
        apiRequest('/mis-casos'),
        apiRequest('/notificaciones')
      ]);
      myCases = caseResult.casos;
      myNotifications = notificationResult.notificaciones;
      estado.lastMyCasesSignature = citizenDashboardSignature(myCases, myNotifications);
    } catch (error) {
      showToast('No se pudieron cargar tus casos', error.message);
      return;
    }
  }

  switch (view) {
    case 'feed':
      main.innerHTML = renderFeedView(statistics);
      filterFeedCases();
      initMainLeafletMap();
      scheduleLocatedExpiry();
      startPublicStatsPolling();
      startLiveSyncPolling('feed');
      break;
    case 'report':
      removeReportPhoto();
      main.innerHTML = renderReportView();
      initReportLocationSelects();
      initReportLeafletMap();
      break;
    case 'lead':
      if (params.caseId) {
        clearLeadPhotoSelection();
        main.innerHTML = renderLeadView(params.caseId);
        initLeadLeafletMap();
      } else {
        main.innerHTML = renderLeadCaseSelection();
      }
      startLiveSyncPolling('lead');
      break;
    case 'stats':
      main.innerHTML = renderStatsView(statistics);
      break;
    case 'my-cases':
      main.innerHTML = renderMyCasesView(myCases, myNotifications);
      startLiveSyncPolling('my-cases');
      break;
    case 'admin':
      main.innerHTML = renderAdminView(adminHistory, adminClues, adminAudit);
      loadAdminHistoryPhotos(main);
      if (params.tab) selectAdminTab(params.tab, null, { silent: true });
      startLiveSyncPolling('admin');
      break;
    case 'otp':
      main.innerHTML = renderOTPView(params);
      break;
    default:
      main.innerHTML = renderFeedView();
      initMainLeafletMap();
  }

  labelButtons(main);

  toggleDrawer(false);
  if (store.currentUser) updateNotifBadge();
}

export function drawerNavigate(view) {
  document.querySelectorAll('.drawer-item').forEach(item => item.classList.remove('active'));
  document.querySelector(`.drawer-item[onclick="drawerNavigate('${view}')"]`)?.classList.add('active');
  navigateTo(view);
}

// ==========================================
// VISTA 4: REPORTAR DESAPARECIDO (SECCIÓN 6)
// ==========================================
// Secciones que requieren cuenta. En vez de soltar al visitante en un
// login pelado, se le explica que seccion pidio y por que hace falta
// una cuenta. Despues de entrar vuelve justo ahi.
export const ACCESS_GATED_VIEWS = {
  report: {
    titulo: 'Reportar persona desaparecida',
    motivo: 'Para registrar una desaparición hace falta una cuenta de ciudadano: el reporte queda asociado a vos y por ahí te llegan los avisos de seguimiento. Buscar casos y ver estadísticas no requiere cuenta.'
  },
  lead: {
    titulo: 'Generar pista',
    motivo: 'Para evitar pistas falsas, cada pista queda asociada a una cuenta verificada. Igual se publica de forma anónima: nadie más que la administración ve quién la envió.'
  },
  'my-cases': {
    titulo: 'Mis casos',
    motivo: 'Acá se listan los reportes que registraste vos, así que primero necesitamos saber quién sos.'
  },
  alerts: {
    titulo: 'Alertas',
    motivo: 'Las alertas son avisos sobre los casos que seguís y sobre búsquedas cerca tuyo. Como son personales, hace falta una cuenta para verlas.'
  },
  admin: {
    titulo: 'Panel de administración',
    motivo: 'El panel es de uso interno. Ingresá con una cuenta autorizada del Ente Regulador.'
  }
};

export function renderAccessView(targetView) {
  const info = ACCESS_GATED_VIEWS[targetView] || ACCESS_GATED_VIEWS.report;
  return `
    <div class="access-page">
      <section class="access-card card">
        <span class="access-icon" aria-hidden="true">♙</span>
        <p class="section-kicker">Acceso ciudadano</p>
        <h1>${escapeHtml(info.titulo)}</h1>
        <p>${escapeHtml(info.motivo)}</p>
        <button type="button" class="btn btn-primary" onclick="navigateTo('auth')">Ingresar / Crear cuenta</button>
      </section>
    </div>
  `;
}
