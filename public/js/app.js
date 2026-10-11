// Punto de entrada: inicialización, eventos de navegación, puente window y service worker.
// Los demás módulos solo declaran; todo lo que se ejecuta al cargar está acá.
import { adminAccept, adminCloseCase, adminMarkLocated, adminModerateClue, adminOpenCase, adminReject, adminReopenCase, adminReturnToReview, closeReviewChecklist, loadAdminHistory, loadAdminHistoryPhotos, runTimeFastForward, searchAdminHistory, selectAdminTab, submitCaseReview } from './admin.js';
import { apiRequest } from './api.js';
import { acceptTerms, changeRegistrationEmail, handleForgotPassword, handleLogin, handleRegister, logout, rejectTerms, resendVerificationCode, retryTermsAcceptance, togglePass, updatePasswordStrength, verifyEmailCode } from './auth.js';
import { changeFeedPage, closeCaseDetail, filterFeedCases, openCaseDetail, openCaseDetailWithKeyboard, setFeedView, shareCase, toggleFeedMap } from './feed.js';
import { iniciarEventos } from './eventos.js';
import { clearLeadPhotoSelection, filterLeadCaseCards, filterLeadCases, handleLeadPhotoSelection, handleLeadSubmit } from './lead.js';
import { centerMapOnParaguay, focusCaseOnMap, useMyLocationOnMap, viewCaseOnFeed } from './map.js';
import { respondToFollowup } from './my-cases.js';
import { clearNotifs, enableSystemNotifications, respondToCaseFollowup, toggleNotificationsModal } from './notifications.js';
import { centerReportMapOnSelection, handleReportPhotoSelection, handleReportSubmit, onReportCityChange, onReportDepartmentChange, removeReportPhoto, updateMinorAuthorization, useBrowserLocation } from './report.js';
import { applyCurrentRoute, drawerNavigate, navigateTo } from './router.js';
import { setStatsView } from './stats.js';
import { applyTheme, hideToast, labelButtons, openFilePicker, showToast, toggleDrawer, toggleSimulateTimeModal, toggleTheme } from './ui.js';

window.backendCurrentUser = null;

// popstate cubre atras/adelante; hashchange cubre que alguien edite la
// direccion a mano. applyCurrentRoute ignora la repetida, asi que no
// molesta que los dos disparen.
window.addEventListener('popstate', () => { applyCurrentRoute(); });

window.addEventListener('hashchange', () => { applyCurrentRoute(); });

// Acciones que se pueden invocar desde data-on-<evento>="..." en el HTML (ver
// eventos.js). Toda función usada en esos atributos tiene que estar acá; el test
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
