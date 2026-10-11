// Reportar una persona desaparecida: formulario, ubicación y foto.
import { apiRequest } from './api.js';
import { estado } from './estado.js';
import { addBaseTiles, addTextMapZoomControl } from './map.js';
import { navigateTo } from './router.js';
import { showToast } from './ui.js';

export function renderReportView() {
  return `
    <div>
      <header class="page-heading">
        <span class="section-kicker">Denuncia ciudadana</span>
        <h1>Reportar persona desaparecida</h1>
        <p>Completá los datos de la persona. El reporte pasa por validación antes de publicarse.</p>
      </header>

      <form data-on-submit="handleReportSubmit(event)" class="card">
        <div class="form-group">
          <label>Nombre Completo *</label>
          <input type="text" id="repNombre" required placeholder="Nombre y apellido de la persona" class="form-control">
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Edad *</label>
            <input type="number" id="repEdad" required min="0" max="120" data-on-input="updateMinorAuthorization()" placeholder="Años" class="form-control">
          </div>
          <div class="form-group">
            <label>Sexo *</label>
            <select id="repSexo" class="form-control">
              <option value="Femenino">Femenino</option>
              <option value="Masculino">Masculino</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
        </div>

        <div class="grid-3 location-select">
          <div class="form-group">
            <label for="repDepartamento">Departamento *</label>
            <select id="repDepartamento" required class="form-control" data-on-change="onReportDepartmentChange()">
              <option value="">Cargando…</option>
            </select>
          </div>
          <div class="form-group">
            <label for="repCiudad">Ciudad / distrito *</label>
            <select id="repCiudad" required disabled class="form-control" data-on-change="onReportCityChange()">
              <option value="">Elegí un departamento</option>
            </select>
          </div>
          <div class="form-group">
            <label for="repBarrio">Barrio / localidad</label>
            <select id="repBarrio" disabled class="form-control" data-on-change="centerReportMapOnSelection()">
              <option value="">Elegí una ciudad</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label for="repFechaHora">Fecha y hora de la desaparición *</label>
          <input type="datetime-local" id="repFechaHora" required class="form-control">
        </div>

        <div class="form-group">
          <label>Descripción Física *</label>
          <textarea id="repFisica" required placeholder="Estatura, tez, tono de cabello..." class="form-control"></textarea>
        </div>

        <div class="form-group">
          <label>Vestimenta al Desaparecer *</label>
          <input type="text" id="repVestimenta" required placeholder="Prendas y calzados..." class="form-control">
        </div>

        <div class="form-group">
          <label>Señas Particulares</label>
          <input type="text" id="repSenas" placeholder="Tatuajes, cicatrices o accesorios..." class="form-control">
        </div>

        <!-- GEOLOCALIZADOR CON MAPA REAL Y PIN ARRASTRABLE -->
        <div class="form-group">
          <div>
            <label>Lugar exacto de desaparición *</label>
            <p class="muted">El pin se ubica solo según el departamento, ciudad y barrio elegidos. Tocá el mapa o arrastrá el pin para marcar el punto exacto.</p>
            <button type="button" data-on-click="useBrowserLocation('replat', 'replng', estado.reportMarker, 'repCoordsText')" class="btn btn-outline btn-sm">Usar mi ubicación actual</button>
          </div>
          <div id="reportMap" class="map-container"></div>
          <input type="hidden" id="replat" value="-25.2867">
          <input type="hidden" id="replng" value="-57.6333">
          <p id="repCoordsText">Coordenadas: -25.2867, -57.6333</p>
        </div>

        <div class="form-group">
          <label>Fotografía de referencia</label>
          <input type="file" id="repFotoFile" accept="image/jpeg,image/png,image/webp" hidden data-on-change="handleReportPhotoSelection(event)">
          <button type="button" id="selectReportPhotoButton" class="btn btn-outline" data-on-click="openFilePicker('repFotoFile')">Seleccionar fotografía</button>
          <div id="reportPhotoPreviewWrap" class="hidden">
            <img id="reportPhotoPreview" alt="Vista previa de la fotografía seleccionada">
            <div>
              <button type="button" class="btn btn-outline btn-sm" data-on-click="openFilePicker('repFotoFile')">Cambiar fotografía</button>
              <button type="button" class="btn btn-outline btn-sm" data-on-click="removeReportPhoto()">Quitar fotografía</button>
            </div>
          </div>
          <p id="reportPhotoError" class="hidden" role="alert"></p>
        </div>

        <div class="form-group">
          <label>N.º Denuncia Policial (Opcional)</label>
          <input type="text" id="repDenuncia" placeholder="Ej: DEN-2026-XXXX" class="form-control">
          <p class="notice notice-warning">
            Aviso: Si no registra número de denuncia, el caso permanecerá en estado PENDIENTE hasta ser verificado por las autoridades.
          </p>
        </div>

        <fieldset class="form-group consent-group">
          <legend>Verificación de edad y autorización *</legend>
          <label><input type="checkbox" id="reporterAdult" required> Declaro que soy mayor de 18 años y estoy autorizado a realizar este reporte.</label>
          <label><input type="checkbox" id="minorAuthorization" data-on-change="updateMinorAuthorization()"> Confirmo que cuento con autorización parental o de tutor legal para reportar a la persona menor de edad.</label>
        </fieldset>
        <label class="privacy-consent">
          <input type="checkbox" id="privacyConsent" required>
          Acepto el aviso de privacidad y el uso de estos datos únicamente para la búsqueda y gestión de este reporte.
        </label>

        <button type="submit" class="btn btn-red">Publicar reporte de búsqueda</button>
      </form>
    </div>
  `;
}

