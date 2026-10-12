// Sesión: ingreso, registro, código por correo, restablecer contraseña, términos y encabezado de usuario.
import { apiRequest } from './api.js';
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { startNotificationPolling } from './notifications.js';
import { consumePendingDestination, navigateTo } from './router.js';
import { olvidarSesion, recordarUsuario } from './sesion.js';
import { getStore } from './store.js';
import { showToast } from './ui.js';

export function updateHeaderUser() {
  const store = getStore();
  const isAdministrator = ['administrador', 'ADMINISTRADOR'].includes(store.currentUser?.rol);
  const isCitizen = Boolean(store.currentUser) && !isAdministrator;
  const authAction = document.getElementById('headerAuthAction');
  const profile = document.getElementById('headerProfile');
  const displayName = store.currentUser?.nombre || store.currentUser?.nombre_completo || store.currentUser?.correo || '';
  document.querySelectorAll('[data-role-nav="admin"]').forEach(item => item.classList.toggle('hidden', !isAdministrator));
  document.querySelectorAll('[data-role-nav="citizen"]').forEach(item => item.classList.toggle('hidden', !isCitizen));
  document.querySelectorAll('[data-hide-admin-nav]').forEach(item => item.classList.toggle('hidden', isAdministrator));
  profile?.classList.toggle('hidden', !store.currentUser);
  document.getElementById('drawerIdentity')?.classList.toggle('hidden', !store.currentUser);
  document.getElementById('headerProfileName').textContent = displayName;
  const avatar = document.getElementById('headerProfileAvatar');
  avatar.textContent = displayName.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toLocaleUpperCase('es-PY');
  avatar.classList.toggle('header-profile-avatar-admin', isAdministrator);
  avatar.classList.toggle('header-profile-avatar-citizen', !isAdministrator);
  const roleBadge = document.getElementById('headerProfileRole');
  roleBadge.textContent = isAdministrator ? 'Administración' : 'Ciudadano';
  roleBadge.classList.toggle('role-badge-admin', isAdministrator);
  roleBadge.classList.toggle('role-badge-citizen', !isAdministrator);
  if (authAction) {
    authAction.textContent = store.currentUser ? 'Cerrar sesión' : '♙ Ingresar';
    authAction.onclick = store.currentUser ? logout : () => navigateTo('auth');
    authAction.classList.toggle('hidden', Boolean(store.currentUser));
  }
  if (!store.currentUser) return;
  document.getElementById('drawerUserName').innerText = displayName;
  const drawerRole = document.getElementById('drawerUserRole');
  drawerRole.innerText = isAdministrator ? 'Administración' : 'Ciudadano';
  drawerRole.classList.toggle('role-badge-admin', isAdministrator);
  drawerRole.classList.toggle('role-badge-citizen', !isAdministrator);
  document.getElementById('simulateFollowupButton').classList.toggle('hidden', !isAdministrator);
  startNotificationPolling();
}

