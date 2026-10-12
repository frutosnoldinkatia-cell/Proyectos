// Punto de entrada: inicialización, eventos de navegación, puente window y service worker.
// Los demás módulos solo declaran; todo lo que se ejecuta al cargar está acá.
import { adminAccept, adminCloseCase, adminMarkLocated, adminModerateClue, adminOpenCase, adminReject, adminReopenCase, adminReturnToReview, closeReviewChecklist, loadAdminHistory, loadAdminHistoryPhotos, runTimeFastForward, searchAdminHistory, selectAdminTab, submitCaseReview } from './admin.js';
import { apiRequest, avisarServidor } from './api.js';
import { acceptTerms, changeRegistrationEmail, handleForgotPassword, handleLogin, handleRegister, logout, rejectTerms, resendVerificationCode, retryTermsAcceptance, togglePass, updatePasswordStrength, verifyEmailCode } from './auth.js';
import { changeFeedPage, closeCaseDetail, filterFeedCases, openCaseDetail, openCaseDetailWithKeyboard, setFeedView, shareCase, toggleFeedMap } from './feed.js';
import { iniciarEventos } from './eventos.js';
import { clearLeadPhotoSelection, filterLeadCaseCards, filterLeadCases, handleLeadPhotoSelection, handleLeadSubmit } from './lead.js';
import { centerMapOnParaguay, focusCaseOnMap, useMyLocationOnMap, viewCaseOnFeed } from './map.js';
import { respondToFollowup } from './my-cases.js';
import { iniciarConexion } from './conexion.js';
import { restaurarSesion } from './sesion.js';
import { clearNotifs, enableSystemNotifications, respondToCaseFollowup, toggleNotificationsModal } from './notifications.js';
import { centerReportMapOnSelection, handleReportPhotoSelection, handleReportSubmit, onReportCityChange, onReportDepartmentChange, removeReportPhoto, updateMinorAuthorization, useBrowserLocation } from './report.js';
import { applyCurrentRoute, drawerNavigate, navigateTo } from './router.js';
import { setStatsView } from './stats.js';
import { syncOnVisible } from './sync.js';
import { applyTheme, hideToast, labelButtons, openFilePicker, showToast, toggleDrawer, toggleSimulateTimeModal, toggleTheme } from './ui.js';

window.backendCurrentUser = null;

// popstate cubre atras/adelante; hashchange cubre que alguien edite la
// direccion a mano. applyCurrentRoute ignora la repetida, asi que no
// molesta que los dos disparen.
window.addEventListener('popstate', () => { applyCurrentRoute(); });

window.addEventListener('hashchange', () => { applyCurrentRoute(); });

// Las actualizaciones periódicas se pausan con la pestaña oculta (sync.js); al
// volver se pide una enseguida.
document.addEventListener('visibilitychange', syncOnVisible);

// Acciones que se pueden invocar desde data-on-<evento>="..." en el HTML (ver
// eventos.js). Toda función usada en esos atributos tiene que estar acá, o sumarse
// con Object.assign(acciones, {...}) en la entrada propia de cada página
// (js/web.js para la web, app/app-movil.js para la app); el test
// backend/test/frontend-handlers.test.js lo verifica.
export const acciones = {
  hideToast,
  toggleTheme,
  toggleDrawer,
  toggleSimulateTimeModal,
  openFilePicker,
  openCaseDetailWithKeyboard,
  navigateTo,
  drawerNavigate,
  toggleNotificationsModal,
  enableSystemNotifications,
  clearNotifs,
  runTimeFastForward,
  closeCaseDetail,
  openCaseDetail,
  submitCaseReview,
  closeReviewChecklist,
  logout,
  retryTermsAcceptance,
  rejectTerms,
  acceptTerms,
  handleLogin,
  handleRegister,
  togglePass,
  handleForgotPassword,
  updatePasswordStrength,
  verifyEmailCode,
  resendVerificationCode,
  changeRegistrationEmail,
  changeFeedPage,
  filterFeedCases,
  setFeedView,
  toggleFeedMap,
  useMyLocationOnMap,
  focusCaseOnMap,
  viewCaseOnFeed,
  centerMapOnParaguay,
  useBrowserLocation,
  handleReportPhotoSelection,
  removeReportPhoto,
  onReportDepartmentChange,
  onReportCityChange,
  handleReportSubmit,
  handleLeadPhotoSelection,
  clearLeadPhotoSelection,
  filterLeadCases,
  handleLeadSubmit,
  setStatsView,
  respondToFollowup,
  respondToCaseFollowup,
  updateMinorAuthorization,
  centerReportMapOnSelection,
  filterLeadCaseCards,
  selectAdminTab,
  adminAccept,
  adminReject,
  adminMarkLocated,
  adminCloseCase,
  adminReturnToReview,
  adminReopenCase,
  adminModerateClue,
  adminOpenCase,
  loadAdminHistory,
  searchAdminHistory,
  loadAdminHistoryPhotos,
  shareCase
};

iniciarEventos(acciones);
iniciarConexion();

// Con un proxy o túnel caído el pedido puede quedar colgado: se corta a los 8 s.
const pedirUsuario = () => apiRequest('/auth/me', { signal: AbortSignal.timeout?.(8000) })
  .then(result => result.usuario);

// Si la sesión se conservó sin poder comprobarla, se reintenta cada 10 s; cuando el
// servidor responde se vuelve a dibujar la vista con datos reales (o se va al login
// si rechazó el token). Se abandona si mientras tanto alguien ingresó o salió.
function reintentarSesion(token) {
  setTimeout(async () => {
    if (sessionStorage.getItem('rastreo_token') !== token) return;
    const { usuario, sinConexion } = await restaurarSesion({ pedirUsuario });
    if (sessionStorage.getItem('rastreo_token') !== token && usuario) return;
    if (sinConexion) return reintentarSesion(token);
    window.backendCurrentUser = usuario;
    const vista = window.rastreoCurrentView;
    if (!usuario) navigateTo('auth', { authMode: 'login' }, { replace: true });
    else if (!vista || vista === 'auth') navigateTo('home', {}, { replace: true });
    else navigateTo(vista, window.rastreoCurrentParams || {}, { replace: true });
  }, 10000);
}

async function initApp() {
  try {
    applyTheme(localStorage.getItem('rastreo_theme') || 'light');
    labelButtons();
    // Solo un 401/403 borra el token; sin red o con 5xx se conserva (ver sesion.js)
    // y se muestra la franja de "Sin conexión" (conexion.js) hasta que el servidor responda.
    const { usuario, sinConexion } = await restaurarSesion({ pedirUsuario });
    window.backendCurrentUser = usuario;
    if (sinConexion) {
      avisarServidor(false);
      reintentarSesion(sessionStorage.getItem('rastreo_token'));
    }
    await applyCurrentRoute();
  } catch (error) {
    console.error('No se pudo inicializar la sesión.', error);
    showToast('Error de sesión', 'No se pudo comprobar la sesión. Recarga la página e inténtalo nuevamente.', 'error');
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(error => console.error('No se pudo registrar el service worker de Rastreo PY.', error));
  });
}
