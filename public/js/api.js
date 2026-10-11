import { API_BASE } from './config.js';

// Las fotos de casos y pistas exigen sesión, pero un <img src> no manda el token:
// se piden con fetch y se muestran como blob. Lanza un error si no se pudo.
export async function showProtectedPhoto(image, url) {
  const token = sessionStorage.getItem('rastreo_token');
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`No se pudo obtener la fotografía (${response.status}).`);
  const photo = URL.createObjectURL(await response.blob());
  image.src = photo;
  image.addEventListener('load', () => URL.revokeObjectURL(photo), { once: true });
}

// Carga las <img src="data:," data-photo-url="/api/..." data-protected-photo> de un
// contenedor que todavía no se cargaron (cada una se marca para no repetirla).
export async function loadProtectedPhotos(container) {
  const images = container.querySelectorAll('img[data-protected-photo]:not([data-protected-loaded])');
  await Promise.all(Array.from(images, async image => {
    const photoUrl = image.dataset.photoUrl;
    if (!photoUrl) return;
    image.dataset.protectedLoaded = 'true';
    try {
      await showProtectedPhoto(image, photoUrl);
    } catch (error) {
      console.error('No se pudo cargar una fotografía protegida:', error.message);
      image.remove();
    }
  }));
}

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
