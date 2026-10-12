// Franja de "Sin conexión", compartida por la web (/) y la app (/app/).
// Se muestra si el equipo no tiene red o si el servidor no responde (aviso de
// api.js: fallo de red o 502/503/504 del proxy), aunque navigator.onLine diga que sí.
import { EVENTO_SERVIDOR } from './api.js';
import { showToast } from './ui.js';

let servidorDisponible = true;

function actualizarAvisoConexion() {
  // Solo se muestra la franja: lo que ya está en pantalla (por ejemplo el feed)
  // no se toca, y la sincronización sigue intentando por su cuenta.
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  const estabaVisible = !banner.classList.contains('hidden');
  const sinConexion = !navigator.onLine || !servidorDisponible;
  banner.classList.toggle('hidden', !sinConexion);
  if (estabaVisible && !sinConexion) {
    showToast('Conexión restablecida', 'Ya podés seguir usando Rastreo PY.', 'success');
  }
}

export function iniciarConexion() {
  window.addEventListener('offline', actualizarAvisoConexion);
  window.addEventListener('online', actualizarAvisoConexion);
  window.addEventListener(EVENTO_SERVIDOR, event => {
    servidorDisponible = event.detail.disponible;
    actualizarAvisoConexion();
  });
  actualizarAvisoConexion();
}
