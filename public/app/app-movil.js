// Punto de entrada solo de la app (/app/). La lógica compartida con la web la
// arranca /js/app.js (cargado antes en index.html); acá se suma lo propio de la
// app: instalación, bienvenida del QR y la pestaña "Mapa" de la barra inferior.
import { acciones } from '/js/app.js';
import { setFeedView } from '/js/feed.js';
import { navigateTo } from '/js/router.js';
import { continuarEnNavegador, iniciarPwa, installApp, toggleInstallGuide } from './pwa.js';

// "Mapa" es el mismo feed mostrado como mapa (no hay una vista aparte).
export async function abrirMapa() {
  await navigateTo('home');
  if (document.getElementById('feedMapPanel')) setFeedView('map');
}

// Acciones de data-on-*="..." que solo existen en la app (ver eventos.js; el test
// backend/test/frontend-handlers.test.js las lee de este Object.assign).
Object.assign(acciones, { installApp, toggleInstallGuide, continuarEnNavegador, abrirMapa });

iniciarPwa();
