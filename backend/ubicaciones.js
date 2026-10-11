import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lista oficial de Paraguay: departamento -> ciudad (distrito) -> barrio/localidad.
// La misma lista la usa el formulario del frontend (/data/paraguay-ubicaciones.json).
const dataPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'paraguay-ubicaciones.json');
const { departamentos } = JSON.parse(readFileSync(dataPath, 'utf8'));

// Compara sin tildes ni mayúsculas para aceptar registros cargados antes de la lista.
export function normalizarNombre(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const index = new Map(departamentos.map(d => [
  normalizarNombre(d.departamento),
  new Map(d.ciudades.map(c => [normalizarNombre(c.ciudad), new Set(c.barrios.map(normalizarNombre))]))
]));

export function ubicacionValida(departamento, ciudad, barrio = '') {
  const ciudades = index.get(normalizarNombre(departamento));
  const barrios = ciudades?.get(normalizarNombre(ciudad));
  if (!barrios) return false;
  return !barrio || barrios.has(normalizarNombre(barrio));
}