// ==========================================
// VISTA 1: BASES Y CONDICIONES (SECCIÓN 3)
// ==========================================
export function renderLegalTerms() {
  return `
    <div class="legal-view">
      <div>
        <div>
          <p>República del Paraguay</p>
          <h1>Plataforma Rastreo PY</h1>
          <p>Bases y Condiciones Obligatorias de Uso</p>
        </div>

        <div>
          <p><strong>1. Alcance del Servicio:</strong> La plataforma Rastreo PY es un canal de difusión colaborativa y centralización de reportes. No constituye un organismo de seguridad, investigación ni administración de justicia, ni reemplaza las actuaciones de la Policía Nacional de Paraguay o del Ministerio Público.</p>
          <p><strong>2. Obligatoriedad de Denuncia Oficial:</strong> El uso de esta plataforma no sustituye la radicación formal de la denuncia. Se exige al usuario realizar la denuncia correspondiente ante las instituciones públicas oficiales de manera prioritaria y previa a la carga de datos en la plataforma.</p>
          <p><strong>3. Deslinde de Responsabilidad:</strong> La plataforma, sus desarrolladores y administradores quedan totalmente eximidos de cualquier responsabilidad legal, civil, penal o administrativa respecto a la conducción, seguimiento o resultados de las investigaciones, así como de la veracidad, exactitud o autenticidad de la información e imágenes ingresadas por terceros.</p>
          <p><strong>4. Marco de referencia:</strong> Este prototipo académico toma como referencia la Ley N.º 7605/2025 (RENAPED/MAFE) y la Ley N.º 7593/2025, Art. 16, num. 7. Su aplicación y alcance deben ser validados por UNIDA y las autoridades competentes antes de un despliegue operativo. Se prohíbe el ingreso de datos crediticios, bancarios o patrimoniales (Ley N.º 6534/2020), así como datos sensibles ajenos a la finalidad del reporte.</p>
          <p><strong>5. Derecho de Supresión (Borrado de Datos):</strong> Una vez que la persona reportada sea localizada o el caso sea cerrado por la autoridad competente, la ficha de búsqueda permanecerá visible por un máximo de 24 horas con el estado 'Localizado', a fin de informar a la ciudadanía. Transcurrido ese plazo, la plataforma procederá al retiro y desindexación pública de la ficha. Los datos solo se conservarán, de forma restringida, para el historial interno de la autoridad administradora y como cifras estadísticas agregadas.</p>
          <p><strong>6. Uso Aceptable:</strong> Queda estrictamente prohibido el ingreso de reportes falsos, difamatorios o el uso de la plataforma para cometer extorsiones, estafas o cobro indebido de recompensas.</p>
        </div>
      </div>

      <div>
        <label>
          <input type="checkbox" id="checkTerms">
          <span>He leído y acepto expresamente las bases y condiciones.</span>
        </label>
        <div id="termsSaveError" class="hidden" role="alert">
          <span id="termsSaveErrorText"></span>
          <button type="button" data-on-click="retryTermsAcceptance()" class="btn btn-outline btn-sm">Reintentar</button>
        </div>
        <div class="grid-2">
          <button data-on-click="rejectTerms()" class="btn btn-outline">No aceptar</button>
          <button id="acceptTermsButton" data-on-click="acceptTerms()" class="btn btn-red">Aceptar y Continuar</button>
        </div>
      </div>
    </div>
  `;
}

export function showTermsSaveError(error) {
  const errorBox = document.getElementById('termsSaveError');
  const errorText = document.getElementById('termsSaveErrorText');
  console.error('Error al guardar aceptación de términos:', error?.status, error?.message);
  errorText.textContent = error?.message || 'No se pudo guardar la aceptación. Intente nuevamente.';
  errorBox.classList.remove('hidden');
}

export async function acceptTerms() {
  if (!document.getElementById('checkTerms').checked) {
    showToast('Importante', 'Debe declarar la aceptación de los términos para utilizar el portal.', 'error');
    return;
  }
  const button = document.getElementById('acceptTermsButton');
  button.disabled = true;
  try {
    await apiRequest('/auth/terminos', { method: 'POST' });
    window.backendCurrentUser = { ...window.backendCurrentUser, acepto_terminos: true };
    recordarUsuario(window.backendCurrentUser);
    navigateTo('home');
  } catch (error) {
    showTermsSaveError(error);
  } finally {
    const retryButton = document.getElementById('acceptTermsButton');
    if (retryButton) retryButton.disabled = false;
  }
}

export async function retryTermsAcceptance() {
  const errorBox = document.getElementById('termsSaveError');
  errorBox.classList.add('hidden');
  await acceptTerms();
}

export function rejectTerms() { showToast('Acceso denegado', 'No es posible acceder sin aceptar las bases y condiciones.', 'error'); }

