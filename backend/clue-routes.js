import express from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { asyncRoute } from './auth-routes.js';
import {
  caseVisibilityParameters,
  IMAGE_DATA_URL,
  paginatedBody,
  paginationFromQuery,
  PUBLIC_CASE_FILTER,
  PUBLIC_CASE_FILTER_JOINED,
  validCoordinates
} from './case-shared.js';
import { withTransaction } from './db.js';

// Índices (desde 0) de las fotos con formato de imagen de una pista, calculados en
// PostgreSQL para que los listados no lean ni envíen el base64. La validación
// completa se hace al servir cada foto (sendCluePhoto).
const CLUE_PHOTO_INDICES = `ARRAY(
  SELECT i - 1 FROM generate_subscripts(p.fotos, 1) AS i
  WHERE p.fotos[i] ~ '^data:image/(jpeg|png|webp);base64,'
  ORDER BY i
) AS fotos_indices`;

function clueFotoUrls(row, administrator) {
  const base = `/api/${administrator ? 'admin/' : ''}pistas/${encodeURIComponent(row.id)}/fotos`;
  return (row.fotos_indices || []).map(index => `${base}/${index}`);
}

async function sendCluePhoto(db, req, res, administrator) {
  const index = Number(req.params.n);
  if (!Number.isInteger(index) || index < 0 || index > 2) return res.status(404).json({ error: 'Foto no disponible' });
  // Los arrays de PostgreSQL empiezan en 1.
  const { rows } = administrator
    ? await db.query('SELECT fotos[$2] AS foto FROM pistas WHERE id = $1', [req.params.id, index + 1])
    : await db.query(`
      SELECT p.fotos[$3] AS foto FROM pistas p JOIN casos c ON c.id = p.caso_id
      WHERE p.id = $2 AND p.estado = 'VALIDADA' AND c.estado <> 'RECHAZADO'
        AND ${PUBLIC_CASE_FILTER_JOINED}
    `, [...caseVisibilityParameters(), req.params.id, index + 1]);
  const match = typeof rows[0]?.foto === 'string' ? rows[0].foto.match(IMAGE_DATA_URL) : null;
  if (!match) return res.status(404).json({ error: 'Foto no disponible' });
  res.type(`image/${match[1]}`).set('Cache-Control', 'private, no-store').send(Buffer.from(match[2], 'base64'));
}