export function initReportLeafletMap() {
  setTimeout(() => {
    if (estado.activeMap) { estado.activeMap.remove(); estado.activeMap = null; }
    const mapEl = document.getElementById('reportMap');
    if (!mapEl) return;

    try {
      const map = L.map('reportMap', { zoomControl: false, attributionControl: false, preferCanvas: true }).setView([-25.2867, -57.6333], 12);
      addTextMapZoomControl(map);
      addBaseTiles(map, mapEl);

      estado.reportMarker = L.marker([-25.2867, -57.6333], { draggable: true, title: 'Lugar de desaparición', icon: L.divIcon({ className: 'location-marker', html: '', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map);
      estado.reportMarker.on('dragend', function (e) {
        setReportCoordinates(e.target.getLatLng());
      });
      map.on('click', event => {
        estado.reportMarker.setLatLng(event.latlng);
        setReportCoordinates(event.latlng);
      });

      estado.activeMap = map;
    } catch (e) {
      mapEl.innerHTML = '<div>No se pudo cargar el mapa. Verifique su conexión.</div>';
    }
  }, 100);
}

export function setReportCoordinates({ lat, lng }) {
  document.getElementById('replat').value = Number(lat).toFixed(5);
  document.getElementById('replng').value = Number(lng).toFixed(5);
  document.getElementById('repCoordsText').innerText = `Coordenadas: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

// Al elegir departamento, ciudad o barrio, el pin se mueve solo a esa zona
// (geocodificación gratuita de OpenStreetMap). Después se puede ajustar a mano.
export async function centerReportMapOnSelection() {
  const parts = ['repBarrio', 'repCiudad', 'repDepartamento']
    .map(id => document.getElementById(id)?.value || '')
    .filter(Boolean)
    .map(value => value === 'Capital' ? 'Asunción' : value);
  if (!parts.length || !estado.activeMap || !estado.reportMarker) return;
  const token = ++estado.reportGeocodeToken;
  try {
    const query = new URLSearchParams({ q: [...parts, 'Paraguay'].join(', '), format: 'json', limit: '1', countrycodes: 'py' });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, { headers: { Accept: 'application/json' } });
    const [place] = response.ok ? await response.json() : [];
    if (!place || token !== estado.reportGeocodeToken) return;
    const position = { lat: Number(place.lat), lng: Number(place.lon) };
    estado.reportMarker.setLatLng(position);
    estado.activeMap.setView(position, document.getElementById('repBarrio').value ? 15 : document.getElementById('repCiudad').value ? 13 : 9);
    setReportCoordinates(position);
  } catch (error) {
    console.error('No se pudo ubicar la zona elegida en el mapa:', error.message);
  }
}

export function useBrowserLocation(latId, lngId, markerObj, coordsTextId) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      document.getElementById(latId).value = lat.toFixed(5);
      document.getElementById(lngId).value = lng.toFixed(5);
      if (coordsTextId) document.getElementById(coordsTextId).innerText = `Coordenadas aproximadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (markerObj && estado.activeMap) {
        markerObj.setLatLng([lat, lng]);
        estado.activeMap.setView([lat, lng], 14);
      }
    }, () => showToast('Ubicación no disponible', 'No se pudo obtener la localización del navegador.', 'error'));
  }
}