// ==========================================
// VISTA 2: ACCESO E INICIO DE SESIÓN (SECCIÓN 4)
// ==========================================
export function renderAuthScreen(mode = 'login', identifier = '') {
  const isLogin = mode === 'login';
  const notice = window.authNotice || '';
  window.authNotice = '';
  return `
    <div class="auth-view">
      <div>
        <h1>Portal de acceso · Rastreo PY</h1>
        <p>Plataforma Oficial Colaborativa</p>
      </div>

      <div class="auth-tabs">
        <button class="${isLogin ? 'active' : ''}" data-on-click="navigateTo('auth', {authMode: 'login'})">Iniciar sesión</button>
        <button class="${isLogin ? '' : 'active'}" data-on-click="navigateTo('auth', {authMode: 'register'})">Crear cuenta</button>
      </div>

      <div class="card auth-panel">
        ${isLogin ? renderLoginForm(identifier) : renderRegisterForm()}
        <div id="authFeedback" class="${notice ? '' : 'hidden'}" role="status">${escapeHtml(notice)}</div>
      </div>
    </div>
  `;
}

export function renderLoginForm(identifier = '') {
  return `
    <form data-on-submit="handleLogin(event)">
      <div class="form-group">
        <label>Correo Gmail</label>
        <input type="email" id="loginEmail" required value="${escapeHtml(identifier.includes('@') ? identifier : '')}" placeholder="usuario@gmail.com" class="form-control">
      </div>
      <div class="form-group">
        <label>Contraseña</label>
        <div>
          <input type="password" id="loginPassword" required placeholder="Contraseña" class="form-control">
          <button type="button" data-on-click="togglePass('loginPassword')">Mostrar</button>
        </div>
      </div>
      <div>
        <button type="button" data-on-click="handleForgotPassword()">¿Olvidaste tu contraseña?</button>
      </div>
      <button type="submit" class="btn btn-primary">Ingresar al sistema</button>
    </form>
  `;
}

export function renderRegisterForm() {
  return `
    <form data-on-submit="handleRegister(event)">
      <div class="form-group">
        <label>Nombre Completo</label>
        <input type="text" id="regName" required minlength="3" value="${escapeHtml(estado.pendingRegistration?.nombre_completo || '')}" placeholder="Ej: Juan Pérez" class="form-control">
      </div>
      <div class="form-group">
        <label>Correo Gmail</label>
        <input type="email" id="regEmail" required value="${escapeHtml(estado.pendingRegistration?.correo || '')}" placeholder="usuario@gmail.com" class="form-control">
      </div>
      <div class="form-group">
        <label>Contraseña (mínimo 8 caracteres)</label>
        <div>
          <input type="password" id="regPass" required minlength="8" data-on-input="updatePasswordStrength()" placeholder="Mínimo 8 caracteres" class="form-control">
          <button type="button" data-on-click="togglePass('regPass')">Mostrar</button>
        </div>
        <div id="passwordStrength" aria-live="polite">Fortaleza de la contraseña: sin evaluar</div>
      </div>
      <div class="form-group">
        <label>Confirmar contraseña</label>
        <div>
          <input type="password" id="regPassConfirm" required minlength="8" placeholder="Repita la contraseña" class="form-control">
          <button type="button" data-on-click="togglePass('regPassConfirm')">Mostrar</button>
        </div>
      </div>
      <label>
        <input type="checkbox" id="regTerms" required>
        <span>He leído y acepto las bases y condiciones</span>
      </label>
      <button type="submit" class="btn btn-red">Enviar código al Gmail</button>
    </form>
  `;
}

export function togglePass(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

export function showAuthFeedback(message) {
  const feedback = document.getElementById('authFeedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove('hidden');
}

export function handleAuthError(error) {
  console.error('Error de autenticación:', error?.status, error?.message);
  showAuthFeedback(error.message || 'No se pudo completar la solicitud.');
}

export function updatePasswordStrength() {
  const password = document.getElementById('regPass').value;
  const score = [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z0-9]/.test(password)
  ].filter(Boolean).length;
  const labels = ['sin evaluar', 'débil', 'media', 'buena', 'fuerte'];
  const indicator = document.getElementById('passwordStrength');
  indicator.textContent = `Fortaleza de la contraseña: ${labels[score]}`;
  indicator.classList.toggle('password-weak', score < 2);
  indicator.classList.toggle('password-medium', score >= 2 && score < 4);
  indicator.classList.toggle('password-strong', score >= 4);
}

export async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  try {
    const result = await apiRequest('/auth/login', { method: 'POST', body: { correo: email, contrasena: password } });
    sessionStorage.setItem('rastreo_token', result.token);
    window.backendCurrentUser = result.usuario;
    recordarUsuario(result.usuario);
    const destino = consumePendingDestination();
    navigateTo(destino ? destino.view : 'home', destino ? destino.params : {}, { replace: true });
  } catch (error) {
    handleAuthError(error);
  }
}

