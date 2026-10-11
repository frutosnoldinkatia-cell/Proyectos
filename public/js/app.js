// Punto de entrada: inicialización, eventos de navegación, puente window y service worker.
// Los demás módulos solo declaran; todo lo que se ejecuta al cargar está acá.
import { adminAccept, adminCloseCase, adminMarkLocated, adminModerateClue, adminOpenCase, adminReject, adminReopenCase, adminReturnToReview, closeReviewChecklist, loadAdminHistory, loadAdminHistoryPhotos, runTimeFastForward, searchAdminHistory, selectAdminTab, submitCaseReview } from './admin.js';
import { apiRequest } from './api.js';
import { acceptTerms, changeRegistrationEmail, handleForgotPassword, handleLogin, handleRegister, logout, rejectTerms, resendVerificationCode, retryTermsAcceptance, togglePass, updatePasswordStrength, verifyEmailCode } from './auth.js';
import { API_BASE, DB_KEY, escapeHtml } from './config.js';
import { estado } from './estado.js';
import { changeFeedPage, closeCaseDetail, filterFeedCases, openCaseDetail, setFeedView, shareCase, toggleFeedMap } from './feed.js';
import { clearLeadPhotoSelection, filterLeadCaseCards, filterLeadCases, handleLeadPhotoSelection, handleLeadSubmit } from './lead.js';
import { centerMapOnParaguay, focusCaseOnMap, useMyLocationOnMap, viewCaseOnFeed } from './map.js';
import { respondToFollowup } from './my-cases.js';
import { clearNotifs, enableSystemNotifications, respondToCaseFollowup, toggleNotificationsModal } from './notifications.js';
import { centerReportMapOnSelection, handleReportPhotoSelection, handleReportSubmit, onReportCityChange, onReportDepartmentChange, removeReportPhoto, updateMinorAuthorization, useBrowserLocation } from './report.js';
import { applyCurrentRoute, drawerNavigate, navigateTo } from './router.js';
import { setStatsView } from './stats.js';
import { getStore, saveStore } from './store.js';
import { NOTICE_TONES, applyTheme, formatRelativeTime, hideToast, labelButtons, showToast, toggleDrawer, toggleSimulateTimeModal, toggleTheme } from './ui.js';

// Puente window (sección 1): utilidades usadas desde handlers on*="...".
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

window.backendCurrentUser = null;

// popstate cubre atras/adelante; hashchange cubre que alguien edite la
// direccion a mano. applyCurrentRoute ignora la repetida, asi que no
// molesta que los dos disparen.
window.addEventListener('popstate', () => { applyCurrentRoute(); });

window.addEventListener('hashchange', () => { applyCurrentRoute(); });

// Exponer funciones restantes a window para que los controladores inline HTML sigan funcionando
Object.assign(window, {
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
});

async function initApp() {
  try {
    applyTheme(localStorage.getItem('rastreo_theme') || 'light');
    labelButtons();
    const token = sessionStorage.getItem('rastreo_token');
    if (token) {
      try {
        const result = await apiRequest('/auth/me');
        window.backendCurrentUser = result.usuario;
      } catch (error) {
        sessionStorage.removeItem('rastreo_token');
        window.backendCurrentUser = null;
      }
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
