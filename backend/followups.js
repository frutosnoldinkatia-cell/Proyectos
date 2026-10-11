import { withTransaction } from './db.js';

// Seguimiento automático: a las 48 h consulta al reportante si la búsqueda sigue
// activa y, sin respuesta en 24 h, pasa el caso a EN_SEGUIMIENTO y avisa a la
// administración. Lo ejecuta server.js cada minuto y el simulador del admin.
export async function processDueFollowups(db) {
  return withTransaction(db, async client => {
    const { rows: dueCases } = await client.query(`
      SELECT id, nombre_completo, reportado_por_usr_id, estado, seguimiento_etapa
      FROM casos
      WHERE proximo_seguimiento <= CURRENT_TIMESTAMP
        AND estado IN ('VALIDADO', 'EN_SEGUIMIENTO')
        AND seguimiento_etapa < 2
      ORDER BY proximo_seguimiento
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);
    const result = { consultasEnviadas: 0, casosEnSeguimiento: 0 };

    for (const caso of dueCases) {
      if (caso.seguimiento_etapa === 0) {
        await client.query(`
          UPDATE casos SET seguimiento_etapa = 1,
            proximo_seguimiento = CURRENT_TIMESTAMP + INTERVAL '24 hours'
          WHERE id = $1
        `, [caso.id]);
        if (caso.reportado_por_usr_id) {
          await client.query(`
            INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
            VALUES ($1, $2, 'Consulta de seguimiento', $3, 'SEGUIMIENTO')
          `, [
            caso.reportado_por_usr_id,
            caso.id,
            `¿La búsqueda de ${caso.nombre_completo} continúa activa? Responda dentro de las próximas 24 horas.`
          ]);
        }
        result.consultasEnviadas += 1;
        continue;
      }

      await client.query(`
        UPDATE casos SET estado = 'EN_SEGUIMIENTO', seguimiento_etapa = 2,
          proximo_seguimiento = NULL
        WHERE id = $1
      `, [caso.id]);
      if (caso.estado !== 'EN_SEGUIMIENTO') {
        await client.query(`
          INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo)
          VALUES ($1, $2, 'EN_SEGUIMIENTO')
        `, [caso.id, caso.estado]);
      }
      if (caso.reportado_por_usr_id) {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          VALUES ($1, $2, 'Seguimiento pendiente', $3, 'SEGUIMIENTO_VENCIDO')
        `, [caso.reportado_por_usr_id, caso.id, `El caso de ${caso.nombre_completo} pasó a seguimiento por falta de respuesta.`]);
      }
      await client.query(`
        INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
        SELECT id, $1, 'Caso sin actualizar', $2, 'CASO_SIN_ACTUALIZAR'
        FROM usuarios WHERE rol = 'administrador'
      `, [caso.id, `El caso de ${caso.nombre_completo} no recibió respuesta al seguimiento.`]);
      result.casosEnSeguimiento += 1;
    }
    return result;
  });
}
