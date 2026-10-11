// Consultas, formatos y validaciones compartidos por las rutas de casos, pistas
// y administración.

export const LOCATED_WINDOW_HOURS = Number(process.env.VENTANA_LOCALIZADOS_HORAS ?? 24);

if (!Number.isFinite(LOCATED_WINDOW_HOURS) || LOCATED_WINDOW_HOURS < 0) {
  throw new Error('VENTANA_LOCALIZADOS_HORAS debe ser un número mayor o igual a cero.');
}

export const PUBLIC_CASE_FILTER = `
  (estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO')
    AND (estado <> 'LOCALIZADO'
      OR (localizado_en IS NOT NULL
        AND CURRENT_TIMESTAMP < localizado_en + ($1 * INTERVAL '1 hour'))))
`;

// Columnas de casos para listados: todo menos la foto (base64 de hasta 10 MB),
// que se reemplaza por un indicador. La foto se sirve aparte en /casos/:id/foto.
export function caseListColumns(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return [
    'id', 'nombre_completo', 'edad', 'sexo', 'ciudad', 'departamento', 'barrio',
    'descripcion_fisica', 'vestimenta', 'senas_particulares', 'fecha_hora_desaparicion',
    'latitud', 'longitud', 'direccion', 'numero_denuncia', 'estado', 'motivo_rechazo',
    'reportado_por_usr_id', 'localizado_en', 'creado_en', 'proximo_seguimiento',
    'reportante_mayor_edad', 'autorizacion_parental', 'aviso_privacidad_aceptado',
    'checklist_denuncia', 'checklist_coherencia', 'checklist_duplicados', 'checklist_menores',
    'motivo_cierre', 'seguimiento_etapa'
  ].map(column => `${prefix}${column}`).join(', ') + `, (${prefix}foto <> '') AS tiene_foto`;
}

// Paginación opcional de los listados: sin ?limite se devuelve todo (lo que espera
// el frontend actual); con ?limite (1..100) y ?pagina se pagina.
export function paginationFromQuery(query) {
  const paginated = query.limite !== undefined;
  const page = Math.max(1, Number.parseInt(query.pagina, 10) || 1);
  const limit = paginated ? Math.min(100, Math.max(1, Number.parseInt(query.limite, 10) || 20)) : null;
  return { paginated, page, limit, offset: paginated ? (page - 1) * limit : 0 };
}

export function paginatedBody(key, items, rows, { paginated, page, limit }) {
  const total = Number(rows[0]?.total_registros || 0);
  return paginated
    ? { [key]: items, pagina: page, limite: limit, total }
    : { [key]: items, total };
}

export function hasPhoto(row) {
  return Boolean(row.foto || row.tiene_foto);
}

export function validDateFilter(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Fotos aceptadas: data URL base64 de JPEG, PNG o WEBP.
export const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function toPublicCase(row) {
  return {
    id: row.id,
    nombreCompleto: row.nombre_completo,
    edad: row.edad,
    sexo: row.sexo,
    ciudad: row.ciudad,
    departamento: row.departamento || '',
    barrio: row.barrio || '',
    descripcionFisica: row.descripcion_fisica,
    vestimenta: row.vestimenta,
    senasParticulares: row.senas_particulares,
    fechaHoraDesaparicion: row.fecha_hora_desaparicion,
    fotoUrl: hasPhoto(row) ? `/api/casos/${encodeURIComponent(row.id)}/foto` : '',
    ubicacion: { lat: row.latitud, lng: row.longitud, direccion: row.direccion },
    numeroDenuncia: row.numero_denuncia,
    estado: row.estado,
    seguimientoEtapa: Number(row.seguimiento_etapa) || 0,
    fechaCreacion: row.creado_en,
    localizadoEn: row.localizado_en,
    visibleHasta: row.localizado_en
      ? new Date(new Date(row.localizado_en).getTime() + LOCATED_WINDOW_HOURS * 60 * 60 * 1000)
      : null,
    proximoSeguimiento: row.proximo_seguimiento
  };
}

export function toAdminCase(row) {
  return {
    ...toPublicCase(row),
    fotoUrl: hasPhoto(row) ? `/api/admin/casos/${encodeURIComponent(row.id)}/foto` : '',
    fotoDisponible: hasPhoto(row),
    motivoRechazo: row.motivo_rechazo,
    reportadoPorUsrId: row.reportado_por_usr_id,
    contactoReportante: row.contacto_reportante,
    reportanteMayorEdad: Boolean(row.reportante_mayor_edad),
    autorizacionParental: Boolean(row.autorizacion_parental),
    avisoPrivacidadAceptado: Boolean(row.aviso_privacidad_aceptado),
    checklistRevision: {
      denuncia: Boolean(row.checklist_denuncia),
      coherencia: Boolean(row.checklist_coherencia),
      duplicados: Boolean(row.checklist_duplicados),
      validacionMenores: Boolean(row.checklist_menores)
    },
    motivoCierre: row.motivo_cierre,
    pistas: row.pistas || [],
    cambiosEstado: row.cambios_estado || []
  };
}

export function caseVisibilityParameters() {
  return [LOCATED_WINDOW_HOURS];
}

// PUBLIC_CASE_FILTER para consultas que unen pistas (p) con casos (c).
export const PUBLIC_CASE_FILTER_JOINED = PUBLIC_CASE_FILTER
  .replaceAll('estado', 'c.estado').replaceAll('localizado_en', 'c.localizado_en');

export async function sendStoredPhoto(db, req, res, administrator) {
  const visibility = administrator ? '' : `AND ${PUBLIC_CASE_FILTER}`;
  const idPlaceholder = administrator ? '$1' : '$2';
  const parameters = administrator ? [req.params.id] : [...caseVisibilityParameters(), req.params.id];
  const { rows } = await db.query(
    `SELECT foto FROM casos WHERE id = ${idPlaceholder} ${visibility}`,
    parameters
  );
  if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
  if (!rows[0].foto) return res.sendStatus(404);
  const match = rows[0].foto.match(IMAGE_DATA_URL);
  if (!match) return res.status(500).json({ error: 'La fotografía almacenada no es válida.' });
  res.type(`image/${match[1]}`).set('Cache-Control', 'private, no-store').send(Buffer.from(match[2], 'base64'));
}