// Las fotos se reducen a 800 px antes de enviarse, así que se acepta el tamaño de una foto de celular.
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export function setReportPhotoError(message) {
  const error = document.getElementById('reportPhotoError');
  if (!error) return;
  error.textContent = message;
  error.classList.toggle('hidden', !message);
}

export function handleReportPhotoSelection(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    clearReportPhotoSelection();
    setReportPhotoError('Seleccione una imagen JPG, PNG o WEBP.');
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    clearReportPhotoSelection();
    setReportPhotoError('La fotografía no debe superar los 15 MB.');
    return;
  }

  estado.selectedReportPhoto = file;
  setReportPhotoError('');
  if (estado.reportPhotoPreviewUrl) URL.revokeObjectURL(estado.reportPhotoPreviewUrl);
  estado.reportPhotoPreviewUrl = URL.createObjectURL(file);
  document.getElementById('reportPhotoPreview').src = estado.reportPhotoPreviewUrl;
  document.getElementById('reportPhotoPreviewWrap').classList.remove('hidden');
  document.getElementById('selectReportPhotoButton').classList.add('hidden');
}

export function removeReportPhoto() {
  clearReportPhotoSelection();
  setReportPhotoError('');
}

export function clearReportPhotoSelection() {
  estado.selectedReportPhoto = null;
  const input = document.getElementById('repFotoFile');
  if (input) input.value = '';
  if (estado.reportPhotoPreviewUrl) URL.revokeObjectURL(estado.reportPhotoPreviewUrl);
  estado.reportPhotoPreviewUrl = '';
  const preview = document.getElementById('reportPhotoPreview');
  const previewWrap = document.getElementById('reportPhotoPreviewWrap');
  const selectButton = document.getElementById('selectReportPhotoButton');
  if (preview) preview.removeAttribute('src');
  if (previewWrap) previewWrap.classList.add('hidden');
  if (selectButton) selectButton.classList.remove('hidden');
}

export function compressReportPhoto(file) {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      const scale = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('No se pudo procesar la fotografía.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('No se pudo comprimir la fotografía.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer la fotografía procesada.'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.75);
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('No se pudo abrir la fotografía seleccionada.'));
    };
    image.src = sourceUrl;
  });
}

// Lista oficial de Paraguay (departamento -> ciudad -> barrio). Se pide una sola vez.
export function loadParaguayLocations() {
  estado.paraguayLocationsPromise ||= fetch('/data/paraguay-ubicaciones.json')
    .then(response => {
      if (!response.ok) throw new Error('No se pudo cargar la lista de ciudades.');
      return response.json();
    })
    .then(data => data.departamentos)
    .catch(error => {
      estado.paraguayLocationsPromise = null;
      throw error;
    });
  return estado.paraguayLocationsPromise;
}

export function fillSelect(select, placeholder, values) {
  select.replaceChildren(new Option(placeholder, ''), ...values.map(value => new Option(value, value)));
  select.disabled = values.length === 0;
}

