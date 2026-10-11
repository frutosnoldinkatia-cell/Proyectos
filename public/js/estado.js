export const estado = {
  // Autenticación (5)
  pendingRegistration: null,
  resendTimer: null,
  activeOtpEmail: '',
  activeOtpPurpose: 'registro',
  resendSeconds: 0,

  // Mapa (2)
  activeMap: null,
  activeMarkers: [],

  // Feed y sincronización pública (7)
  locatedExpiryTimer: null,
  publicStatsTimer: null,
  liveSyncTimer: null,
  liveSyncInProgress: false,
  lastPublicCaseSignature: '',
  feedCurrentPage: 1,
  feedFilteredCases: [],

  // Mis casos (1)
  lastMyCasesSignature: '',

  // Panel de administración y estadísticas (2)
  lastAdminDashboardSignature: '',
  activeStatsView: 'porMes',

  // Enrutador (3)
  currentRouteUrl: '',
  routeApplyToken: 0,
  pendingDestination: null,

  // Reportar caso (5)
  reportMarker: null,
  reportGeocodeToken: 0,
  selectedReportPhoto: null,
  reportPhotoPreviewUrl: '',
  paraguayLocationsPromise: null,

  // Aportar pista (3)
  leadMarker: null,
  selectedLeadPhotos: [],
  leadPhotoPreviewUrls: [],

  // Interfaz de usuario (2)
  toastTimeout: null,
  notificationRefreshTimer: null
};

if (typeof window !== 'undefined') {
  window.estado = estado;
}
