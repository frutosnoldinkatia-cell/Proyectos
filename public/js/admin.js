// Panel de administración: bandeja, casos, pistas, auditoría, historial y simulador.
import { apiRequest } from './api.js';
import { escapeHtml } from './config.js';
import { statusLabel, timeSince } from './my-cases.js';
import { navigateTo, syncUrl } from './router.js';
import { getStore } from './store.js';
import { labelButtons, showToast } from './ui.js';

export function renderAdminView(history, clues = [], audit = []) {
  const store = getStore();
  const pending = store.casos.filter(c => c.estado === 'PENDIENTE');
  const staleCases = store.casos.filter(c =>
    c.estado !== 'CERRADO' &&
    c.estado !== 'LOCALIZADO' &&
    c.estado !== 'RECHAZADO' &&
    ((c.estado === 'EN_SEGUIMIENTO' && c.seguimientoEtapa >= 2)
      || (c.proximoSeguimiento && new Date(c.proximoSeguimiento).getTime() < Date.now()))
  );
  const pendingClues = clues.filter(clue => clue.estado === 'PENDIENTE');
  const activeCases = store.casos.filter(c => ['VALIDADO', 'EN_SEGUIMIENTO'].includes(c.estado));
  const needsAction = [...pending, ...staleCases].slice(0, 6);

  return `
    <section class="admin-dashboard">
      <div class="admin-dashboard-heading">
        <div><span class="section-kicker">Gestión institucional</span><h1>Panel de administración</h1></div>
      </div>

      <nav class="admin-tabs" aria-label="Secciones del administrador">
        <button class="admin-tab active" data-admin-tab="overview" onclick="selectAdminTab('overview', this)">Resumen</button>
        <button class="admin-tab" data-admin-tab="validation" onclick="selectAdminTab('validation', this)">Bandeja de validación ${pending.length ? `<span class="tab-count">${pending.length}</span>` : ''}</button>
        <button class="admin-tab" data-admin-tab="cases" onclick="selectAdminTab('cases', this)">Casos</button>
        <button class="admin-tab" data-admin-tab="followup" onclick="selectAdminTab('followup', this)">Seguimiento ${staleCases.length ? `<span class="tab-count">${staleCases.length}</span>` : ''}</button>
        <button class="admin-tab" data-admin-tab="clues" onclick="selectAdminTab('clues', this)">Pistas ${pendingClues.length ? `<span class="tab-count">${pendingClues.length}</span>` : ''}</button>
        <button class="admin-tab" data-admin-tab="audit" onclick="selectAdminTab('audit', this)">Auditoría</button>
        <button class="admin-tab" data-admin-tab="history" onclick="selectAdminTab('history', this)">Historial</button>
      </nav>

      <section class="admin-tab-panel admin-overview-panel" data-admin-panel="overview">
        <div class="admin-metric-grid">
          <article class="card"><span>Por validar</span><strong>${pending.length}</strong></article>
          <article class="card"><span>En seguimiento</span><strong>${store.casos.filter(c => c.estado === 'EN_SEGUIMIENTO').length}</strong></article>
          <article class="card"><span>Pistas nuevas</span><strong>${pendingClues.length}</strong></article>
          <article class="card"><span>Búsquedas activas</span><strong>${activeCases.length}</strong></article>
        </div>
        <section class="card priority-actions">
          <div class="admin-section-heading"><div><span class="section-kicker">Cola prioritaria</span><h2>Requieren acción</h2></div><span>${needsAction.length} pendientes</span></div>
          ${needsAction.length ? `<div class="priority-case-list">${needsAction.map(c => {
            const isPending = c.estado === 'PENDIENTE';
            const tag = isPending ? 'En revisión'
              : c.estado === 'EN_SEGUIMIENTO' ? 'En seguimiento' : 'Búsqueda activa';
            const validation = isPending ? 'Sin validar' : 'Seguimiento vencido';
            return `<article class="priority-case-row"><div><strong>${escapeHtml(c.nombreCompleto)}</strong>
              <span>${escapeHtml(c.ciudad)} · ${escapeHtml(tag)} · ${escapeHtml(validation)}</span></div>
              <button type="button" class="btn btn-outline btn-sm" data-case-id="${escapeHtml(c.id)}" onclick="adminOpenCase(this.dataset.caseId, '${isPending ? 'validation' : 'followup'}')">Abrir</button></article>`;
          }).join('')}</div>` : '<div class="empty-state"><h3>Todo al día</h3><p>No hay casos que requieran atención inmediata.</p></div>'}
        </section>
      </section>

      <section class="admin-tab-panel card hidden" data-admin-panel="validation">
        <h2>Bandeja de validación</h2>
        <p class="workflow-guidance"><strong>Flujo seguro:</strong> 1. Validar con la lista de control → 2. Aprobar y publicar. También podés rechazar con motivo; los cambios quedan registrados.</p>
        ${pending.length ? `<div class="table-scroll"><table><thead><tr><th>Caso</th><th>Estado</th><th>Validación</th><th>Reportado</th><th>Acciones</th></tr></thead><tbody>
          ${pending.map(c => `<tr>
            <td data-label="Caso"><strong>${escapeHtml(c.nombreCompleto)}</strong><br><span class="muted">${escapeHtml(c.ciudad)}, ${Number(c.edad)} años</span></td>
            <td data-label="Estado"><span class="status-tag status-PENDIENTE">En revisión</span></td>
            <td data-label="Validación"><span class="validation-state">Sin validar</span></td>
            <td data-label="Reportado">${timeSince(c.fechaCreacion)}</td>
            <td data-label="Acciones"><div class="table-actions">
              <button type="button" data-case-id="${escapeHtml(c.id)}" onclick="adminAccept(this.dataset.caseId)" class="btn btn-outline btn-sm">Abrir</button>
              <button type="button" data-case-id="${escapeHtml(c.id)}" onclick="adminAccept(this.dataset.caseId)" class="btn btn-primary btn-sm">Validar y publicar</button>
              <button type="button" data-case-id="${escapeHtml(c.id)}" onclick="adminReject(this.dataset.caseId)" class="btn btn-danger btn-sm">Rechazar</button>
            </div></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state"><h3>Sin pendientes</h3><p>No hay reportes pendientes de revisión en este momento.</p></div>'}
      </section>

      <section class="admin-tab-panel card hidden" data-admin-panel="cases">
        <h2>Gestión de casos</h2>
        ${store.casos.length ? `<div class="table-scroll"><table><thead><tr><th>Persona</th><th>Ciudad</th><th>Denuncia</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
          ${store.casos.map(c => `<tr id="admin-case-${escapeHtml(c.id)}">
            <td data-label="Persona">${escapeHtml(c.nombreCompleto)}</td>
            <td data-label="Ciudad">${escapeHtml(c.ciudad)}</td>
            <td data-label="Denuncia">${escapeHtml(c.numeroDenuncia || 'Sin registrar')}</td>
            <td data-label="Estado"><span class="status-tag status-${escapeHtml(c.estado)}">${escapeHtml(statusLabel(c.estado))}</span></td>
            <td data-label="Acciones"><div class="table-actions">
              ${!['CERRADO', 'LOCALIZADO', 'RECHAZADO'].includes(c.estado) ? `<button type="button" data-case-id="${escapeHtml(c.id)}" onclick="adminMarkLocated(this.dataset.caseId)" class="btn btn-primary btn-sm">Marcar localizado</button><button type="button" data-case-id="${escapeHtml(c.id)}" onclick="adminCloseCase(this.dataset.caseId)" class="btn btn-outline btn-sm">Cerrar caso</button>` : ''}
              ${c.estado !== 'PENDIENTE' ? `<button type="button" data-case-id="${escapeHtml(c.id)}" onclick="adminReturnToReview(this.dataset.caseId)" class="btn btn-outline btn-sm">${['CERRADO', 'LOCALIZADO', 'RECHAZADO'].includes(c.estado) ? 'Reabrir en revisión' : 'Devolver a revisión'}</button>` : ''}
              ${['CERRADO', 'LOCALIZADO', 'RECHAZADO'].includes(c.estado) && c.estado !== 'RECHAZADO' ? `<button type="button" data-case-id="${escapeHtml(c.id)}" onclick="adminReopenCase(this.dataset.caseId)" class="btn btn-outline btn-sm">Reabrir búsqueda</button>` : ''}
            </div></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state"><h3>Sin casos</h3><p>No hay casos para administrar.</p></div>'}
      </section>

      <section class="admin-tab-panel card hidden" data-admin-panel="history" aria-labelledby="locatedHistoryHeading">
        <h2 id="locatedHistoryHeading">Historial de casos localizados</h2>
        <form onsubmit="searchAdminHistory(event)" class="grid-3">
          <input id="historySearch" type="search" class="form-control" placeholder="Nombre o ciudad" aria-label="Buscar por nombre o ciudad">
          <input id="historyFrom" type="date" class="form-control" aria-label="Desde">
          <input id="historyTo" type="date" class="form-control" aria-label="Hasta">
          <button type="submit" class="btn btn-outline btn-sm">Buscar historial</button>
        </form>
        <div id="adminHistoryResults">${renderAdminHistory(history)}</div>
      </section>

      <section class="admin-tab-panel card hidden" data-admin-panel="followup">
        <h2>Seguimiento pendiente</h2>
        ${staleCases.length ? `<div class="table-scroll"><table><thead><tr><th>Persona</th><th>Ciudad</th><th>Seguimiento previsto</th><th>Estado</th></tr></thead><tbody>
          ${staleCases.map(c => `<tr id="followup-case-${escapeHtml(c.id)}">
            <td data-label="Persona">${escapeHtml(c.nombreCompleto)}</td>
            <td data-label="Ciudad">${escapeHtml(c.ciudad)}</td>
            <td data-label="Seguimiento previsto">${new Date(c.proximoSeguimiento).toLocaleString()}</td>
            <td data-label="Estado">${c.seguimientoEtapa >= 2 ? 'EN SEGUIMIENTO · SIN ACTUALIZAR' : escapeHtml(c.estado)}</td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state"><h3>Sin casos pendientes de actualización</h3><p>No hay casos que requieran seguimiento vencido.</p></div>'}
      </section>

      <section class="admin-tab-panel card hidden" data-admin-panel="audit">
        <h2>Auditoría de acciones</h2>
        ${audit.length ? `<div class="table-scroll"><table><thead><tr><th>Fecha</th><th>Registro</th><th>Acción</th><th>Responsable</th><th>Motivo</th></tr></thead><tbody>
          ${audit.map(event => `<tr>
            <td data-label="Fecha">${new Date(event.fecha).toLocaleString('es-PY')}</td>
            <td data-label="Registro">${escapeHtml(event.persona)} · ${escapeHtml(event.tipoRegistro)}</td>
            <td data-label="Acción">${escapeHtml(event.estadoAnterior || 'Nuevo')} → ${escapeHtml(event.estadoNuevo)}</td>
            <td data-label="Responsable">${escapeHtml(event.administrador || 'Sistema')}</td>
            <td data-label="Motivo">${escapeHtml(event.motivo || '—')}</td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state"><h3>Sin actividad registrada</h3><p>Las acciones de moderación aparecerán aquí.</p></div>'}
      </section>

      <section class="admin-tab-panel card hidden" data-admin-panel="clues">
        <h2>Moderación de pistas ciudadanas</h2>
        ${clues.length ? `<div class="table-scroll"><table><thead><tr><th>Persona</th><th>Avistamiento y ubicación</th><th>Fotografías</th><th>Estado y acciones</th></tr></thead><tbody>
          ${clues.map(clue => `<tr>
            <td data-label="Persona">${escapeHtml(clue.nombreCompleto)}</td>
            <td data-label="Avistamiento y ubicación">
              <p>${escapeHtml(clue.descripcion)}</p>
              <p>${new Date(clue.fechaHoraAvistamiento).toLocaleString('es-PY')}</p>
              <p>${Number(clue.ubicacion?.lat)}, ${Number(clue.ubicacion?.lng)} · ${escapeHtml(clue.ubicacion?.direccion || '')}</p>
              <p class="muted">Enviada por: ${clue.autor ? `${escapeHtml(clue.autor.nombre)} · ${escapeHtml(clue.autor.correo)}` : 'sin cuenta (pista anterior al registro obligatorio)'}</p>
            </td>
            <td data-label="Fotografías"><div class="moderation-photos">
              ${(clue.fotosUrl || []).map((url, index) => `<img class="history-photo" src="data:," data-photo-url="${escapeHtml(url)}" alt="Fotografía ${index + 1} de la pista" data-admin-photo>`).join('') || 'Sin fotografías'}
            </div></td>
            <td data-label="Estado y acciones">
              <span class="status-tag status-${escapeHtml(clue.estado)}">${escapeHtml(clue.estado)}</span>
              ${(clue.cambiosEstado || []).map(change => `<p class="muted">${escapeHtml(change.estadoAnterior || 'Nueva')} → ${escapeHtml(change.estadoNuevo)} · ${escapeHtml(change.administrador || 'Administrador')} · ${new Date(change.cambiadoEn).toLocaleString('es-PY')}${change.motivo ? ` · ${escapeHtml(change.motivo)}` : ''}</p>`).join('')}
              ${clue.estado === 'PENDIENTE' ? `<div class="table-actions">
                <button type="button" data-clue-id="${escapeHtml(clue.id)}" onclick="adminModerateClue(this.dataset.clueId, 'VALIDADA')" class="btn btn-success btn-sm">Aprobar pista</button>
                <button type="button" data-clue-id="${escapeHtml(clue.id)}" onclick="adminModerateClue(this.dataset.clueId, 'RECHAZADA')" class="btn btn-danger btn-sm">Rechazar pista</button>
              </div>` : ''}
            </td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state"><h3>Sin pistas</h3><p>Aún no hay pistas ciudadanas para moderar.</p></div>'}
      </section>
    </section>
  `;
}

export function adminOpenCase(caseId, panel) {
  if (panel === 'validation') {
    adminAccept(caseId);
    return;
  }
  const tab = Array.from(document.querySelectorAll('.admin-tab'))
    .find(item => item.getAttribute('onclick')?.includes("'followup'"));
  selectAdminTab('followup', tab);
  document.getElementById(`followup-case-${caseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function selectAdminTab(panel, button, options = {}) {
  const targetPanel = document.querySelector(`[data-admin-panel="${CSS.escape(panel)}"]`) ? panel : 'overview';
  const activeTab = button || document.querySelector(`.admin-tab[data-admin-tab="${CSS.escape(targetPanel)}"]`);
  document.querySelectorAll('[data-admin-panel]').forEach(section => {
    section.classList.toggle('hidden', section.dataset.adminPanel !== targetPanel);
  });
  document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.toggle('active', tab === activeTab));
  window.rastreoCurrentParams = { ...(window.rastreoCurrentParams || {}), tab: targetPanel };
  if (!options.silent) syncUrl('admin', { tab: targetPanel }, { replace: true });
  if (['clues', 'history'].includes(targetPanel)) {
    const main = document.getElementById('mainContent');
    if (main) loadAdminHistoryPhotos(main);
  }
}

export function renderAdminHistory(history) {
  if (!history?.casos?.length) {
    return '<p>No hay casos localizados en este historial.</p>';
  }
  return `<div class="table-scroll"><table class="history-table">
    <thead><tr><th>Persona</th><th>Localización</th><th>Detalle del caso</th><th>Pistas</th><th>Cambios de estado</th></tr></thead>
    <tbody>${history.casos.map(c => `
      <tr>
        <td data-label="Persona">
          ${c.fotoUrl ? `<img class="history-photo" src="data:," data-photo-url="${escapeHtml(c.fotoUrl)}" alt="Fotografía de ${escapeHtml(c.nombreCompleto)}" data-admin-photo>` : ''}
          <strong>${escapeHtml(c.nombreCompleto)}</strong>
          <p>${escapeHtml(c.ciudad)}, ${Number(c.edad)} años, ${escapeHtml(c.sexo)}</p>
        </td>
        <td data-label="Localización">${c.localizadoEn ? new Date(c.localizadoEn).toLocaleString() : 'Sin fecha'}</td>
        <td data-label="Detalle del caso">
          <p>Desaparición: ${new Date(c.fechaHoraDesaparicion).toLocaleString()}, estado: ${escapeHtml(c.estado)}</p>
          <p>Denuncia: ${escapeHtml(c.numeroDenuncia || 'Sin registrar')}</p>
          <p>Contacto del reportante: ${escapeHtml(c.contactoReportante || 'No disponible')}</p>
          <p>Descripción: ${escapeHtml(c.descripcionFisica)}</p>
          <p>Vestimenta: ${escapeHtml(c.vestimenta)}</p>
          <p>Señas particulares: ${escapeHtml(c.senasParticulares || 'No registradas')}</p>
          <p>Ubicación: ${escapeHtml(c.ubicacion?.direccion || c.ciudad)} (${Number(c.ubicacion?.lat)}, ${Number(c.ubicacion?.lng)})</p>
        </td>
        <td data-label="Pistas">
          ${(c.pistas || []).map(p => `<p>${escapeHtml(p.descripcion)}, ${new Date(p.fechaHoraAvistamiento).toLocaleString()}, ${escapeHtml(p.nombreUsuario || p.correoUsuario || 'Usuario no disponible')}, ${Number(p.ubicacion?.lat)}, ${Number(p.ubicacion?.lng)}</p>`).join('') || '<p>Sin pistas registradas.</p>'}
        </td>
        <td data-label="Cambios de estado">
          ${(c.cambiosEstado || []).map(change => `<p>${escapeHtml(change.estadoAnterior || 'Nuevo')} a ${escapeHtml(change.estadoNuevo)}, ${escapeHtml(change.nombreAdministrador || 'Sistema')}, ${new Date(change.cambiadoEn).toLocaleString()}</p>`).join('') || '<p>Sin historial de cambios.</p>'}
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div>
  <div class="history-pagination">
    <span>Página ${history.pagina}, ${history.total} casos</span>
    <div>
      <button class="btn btn-outline btn-sm" onclick="loadAdminHistory(${history.pagina - 1})" ${history.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
      <button class="btn btn-outline btn-sm" onclick="loadAdminHistory(${history.pagina + 1})" ${history.pagina * history.limite >= history.total ? 'disabled' : ''}>Siguiente</button>
    </div>
  </div>`;
}

export async function loadAdminHistory(page) {
  const query = new URLSearchParams({
    page: String(Math.max(1, page)),
    q: document.getElementById('historySearch')?.value.trim() || '',
    desde: document.getElementById('historyFrom')?.value || '',
    hasta: document.getElementById('historyTo')?.value || ''
  });
  try {
    const history = await apiRequest(`/admin/historial-localizados?${query}`);
    const container = document.getElementById('adminHistoryResults');
    if (container) {
      container.innerHTML = renderAdminHistory(history);
      loadAdminHistoryPhotos(container);
      labelButtons(container);
    }
  } catch (error) {
    showToast('Error al cargar el historial', error.message);
  }
}

export function searchAdminHistory(event) {
  event.preventDefault();
  loadAdminHistory(1);
}

export async function loadAdminHistoryPhotos(container) {
  const images = container.querySelectorAll('img[data-admin-photo]:not([data-admin-loaded])');
  await Promise.all(Array.from(images, async image => {
    const photoUrl = image.dataset.photoUrl;
    if (!photoUrl) return;
    image.dataset.adminLoaded = 'true';
    try {
      const response = await fetch(photoUrl, {
        headers: { Authorization: ['Be', 'arer'].join('') + ' ' + sessionStorage.getItem('rastreo_token') }
      });
      if (!response.ok) throw new Error(`No se pudo obtener la fotografía (${response.status}).`);
      const photo = URL.createObjectURL(await response.blob());
      image.src = photo;
      image.addEventListener('load', () => URL.revokeObjectURL(photo), { once: true });
    } catch (error) {
      console.error('No se pudo cargar una fotografía protegida:', error.message);
      image.remove();
    }
  }));
}

export function adminAccept(caseId) {
  const form = document.getElementById('reviewChecklistForm');
  const selectedCase = getStore().casos.find(item => item.id === caseId);
  const detail = document.getElementById('reviewCaseDetails');
  detail.innerHTML = selectedCase ? `
    <strong>${escapeHtml(selectedCase.nombreCompleto)}</strong>
    <span>${Number(selectedCase.edad)} años · ${escapeHtml(selectedCase.ciudad)}, ${escapeHtml(selectedCase.departamento || '')}</span>
    <span>Denuncia registrada: ${escapeHtml(selectedCase.numeroDenuncia || 'Sin registrar')}</span>
    <span>Contacto reportante: ${escapeHtml(selectedCase.contactoReportante || 'No disponible')}</span>
    <span>Descripción: ${escapeHtml(selectedCase.descripcionFisica || 'Sin descripción')}</span>
    <span>Vestimenta: ${escapeHtml(selectedCase.vestimenta || 'Sin especificar')}</span>
    <span>Autorización parental: ${selectedCase.autorizacionParental ? 'Registrada' : 'No registrada / no aplica'}</span>
  ` : '<span>No se pudo cargar el detalle del caso. Actualizá el panel e intentá otra vez.</span>';
  form.reset();
  form.dataset.caseId = caseId;
  document.getElementById('reviewChecklistModal').classList.remove('hidden');
  document.getElementById('reviewDenuncia').focus();
}

export function closeReviewChecklist() {
  document.getElementById('reviewChecklistModal').classList.add('hidden');
}

export async function submitCaseReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const caseId = form.dataset.caseId;
  try {
    await apiRequest(`/admin/casos/${encodeURIComponent(caseId)}/estado`, {
      method: 'POST',
      body: {
        estado: 'VALIDADO',
        numeroDenuncia: data.get('numeroDenuncia'),
        verificoDenuncia: data.has('verificoDenuncia'),
        datosCoherentes: data.has('datosCoherentes'),
        duplicadosVerificados: data.has('duplicadosVerificados'),
        menorValidado: data.has('menorValidado')
      }
    });
    closeReviewChecklist();
    showToast('Listo', 'Caso validado y publicado en el mapa.', 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo validar el caso', error.message);
  }
}

export async function adminReject(caseId) {
  const motivo = prompt('Ingrese el motivo obligatorio del rechazo del caso:');
  if (!motivo) return;
  try {
    await apiRequest(`/admin/casos/${encodeURIComponent(caseId)}/estado`, {
      method: 'POST', body: { estado: 'RECHAZADO', motivo }
    });
    showToast('Listo', 'Reporte rechazado.', 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo rechazar el caso', error.message);
  }
}

export async function adminMarkLocated(caseId) {
  if (!confirm('¿Confirmar que la persona ha sido localizada? La ficha permanecerá visible hasta 24 horas y luego se retirará del acceso público.')) return;
  try {
    await apiRequest(`/admin/casos/${encodeURIComponent(caseId)}/estado`, {
      method: 'POST', body: { estado: 'LOCALIZADO' }
    });
    showToast('Listo', 'Caso marcado como localizado. Se notificará a las personas suscritas.', 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo actualizar el caso', error.message);
  }
}

export async function adminCloseCase(caseId) {
  const motivo = prompt('Indique la justificación para cerrar este caso:');
  if (!motivo?.trim()) return;
  try {
    await apiRequest(`/admin/casos/${encodeURIComponent(caseId)}/estado`, {
      method: 'POST', body: { estado: 'CERRADO', motivo: motivo.trim() }
    });
    showToast('Caso cerrado', 'Se registró la justificación de cierre.', 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo cerrar el caso', error.message);
  }
}

export async function adminReturnToReview(caseId) {
  const motivo = prompt('Indique qué debe corregirse antes de volver a validar el caso:');
  if (!motivo?.trim()) return;
  try {
    await apiRequest(`/admin/casos/${encodeURIComponent(caseId)}/estado`, {
      method: 'POST', body: { estado: 'PENDIENTE', motivo: motivo.trim() }
    });
    showToast('Caso devuelto a revisión', 'Se notificó al ciudadano el motivo de la corrección.', 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo devolver el caso', error.message);
  }
}

export async function adminReopenCase(caseId) {
  try {
    await apiRequest(`/admin/casos/${encodeURIComponent(caseId)}/estado`, {
      method: 'POST', body: { estado: 'EN_SEGUIMIENTO' }
    });
    showToast('Búsqueda reabierta', 'El caso volvió al seguimiento activo.', 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo reabrir la búsqueda', error.message);
  }
}

export async function adminModerateClue(clueId, state) {
  const motivo = state === 'RECHAZADA' ? prompt('Indique el motivo para rechazar esta pista:') : '';
  if (state === 'RECHAZADA' && !motivo?.trim()) return;
  try {
    await apiRequest(`/admin/pistas/${encodeURIComponent(clueId)}/estado`, {
      method: 'POST',
      body: { estado: state, motivo: motivo?.trim() || '' }
    });
    showToast('Moderación registrada', state === 'VALIDADA' ? 'La pista ya puede mostrarse públicamente.' : 'La pista quedó fuera de publicación.', 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo moderar la pista', error.message, 'error');
  }
}

export async function runTimeFastForward() {
  if (getStore().currentUser?.rol !== 'administrador') {
    showToast('Acceso restringido', 'Solo un administrador puede ejecutar la simulación.', 'error');
    return;
  }
  if (!confirm('Esta simulación fuerza el seguimiento de todos los casos activos y puede generar avisos y cambios de estado. ¿Continuar?')) return;
  try {
    const result = await apiRequest('/admin/simulador/avanzar-48h', { method: 'POST' });
    document.getElementById('simTimeModal').classList.add('hidden');
    showToast('Simulación completada', `${result.consultasEnviadas} consultas enviadas; ${result.casosEnSeguimiento} casos pasaron a seguimiento.`, 'success');
    navigateTo('admin');
  } catch (error) {
    showToast('No se pudo simular el avance', error.message, 'error');
  }
}
