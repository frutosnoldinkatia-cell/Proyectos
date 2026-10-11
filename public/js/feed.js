// Inicio: listado de casos, filtros, paginación y ficha del caso.
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { buildRoute, syncUrl } from './router.js';
import { buildAgeAnalyticsRows, buildStateAnalyticsRows, renderAnalyticsBars } from './stats.js';
import { getStore } from './store.js';
import { showToast } from './ui.js';

// ==========================================
// VISTA 3: PANTALLA PRINCIPAL CON MAPA Y CASOS (SECCIÓN 5 Y 6)
// ==========================================
export function renderFeedView(statistics = window.currentStatistics) {
  const store = getStore();
  window.currentStatistics = statistics || {};
  statistics = window.currentStatistics;
  const casos = store.casos;
  const total = Number(statistics.total ?? casos.length);
  const encontrados = Number(statistics.localizados ?? statistics.encontrados
    ?? casos.filter(c => c.estado === 'LOCALIZADO').length);
  const activos = Number(statistics.activos
    ?? casos.filter(c => c.estado === 'VALIDADO' || c.estado === 'EN_SEGUIMIENTO').length);
  const sinActualizar = casos.filter(c => c.estado === 'EN_SEGUIMIENTO' && Number(c.seguimientoEtapa) >= 2).length;
  const efectividad = total ? Math.round(encontrados / total * 100) : 0;
  const groupCases = (select, label) => {
    const groups = new Map();
    casos.forEach(item => {
      const key = select(item);
      if (key) groups.set(key, (groups.get(key) || 0) + 1);
    });
    return [...groups].map(([categoria, count]) => ({ categoria, total: count }))
      .sort((a, b) => b.total - a.total)
      .map(row => ({ ...row, categoria: row.categoria || label }));
  };
  const cityRows = statistics.casosPorCiudad || groupCases(c => c.ciudad, 'Sin especificar');
  const ageRows = buildAgeAnalyticsRows(statistics, casos);
  const stateRows = buildStateAnalyticsRows(statistics, casos);
  const departments = ['Alto Paraná', 'Amambay', 'Caaguazú', 'Central', 'Concepción', 'Guairá', 'Itapúa'];
  const otherDepartments = [...new Set(casos.map(c => c.departamento).filter(Boolean))]
    .filter(name => !departments.some(department => department.toLocaleLowerCase('es-PY') === name.toLocaleLowerCase('es-PY')))
    .sort((a, b) => a.localeCompare(b, 'es-PY'));
  const cityOptions = [...departments, ...otherDepartments]
    .map(department => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`).join('');
  return `
    <div class="home-page">
      <section class="home-hero card" aria-labelledby="homeHeading">
        <div class="hero-copy">
          <p class="hero-eyebrow">Canal colaborativo · complementa la denuncia policial</p>
          <h1 id="homeHeading">Rastreo PY</h1>
          <p class="hero-description">Un canal de difusión y ayuda colaborativa para encontrar personas desaparecidas en Paraguay. <strong>No reemplaza la denuncia policial</strong>: la complementa con alertas por zona, pistas ciudadanas con foto y ubicación, y un seguimiento automático de cada caso.</p>
          <div class="hero-actions">
            <button type="button" data-on-click="navigateTo('report')" class="btn btn-primary">＋ Reportar persona desaparecida</button>
            <button type="button" data-on-click="navigateTo('lead')" class="btn btn-outline">⌖ Generar pista</button>
            <a href="tel:911" class="btn btn-emergency">☎ 911</a>
          </div>
        </div>
        <div class="hero-mark" aria-hidden="true"><span>R</span><small>UNIDA<br>PARAGUAY</small></div>
      </section>

      <section class="home-stats" aria-labelledby="homeStatsHeading">
        <div class="home-section-heading">
          <div><span class="section-kicker">Datos públicos</span><h2 id="homeStatsHeading">Estadísticas en tiempo real</h2></div>
          <button type="button" class="section-link" data-on-click="navigateTo('stats')">Ver detalle <span aria-hidden="true">›</span></button>
        </div>
        <div class="home-stats-grid">
          <article class="metric-card"><span class="metric-icon">▤</span><strong id="metricTotal">${total}</strong><span>Casos registrados (validados)</span></article>
          <article class="metric-card metric-found"><span class="metric-icon">✓</span><strong id="metricFound">${encontrados}</strong><span>Personas localizadas</span></article>
          <article class="metric-card metric-followup"><span class="metric-icon">◷</span><strong id="metricActive">${activos}</strong><span id="metricOutdated">En seguimiento activo · ${sinActualizar} sin actualizar</span></article>
          <article class="metric-card metric-effectiveness"><span class="metric-icon">↗</span><strong id="metricEffectiveness">${efectividad}%</strong><span>Efectividad (localizadas / registradas)</span></article>
        </div>
      </section>

      <section class="analytics-grid" aria-label="Distribución analítica de los reportes">
        <article class="analytics-card card"><h2>Por ciudad</h2><div id="analyticsByCity" class="analytics-list">${renderAnalyticsBars(cityRows)}</div></article>
        <article class="analytics-card card"><h2>Por rango de edad</h2><div id="analyticsByAge" class="analytics-list">${renderAnalyticsBars(ageRows)}</div></article>
        <article class="analytics-card card"><h2>Por estado</h2><div id="analyticsByState" class="analytics-list">${renderAnalyticsBars(stateRows, 'status')}</div></article>
      </section>

      <section class="case-explorer" aria-labelledby="caseExplorerHeading">
        <div class="home-section-heading explorer-heading">
          <div><span class="section-kicker">Búsqueda pública</span><h2 id="caseExplorerHeading">Reportes de personas desaparecidas</h2>
            <p class="explorer-description">Filtrá por ciudad/zona, sexo, estado o nombre. Tocá una ficha para ver el detalle y enviar una pista.</p>
          </div>
        </div>
        <div class="feed-filters advanced-feed-filters">
          <label class="filter-field"><span>Nombre, ciudad o seña</span><input type="search" id="feedSearch" class="form-control" data-on-input="filterFeedCases()" placeholder="Ej.: Lucía, Luque, mochila..." aria-label="Buscar por nombre, ciudad o seña"></label>
          <label class="filter-field"><span>Estado</span><select id="feedStatus" class="form-control" data-on-change="filterFeedCases()" aria-label="Filtrar por estado">
            <option value="active">Búsqueda activa</option>
            <option value="localized24">Localizados (últimas 24 h)</option>
            <option value="all">Todos los publicados</option>
          </select></label>
          <label class="filter-field"><span>Ciudad / zona (departamento)</span><select id="feedCity" class="form-control" data-on-change="filterFeedCases()" aria-label="Filtrar por ciudad o departamento">
            <option value="">Todos</option>${cityOptions}
          </select></label>
          <label class="filter-field"><span>Edad</span><select id="feedAge" class="form-control" data-on-change="filterFeedCases()" aria-label="Filtrar por rango de edad">
            <option value="all">Todas</option>
            <option value="minor">Menores de 18</option>
            <option value="adult">Adultos (18–64)</option>
            <option value="senior">65 o más</option>
          </select></label>
          <label class="filter-field"><span>Sexo</span>
          <select id="feedSex" class="form-control" data-on-change="filterFeedCases()" aria-label="Filtrar por sexo">
            <option value="">Todos</option>
            <option value="Femenino">Femenino</option>
            <option value="Masculino">Masculino</option>
            <option value="Otro">Otro</option>
          </select></label>
        </div>
        <div class="results-toolbar">
          <p class="results-count" id="caseListCount" aria-live="polite">0 resultados</p>
          <button id="feedMapToggle" type="button" class="btn btn-outline btn-sm" aria-expanded="false" aria-controls="feedMapPanel" data-on-click="toggleFeedMap()">⌖ Mostrar mapa</button>
        </div>

      <div id="feedMapPanel" class="card home-map-card hidden">
        <div>
          <span>Mapa de desapariciones</span>
          <div>
            <button data-on-click="useMyLocationOnMap()" class="btn btn-outline btn-sm">Mi ubicación</button>
            <button data-on-click="centerMapOnParaguay()" class="btn btn-outline btn-sm">Centrar mapa</button>
          </div>
        </div>
        <div id="mainMap" class="map-container"></div>
        <div class="map-legend">
          Punto: lugar de desaparición. Círculo: zona de alerta de 60 km.
        </div>
      </div>

      <div id="feedCaseList" class="case-grid"></div>
      <div id="feedPagination"></div>
      <p id="feedEmptyState" class="feed-empty-state hidden">No hay reportes que coincidan con los filtros seleccionados.</p>
      </section>
    </div>
  `;
}

export const FEED_PAGE_SIZE = 12;

export function renderFeedPage() {
  const list = document.getElementById('feedCaseList');
  if (!list) return;
  const totalPages = Math.max(1, Math.ceil(estado.feedFilteredCases.length / FEED_PAGE_SIZE));
  if (estado.feedCurrentPage > totalPages) estado.feedCurrentPage = totalPages;
  if (estado.feedCurrentPage < 1) estado.feedCurrentPage = 1;

  const start = (estado.feedCurrentPage - 1) * FEED_PAGE_SIZE;
  const pageCases = estado.feedFilteredCases.slice(start, start + FEED_PAGE_SIZE);

  list.innerHTML = pageCases.map(c => renderCaseItemRow(c)).join('');
  renderCasePhotos(pageCases);

  const pagEl = document.getElementById('feedPagination');
  if (pagEl) {
    if (totalPages <= 1) {
      pagEl.classList.add('hidden');
      pagEl.innerHTML = '';
    } else {
      pagEl.classList.remove('hidden');
      const fromItem = estado.feedFilteredCases.length === 0 ? 0 : start + 1;
      const toItem = Math.min(start + FEED_PAGE_SIZE, estado.feedFilteredCases.length);
      pagEl.innerHTML = `
        <div class="history-pagination" role="navigation" aria-label="Paginación de reportes">
          <span>Mostrando ${escapeHtml(String(fromItem))}–${escapeHtml(String(toItem))} de ${escapeHtml(String(estado.feedFilteredCases.length))} reportes</span>
          <div>
            <button type="button" class="btn btn-outline btn-sm" data-on-click="changeFeedPage(${estado.feedCurrentPage - 1})" ${estado.feedCurrentPage <= 1 ? 'disabled' : ''} aria-label="Página anterior">« Anterior</button>
            <span class="pagination-current" aria-current="page">Página ${escapeHtml(String(estado.feedCurrentPage))} de ${escapeHtml(String(totalPages))}</span>
            <button type="button" class="btn btn-outline btn-sm" data-on-click="changeFeedPage(${estado.feedCurrentPage + 1})" ${estado.feedCurrentPage >= totalPages ? 'disabled' : ''} aria-label="Página siguiente">Siguiente »</button>
          </div>
        </div>
      `;
    }
  }
}

export function changeFeedPage(newPage) {
  const totalPages = Math.max(1, Math.ceil(estado.feedFilteredCases.length / FEED_PAGE_SIZE));
  if (newPage < 1 || newPage > totalPages || newPage === estado.feedCurrentPage) return;
  estado.feedCurrentPage = newPage;
  renderFeedPage();
  const listEl = document.getElementById('feedCaseList');
  if (listEl) {
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export function renderCaseItemRow(c) {
  const initials = c.nombreCompleto.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const isMinor = Number(c.edad) < 18;
  const statusLabel = c.estado === 'EN_SEGUIMIENTO'
    ? (Number(c.seguimientoEtapa) >= 2 ? 'En seguimiento · sin actualizar' : 'En seguimiento')
    : c.estado === 'VALIDADO' ? 'Búsqueda activa'
      : c.estado === 'LOCALIZADO' ? 'Localizada' : 'Cerrado';
  const statusTone = c.estado === 'VALIDADO' ? 'active'
    : c.estado === 'EN_SEGUIMIENTO' ? 'followup'
      : c.estado === 'LOCALIZADO' ? 'located' : 'closed';
  const reportedAt = new Date(c.fechaHoraDesaparicion).toLocaleString('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h12'
  });
  return `
    <article id="case-${escapeHtml(c.id)}" class="case-row card"
      role="button" tabindex="0"
      aria-label="Ver ficha de ${escapeHtml(c.nombreCompleto)}"
      data-on-click="openCaseDetail(this.dataset.caseId)"
      data-on-keydown="openCaseDetailWithKeyboard(event, this.dataset.caseId)"
      data-case-id="${escapeHtml(c.id)}"
      data-search="${escapeHtml([c.nombreCompleto, c.ciudad, c.departamento, c.descripcionFisica, c.vestimenta, c.senasParticulares].join(' '))}"
        data-city="${escapeHtml([c.ciudad, c.departamento].filter(Boolean).join(' · '))}"
      data-sex="${escapeHtml(c.sexo)}"
      data-age="${Number(c.edad)}"
      data-status="${escapeHtml(c.estado)}"
      data-located-at="${escapeHtml(c.localizadoEn || '')}">
      <div class="case-card-banner">
        <span class="case-status-pill status-tone-${statusTone}">${escapeHtml(statusLabel)}</span>
        ${isMinor ? '<span class="case-minor-pill">Menor</span>' : ''}
        <div id="case-photo-${escapeHtml(c.id)}" class="case-card-avatar no-photo-box" aria-label="Sin fotografía">${escapeHtml(initials)}</div>
      </div>
      <div class="case-card-body">
        <h3>${escapeHtml(c.nombreCompleto)}</h3>
        <p class="case-card-meta">${Number(c.edad)} años · ${escapeHtml(c.ciudad)}${c.departamento ? `, ${escapeHtml(c.departamento)}` : ''}</p>
        <p class="case-card-date">Desde <time datetime="${escapeHtml(c.fechaHoraDesaparicion)}">${escapeHtml(reportedAt)}</time></p>
        <span class="case-card-open">Ver ficha y aportar información <span aria-hidden="true">›</span></span>
      </div>
    </article>
  `;
}

export function filterFeedCases(resetPage = true) {
  if (resetPage) estado.feedCurrentPage = 1;
  const query = document.getElementById('feedSearch')?.value.trim().toLocaleLowerCase('es-PY') || '';
  const city = document.getElementById('feedCity')?.value.trim().toLocaleLowerCase('es-PY') || '';
  const age = document.getElementById('feedAge')?.value || 'all';
  const sex = document.getElementById('feedSex')?.value || '';
  const status = document.getElementById('feedStatus')?.value || 'all';

  estado.feedFilteredCases = getStore().casos.filter(c => {
    const searchCorpus = [c.nombreCompleto, c.ciudad, c.departamento, c.descripcionFisica, c.vestimenta, c.senasParticulares].filter(Boolean).join(' ').toLocaleLowerCase('es-PY');
    const cityCorpus = [c.ciudad, c.departamento].filter(Boolean).join(' · ').toLocaleLowerCase('es-PY');
    const matchesQuery = !query || searchCorpus.includes(query);
    const matchesCity = !city || cityCorpus.includes(city) || (cityCorpus.includes(' · ') && cityCorpus.split(' · ').at(-1).toLocaleLowerCase('es-PY') === city);
    const ageNum = Number(c.edad);
    const matchesAge = (age === 'all'
      || (age === 'minor' && ageNum < 18)
      || (age === 'adult' && ageNum >= 18 && ageNum < 65)
      || (age === 'senior' && ageNum >= 65));
    const matchesSex = !sex || c.sexo === sex;
    const matchesStatus = (status === 'all'
      || (status === 'active' && ['VALIDADO', 'EN_SEGUIMIENTO'].includes(c.estado))
      || (status === 'localized24' && c.estado === 'LOCALIZADO'
        && Number.isFinite(Date.parse(c.localizadoEn))
        && Date.parse(c.localizadoEn) <= Date.now()
        && Date.now() - Date.parse(c.localizadoEn) <= 24 * 60 * 60 * 1000));
    return matchesQuery && matchesCity && matchesAge && matchesSex && matchesStatus;
  });

  renderFeedPage();

  const countEl = document.getElementById('caseListCount');
  if (countEl) {
    countEl.textContent = `${estado.feedFilteredCases.length} ${estado.feedFilteredCases.length === 1 ? 'resultado' : 'resultados'}`;
  }
  const emptyEl = document.getElementById('feedEmptyState');
  if (emptyEl) {
    emptyEl.classList.toggle('hidden', estado.feedFilteredCases.length !== 0);
  }

  const matchingIds = new Set(estado.feedFilteredCases.map(c => c.id));
  estado.activeMarkers.forEach(({ marker, geofence, caseId }) => {
    if (matchingIds.has(caseId)) {
      marker.addTo(estado.activeMap);
      if (geofence) geofence.addTo(estado.activeMap);
    } else {
      marker.remove();
      if (geofence) geofence.remove();
    }
  });
}

export function setFeedView(view) {
  document.getElementById('feedMapPanel').classList.toggle('hidden', view === 'list');
  document.getElementById('feedCaseList').classList.toggle('hidden', view === 'map');
  if (view !== 'list' && estado.activeMap) setTimeout(() => estado.activeMap.invalidateSize(), 0);
}

export function toggleFeedMap() {
  const panel = document.getElementById('feedMapPanel');
  const toggle = document.getElementById('feedMapToggle');
  const isVisible = panel.classList.toggle('hidden') === false;
  toggle.setAttribute('aria-expanded', String(isVisible));
  toggle.innerHTML = isVisible ? '⌖ Ocultar mapa' : '⌖ Mostrar mapa';
  if (isVisible && estado.activeMap) requestAnimationFrame(() => estado.activeMap.invalidateSize());
}

export function openCaseDetail(caseId, options = {}) {
  const c = getStore().casos.find(item => item.id === caseId);
  if (!c) {
    showToast('Caso no disponible', 'La ficha ya no está disponible para consulta.', 'error');
    // El enlace apunta a una ficha que ya no existe. Se corrige siempre,
    // incluso si vino del historial: dejar la direccion de una ficha
    // inexistente haria que recargar vuelva a fallar.
    syncUrl('feed', {}, { replace: true });
    return;
  }
  const content = document.getElementById('caseDetailContent');
  const approvedClues = getStore().pistas.filter(pista => pista.casoId === c.id);
  const clueGallery = approvedClues.flatMap(pista => (pista.fotosUrl || []).map((url, index) =>
    `<img src="${escapeHtml(url)}" alt="Fotografía de pista ciudadana ${index + 1}" loading="lazy">`)).join('');
  content.innerHTML = `
    <h2 id="caseDetailTitle">${escapeHtml(c.nombreCompleto)}</h2>
    <p><span class="status-tag ${c.estado === 'EN_SEGUIMIENTO' && c.seguimientoEtapa >= 2 ? 'status-SIN_ACTUALIZAR' : `status-${escapeHtml(c.estado)}`}">${c.estado === 'EN_SEGUIMIENTO' && c.seguimientoEtapa >= 2 ? 'EN SEGUIMIENTO · SIN ACTUALIZAR' : escapeHtml(c.estado.replaceAll('_', ' '))}</span></p>
    <p><strong>Edad:</strong> ${Number(c.edad)} años · ${escapeHtml(c.sexo)}</p>
    <p><strong>Ciudad:</strong> ${c.barrio ? `${escapeHtml(c.barrio)}, ` : ''}${escapeHtml(c.ciudad)}${c.departamento ? `, ${escapeHtml(c.departamento)}` : ''}</p>
    <p><strong>Desaparición:</strong> ${new Date(c.fechaHoraDesaparicion).toLocaleString('es-PY')}</p>
    <p><strong>Descripción física:</strong> ${escapeHtml(c.descripcionFisica)}</p>
    <p><strong>Vestimenta:</strong> ${escapeHtml(c.vestimenta)}</p>
    <p><strong>Señas particulares:</strong> ${escapeHtml(c.senasParticulares || 'No registradas')}</p>
    <p><strong>Denuncia policial:</strong> ${escapeHtml(c.numeroDenuncia || 'En verificación por las autoridades')}</p>
    ${approvedClues.length ? `<section class="public-clues"><h3>Pistas ciudadanas validadas</h3>${approvedClues.map(pista => `<article><p>${escapeHtml(pista.descripcion)}</p><small>${escapeHtml(new Date(pista.fechaHoraAvistamiento || pista.fechaEnvio).toLocaleString('es-PY'))}</small></article>`).join('')}${clueGallery ? `<div class="public-clue-photos">${clueGallery}</div>` : ''}</section>` : ''}
    <div class="case-detail-actions">
      <a class="btn btn-outline btn-sm" href="tel:911">Llamar al 911</a>
      <button type="button" class="btn btn-outline btn-sm" data-on-click="shareCase('${escapeHtml(c.id)}')">Compartir ficha</button>
      ${c.estado !== 'LOCALIZADO' && c.estado !== 'CERRADO' && c.estado !== 'RECHAZADO' ? `<button type="button" class="btn btn-primary btn-sm" data-case-id="${escapeHtml(c.id)}" data-on-click="closeCaseDetail({silent:true}); navigateTo('lead', {caseId:this.dataset.caseId}, {replace:true})">Enviar pista</button>` : ''}
    </div>
    <p class="muted">El contacto del reportante se mantiene restringido y no se publica en esta ficha.</p>
  `;
  document.getElementById('caseDetailModal').classList.remove('hidden');
  document.getElementById('caseDetailModal').querySelector('button').focus();
  if (!options.fromHistory) syncUrl('feed', {}, { caseId: c.id });
}

// silent: cerrar sin tocar el historial, para cuando justo despues se
// navega a otra vista y esa navegacion es la que manda en la direccion.
// Las filas de caso son role="button": Enter o espacio abren la ficha.
export function openCaseDetailWithKeyboard(event, caseId) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openCaseDetail(caseId);
}

export function closeCaseDetail(options = {}) {
  const modal = document.getElementById('caseDetailModal');
  const wasOpen = !modal.classList.contains('hidden');
  modal.classList.add('hidden');
  if (wasOpen && !options.fromHistory && !options.silent) {
    syncUrl(window.rastreoCurrentView || 'feed', window.rastreoCurrentParams || {}, { replace: true });
  }
}

export async function shareCase(caseId) {
  const c = getStore().casos.find(item => item.id === caseId);
  if (!c) return;
  const shareData = {
    title: `Rastreo PY: ${c.nombreCompleto}`,
    text: `Caso de búsqueda en ${c.ciudad}.`,
    url: `${location.origin}${location.pathname}${buildRoute('case', { caseId: c.id })}`
  };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${shareData.title} - ${shareData.text} ${shareData.url}`);
      showToast('Ficha copiada', 'El enlace de la plataforma quedó copiado.', 'success');
    } else {
      showToast('Compartir no disponible', 'Este navegador no permite compartir ni copiar enlaces.', 'error');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('No se pudo compartir', error.message, 'error');
  }
}

export function renderCasePhotos(cases) {
  cases.forEach(caseItem => {
    const photo = caseItem.foto || caseItem.fotoUrl;
    const placeholder = document.getElementById(`case-photo-${caseItem.id}`);
    if (!photo || !placeholder) return;

    const image = document.createElement('img');
    image.src = photo;
    image.alt = `Fotografía de ${caseItem.nombreCompleto}`;
    image.className = 'case-photo-image';
    image.addEventListener('error', () => replaceWithMissingPhoto(image, caseItem.nombreCompleto), { once: true });
    placeholder.replaceWith(image);
  });
}

export function replaceWithMissingPhoto(image, name = '') {
  const placeholder = document.createElement('div');
  placeholder.className = 'no-photo-box';
  placeholder.textContent = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  placeholder.setAttribute('aria-label', 'Sin fotografía');
  image.replaceWith(placeholder);
}