export async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPass').value;
  const confirmation = document.getElementById('regPassConfirm').value;
  if (name.length < 3) {
    showAuthFeedback('El nombre completo debe tener al menos 3 caracteres.');
    return;
  }
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
    showAuthFeedback('Ingrese una cuenta de Gmail válida (terminada en @gmail.com).');
    return;
  }
  if (password.length < 8) {
    showAuthFeedback('La contraseña debe tener al menos 8 caracteres.');
    return;
  }
  if (password !== confirmation) {
    showAuthFeedback('Las contraseñas no coinciden.');
    return;
  }
  if (!document.getElementById('regTerms').checked) {
    showAuthFeedback('Debe aceptar las bases y condiciones para registrarse.');
    return;
  }

  try {
    estado.pendingRegistration = {
      nombre_completo: name,
      correo: email,
      contrasena: password,
      acepto_terminos: true
    };
    await apiRequest('/auth/registro', { method: 'POST', body: estado.pendingRegistration });
    estado.activeOtpEmail = email;
    estado.activeOtpPurpose = 'registro';
    navigateTo('otp', { contact: email, purpose: 'registro' });
    startResendCountdown(60);
  } catch (error) {
    handleAuthError(error);
  }
}

export async function handleForgotPassword() {
  const value = prompt('Ingresa tu Gmail para restablecer la contraseña:');
  if (!value) return;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
    showAuthFeedback('Ingrese una cuenta de Gmail válida (terminada en @gmail.com).');
    return;
  }
  try {
    const res = await apiRequest('/auth/restablecer/solicitar', { method: 'POST', body: { correo: email } });
    estado.activeOtpEmail = email;
    estado.activeOtpPurpose = 'restablecer';
    navigateTo('otp', { contact: email, purpose: 'restablecer', notice: res?.mensaje });
    startResendCountdown(60);
  } catch (error) {
    handleAuthError(error);
  }
}

export function startResendCountdown(seconds) {
  if (estado.resendTimer) clearInterval(estado.resendTimer);
  estado.resendSeconds = seconds;
  updateResendButton();
  estado.resendTimer = setInterval(() => {
    estado.resendSeconds -= 1;
    updateResendButton();
    if (estado.resendSeconds <= 0) {
      clearInterval(estado.resendTimer);
      estado.resendTimer = null;
    }
  }, 1000);
}

export function updateResendButton() {
  const button = document.getElementById('resendCodeButton');
  if (!button) return;
  button.disabled = estado.resendSeconds > 0;
  button.textContent = estado.resendSeconds > 0 ? `Reenviar código (${estado.resendSeconds}s)` : 'Reenviar código';
}

export function renderOTPView(params) {
  estado.activeOtpEmail = params.contact || estado.activeOtpEmail;
  estado.activeOtpPurpose = params.purpose || estado.activeOtpPurpose;
  const isReset = estado.activeOtpPurpose === 'restablecer';
  const introMessage = isReset
    ? (params.notice ? escapeHtml(params.notice) : 'Si el Gmail está registrado, recibirá un código de 6 dígitos para restablecer la contraseña.')
    : `Hemos enviado un código de 6 dígitos a <strong>${escapeHtml(estado.activeOtpEmail)}</strong>`;
  return `
    <div>
      <div class="card">
        <h3>${isReset ? 'Restablecer contraseña' : 'Verificar correo'}</h3>
        <p>${introMessage}</p>
        <input type="text" id="otpInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" aria-label="Código de 6 dígitos" class="form-control">
        ${isReset ? `<div class="form-group"><label>Nueva contraseña</label><input id="resetPassword" type="password" minlength="8" class="form-control" placeholder="Mínimo 8 caracteres"></div><div class="form-group"><label>Confirmar contraseña</label><input id="resetPasswordConfirm" type="password" minlength="8" class="form-control" placeholder="Repita la contraseña"></div>` : ''}
        <div id="otpFeedback" class="hidden" role="status"></div>
        <button data-on-click="verifyEmailCode()" class="btn btn-primary">${isReset ? 'Cambiar contraseña' : 'Verificar y crear cuenta'}</button>
        <button id="resendCodeButton" data-on-click="resendVerificationCode()" class="btn btn-outline" ${estado.resendSeconds > 0 ? 'disabled' : ''}>${estado.resendSeconds > 0 ? `Reenviar código (${estado.resendSeconds}s)` : 'Reenviar código'}</button>
        ${!isReset ? `<button data-on-click="changeRegistrationEmail()" class="btn btn-outline">Cambiar correo</button>` : ''}
        <button data-on-click="navigateTo('auth', {authMode:'login'})" class="btn btn-outline">Volver a iniciar sesión</button>
      </div>
    </div>
  `;
}

