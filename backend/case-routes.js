import express from 'express';
import { randomUUID } from 'node:crypto';
import { authenticate, requireAdministrator } from './auth-routes.js';
import { withTransaction } from './db.js';

const LOCATED_WINDOW_HOURS = Number(process.env.VENTANA_LOCALIZADOS_HORAS ?? 24);

if (!Number.isFinite(LOCATED_WINDOW_HOURS) || LOCATED_WINDOW_HOURS < 0) {
  throw new Error('VENTANA_LOCALIZADOS_HORAS debe ser un número mayor o igual a cero.');
}

const PUBLIC_CASE_FILTER = `
  (estado <> 'LOCALIZADO'
    OR (localizado_en IS NOT NULL
      AND CURRENT_TIMESTAMP < localizado_en + ($1 * INTERVAL '1 hour')))
`;

function validDateFilter(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function toPublicCase(row) {
  return {
    id: row.id,
    nombreCompleto: row.nombre_completo,
    edad: row.edad,
    sexo: row.sexo,
    ciudad: row.ciudad,
    descripcionFisica: row.descripcion_fisica,
    vestimenta: row.vestimenta,
    senasParticulares: row.senas_particulares,
    fechaHoraDesaparicion: row.fecha_hora_desaparicion,
    fotoUrl: row.foto ? `/api/casos/${encodeURIComponent(row.id)}/foto` : '',
    ubicacion: { lat: row.latitud, lng: row.longitud, direccion: row.direccion },
    numeroDenuncia: row.numero_denuncia,
    estado: row.estado,
    fechaCreacion: row.creado_en,
    localizadoEn: row.localizado_en,
    visibleHasta: row.localizado_en
      ? new Date(new Date(row.localizado_en).getTime() + LOCATED_WINDOW_HOURS * 60 * 60 * 1000)
      : null,
    proximoSeguimiento: row.proximo_seguimiento
  };
}

function toAdminCase(row) {
  return {
    ...toPublicCase(row),
    fotoUrl: row.foto ? `/api/admin/casos/${encodeURIComponent(row.id)}/foto` : '',
    fotoDisponible: Boolean(row.foto),
    motivoRechazo: row.motivo_rechazo,
    reportadoPorUsrId: row.reportado_por_usr_id,
    contactoReportante: row.contacto_reportante,
    pistas: row.pistas || [],
    cambiosEstado: row.cambios_estado || []
  };
}

function caseVisibilityParameters() {
  return [LOCATED_WINDOW_HOURS];
}

async function sendStoredPhoto(db, req, res, administrator) {
  const visibility = administrator ? '' : `AND ${PUBLIC_CASE_FILTER}`;
  const idPlaceholder = administrator ? '$1' : '$2';
  const parameters = administrator ? [req.params.id] : [...caseVisibilityParameters(), req.params.id];
  const { rows } = await db.query(
    `SELECT foto FROM casos WHERE id = ${idPlaceholder} ${visibility}`,
    parameters
  );
  if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
  if (!rows[0].foto) return res.sendStatus(404);
  const match = rows[0].foto.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(500).json({ error: 'La fotografía almacenada no es válida.' });
  res.type(`image/${match[1]}`).set('Cache-Control', 'private, no-store').send(Buffer.from(match[2], 'base64'));
}

export function createCaseRouter({ db, jwtSecret }) {
  const router = express.Router();
  const requireUser = authenticate(jwtSecret);
  const requireAdmin = [requireUser, requireAdministrator];

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/casos', asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%%';
    const city = typeof req.query.ciudad === 'string' ? `%${req.query.ciudad.trim()}%` : '%%';
    const sex = typeof req.query.sexo === 'string' ? req.query.sexo : '';
    const ageMin = Number.isInteger(Number(req.query.edadMin)) ? Number(req.query.edadMin) : null;
    const ageMax = Number.isInteger(Number(req.query.edadMax)) ? Number(req.query.edadMax) : null;
    const { rows } = await db.query(`
      SELECT * FROM casos
      WHERE ${PUBLIC_CASE_FILTER} AND estado <> 'RECHAZADO'
        AND ($2 = '%%' OR nombre_completo ILIKE $2 OR ciudad ILIKE $2)
        AND ($3 = '%%' OR ciudad ILIKE $3)
        AND ($4 = '' OR sexo = $4)
        AND ($5::integer IS NULL OR edad >= $5)
        AND ($6::integer IS NULL OR edad <= $6)
      ORDER BY creado_en DESC
    `, [...caseVisibilityParameters(), search, city, sex, ageMin, ageMax]);
    res.json({ casos: rows.map(toPublicCase) });
  }));

  router.get('/casos/:id', asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT * FROM casos
      WHERE id = $2 AND ${PUBLIC_CASE_FILTER} AND estado <> 'RECHAZADO'
    `, [...caseVisibilityParameters(), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toPublicCase(rows[0]) });
  }));

  router.get('/casos/:id/foto', asyncRoute((req, res) => sendStoredPhoto(db, req, res, false)));

  router.get('/pistas', asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT p.id, p.caso_id, p.descripcion, p.fecha_hora_avistamiento,
        p.latitud, p.longitud, p.direccion, p.fecha_envio
      FROM pistas p JOIN casos c ON c.id = p.caso_id
      WHERE ${PUBLIC_CASE_FILTER.replaceAll('estado', 'c.estado').replaceAll('localizado_en', 'c.localizado_en')}
        AND c.estado <> 'RECHAZADO'
      ORDER BY p.fecha_envio DESC
    `, caseVisibilityParameters());
    res.json({ pistas: rows.map(row => ({
      id: row.id,
      casoId: row.caso_id,
      descripcion: row.descripcion,
      fechaHoraAvistamiento: row.fecha_hora_avistamiento,
      ubicacion: { lat: row.latitud, lng: row.longitud, direccion: row.direccion },
      fechaEnvio: row.fecha_envio
    })) });
  }));

  router.post('/casos', requireUser, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const requiredText = ['nombreCompleto', 'sexo', 'ciudad', 'descripcionFisica', 'vestimenta', 'fechaHoraDesaparicion'];
    if (requiredText.some(key => typeof body[key] !== 'string' || !body[key].trim())
      || !Number.isInteger(body.edad) || body.edad < 0
      || !validCoordinates(Number(body.ubicacion?.lat), Number(body.ubicacion?.lng))
      || Number.isNaN(Date.parse(body.fechaHoraDesaparicion))) {
      return res.status(400).json({ error: 'Los datos del caso están incompletos o no son válidos.' });
    }
    if (body.foto && (typeof body.foto !== 'string'
      || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.foto)
      || Buffer.byteLength(body.foto, 'utf8') > 10 * 1024 * 1024)) {
      return res.status(400).json({ error: 'La fotografía debe ser JPEG, PNG o WEBP y no superar 10 MB.' });
    }
    const denuncia = typeof body.numeroDenuncia === 'string' ? body.numeroDenuncia.trim() : '';
    const id = `cas_${randomUUID()}`;
    const created = await withTransaction(db, async client => {
      const { rows } = await client.query(`
        INSERT INTO casos (
          id, nombre_completo, edad, sexo, ciudad, descripcion_fisica, vestimenta,
          senas_particulares, fecha_hora_desaparicion, foto, latitud, longitud, direccion,
          numero_denuncia, estado, reportado_por_usr_id, proximo_seguimiento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `, [
        id, body.nombreCompleto.trim(), Number(body.edad), body.sexo.trim(), body.ciudad.trim(),
        body.descripcionFisica.trim(), body.vestimenta.trim(), body.senasParticulares || '',
        body.fechaHoraDesaparicion, body.foto || '', Number(body.ubicacion.lat), Number(body.ubicacion.lng),
        body.ubicacion.direccion || body.ciudad, denuncia, denuncia ? 'VALIDADO' : 'PENDIENTE',
        req.auth.id, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      ]);
      await client.query(
        'INSERT INTO suscripciones_caso (caso_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, req.auth.id]
      );
      await client.query(
        'INSERT INTO cambios_estado_caso (caso_id, estado_nuevo, cambiado_por) VALUES ($1, $2, $3)',
        [id, rows[0].estado, req.auth.id]
      );
      return rows[0];
    });
    res.status(201).json({ caso: toPublicCase(created) });
  }));

  router.post('/casos/:id/pistas', requireUser, asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (typeof body.descripcion !== 'string' || !body.descripcion.trim()
      || Number.isNaN(Date.parse(body.fechaHoraAvistamiento))
      || !validCoordinates(Number(body.ubicacion?.lat), Number(body.ubicacion?.lng))) {
      return res.status(400).json({ error: 'Los datos de la pista están incompletos o no son válidos.' });
    }
    const result = await withTransaction(db, async client => {
      const { rows: cases } = await client.query(`
        SELECT * FROM casos WHERE id = $2 AND ${PUBLIC_CASE_FILTER}
          AND estado NOT IN ('CERRADO', 'RECHAZADO', 'LOCALIZADO') FOR UPDATE
      `, [...caseVisibilityParameters(), req.params.id]);
      if (!cases[0]) return null;
      const id = `pst_${randomUUID()}`;
      await client.query(`
        INSERT INTO pistas (
          id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento, latitud, longitud, direccion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, req.params.id, req.auth.id, body.descripcion.trim(), body.fechaHoraAvistamiento,
        Number(body.ubicacion.lat), Number(body.ubicacion.lng), body.ubicacion.direccion || '']);
      await client.query(
        'INSERT INTO suscripciones_caso (caso_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, req.auth.id]
      );
      await client.query(`
        INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
        SELECT usuario_id, $1, 'Nueva pista recibida', $2, 'PISTA_RECIBIDA'
        FROM suscripciones_caso WHERE caso_id = $1 AND usuario_id <> $3
      `, [req.params.id, 'Se recibió una nueva pista vinculada al caso.', req.auth.id]);
      return id;
    });
    if (!result) return res.status(404).json({ error: 'Caso no disponible' });
    res.status(201).json({ id: result, mensaje: 'Pista ingresada correctamente.' });
  }));

  router.get('/notificaciones', requireUser, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT id, caso_id, titulo, mensaje, tipo, leida, creada_en
      FROM notificaciones WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT 100
    `, [req.auth.id]);
    res.json({ notificaciones: rows.map(row => ({
      id: row.id,
      casoId: row.caso_id,
      titulo: row.titulo,
      mensaje: row.mensaje,
      tipo: row.tipo,
      leida: row.leida,
      fecha: row.creada_en
    })) });
  }));

  router.post('/notificaciones/leidas', requireUser, asyncRoute(async (req, res) => {
    await db.query(
      'UPDATE notificaciones SET leida = TRUE WHERE usuario_id = $1',
      [req.auth.id]
    );
    res.json({ mensaje: 'Notificaciones marcadas como leídas.' });
  }));

  router.get('/estadisticas', asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE estado IN ('LOCALIZADO', 'CERRADO')) AS encontrados,
        COUNT(*) FILTER (WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO')) AS activos,
        COUNT(*) FILTER (WHERE estado = 'LOCALIZADO') AS localizados,
        COUNT(*) FILTER (WHERE estado = 'CERRADO') AS cerrados
      FROM casos
    `);
    const [porMes, porCiudad, porSexo, porEdad] = await Promise.all([
      db.query(`SELECT TO_CHAR(DATE_TRUNC('month', localizado_en), 'YYYY-MM') AS periodo, COUNT(*) AS total
        FROM casos WHERE estado = 'LOCALIZADO' GROUP BY 1 ORDER BY 1`),
      db.query(`SELECT ciudad AS categoria, COUNT(*) AS total FROM casos
        WHERE estado = 'LOCALIZADO' GROUP BY ciudad ORDER BY total DESC`),
      db.query(`SELECT sexo AS categoria, COUNT(*) AS total FROM casos
        WHERE estado = 'LOCALIZADO' GROUP BY sexo ORDER BY sexo`),
      db.query(`SELECT CASE WHEN edad < 18 THEN '0-17' WHEN edad < 30 THEN '18-29'
        WHEN edad < 60 THEN '30-59' ELSE '60+' END AS categoria, COUNT(*) AS total
        FROM casos WHERE estado = 'LOCALIZADO' GROUP BY 1 ORDER BY 1`)
    ]);
    res.json({
      ...rows[0],
      porcentajeResueltos: Number(rows[0].total) ? Math.round(Number(rows[0].encontrados) / Number(rows[0].total) * 100) : 0,
      porMes: porMes.rows, porCiudad: porCiudad.rows, porSexo: porSexo.rows, porEdad: porEdad.rows
    });
  }));

  router.get('/admin/casos', ...requireAdmin, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      ORDER BY c.creado_en DESC
    `);
    res.json({ casos: rows.map(toAdminCase) });
  }));

  router.get('/admin/casos/:id/foto', ...requireAdmin, asyncRoute((req, res) => sendStoredPhoto(db, req, res, true)));

  router.get('/admin/historial-localizados', ...requireAdmin, asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%%';
    const from = typeof req.query.desde === 'string' ? req.query.desde : null;
    const to = typeof req.query.hasta === 'string' ? req.query.hasta : null;
    if (!validDateFilter(from) || !validDateFilter(to)
      || (from && to && from > to)) {
      return res.status(400).json({ error: 'El rango de fechas no es válido.' });
    }
    const values = [search, from, to, limit, offset];
    const result = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', p.id, 'descripcion', p.descripcion, 'usuarioId', p.usuario_id,
          'nombreUsuario', pu.nombre_completo, 'correoUsuario', pu.correo,
          'fechaHoraAvistamiento', p.fecha_hora_avistamiento,
          'ubicacion', json_build_object('lat', p.latitud, 'lng', p.longitud, 'direccion', p.direccion),
          'fechaEnvio', p.fecha_envio
        ) ORDER BY p.fecha_envio DESC), '[]'::json) FROM pistas p
          LEFT JOIN usuarios pu ON pu.id = p.usuario_id WHERE p.caso_id = c.id) AS pistas,
        (SELECT COALESCE(json_agg(json_build_object(
          'estadoAnterior', h.estado_anterior, 'estadoNuevo', h.estado_nuevo,
          'cambiadoPor', h.cambiado_por, 'cambiadoEn', h.cambiado_en,
          'nombreAdministrador', a.nombre_completo
        ) ORDER BY h.cambiado_en), '[]'::json) FROM cambios_estado_caso h
          LEFT JOIN usuarios a ON a.id = h.cambiado_por WHERE h.caso_id = c.id) AS cambios_estado,
        COUNT(*) OVER() AS total_registros
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      WHERE c.estado = 'LOCALIZADO'
        AND ($1 = '%%' OR c.nombre_completo ILIKE $1 OR c.ciudad ILIKE $1)
        AND ($2::date IS NULL OR c.localizado_en >= $2::date)
        AND ($3::date IS NULL OR c.localizado_en < $3::date + INTERVAL '1 day')
      ORDER BY c.localizado_en DESC LIMIT $4 OFFSET $5
    `, values);
    res.json({
      casos: result.rows.map(toAdminCase),
      pagina: page,
      limite: limit,
      total: Number(result.rows[0]?.total_registros || 0)
    });
  }));

  router.get('/admin/historial-localizados/:id', ...requireAdmin, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', p.id, 'descripcion', p.descripcion, 'usuarioId', p.usuario_id,
          'nombreUsuario', pu.nombre_completo, 'correoUsuario', pu.correo,
          'fechaHoraAvistamiento', p.fecha_hora_avistamiento,
          'ubicacion', json_build_object('lat', p.latitud, 'lng', p.longitud, 'direccion', p.direccion),
          'fechaEnvio', p.fecha_envio
        ) ORDER BY p.fecha_envio DESC), '[]'::json) FROM pistas p
          LEFT JOIN usuarios pu ON pu.id = p.usuario_id WHERE p.caso_id = c.id) AS pistas,
        (SELECT COALESCE(json_agg(json_build_object(
          'estadoAnterior', h.estado_anterior, 'estadoNuevo', h.estado_nuevo,
          'cambiadoPor', h.cambiado_por, 'cambiadoEn', h.cambiado_en,
          'nombreAdministrador', a.nombre_completo
        ) ORDER BY h.cambiado_en), '[]'::json) FROM cambios_estado_caso h
          LEFT JOIN usuarios a ON a.id = h.cambiado_por WHERE h.caso_id = c.id) AS cambios_estado
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      WHERE c.id = $1 AND c.estado = 'LOCALIZADO'
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toAdminCase(rows[0]) });
  }));

  router.post('/admin/casos/:id/estado', ...requireAdmin, asyncRoute(async (req, res) => {
    const state = req.body?.estado;
    if (!['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO'].includes(state)) {
      return res.status(400).json({ error: 'El estado solicitado no es válido.' });
    }
    if (state === 'RECHAZADO' && (typeof req.body?.motivo !== 'string' || !req.body.motivo.trim())) {
      return res.status(400).json({ error: 'Debe indicar el motivo del rechazo.' });
    }
    if (state === 'VALIDADO'
      && (typeof req.body?.numeroDenuncia !== 'string' || !req.body.numeroDenuncia.trim())) {
      return res.status(400).json({ error: 'Debe registrar el número oficial de denuncia.' });
    }
    const updated = await withTransaction(db, async client => {
      const { rows } = await client.query('SELECT * FROM casos WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) return null;
      const current = rows[0];
      if (current.estado === state) return current;
      const { rows: updatedRows } = await client.query(`
        UPDATE casos SET estado = $2,
          localizado_en = CASE WHEN $2 = 'LOCALIZADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
          motivo_rechazo = CASE WHEN $2 = 'RECHAZADO' THEN $3 ELSE motivo_rechazo END,
          numero_denuncia = CASE WHEN $2 = 'VALIDADO' AND $4 <> '' THEN $4 ELSE numero_denuncia END
        WHERE id = $1 RETURNING *
      `, [req.params.id, state, req.body?.motivo || null, req.body?.numeroDenuncia || '']);
      await client.query(`
        INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo, cambiado_por)
        VALUES ($1, $2, $3, $4)
      `, [req.params.id, current.estado, state, req.auth.id]);
      if (state === 'LOCALIZADO') {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          SELECT usuario_id, $1, 'Caso resuelto', $2, 'CASO_LOCALIZADO'
          FROM suscripciones_caso WHERE caso_id = $1
        `, [req.params.id, `El caso de ${current.nombre_completo} fue resuelto: la persona fue localizada.`]);
      }
      return updatedRows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toPublicCase(updated) });
  }));

  return router;
}
