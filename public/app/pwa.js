// Instalación de la app (/app/): solo la app es instalable, la web en / no.
// - Android/Chrome/Edge disparan beforeinstallprompt: se guarda el evento y lo usan
//   el botón de la bienvenida y el "Instalar app" del menú.
// - iOS no tiene ese evento: se muestra la guía de 3 pasos (Compartir > Añadir a
//   pantalla de inicio).
// - Bienvenida para quien llega por el QR: si la app se abre en el navegador de un
//   celular (no instalada), una pantalla breve invita a instalarla o a continuar.
// La franja de "Sin conexión" no está acá: es compartida (/js/conexion.js).
import { showToast } from '/js/ui.js';

const CLAVE_BIENVENIDA = 'rastreo_bienvenida_vista';
let eventoInstalacion = null;

function esIos() {
  // iPadOS se presenta como "MacIntel", pero con pantalla táctil.
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// La bienvenida es para quien llega por el QR desde el celular: en computadoras
// no se muestra. Celular = user agent móvil o pantalla táctil como puntero principal.
function esCelular() {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
    || esIos()
    || window.matchMedia('(pointer: coarse)').matches;
}

function yaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// Qué opción de instalación se ve, en el menú y en la bienvenida.
function actualizarOpcionesInstalacion() {
  const puedeInstalar = Boolean(eventoInstalacion);
  const ios = esIos() && !yaInstalada();
  document.getElementById('installAppButton')?.classList.toggle('hidden', !(puedeInstalar || ios));
  document.getElementById('installWelcomeButton')?.classList.toggle('hidden', !puedeInstalar);
  document.getElementById('installWelcomeIos')?.classList.toggle('hidden', !ios);
  // Sin evento ni iOS (otro navegador, o Chrome todavía no lo ofreció).
  document.getElementById('installWelcomeOther')?.classList.toggle('hidden', puedeInstalar || ios);
}

function mostrarBienvenida(visible) {
  document.getElementById('installWelcome')?.classList.toggle('hidden', !visible);
}

export async function installApp() {
  if (eventoInstalacion) {
    const evento = eventoInstalacion;
    // El evento sirve una sola vez: después de prompt() hay que esperar otro.
    eventoInstalacion = null;
    actualizarOpcionesInstalacion();
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

export function continuarEnNavegador() {
  mostrarBienvenida(false);
  try {
    sessionStorage.setItem(CLAVE_BIENVENIDA, '1');
  } catch {
    /* Almacenamiento bloqueado: la bienvenida puede volver a aparecer al recargar. */
  }
}

function bienvenidaYaVista() {
  try {
    return sessionStorage.getItem(CLAVE_BIENVENIDA) === '1';
  } catch {
    return false;
  }
}

export function iniciarPwa() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    eventoInstalacion = event;
    actualizarOpcionesInstalacion();
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalacion = null;
    actualizarOpcionesInstalacion();
    mostrarBienvenida(false);
    showToast('App instalada', 'Rastreo PY ya está en tu pantalla de inicio.', 'success');
  });
  actualizarOpcionesInstalacion();
  if (esCelular() && !yaInstalada() && !bienvenidaYaVista()) mostrarBienvenida(true);
}