export function showOtpFeedback(message) {
  const feedback = document.getElementById('otpFeedback');
  feedback.textContent = message;
  feedback.classList.remove('hidden');
}

export async function verifyEmailCode() {
  const code = document.getElementById('otpInput').value.trim();
  if (!/^\d{6}$/.test(code)) {
    showOtpFeedback('Ingrese un código válido de 6 dígitos.');
    return;
  }
  if (estado.activeOtpPurpose === 'restablecer') {
    const password = document.getElementById('resetPassword').value;
    const confirmation = document.getElementById('resetPasswordConfirm').value;
    if (password.length < 8) return showOtpFeedback('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirmation) return showOtpFeedback('Las contraseñas no coinciden.');
    try {
      await apiRequest('/auth/restablecer/confirmar', {
        method: 'POST',
        body: { correo: estado.activeOtpEmail, codigo: code, nueva_contrasena: password }
      });
      if (estado.resendTimer) clearInterval(estado.resendTimer);
      estado.pendingRegistration = null;
      window.authNotice = 'La contraseña se actualizó correctamente. Inicie sesión.';
      navigateTo('auth', { authMode: 'login', identifier: estado.activeOtpEmail });
    } catch (error) {
      showOtpFeedback(error.message);
    }
    return;
  }
  try {
    await apiRequest('/auth/verificar', {
      method: 'POST',
      body: { correo: estado.activeOtpEmail, codigo: code }
    });
    if (estado.resendTimer) clearInterval(estado.resendTimer);
    estado.pendingRegistration = null;
    window.authNotice = 'Cuenta creada correctamente. Ya puede iniciar sesión.';
    navigateTo('auth', { authMode: 'login', identifier: estado.activeOtpEmail });
  } catch (error) {
    showOtpFeedback(error.message);
  }
}

export async function resendVerificationCode() {
  if (estado.resendSeconds > 0) return;
  try {
    if (estado.activeOtpPurpose === 'restablecer') {
      const res = await apiRequest('/auth/restablecer/solicitar', {
        method: 'POST',
        body: { correo: estado.activeOtpEmail }
      });
      startResendCountdown(60);
      showOtpFeedback(res?.mensaje || 'Se solicitó un nuevo código para restablecer la contraseña.');
    } else {
      await apiRequest('/auth/registro/reenviar', {
        method: 'POST',
        body: { correo: estado.activeOtpEmail }
      });
      startResendCountdown(60);
      showOtpFeedback('Enviamos un nuevo código a tu Gmail.');
    }
  } catch (error) {
    showOtpFeedback(error.message);
    if (error.status === 429) startResendCountdown(60);
  }
}

export function changeRegistrationEmail() {
  if (estado.resendTimer) clearInterval(estado.resendTimer);
  estado.pendingRegistration = null;
  navigateTo('auth', { authMode: 'register' });
}

export async function logout() {
  if (estado.notificationRefreshTimer) {
    clearInterval(estado.notificationRefreshTimer);
    estado.notificationRefreshTimer = null;
  }
  olvidarSesion();
  window.backendCurrentUser = null;
  window.backendCaseData = null;
  estado.pendingDestination = null;
  navigateTo('auth', { authMode: 'login' });
}
