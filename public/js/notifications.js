// Alertas: centro de notificaciones, avisos del dispositivo y polling.
import { apiRequest } from './api.js';
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { buildRoute, navigateTo } from './router.js';
import { getStore, saveStore } from './store.js';
import { NOTICE_TONES, formatRelativeTime, showToast } from './ui.js';

// AUXILIARES Y NOTIFICACIONES
export function toggleNotificationsModal() {
  if (!getStore().currentUser) {
    navigateTo('alerts');
    return;
  }
  const modal = document.getElementById('notifModal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) renderNotifList();
}

export function renderNoticeItem(notice, actionsHtml = '') {
  const tone = NOTICE_TONES[notice.tipo] || 'info';
  return `<article class="notif-item notif-${tone}${notice.leida ? '' : ' notif-unread'}">
    <span class="notif-dot" aria-hidden="true"></span>
    <div class="notif-body">
      <div class="notif-head">
        <strong>${escapeHtml(notice.titulo)}</strong>
        <time datetime="${escapeHtml(notice.fecha)}" title="${escapeHtml(new Date(notice.fecha).toLocaleString('es-PY'))}">${escapeHtml(formatRelativeTime(notice.fecha))}</time>
      </div>
      <p>${escapeHtml(notice.mensaje)}</p>
      ${actionsHtml}
    </div>
  </article>`;
}

export async function renderNotifList() {
  const store = getStore();
  const container = document.getElementById('notifList');
  try {
    const result = await apiRequest('/notificaciones');
    store.notificaciones = Array.isArray(result.notificaciones) ? result.notificaciones : [];
    saveStore(store);
  } catch (error) {
    console.error('No se pudieron cargar las notificaciones:', error.message);
  }
  if (!Array.isArray(store.notificaciones)) store.notificaciones = [];
  if (store.notificaciones.length === 0) {
    container.innerHTML = '<div class="notif-empty"><strong>Todo al día</strong><p>No tenés notificaciones por ahora.</p></div>';
    return;
  }
  container.innerHTML = store.notificaciones.map(n => renderNoticeItem(n,
      ['SEGUIMIENTO', 'SEGUIMIENTO_VENCIDO'].includes(n.tipo) && n.casoId ? `
        <div class="table-actions">
          <button type="button" class="btn btn-outline btn-sm" data-case-id="${escapeHtml(n.casoId)}" data-on-click="respondToCaseFollowup(this.dataset.caseId, 'SIGUE_ACTIVA')">Sigue activa</button>
          <button type="button" class="btn btn-success btn-sm" data-case-id="${escapeHtml(n.casoId)}" data-on-click="respondToCaseFollowup(this.dataset.caseId, 'LOCALIZADO')">Persona localizada</button>
          <button type="button" class="btn btn-outline btn-sm" data-case-id="${escapeHtml(n.casoId)}" data-on-click="respondToCaseFollowup(this.dataset.caseId, 'PRORROGA')">Solicitar prórroga</button>
          <button type="button" class="btn btn-outline btn-sm" data-case-id="${escapeHtml(n.casoId)}" data-on-click="respondToCaseFollowup(this.dataset.caseId, 'CERRAR')">Cerrar caso</button>
        </div>` : '')).join('');
}

export async function respondToCaseFollowup(caseId, action) {
  if (action === 'LOCALIZADO' && !confirm('¿Confirma que la persona fue localizada?')) return;
  const motivo = action === 'CERRAR' ? prompt('Indique el motivo para cerrar el caso:') : '';
  if (action === 'CERRAR' && !motivo?.trim()) return;
  try {
    await apiRequest(`/casos/${encodeURIComponent(caseId)}/seguimiento`, {
      method: 'POST',
      body: { accion: action, motivo: motivo?.trim() || '' }
    });
    document.getElementById('notifModal').classList.add('hidden');
    showToast('Respuesta registrada', 'Se actualizó el seguimiento del caso.', 'success');
    navigateTo('home');
  } catch (error) {
    showToast('No se pudo actualizar el seguimiento', error.message, 'error');
  }
}

export async function updateNotifBadge() {
  const store = getStore();
  const badge = document.getElementById('notifBadge');
  try {
    const result = await apiRequest('/notificaciones');
    store.notificaciones = Array.isArray(result.notificaciones) ? result.notificaciones : [];
    saveStore(store);
    try {
      await deliverSystemNotifications(store.notificaciones);
    } catch (error) {
      console.error('No se pudo mostrar una notificación del sistema:', error.message);
    }
  } catch (error) {
    console.error('No se pudo actualizar el contador de notificaciones:', error.message);
  }
  const unread = (Array.isArray(store.notificaciones) ? store.notificaciones : []).filter(n => !n.leida).length;
  [badge, document.getElementById('headerNotifBadge')].forEach(item => {
    if (unread > 0) {
      item.innerText = unread;
      item.classList.remove('hidden');
    } else item.classList.add('hidden');
  });
}

export function startNotificationPolling() {
  if (estado.notificationRefreshTimer) return;
  estado.notificationRefreshTimer = window.setInterval(() => {
    if (window.backendCurrentUser && !document.hidden) updateNotifBadge();
  }, 15_000);
}

export async function enableSystemNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    showToast('Avisos no disponibles', 'Este navegador no admite notificaciones del sistema.', 'error');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Permiso no concedido', 'Puede habilitar las notificaciones desde la configuración del navegador.', 'error');
      return;
    }
    const userId = window.backendCurrentUser?.id;
    if (userId) {
      const result = await apiRequest('/notificaciones');
      const latestId = Math.max(0, ...result.notificaciones.map(item => Number(item.id) || 0));
      localStorage.setItem(`rastreo_notif_last_${userId}`, String(latestId));
    }
    showToast('Avisos activados', 'Recibirá avisos del sistema mientras Rastreo PY esté activo.', 'success');
  } catch (error) {
    showToast('No se pudieron activar los avisos', error.message, 'error');
  }
}

export async function deliverSystemNotifications(notifications) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  const userId = window.backendCurrentUser?.id;
  if (!userId) return;
  const key = `rastreo_notif_last_${userId}`;
  const savedId = localStorage.getItem(key);
  const unread = notifications
    .filter(item => !item.leida && Number.isFinite(Number(item.id)))
    .sort((left, right) => Number(left.id) - Number(right.id));
  if (savedId === null) {
    const latestId = Math.max(0, ...notifications.map(item => Number(item.id) || 0));
    localStorage.setItem(key, String(latestId));
    return;
  }
  const lastId = Number(savedId) || 0;
  const fresh = unread.filter(item => Number(item.id) > lastId).slice(-3);
  if (!fresh.length) return;
  const registration = await navigator.serviceWorker.ready;
  for (const item of fresh) {
    await registration.showNotification('Rastreo PY', {
      body: 'Tiene una nueva actualización en sus notificaciones.',
      icon: '/icons/rastreopy.svg',
      tag: `rastreo-${item.id}`,
      data: {
        url: item.casoId
          ? `${location.origin}${location.pathname}${buildRoute('case', { caseId: item.casoId })}`
          : location.href
      }
    });
  }
  localStorage.setItem(key, String(Math.max(lastId, ...fresh.map(item => Number(item.id)))));
}

export async function clearNotifs() {
  try {
    await apiRequest('/notificaciones/leidas', { method: 'POST' });
    await updateNotifBadge();
    await renderNotifList();
    toggleNotificationsModal();
  } catch (error) {
    showToast('No se pudieron actualizar las notificaciones', error.message);
  }
}
