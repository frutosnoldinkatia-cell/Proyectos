// Generar una pista: selección del caso, ubicación y fotos.
import { apiRequest } from './api.js';
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { addBaseTiles, addTextMapZoomControl } from './map.js';
import { MAX_PHOTO_BYTES, compressReportPhoto } from './report.js';
import { navigateTo } from './router.js';
import { getStore } from './store.js';
import { showToast } from './ui.js';

// ==========================================
// VISTA 5: GENERAR PISTA CON FILTROS (SECCIÓN 7)
// ==========================================
export function renderLeadCaseSelection() {
  const activeCases = getStore().casos.filter(c =>
    ['VALIDADO', 'EN_SEGUIMIENTO'].includes(c.estado));
  return `
    <div class="lead-flow">
      <header class="page-heading">
        <span class="section-kicker">Colaboración ciudadana</span>
        <h1>Generar pista</h1>
        <p>Paso 1 de 2 · Buscá el caso sobre el que viste algo.</p>
      </header>
      <label class="lead-search-field"><span class="sr-only">Buscar un caso</span>
        <input type="search" id="leadCaseSearch" class="form-control" data-on-input="filterLeadCaseCards()" placeholder="Buscar por nombre, ciudad o señas particulares">
      </label>
      <div id="leadCaseChoices" class="lead-case-choices">
        ${activeCases.map(c => {
          const initials = c.nombreCompleto.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
          const status = c.estado === 'EN_SEGUIMIENTO' ? 'En seguimiento' : 'Búsqueda activa';
          return `<article class="lead-case-choice" data-case-id="${escapeHtml(c.id)}" data-search="${escapeHtml([c.nombreCompleto, c.ciudad, c.departamento, c.descripcionFisica, c.senasParticulares].join(' ')).toLocaleLowerCase('es-PY')}">
            <div class="lead-case-avatar">${escapeHtml(initials)}</div>
            <div class="lead-case-info"><strong>${escapeHtml(c.nombreCompleto)}</strong><span>${Number(c.edad)} años · ${escapeHtml(c.ciudad)}${c.departamento ? `, ${escapeHtml(c.departamento)}` : ''}</span><small>${escapeHtml(status)}</small></div>
            <button type="button" class="btn btn-outline btn-sm" data-case-id="${escapeHtml(c.id)}" data-on-click="navigateTo('lead',{caseId:this.dataset.caseId})">Enviar pista <span aria-hidden="true">›</span></button>
          </article>`;
        }).join('')}
      </div>
      <p id="leadCaseEmpty" class="feed-empty-state ${activeCases.length ? 'hidden' : ''}">${activeCases.length ? 'No se encontraron casos con esa búsqueda.' : 'No hay casos activos disponibles para recibir pistas.'}</p>
    </div>
  `;
}

export function filterLeadCaseCards() {
  const query = document.getElementById('leadCaseSearch').value.trim().toLocaleLowerCase('es-PY');
  let visible = 0;
  document.querySelectorAll('.lead-case-choice').forEach(card => {
    const matches = !query || card.dataset.search.includes(query);
    card.classList.toggle('hidden', !matches);
    if (matches) visible += 1;
  });
  document.getElementById('leadCaseEmpty').classList.toggle('hidden', visible !== 0);
}

