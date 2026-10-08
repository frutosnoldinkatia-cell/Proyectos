import { auth, db, firebaseConfig } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  RecaptchaVerifier,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let recaptchaVerifier = null;
let phoneConfirmation = null;
let phoneRegistrationName = '';
let acceptedAtForPhone = '';
let firstAuthState = true;

function ensureConfigured() {
  if (Object.values(firebaseConfig).some(value => !value)) {
    throw new Error('FIREBASE_CONFIG_INCOMPLETE');
  }
}

function makeProfile(uid, data) {
  if (!['ciudadano', 'administrador'].includes(data.rol)) {
    throw new Error('USER_PROFILE_INVALID');
  }
  return {
    id: uid,
    nombre: data.nombre || 'Ciudadano',
    correo: data.correo || '',
    telefono: data.telefono || '',
    identificador: data.telefono || data.correo || '',
    rol: data.rol,
    proveedor: data.proveedor || '',
    verificado: data.verificado === true,
    creado_en: data.creado_en || null
  };
}

function providerForUser(user) {
  if (user.phoneNumber) return 'telefono';
  if (user.providerData.some(item => item.providerId === 'google.com')) return 'google';
  return 'correo';
}

async function saveOrLoadProfile(user, provider, name, acceptedAt) {
  const profileRef = doc(db, 'usuarios', user.uid);
  const profileSnapshot = await getDoc(profileRef);

  if (!profileSnapshot.exists()) {
    const profile = {
      nombre: name || user.displayName || user.phoneNumber || user.email || 'Ciudadano',
      correo: user.email || '',
      telefono: user.phoneNumber || '',
      rol: 'ciudadano',
      proveedor: provider,
      verificado: user.emailVerified || provider !== 'correo',
      creado_en: serverTimestamp(),
      terms_accepted_at: acceptedAt
    };
    await setDoc(profileRef, profile);
    return makeProfile(user.uid, { ...profile, creado_en: new Date().toISOString() });
  }

  const data = profileSnapshot.data();
  const updates = {};
  if (acceptedAt) updates.terms_accepted_at = acceptedAt;
  if (user.emailVerified && data.verificado !== true) updates.verificado = true;
  if (Object.keys(updates).length) await setDoc(profileRef, updates, { merge: true });
  return makeProfile(user.uid, { ...data, ...updates });
}

async function completeLogin(user, provider, name, acceptedAt) {
  ensureConfigured();
  const profile = await saveOrLoadProfile(user, provider, name, acceptedAt);
  window.firebaseCurrentProfile = profile;
  return profile;
}

function resetRecaptcha() {
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }
}

async function startPhoneLogin(phone, name, acceptedAt) {
  ensureConfigured();
  const normalizedPhone = String(phone).replace(/[\s().-]/g, '');
  let e164Phone = normalizedPhone;
  if (/^09\d{8}$/.test(normalizedPhone)) e164Phone = `+595${normalizedPhone.slice(1)}`;
  else if (/^5959\d{8}$/.test(normalizedPhone)) e164Phone = `+${normalizedPhone}`;
  if (!/^\+5959\d{8}$/.test(e164Phone)) {
    throw new Error('INVALID_PARAGUAY_PHONE');
  }

  resetRecaptcha();
  phoneConfirmation = null;
  recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
  phoneConfirmation = await signInWithPhoneNumber(auth, e164Phone, recaptchaVerifier);
  phoneRegistrationName = name || '';
  acceptedAtForPhone = acceptedAt || '';
}

async function confirmPhoneCode(code) {
  if (!phoneConfirmation) throw new Error('PHONE_CODE_SESSION_MISSING');
  const credential = await phoneConfirmation.confirm(code);
  phoneConfirmation = null;
  resetRecaptcha();
  return completeLogin(credential.user, 'telefono', phoneRegistrationName, acceptedAtForPhone);
}

async function registerEmail(email, password, name, acceptedAt) {
  ensureConfigured();
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    await saveOrLoadProfile(credential.user, 'correo', name, acceptedAt);
    await sendEmailVerification(credential.user);
  } finally {
    await signOut(auth);
    window.firebaseCurrentProfile = null;
  }
}