export async function initReportLocationSelects() {
  const department = document.getElementById('repDepartamento');
  if (!department) return;
  try {
    const departments = await loadParaguayLocations();
    fillSelect(department, 'Elegí un departamento', departments.map(item => item.departamento));
  } catch (error) {
    department.replaceChildren(new Option('No se pudo cargar la lista', ''));
    showToast('Lista de ciudades no disponible', error.message, 'error');
  }
}

export async function onReportDepartmentChange() {
  const departments = await loadParaguayLocations();
  const selected = departments.find(item => item.departamento === document.getElementById('repDepartamento').value);
  fillSelect(document.getElementById('repCiudad'), selected ? 'Elegí una ciudad' : 'Elegí un departamento',
    selected ? selected.ciudades.map(item => item.ciudad) : []);
  fillSelect(document.getElementById('repBarrio'), 'Elegí una ciudad', []);
  centerReportMapOnSelection();
}

export async function onReportCityChange() {
  const departments = await loadParaguayLocations();
  const department = departments.find(item => item.departamento === document.getElementById('repDepartamento').value);
  const city = department?.ciudades.find(item => item.ciudad === document.getElementById('repCiudad').value);
  const barrios = city?.barrios || [];
  fillSelect(document.getElementById('repBarrio'), barrios.length ? 'Sin especificar' : 'Sin barrios cargados', barrios);
  centerReportMapOnSelection();
}

export async function handleReportSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('repNombre').value.trim();
  const city = document.getElementById('repCiudad').value.trim();
  let photoData = '';

  if (estado.selectedReportPhoto) {
    try {
      photoData = await compressReportPhoto(estado.selectedReportPhoto);
    } catch (error) {
      setReportPhotoError(error.message);
      return;
    }
  }

  // Validación Ley N.º 6534/2020: Bloqueo de datos financieros o patrimoniales
  const text = (name + ' ' + document.getElementById('repFisica').value).toLowerCase();
  if (text.includes('tarjeta') || text.includes('cuenta') || text.includes('banco') || text.includes('deuda')) {
    showToast('Importante', 'Se prohíbe explícitamente ingresar datos crediticios, bancarios o patrimoniales (Ley N.º 6534/2020).', 'error');
    return;
  }

  const denuncia = document.getElementById('repDenuncia').value.trim();
  const newCase = {
    nombreCompleto: name,
    edad: parseInt(document.getElementById('repEdad').value),
    sexo: document.getElementById('repSexo').value,
    ciudad: city,
    departamento: document.getElementById('repDepartamento').value,
    barrio: document.getElementById('repBarrio').value,
    descripcionFisica: document.getElementById('repFisica').value,
    vestimenta: document.getElementById('repVestimenta').value,
    senasParticulares: document.getElementById('repSenas').value,
    fechaHoraDesaparicion: document.getElementById('repFechaHora').value || new Date().toISOString(),
    foto: photoData,
    ubicacion: {
      lat: parseFloat(document.getElementById('replat').value),
      lng: parseFloat(document.getElementById('replng').value),
      direccion: city
    },
    numeroDenuncia: denuncia,
    declaraMayorEdad: document.getElementById('reporterAdult').checked,
    autorizacionParental: document.getElementById('minorAuthorization').checked,
    avisoPrivacidadAceptado: document.getElementById('privacyConsent').checked
  };

  try {
    await apiRequest('/casos', { method: 'POST', body: newCase });
  } catch (error) {
    setReportPhotoError(error.message);
    return;
  }
  showToast('Reporte recibido', 'El caso quedó en revisión y ya aparece en Mis casos.', 'success');
  await navigateTo('my-cases');
}

export function updateMinorAuthorization() {
  const age = Number(document.getElementById('repEdad')?.value);
  const authorization = document.getElementById('minorAuthorization');
  if (!authorization) return;
  const isMinor = Number.isFinite(age) && age < 18;
  authorization.required = isMinor;
  authorization.disabled = !isMinor;
  if (!isMinor) authorization.checked = false;
}
