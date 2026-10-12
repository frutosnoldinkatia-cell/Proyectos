// Instalación como app (PWA) y aviso de "sin conexión".
// Android/Chrome/Edge disparan beforeinstallprompt: se guarda el evento y el botón
// "Instalar app" del menú lo usa. iOS no tiene ese evento: el mismo botón abre una
// guía corta (Compartir > Añadir a pantalla de inicio).
import { showToast } from './ui.js';

let eventoInstalacion = null;

function esIos() {
  // iPadOS se presenta como "MacIntel", pero con pantalla táctil.
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function yaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function mostrarBotonInstalar(visible) {
  document.getElementById('installAppButton')?.classList.toggle('hidden', !visible);
}

export async function installApp() {
  if (eventoInstalacion) {
    const evento = eventoInstalacion;
    // El evento sirve una sola vez: después de prompt() hay que esperar otro.
    eventoInstalacion = null;
    mostrarBotonInstalar(false);
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    if (outcome !== 'accepted') showToast('Instalación cancelada', 'Podés instalarla más tarde desde el menú.');
    return;
  }
  if (esIos()) toggleInstallGuide();
}

export function toggleInstallGuide() {
  document.getElementById('installGuideModal')?.classList.toggle('hidden');
}

function actualizarAvisoConexion() {
  // Solo se muestra la franja: lo que ya está en pantalla (por ejemplo el feed)
  // no se toca, y la sincronización sigue intentando por su cuenta.
  document.getElementById('offlineBanner')?.classList.toggle('hidden', navigator.onLine);
}

export function iniciarPwa() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    eventoInstalacion = event;
    mostrarBotonInstalar(true);
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalacion = null;
    mostrarBotonInstalar(false);
    showToast('App instalada', 'Rastreo PY ya está en tu pantalla de inicio.', 'success');
  });
  if (esIos() && !yaInstalada()) mostrarBotonInstalar(true);

  window.addEventListener('offline', actualizarAvisoConexion);
  window.addEventListener('online', () => {
    actualizarAvisoConexion();
    showToast('Conexión restablecida', 'Ya podés seguir usando Rastreo PY.', 'success');
  });
  actualizarAvisoConexion();
}
