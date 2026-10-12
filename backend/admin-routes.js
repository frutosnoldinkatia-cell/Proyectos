import express from 'express';
import { asyncRoute } from './auth-routes.js';
import {
  caseListColumns,
  paginatedBody,
  paginationFromQuery,
  sendStoredPhoto,
  toAdminCase,
  validDateFilter
} from './case-shared.js';
import { withTransaction } from './db.js';
import { processDueFollowups } from './followups.js';

// Panel de administración: listado y moderación de casos, auditoría, historial
// de localizados y simulador de seguimiento. Todas las rutas exigen administrador.
export function createAdminRouter({ db, requireAdmin }) {
  const router = express.Router();

  router.get('/admin/casos', ...requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFromQuery(req.query);
    const { rows } = await db.query(`
      SELECT ${caseListColumns('c')}, u.correo AS contacto_reportante,
        COUNT(*) OVER() AS total_registros
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      ORDER BY c.creado_en DESC
      LIMIT $1::integer OFFSET $2::integer
    `, [pagination.limit, pagination.offset]);
    res.json(paginatedBody('casos', rows.map(toAdminCase), rows, pagination));
  }));

  router.get('/admin/auditoria', ...requireAdmin, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT h.cambiado_en AS fecha, 'Caso' AS tipo_registro,
        c.nombre_completo AS persona, h.estado_anterior, h.estado_nuevo,
        a.nombre_completo AS administrador, NULL::text AS motivo
      FROM cambios_estado_caso h
      JOIN casos c ON c.id = h.caso_id
      LEFT JOIN usuarios a ON a.id = h.cambiado_por
      UNION ALL
      SELECT h.cambiado_en AS fecha, 'Pista' AS tipo_registro,
        c.nombre_completo AS persona, h.estado_anterior, h.estado_nuevo,
        a.nombre_completo AS administrador, h.motivo
      FROM cambios_estado_pista h
      JOIN pistas p ON p.id = h.pista_id
      JOIN casos c ON c.id = p.caso_id
      LEFT JOIN usuarios a ON a.id = h.cambiado_por
      ORDER BY fecha DESC
      LIMIT 100
    `);
    res.json({ eventos: rows.map(row => ({
      fecha: row.fecha,
      tipoRegistro: row.tipo_registro,
      persona: row.persona,
      estadoAnterior: row.estado_anterior,
      estadoNuevo: row.estado_nuevo,
      administrador: row.administrador,
      motivo: row.motivo
    })) });
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
    if (state === 'VALIDADO' && [
      'verificoDenuncia',
      'datosCoherentes',
      'duplicadosVerificados',
      'menorValidado'
    ].some(key => req.body?.[key] !== true)) {
      return res.status(400).json({ error: 'Debe completar toda la lista de validación antes de publicar el caso.' });
    }
    if (state === 'CERRADO' && (typeof req.body?.motivo !== 'string' || !req.body.motivo.trim())) {
      return res.status(400).json({ error: 'Debe indicar la justificación para cerrar el caso.' });
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
          motivo_cierre = CASE WHEN $2 = 'CERRADO' THEN $3 ELSE motivo_cierre END,
          numero_denuncia = CASE WHEN $2 = 'VALIDADO' AND $4 <> '' THEN $4 ELSE numero_denuncia END,
          checklist_denuncia = CASE WHEN $2 = 'VALIDADO' THEN $5 ELSE checklist_denuncia END,
          checklist_coherencia = CASE WHEN $2 = 'VALIDADO' THEN $6 ELSE checklist_coherencia END,
          checklist_duplicados = CASE WHEN $2 = 'VALIDADO' THEN $7 ELSE checklist_duplicados END,
          checklist_menores = CASE WHEN $2 = 'VALIDADO' THEN $8 ELSE checklist_menores END,
          proximo_seguimiento = CASE
            WHEN $2 IN ('VALIDADO', 'EN_SEGUIMIENTO')
              AND $9 NOT IN ('VALIDADO', 'EN_SEGUIMIENTO')
              THEN CURRENT_TIMESTAMP + INTERVAL '48 hours'
            WHEN $2 IN ('LOCALIZADO', 'CERRADO', 'RECHAZADO', 'PENDIENTE') THEN NULL
            ELSE proximo_seguimiento
          END,
          seguimiento_etapa = CASE
            WHEN $2 IN ('VALIDADO', 'EN_SEGUIMIENTO')
              AND $9 NOT IN ('VALIDADO', 'EN_SEGUIMIENTO') THEN 0
            WHEN $2 IN ('LOCALIZADO', 'CERRADO', 'RECHAZADO', 'PENDIENTE') THEN 2
            ELSE seguimiento_etapa
          END
        WHERE id = $1 RETURNING *
      `, [
        req.params.id, state, req.body?.motivo || null, req.body?.numeroDenuncia || '',
        req.body?.verificoDenuncia === true, req.body?.datosCoherentes === true,
        req.body?.duplicadosVerificados === true, req.body?.menorValidado === true,
        current.estado
      ]);
      await client.query(`
        INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo, cambiado_por)
        VALUES ($1, $2, $3, $4)
      `, [req.params.id, current.estado, state, req.auth.id]);
      if (current.reportado_por_usr_id) {
        const caseName = current.nombre_completo;
        const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
        const transition = state === 'VALIDADO'
          ? ['Reporte aprobado', `El reporte de ${caseName} fue aprobado y publicado.`, 'CASO_VALIDADO']
          : state === 'PENDIENTE'
            ? ['Reporte devuelto a revisión', `El reporte de ${caseName} volvió a revisión.${reason ? ` Observación: ${reason}` : ''}`, 'CASO_REVISION']
            : state === 'RECHAZADO'
              ? ['Reporte rechazado', `El reporte de ${caseName} fue rechazado: ${reason}`, 'CASO_RECHAZADO']
              : state === 'EN_SEGUIMIENTO'
                ? ['Seguimiento actualizado', `El caso de ${caseName} pasó a seguimiento.`, 'CASO_SEGUIMIENTO']
                : state === 'CERRADO'
                  ? ['Caso cerrado', `El caso de ${caseName} fue cerrado: ${reason}`, 'CASO_CERRADO']
                  : null;
        if (transition) {
          await client.query(`
            INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
            VALUES ($1, $2, $3, $4, $5)
          `, [current.reportado_por_usr_id, req.params.id, ...transition]);
        }
      }
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
    res.json({ caso: toAdminCase(updated) });
  }));

  router.post('/admin/simulador/avanzar-48h', ...requireAdmin, asyncRoute(async (_req, res) => {
    await db.query(`
      UPDATE casos SET proximo_seguimiento = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO')
        AND seguimiento_etapa IN (0, 1)
        AND proximo_seguimiento IS NOT NULL
    `);
    const result = { consultasEnviadas: 0, casosEnSeguimiento: 0 };
    let batch;
    do {
      batch = await processDueFollowups(db);
      result.consultasEnviadas += batch.consultasEnviadas;
      result.casosEnSeguimiento += batch.casosEnSeguimiento;
    } while (batch.consultasEnviadas + batch.casosEnSeguimiento === 50);
    res.json({ mensaje: 'Simulación completada.', ...result });
  }));

  return router;
}
