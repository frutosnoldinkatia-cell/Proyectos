// Restauración de la sesión al abrir la app (sin DOM, para poder testearla en Node).
// Regla: el token solo se descarta cuando el servidor lo rechaza (401 o 403).
// Si falla la red, vence el tiempo de espera o el servidor responde 5xx, la sesión
// se conserva: con la copia del usuario guardada en el último ingreso la app sigue
// mostrando la cuenta, y se vuelve a comprobar cuando el servidor responda.
const CLAVE_TOKEN = 'rastreo_token';
const CLAVE_USUARIO = 'rastreo_usuario';

export function esRechazoDeSesion(error) {
  return error?.status === 401 || error?.status === 403;
}

// La copia solo sirve para dibujar la interfaz sin red: los permisos reales los
// decide siempre el backend con el token.
export function recordarUsuario(usuario, almacen = sessionStorage) {
  try {
    almacen.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
  } catch {
    /* Almacenamiento lleno o bloqueado: sin copia, sin red se verá el login. */
  }
}

export function olvidarSesion(almacen = sessionStorage) {
  almacen.removeItem(CLAVE_TOKEN);
  almacen.removeItem(CLAVE_USUARIO);
}

function usuarioRecordado(almacen) {
  try {
    return JSON.parse(almacen.getItem(CLAVE_USUARIO)) || null;
  } catch {
    return null;
  }
}

// pedirUsuario: función que consulta /auth/me y devuelve el usuario (o lanza el
// error de apiRequest, que trae `status` solo si el servidor respondió).
// Devuelve { usuario, sinConexion }.
export async function restaurarSesion({ pedirUsuario, almacen = sessionStorage }) {
  if (!almacen.getItem(CLAVE_TOKEN)) return { usuario: null, sinConexion: false };
  try {
    const usuario = await pedirUsuario();
    recordarUsuario(usuario, almacen);
    return { usuario, sinConexion: false };
  } catch (error) {
    if (esRechazoDeSesion(error)) {
      olvidarSesion(almacen);
      return { usuario: null, sinConexion: false };
    }
    return { usuario: usuarioRecordado(almacen), sinConexion: true };
  }
}
