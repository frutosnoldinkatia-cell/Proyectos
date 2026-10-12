import express from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { createAdminRouter } from './admin-routes.js';
import { asyncRoute, authenticate, isAdministrator, requireAdministrator } from './auth-routes.js';
import {
  caseListColumns,
  caseVisibilityParameters,
  IMAGE_DATA_URL,
  paginatedBody,
  paginationFromQuery,
  PUBLIC_CASE_FILTER,
  sendStoredPhoto,
  toOwnerCase,
  toPublicCase,
  validCoordinates
} from './case-shared.js';
import { createClueRouter } from './clue-routes.js';
import { withTransaction } from './db.js';
import { createNotificationRouter } from './notification-routes.js';
import { createStatsRouter } from './stats-routes.js';
import { ubicacionValida } from './ubicaciones.js';

export { processDueFollowups } from './followups.js';

// Router de /api: define los permisos comunes y las rutas de casos del ciudadano,
// y monta los routers de pistas, notificaciones, estadísticas y administración.
export function createCaseRouter({ db, jwtSecret }) {
  const router = express.Router();
  const requireUser = authenticate(jwtSecret, db);
  const requireAdmin = [requireUser, requireAdministrator];
  // La cuenta de administrador es institucional: no reporta ni sigue casos
  // propios (ROLES_Y_PERMISOS.txt, tabla de permisos).
  const requireCitizen = [requireUser, (req, res, next) => {
    if (isAdministrator(req.auth)) {
      return res.status(403).json({ error: 'La cuenta de administrador no reporta ni sigue casos propios.' });
    }
    next();
  }];

  // Lectura pública sin sesión (casos, fotos, pistas validadas y estadísticas):
  // límite por IP solo contra abusos. En un evento ~100 celulares salen por la misma
  // IP y el feed se actualiza solo, así que el límite por defecto es holgado.
  const publicReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.LIMITE_LECTURA_PUBLICA_POR_MINUTO) || 3000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiadas consultas desde esta red. Intente nuevamente en un minuto.' }
  });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/casos', publicReadLimiter, asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%%';
    const city = typeof req.query.ciudad === 'string' ? `%${req.query.ciudad.trim()}%` : '%%';
    const department = typeof req.query.departamento === 'string' ? `%${req.query.departamento.trim()}%` : '%%';
    const sex = typeof req.query.sexo === 'string' ? req.query.sexo : '';
    const ageMin = Number.isInteger(Number(req.query.edadMin)) ? Number(req.query.edadMin) : null;
    const ageMax = Number.isInteger(Number(req.query.edadMax)) ? Number(req.query.edadMax) : null;
    const pagination = paginationFromQuery(req.query);
    const { rows } = await db.query(`
      SELECT ${caseListColumns()}, COUNT(*) OVER() AS total_registros FROM casos
      WHERE ${PUBLIC_CASE_FILTER} AND estado <> 'RECHAZADO'
        AND ($2 = '%%' OR nombre_completo ILIKE $2 OR ciudad ILIKE $2
          OR departamento ILIKE $2 OR descripcion_fisica ILIKE $2
          OR vestimenta ILIKE $2 OR senas_particulares ILIKE $2)
        AND ($3 = '%%' OR ciudad ILIKE $3)
        AND ($4 = '%%' OR departamento ILIKE $4)
        AND ($5 = '' OR sexo = $5)
        AND ($6::integer IS NULL OR edad >= $6)
        AND ($7::integer IS NULL OR edad <= $7)
      ORDER BY creado_en DESC
      LIMIT $8::integer OFFSET $9::integer
    `, [...caseVisibilityParameters(), search, city, department, sex, ageMin, ageMax,
      pagination.limit, pagination.offset]);
    res.json(paginatedBody('casos', rows.map(toPublicCase), rows, pagination));
  }));

  router.get('/casos/:id', publicReadLimiter, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT * FROM casos
      WHERE id = $2 AND ${PUBLIC_CASE_FILTER} AND estado <> 'RECHAZADO'
    `, [...caseVisibilityParameters(), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toPublicCase(rows[0]) });
  }));

  router.get('/casos/:id/foto', publicReadLimiter, asyncRoute((req, res) => sendStoredPhoto(db, req, res, false)));

  router.get('/mis-casos', ...requireCitizen, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT ${caseListColumns()} FROM casos
      WHERE reportado_por_usr_id = $1
      ORDER BY creado_en DESC
    `, [req.auth.id]);
    res.json({ casos: rows.map(row => ({
      ...toOwnerCase(row),
      motivoRechazo: row.motivo_rechazo
    })) });
  }));

  router.post('/casos', ...requireCitizen, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const requiredText = ['nombreCompleto', 'sexo', 'ciudad', 'departamento', 'descripcionFisica', 'vestimenta', 'fechaHoraDesaparicion'];
    if (requiredText.some(key => typeof body[key] !== 'string' || !body[key].trim())
      || !Number.isInteger(body.edad) || body.edad < 0 || body.edad > 120
      || !validCoordinates(Number(body.ubicacion?.lat), Number(body.ubicacion?.lng))
      || Number.isNaN(Date.parse(body.fechaHoraDesaparicion))
      || body.declaraMayorEdad !== true
      || body.avisoPrivacidadAceptado !== true
      || (body.edad < 18 && body.autorizacionParental !== true)) {
      return res.status(400).json({ error: 'Los datos del caso están incompletos o no son válidos.' });
    }
    const barrio = typeof body.barrio === 'string' ? body.barrio.trim() : '';
    if (!ubicacionValida(body.departamento, body.ciudad, barrio)) {
      return res.status(400).json({ error: 'Elegí un departamento, ciudad y barrio de la lista de Paraguay.' });
    }
    if (body.foto && (typeof body.foto !== 'string'
      || !IMAGE_DATA_URL.test(body.foto)
      || Buffer.byteLength(body.foto, 'utf8') > 10 * 1024 * 1024)) {
      return res.status(400).json({ error: 'La fotografía debe ser JPEG, PNG o WEBP y no superar 10 MB.' });
    }
    const denuncia = typeof body.numeroDenuncia === 'string' ? body.numeroDenuncia.trim() : '';
    const id = `cas_${randomUUID()}`;
    const created = await withTransaction(db, async client => {
      const { rows } = await client.query(`
        INSERT INTO casos (
          id, nombre_completo, edad, sexo, ciudad, departamento, barrio, descripcion_fisica, vestimenta,
          senas_particulares, fecha_hora_desaparicion, foto, latitud, longitud, direccion,
          numero_denuncia, estado, reportado_por_usr_id, proximo_seguimiento,
          reportante_mayor_edad, autorizacion_parental, aviso_privacidad_aceptado
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING *
      `, [
        id, body.nombreCompleto.trim(), Number(body.edad), body.sexo.trim(), body.ciudad.trim(),
        body.departamento.trim(), barrio, body.descripcionFisica.trim(), body.vestimenta.trim(), body.senasParticulares || '',
        body.fechaHoraDesaparicion, body.foto || '', Number(body.ubicacion.lat), Number(body.ubicacion.lng),
        body.ubicacion.direccion || body.ciudad, denuncia, 'PENDIENTE',
        req.auth.id, new Date(Date.now() + 48 * 60 * 60 * 1000),
        body.declaraMayorEdad, body.autorizacionParental === true, body.avisoPrivacidadAceptado
      ]);
      await client.query(
        'INSERT INTO suscripciones_caso (caso_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, req.auth.id]
      );
      await client.query(
        'INSERT INTO cambios_estado_caso (caso_id, estado_nuevo, cambiado_por) VALUES ($1, $2, $3)',
        [id, rows[0].estado, req.auth.id]
      );
      await client.query(`
        INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
        SELECT id, $1, 'Nuevo reporte para validar', $2, 'CASO_PENDIENTE'
        FROM usuarios WHERE rol = 'administrador'
      `, [id, `Se recibió un reporte de ${body.nombreCompleto.trim()} y espera validación.`]);
      return rows[0];
    });
    res.status(201).json({ caso: toOwnerCase(created) });
  }));

  router.post('/casos/:id/seguimiento', ...requireCitizen, asyncRoute(async (req, res) => {
    const action = req.body?.accion;
    const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!['SIGUE_ACTIVA', 'LOCALIZADO', 'PRORROGA', 'CERRAR'].includes(action)) {
      return res.status(400).json({ error: 'La respuesta de seguimiento no es válida.' });
    }
    if (action === 'CERRAR' && !reason) {
      return res.status(400).json({ error: 'Debe justificar el cierre del caso.' });
    }

    const updated = await withTransaction(db, async client => {
      const { rows } = await client.query(`
        SELECT * FROM casos
        WHERE id = $1 AND reportado_por_usr_id = $2
        FOR UPDATE
      `, [req.params.id, req.auth.id]);
      const current = rows[0];
      if (!current || !['VALIDADO', 'EN_SEGUIMIENTO'].includes(current.estado)) return null;

      const state = action === 'LOCALIZADO' ? 'LOCALIZADO'
        : action === 'CERRAR' ? 'CERRADO' : 'VALIDADO';
      const { rows: updatedRows } = await client.query(`
        UPDATE casos SET estado = $2,
          localizado_en = CASE WHEN $2 = 'LOCALIZADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
          motivo_cierre = CASE WHEN $2 = 'CERRADO' THEN $3 ELSE motivo_cierre END,
          seguimiento_etapa = CASE WHEN $2 IN ('LOCALIZADO', 'CERRADO') THEN 2 ELSE 0 END,
          proximo_seguimiento = CASE
            WHEN $2 IN ('LOCALIZADO', 'CERRADO') THEN NULL
            WHEN $4 = 'PRORROGA' THEN CURRENT_TIMESTAMP + INTERVAL '24 hours'
            ELSE CURRENT_TIMESTAMP + INTERVAL '48 hours'
          END
        WHERE id = $1 RETURNING *
      `, [req.params.id, state, reason || null, action]);

      if (current.estado !== state) {
        await client.query(`
          INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo, cambiado_por)
          VALUES ($1, $2, $3, $4)
        `, [req.params.id, current.estado, state, req.auth.id]);
      }
      if (state === 'LOCALIZADO') {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          SELECT usuario_id, $1, 'Caso resuelto', $2, 'CASO_LOCALIZADO'
          FROM suscripciones_caso WHERE caso_id = $1
        `, [req.params.id, `El familiar informó que ${current.nombre_completo} fue localizado.`]);
      }
      return updatedRows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Caso no disponible para seguimiento.' });
    res.json({ caso: toOwnerCase(updated) });
  }));

  const shared = { db, requireUser, requireAdmin, requireCitizen, publicReadLimiter };
  router.use(createClueRouter(shared));
  router.use(createNotificationRouter(shared));
  router.use(createStatsRouter(shared));
  router.use(createAdminRouter(shared));

  return router;
}
