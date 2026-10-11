// Mapa principal (Leaflet).
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { filterFeedCases } from './feed.js';
import { getStore } from './store.js';
import { showToast } from './ui.js';

// INICIALIZACIÓN DE LEAFLET EN EL MAPA PRINCIPAL
export function initMainLeafletMap() {
  setTimeout(() => {
    if (estado.activeMap) { estado.activeMap.remove(); estado.activeMap = null; }
    estado.activeMarkers = [];

    const mapEl = document.getElementById('mainMap');
    if (!mapEl) return;

    try {
      const map = L.map('mainMap', { zoomControl: false, attributionControl: false, preferCanvas: true }).setView([-25.2867, -57.6333], 7);
      addTextMapZoomControl(map);
      
      addBaseTiles(map, mapEl);

      const store = getStore();
      store.casos.forEach(c => {
        if (c.ubicacion && c.ubicacion.lat) {
          const marker = L.marker([c.ubicacion.lat, c.ubicacion.lng], {
            title: `Caso: ${c.nombreCompleto}`,
            icon: L.divIcon({ className: 'case-marker', html: '<span></span>', iconSize: [24, 32], iconAnchor: [12, 30] })
          }).addTo(map);

          marker.bindPopup(`
            <div>
              <strong>${escapeHtml(c.nombreCompleto)}</strong><br>
              ${escapeHtml(c.ciudad)}${c.departamento ? `, ${escapeHtml(c.departamento)}` : ''} (${Number(c.edad)} años)<br>
              Fecha: ${new Date(c.fechaHoraDesaparicion).toLocaleDateString('es-PY')}<br>
              Estado: ${escapeHtml(c.estado)}<br>
              <button aria-label="Ver ficha del caso" data-case-id="${escapeHtml(c.id)}" data-on-click="openCaseDetail(this.dataset.caseId)">Ver caso</button>
            </div>
          `);

          let geofence = null;
          estado.activeMarkers.push({ id: c.id, caseId: c.id, marker, geofence, lat: c.ubicacion.lat, lng: c.ubicacion.lng });

          // DIBUJAR GEOCERCA REAL DE 60 KM (60,000 METROS)
          if (c.estado === 'VALIDADO' || c.estado === 'EN_SEGUIMIENTO') {
            geofence = L.circle([c.ubicacion.lat, c.ubicacion.lng], {
              color: '#B3261E',
              weight: 1,
              fillColor: '#B3261E',
              fillOpacity: 0.12,
              radius: 60000
            }).addTo(map);
            estado.activeMarkers.at(-1).geofence = geofence;
          }
        }
      });

      store.pistas.forEach(pista => {
        if (!pista.ubicacion || !Number.isFinite(pista.ubicacion.lat) || !Number.isFinite(pista.ubicacion.lng)) return;
        const relatedCase = store.casos.find(caso => caso.id === pista.casoId);
        const clueMarker = L.marker([pista.ubicacion.lat, pista.ubicacion.lng], {
          icon: L.divIcon({ className: 'clue-marker', html: '', iconSize: [12, 12], iconAnchor: [6, 6] }),
          title: 'Pista reportada'
        }).addTo(map);
        clueMarker.bindPopup(`<div><strong>Pista reportada</strong><br>${escapeHtml(relatedCase ? relatedCase.nombreCompleto : 'Caso')}<br>${escapeHtml(pista.descripcion)}<br>${new Date(pista.fechaHoraAvistamiento || pista.fechaEnvio).toLocaleDateString('es-PY')}</div>`);
      });

      estado.activeMap = map;
      filterFeedCases();
    } catch (e) {
      mapEl.innerHTML = '<div>No se pudo cargar el mapa. Verifique su conexión.</div>';
    }
  }, 100);
}

export function centerMapOnParaguay() {
  if (estado.activeMap) estado.activeMap.setView([-25.2867, -57.6333], 7);
}

export function showMapLoadError(mapEl) {
  if (mapEl.querySelector('.map-load-error')) return;
  const notice = document.createElement('div');
  notice.className = 'map-load-error';
  notice.textContent = 'No se pudo cargar el mapa. Verifique su conexión.';
  mapEl.appendChild(notice);
}

// Mapa base de OpenStreetMap: no requiere API key (CARTO empezó a pedirla).
export function addBaseTiles(map, mapEl) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map).on('tileerror', () => showMapLoadError(mapEl));
}

export function addTextMapZoomControl(map) {
  L.control.attribution({ prefix: false }).addTo(map);
  L.control.zoom({
    zoomInText: 'Acercar',
    zoomInTitle: 'Acercar mapa',
    zoomOutText: 'Alejar',
    zoomOutTitle: 'Alejar mapa'
  }).addTo(map);
  const controls = map.getContainer().querySelectorAll('.leaflet-control-zoom a');
  controls[0]?.setAttribute('aria-label', 'Acercar mapa');
  controls[1]?.setAttribute('aria-label', 'Alejar mapa');
  map.on('popupopen', event => {
    const closeButton = event.popup.getElement()?.querySelector('.leaflet-popup-close-button');
    closeButton?.setAttribute('aria-label', 'Cerrar ventana');
  });
}

export function viewCaseOnFeed(caseId) {
  const card = document.getElementById(`case-${caseId}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.focus({ preventScroll: true });
  }
}

export function useMyLocationOnMap() {
  if (!navigator.geolocation) {
    showToast('Información', 'La geolocalización no está disponible en este navegador.', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(position => {
    if (estado.activeMap) estado.activeMap.setView([position.coords.latitude, position.coords.longitude], 13);
  }, () => showToast('Ubicación no disponible', 'No se pudo obtener la ubicación. Verifique los permisos del navegador.', 'error'));
}

export function focusCaseOnMap(caseId) {
  const found = estado.activeMarkers.find(m => m.id === caseId);
  if (found && estado.activeMap) {
    estado.activeMap.setView([found.lat, found.lng], 13);
    found.marker.openPopup();
  }
}