export function renderLeadView(preCaseId) {
  const store = getStore();
  const activeCases = store.casos.filter(c => ['VALIDADO', 'EN_SEGUIMIENTO'].includes(c.estado));
  const selectedCase = activeCases.find(c => c.id === preCaseId);
  if (!selectedCase) return renderLeadCaseSelection();
  return `
    <div class="lead-flow">
      <nav class="breadcrumbs" aria-label="Ruta de navegación">
        <button type="button" data-on-click="navigateTo('feed')">Inicio</button><span aria-hidden="true">›</span><button type="button" data-on-click="navigateTo('lead')">Generar pista</button><span aria-hidden="true">›</span><span>Pista sobre ${escapeHtml(selectedCase.nombreCompleto)}</span>
      </nav>
      <header class="page-heading">
        <span class="section-kicker">Paso 2 de 2 · Contanos qué viste.</span>
        <h1>Pista sobre ${escapeHtml(selectedCase.nombreCompleto)}</h1>
        <button type="button" class="inline-detail-link" data-case-id="${escapeHtml(selectedCase.id)}" data-on-click="openCaseDetail(this.dataset.caseId)">Ver ficha del caso <span aria-hidden="true">›</span></button>
      </header>
      <article class="lead-selected-case">
        <div class="lead-case-avatar">${escapeHtml(selectedCase.nombreCompleto.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())}</div>
        <div><span class="case-status-pill status-tone-${selectedCase.estado === 'EN_SEGUIMIENTO' ? 'followup' : 'active'}">${selectedCase.estado === 'EN_SEGUIMIENTO' ? 'En seguimiento' : 'Búsqueda activa'}</span>
          <h2>${escapeHtml(selectedCase.nombreCompleto)}</h2>
          <p>${Number(selectedCase.edad)} años · ${escapeHtml(selectedCase.ciudad)}${selectedCase.departamento ? `, ${escapeHtml(selectedCase.departamento)}` : ''}</p>
          <p>${escapeHtml(selectedCase.descripcionFisica)}</p>
        </div>
      </article>
      <form data-on-submit="handleLeadSubmit(event)" class="card lead-form">
        <h2>Enviar una pista</h2>
        <p class="muted">Tu pista se publica de forma anónima. Solo la administración puede ver qué cuenta la envió.</p>
        <p class="notice notice-info">Si la pista se valida, su descripción, fotos y ubicación podrán mostrarse en la ficha; no solicitamos tus datos personales ni se muestran al público.</p>
        <input type="hidden" id="leadCaseId" value="${escapeHtml(selectedCase.id)}">
        <div class="form-group">
          <label for="leadDesc">¿Qué viste? *</label>
          <textarea id="leadDesc" required maxlength="3000" placeholder="Dónde, cuándo, con quién, cómo iba vestida/o..." class="form-control lead-description-input"></textarea>
        </div>
        <div class="form-group">
          <label for="leadPhotos" class="lead-upload-zone"><span aria-hidden="true">▧</span><strong>Toca para sacar o subir fotos</strong><small>Hasta 3 imágenes JPG, PNG o WEBP</small></label>
          <input type="file" id="leadPhotos" accept="image/jpeg,image/png,image/webp" capture="environment" multiple data-on-change="handleLeadPhotoSelection(event)" class="sr-only">
          <div id="leadPhotoPreviews" class="lead-photo-previews"></div>
          <p id="leadPhotoError" class="hidden" role="alert"></p>
        </div>
        <div class="form-group">
          <label for="leadFecha">Fecha y hora del avistamiento *</label>
          <input type="datetime-local" id="leadFecha" required class="form-control">
        </div>
        <label class="privacy-consent lead-public-consent"><input type="checkbox" id="leadPublicConsent" required>
          Entiendo que la pista, su ubicación y las fotografías que envíe podrán ser publicadas si el equipo las valida.
        </label>
        <div class="form-group lead-location-group">
          <div class="lead-location-heading"><label>Ubicación del avistamiento *</label><span>Tocá el mapa para marcar el lugar</span></div>
          <div id="leadMap" class="map-container"></div>
          <input type="hidden" id="leadlat" value="-25.2867">
          <input type="hidden" id="leadlng" value="-57.6333">
          <div class="lead-location-footer"><p id="leadCoordsText">Coordenadas aproximadas: -25.2867, -57.6333</p>
            <button type="button" data-on-click="useBrowserLocation('leadlat', 'leadlng', estado.leadMarker, 'leadCoordsText')" class="btn btn-outline btn-sm">⌖ Usar mi ubicación</button>
          </div>
        </div>
        <div class="lead-form-actions"><button type="button" class="btn btn-outline" data-on-click="navigateTo('lead')">Volver a casos</button><button type="submit" class="btn btn-primary">Enviar una pista</button></div>
      </form>
    </div>
  `;
}

export function clearLeadPhotoSelection() {
  estado.leadPhotoPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  estado.leadPhotoPreviewUrls = [];
  estado.selectedLeadPhotos = [];
  const input = document.getElementById('leadPhotos');
  if (input) input.value = '';
  const previews = document.getElementById('leadPhotoPreviews');
  if (previews) previews.replaceChildren();
  const error = document.getElementById('leadPhotoError');
  if (error) {
    error.textContent = '';
    error.classList.add('hidden');
  }
}

export function handleLeadPhotoSelection(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  clearLeadPhotoSelection();
  const error = document.getElementById('leadPhotoError');
  if (files.length > 3 || files.some(file =>
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_PHOTO_BYTES
  )) {
    input.value = '';
    error.textContent = 'Seleccione hasta 3 fotografías JPG, PNG o WEBP de máximo 15 MB cada una.';
    error.classList.remove('hidden');
    return;
  }

  estado.selectedLeadPhotos = files;
  const previews = document.getElementById('leadPhotoPreviews');
  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    estado.leadPhotoPreviewUrls.push(url);
    const image = document.createElement('img');
    image.src = url;
    image.alt = `Vista previa de la fotografía ${index + 1}`;
    previews.append(image);
  });
}