export function createClueRouter({ db, requireUser, requireAdmin }) {
  const router = express.Router();
  // Las pistas exigen sesión (ver docs/ROLES_Y_PERMISOS.txt); el límite es por usuario.
  const clueLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: req => `usuario:${req.auth.id}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Se alcanzó el límite temporal de envíos de pistas. Intente nuevamente más tarde.' }
  });

  router.get('/pistas', requireUser, asyncRoute(async (req, res) => {
    const pagination = paginationFromQuery(req.query);
    const { rows } = await db.query(`
      SELECT p.id, p.caso_id, p.descripcion, p.fecha_hora_avistamiento,
        p.latitud, p.longitud, p.direccion, ${CLUE_PHOTO_INDICES}, p.fecha_envio,
        COUNT(*) OVER() AS total_registros
      FROM pistas p JOIN casos c ON c.id = p.caso_id
      WHERE ${PUBLIC_CASE_FILTER_JOINED}
        AND c.estado <> 'RECHAZADO' AND p.estado = 'VALIDADA'
      ORDER BY p.fecha_envio DESC
      LIMIT $2::integer OFFSET $3::integer
    `, [...caseVisibilityParameters(), pagination.limit, pagination.offset]);
    res.json(paginatedBody('pistas', rows.map(row => ({
      id: row.id,
      casoId: row.caso_id,
      descripcion: row.descripcion,
      fechaHoraAvistamiento: row.fecha_hora_avistamiento,
      ubicacion: { lat: row.latitud, lng: row.longitud, direccion: row.direccion },
      fotosUrl: clueFotoUrls(row, false),
      fechaEnvio: row.fecha_envio
    })), rows, pagination));
  }));

  router.get('/pistas/:id/fotos/:n', requireUser, asyncRoute((req, res) => sendCluePhoto(db, req, res, false)));
  router.get('/admin/pistas/:id/fotos/:n', ...requireAdmin, asyncRoute((req, res) => sendCluePhoto(db, req, res, true)));

  router.get('/admin/pistas', ...requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFromQuery(req.query);
    const { rows } = await db.query(`
      SELECT p.id, p.caso_id, c.nombre_completo, p.descripcion, p.fecha_hora_avistamiento,
        p.latitud, p.longitud, p.direccion, ${CLUE_PHOTO_INDICES}, p.estado, p.fecha_envio,
        u.id AS autor_id, u.nombre_completo AS autor_nombre, u.correo AS autor_correo,
        COUNT(*) OVER() AS total_registros,
        (SELECT COALESCE(json_agg(json_build_object(
          'estadoAnterior', m.estado_anterior,
          'estadoNuevo', m.estado_nuevo,
          'motivo', m.motivo,
          'cambiadoEn', m.cambiado_en,
          'administrador', a.nombre_completo
        ) ORDER BY m.cambiado_en), '[]'::json)
        FROM cambios_estado_pista m LEFT JOIN usuarios a ON a.id = m.cambiado_por
        WHERE m.pista_id = p.id) AS cambios_estado
      FROM pistas p JOIN casos c ON c.id = p.caso_id
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      ORDER BY CASE WHEN p.estado = 'PENDIENTE' THEN 0 ELSE 1 END, p.fecha_envio DESC
      LIMIT $1::integer OFFSET $2::integer
    `, [pagination.limit, pagination.offset]);
    res.json(paginatedBody('pistas', rows.map(row => ({
      id: row.id,
      casoId: row.caso_id,
      nombreCompleto: row.nombre_completo,
      descripcion: row.descripcion,
      fechaHoraAvistamiento: row.fecha_hora_avistamiento,
      ubicacion: { lat: row.latitud, lng: row.longitud, direccion: row.direccion },
      fotosUrl: clueFotoUrls(row, true),
      estado: row.estado,
      // Solo para moderación: el público nunca recibe estos datos.
      autor: row.autor_id
        ? { id: row.autor_id, nombre: row.autor_nombre, correo: row.autor_correo }
        : null,
      cambiosEstado: row.cambios_estado || [],
      fechaEnvio: row.fecha_envio
    })), rows, pagination));
  }));

  router.post('/casos/:id/pistas', requireUser, clueLimiter, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const photos = body.fotos === undefined ? [] : body.fotos;
    if (typeof body.descripcion !== 'string' || !body.descripcion.trim()
      || Number.isNaN(Date.parse(body.fechaHoraAvistamiento))
      || !validCoordinates(Number(body.ubicacion?.lat), Number(body.ubicacion?.lng))
      || !Array.isArray(photos)
      || photos.length > 3
      || photos.some(photo => typeof photo !== 'string'
        || !IMAGE_DATA_URL.test(photo)
        || Buffer.byteLength(photo, 'utf8') > 4 * 1024 * 1024)
      || Buffer.byteLength(photos.join(''), 'utf8') > 10 * 1024 * 1024) {
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
          id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento, latitud, longitud, direccion, fotos
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [id, req.params.id, req.auth.id, body.descripcion.trim(), body.fechaHoraAvistamiento,
        Number(body.ubicacion.lat), Number(body.ubicacion.lng), body.ubicacion.direccion || '', photos]);
      await client.query(
        'INSERT INTO suscripciones_caso (caso_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, req.auth.id]
      );
      await client.query(`
        INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
        SELECT id, $1, 'Nueva pista recibida', $2, 'PISTA_RECIBIDA'
        FROM usuarios WHERE rol = 'administrador'
      `, [req.params.id, 'Se recibió una nueva pista vinculada al caso.']);
      return id;
    });
    if (!result) return res.status(404).json({ error: 'Caso no disponible' });
    res.status(201).json({ id: result, mensaje: 'Pista ingresada correctamente.' });
  }));

  router.post('/admin/pistas/:id/estado', ...requireAdmin, asyncRoute(async (req, res) => {
    const state = req.body?.estado;
    const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!['VALIDADA', 'RECHAZADA'].includes(state)) {
      return res.status(400).json({ error: 'El estado de moderación no es válido.' });
    }
    if (state === 'RECHAZADA' && !reason) {
      return res.status(400).json({ error: 'Debe indicar el motivo del rechazo de la pista.' });
    }
    const moderated = await withTransaction(db, async client => {
      const { rows } = await client.query('SELECT * FROM pistas WHERE id = $1 FOR UPDATE', [req.params.id]);
      const current = rows[0];
      if (!current) return null;
      const { rows: updatedRows } = await client.query(
        'UPDATE pistas SET estado = $2 WHERE id = $1 RETURNING *',
        [req.params.id, state]
      );
      if (current.estado !== state) {
        await client.query(`
          INSERT INTO cambios_estado_pista (pista_id, estado_anterior, estado_nuevo, motivo, cambiado_por)
          VALUES ($1, $2, $3, $4, $5)
        `, [req.params.id, current.estado, state, reason || null, req.auth.id]);
      }
      if (state === 'VALIDADA') {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          SELECT usuario_id, $1, 'Pista validada', 'Una pista ciudadana fue revisada y agregada al caso.', 'PISTA_VALIDADA'
          FROM suscripciones_caso WHERE caso_id = $1
        `, [current.caso_id]);
      }
      return updatedRows[0];
    });
    if (!moderated) return res.status(404).json({ error: 'La pista ya no está disponible.' });
    res.json({ id: moderated.id, estado: moderated.estado });
  }));

  return router;
}
