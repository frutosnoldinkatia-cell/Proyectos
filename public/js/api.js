import { API_BASE } from './config.js';

export async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = sessionStorage.getItem('rastreo_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    const requestError = new Error('No se pudo conectar con el servidor. Compruebe que esté disponible e intente nuevamente.');
    requestError.cause = error;
    throw requestError;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(payload.error || `Error del servidor (${response.status}).`);
    requestError.status = response.status;
    requestError.endpoint = `${API_BASE}${path}`;
    throw requestError;
  }
  return payload;
}