export function initLeadLeafletMap() {
  setTimeout(() => {
    if (estado.activeMap) { estado.activeMap.remove(); estado.activeMap = null; }
    const mapEl = document.getElementById('leadMap');
    if (!mapEl) return;

    try {
      const map = L.map('leadMap', { zoomControl: false, attributionControl: false, preferCanvas: true }).setView([-25.2867, -57.6333], 12);
      addTextMapZoomControl(map);
      addBaseTiles(map, mapEl);

      estado.leadMarker = L.marker([-25.2867, -57.6333], { draggable: true, title: 'Ubicación de la pista', icon: L.divIcon({ className: 'location-marker', html: '', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map);
      map.on('click', event => {
        estado.leadMarker.setLatLng(event.latlng);
        document.getElementById('leadlat').value = event.latlng.lat.toFixed(5);
        document.getElementById('leadlng').value = event.latlng.lng.toFixed(5);
        document.getElementById('leadCoordsText').innerText = `Lugar marcado: ${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`;
      });
      estado.leadMarker.on('dragend', function (e) {
        const coord = e.target.getLatLng();
        document.getElementById('leadlat').value = coord.lat.toFixed(5);
        document.getElementById('leadlng').value = coord.lng.toFixed(5);
        document.getElementById('leadCoordsText').innerText = `Coordenadas aproximadas: ${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`;
      });

      estado.activeMap = map;
      const dateInput = document.getElementById('leadFecha');
      if (dateInput && !dateInput.value) {
        const now = new Date();
        dateInput.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }
    } catch (e) {
      mapEl.innerHTML = '<div>No se pudo cargar el mapa. Verifique su conexión.</div>';
    }
  }, 100);
}

export function filterLeadCases() {
  const query = document.getElementById('leadCaseSearch').value.trim().toLocaleLowerCase('es-PY');
  const store = getStore();

  const filtered = store.casos.filter(c => {
    return ['VALIDADO', 'EN_SEGUIMIENTO'].includes(c.estado)
      && (!query || [c.nombreCompleto, c.ciudad, c.departamento, c.descripcionFisica, c.senasParticulares]
        .join(' ').toLocaleLowerCase('es-PY').includes(query));
  });
  document.getElementById('leadCaseChoices').innerHTML = filtered.map(c => {
    const initials = c.nombreCompleto.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    return `<article class="lead-case-choice" data-case-id="${escapeHtml(c.id)}">
      <div class="lead-case-avatar">${escapeHtml(initials)}</div>
      <div class="lead-case-info"><strong>${escapeHtml(c.nombreCompleto)}</strong><span>${Number(c.edad)} años · ${escapeHtml(c.ciudad)}${c.departamento ? `, ${escapeHtml(c.departamento)}` : ''}</span><small>${c.estado === 'EN_SEGUIMIENTO' ? 'En seguimiento' : 'Búsqueda activa'}</small></div>
      <button type="button" class="btn btn-outline btn-sm" data-case-id="${escapeHtml(c.id)}" data-on-click="navigateTo('lead',{caseId:this.dataset.caseId})">Enviar pista <span aria-hidden="true">›</span></button>
    </article>`;
  }).join('');
  document.getElementById('leadCaseEmpty').classList.toggle('hidden', filtered.length > 0);
}

export async function handleLeadSubmit(e) {
  e.preventDefault();
  const caseId = document.getElementById('leadCaseId').value;
  const desc = document.getElementById('leadDesc').value.trim();
  try {
    const photos = await Promise.all(estado.selectedLeadPhotos.map(compressReportPhoto));
    await apiRequest(`/casos/${encodeURIComponent(caseId)}/pistas`, {
      method: 'POST',
      body: {
        descripcion: desc,
        fechaHoraAvistamiento: document.getElementById('leadFecha').value,
        fotos: photos,
        ubicacion: {
          lat: parseFloat(document.getElementById('leadlat').value),
          lng: parseFloat(document.getElementById('leadlng').value)
        }
      }
    });
    showToast('Pista recibida', 'La pista se envió para moderación antes de publicarse. Tus datos personales no se muestran al público.', 'success');
    clearLeadPhotoSelection();
    navigateTo('feed');
  } catch (error) {
    showToast('No se pudo enviar la pista', error.message);
  }
}