async function loginEmail(email, password, acceptedAt) {
  ensureConfigured();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  if (!credential.user.emailVerified) {
    try {
      await sendEmailVerification(credential.user);
    } finally {
      await signOut(auth);
    }
    throw new Error('EMAIL_NOT_VERIFIED');
  }
  return completeLogin(credential.user, 'correo', '', acceptedAt);
}

async function loginGoogle(acceptedAt) {
  ensureConfigured();
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  return completeLogin(credential.user, 'google', credential.user.displayName, acceptedAt);
}

async function resetEmailPassword(email) {
  ensureConfigured();
  await sendPasswordResetEmail(auth, email.trim());
}

async function logout() {
  await signOut(auth);
  window.firebaseCurrentProfile = null;
}

async function recordTermsAcceptance(acceptedAt) {
  if (!auth.currentUser) return;
  const user = auth.currentUser;
  window.firebaseCurrentProfile = await saveOrLoadProfile(user, providerForUser(user), user.displayName, acceptedAt);
}

function getAuthErrorMessage(error) {
  const code = error && error.message === 'FIREBASE_CONFIG_INCOMPLETE' ? error.message : error?.code || error?.message;
  const messages = {
    'FIREBASE_CONFIG_INCOMPLETE': 'Completa firebaseConfig en firebase-config.js antes de usar el acceso.',
    'INVALID_PARAGUAY_PHONE': 'Ingresa un celular paraguayo válido, por ejemplo 0981 123 456.',
    'USER_PROFILE_INVALID': 'La cuenta no tiene un rol válido en Firestore. Contacta al administrador.',
    'EMAIL_NOT_VERIFIED': 'Tu correo aún no está verificado. Te enviamos un nuevo enlace de verificación.',
    'auth/email-already-in-use': 'Ese correo ya está registrado. Inicia sesión o restablece tu contraseña.',
    'auth/account-exists-with-different-credential': 'Ese correo ya está registrado con otro método de acceso. Inicia sesión con ese método.',
    'auth/invalid-email': 'El formato del correo no es válido.',
    'auth/invalid-phone-number': 'Ingresa un celular paraguayo válido, por ejemplo 0981 123 456.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/wrong-password': 'La contraseña es incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/invalid-verification-code': 'El código SMS es incorrecto. Revisa los 6 dígitos e inténtalo de nuevo.',
    'auth/code-expired': 'El código SMS venció. Solicita un nuevo código.',
    'auth/session-expired': 'El código SMS venció. Solicita un nuevo código.',
    'auth/too-many-requests': 'Se realizaron demasiados intentos. Espera un momento antes de volver a intentar.',
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de completar el inicio de sesión.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo de nuevo.',
    'auth/captcha-check-failed': 'No se pudo validar reCAPTCHA. Recarga la página e inténtalo nuevamente.',
    'PHONE_CODE_SESSION_MISSING': 'Solicita primero el código SMS antes de validarlo.'
  };
  return messages[code] || 'No se pudo completar la operación. Verifica tu conexión y vuelve a intentarlo.';
}

window.firebaseCurrentProfile = null;
window.firebaseAuthApi = {
  startPhoneLogin,
  confirmPhoneCode,
  registerEmail,
  loginEmail,
  loginGoogle,
  resetEmailPassword,
  logout,
  recordTermsAcceptance,
  getAuthErrorMessage
};

window.firebaseAuthReady = new Promise(resolve => {
  onAuthStateChanged(auth, async user => {
    if (!firstAuthState) return;
    firstAuthState = false;
    try {
      if (user && (user.emailVerified || user.phoneNumber || user.providerData.some(item => item.providerId === 'google.com'))) {
        const profile = await saveOrLoadProfile(user, providerForUser(user), user.displayName, '');
        window.firebaseCurrentProfile = profile;
      } else {
        window.firebaseCurrentProfile = null;
        if (user) await signOut(auth);
      }
    } catch (error) {
      console.error('No se pudo cargar el perfil de Firebase.', error);
      window.firebaseCurrentProfile = null;
      if (user) await signOut(auth);
    } finally {
      resolve();
    }
  }, error => {
    console.error('No se pudo comprobar la sesión de Firebase.', error);
    resolve();
  });
});
