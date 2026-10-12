import express from 'express';
import { asyncRoute } from './auth-routes.js';

// Estadísticas públicas: solo agregados, nunca registros personales.
export function createStatsRouter({ db, publicReadLimiter }) {
  const router = express.Router();

  router.get('/estadisticas', publicReadLimiter, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')) AS total,
        COUNT(*) FILTER (WHERE estado IN ('LOCALIZADO', 'CERRADO')) AS encontrados,
        COUNT(*) FILTER (WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO')) AS activos,
        COUNT(*) FILTER (WHERE estado = 'LOCALIZADO') AS localizados,
        COUNT(*) FILTER (WHERE estado = 'CERRADO') AS cerrados
      FROM casos
    `);
    const [porMes, porCiudad, porSexo, porEdad, casosPorCiudad, casosPorEdad, casosPorEstado, casosPorDepartamento] = await Promise.all([
      db.query(`SELECT TO_CHAR(DATE_TRUNC('month', localizado_en), 'YYYY-MM') AS periodo, COUNT(*) AS total
        FROM casos WHERE estado = 'LOCALIZADO' GROUP BY 1 ORDER BY 1`),
      db.query(`SELECT ciudad AS categoria, COUNT(*) AS total FROM casos
        WHERE estado = 'LOCALIZADO' GROUP BY ciudad ORDER BY total DESC`),
      db.query(`SELECT sexo AS categoria, COUNT(*) AS total FROM casos
        WHERE estado = 'LOCALIZADO' GROUP BY sexo ORDER BY sexo`),
      db.query(`SELECT CASE WHEN edad < 18 THEN '0-17' WHEN edad < 30 THEN '18-29'
        WHEN edad < 60 THEN '30-59' ELSE '60+' END AS categoria, COUNT(*) AS total
        FROM casos WHERE estado = 'LOCALIZADO' GROUP BY 1 ORDER BY 1`),
      db.query(`SELECT ciudad AS categoria, departamento, COUNT(*) AS total
        FROM casos
        WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')
        GROUP BY ciudad, departamento ORDER BY total DESC, ciudad`),
      db.query(`SELECT CASE
          WHEN edad BETWEEN 0 AND 11 THEN 'Niñez (0–11)'
          WHEN edad BETWEEN 12 AND 17 THEN 'Adolescentes (12–17)'
          WHEN edad BETWEEN 18 AND 64 THEN 'Adultos (18–64)'
          ELSE 'Mayores (65+)'
        END AS categoria, COUNT(*) AS total
        FROM casos
        WHERE edad >= 0 AND estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')
        GROUP BY 1
        ORDER BY MIN(edad)`),
      db.query(`SELECT CASE estado
          WHEN 'VALIDADO' THEN 'Búsqueda activa'
          WHEN 'LOCALIZADO' THEN 'Localizada'
          WHEN 'EN_SEGUIMIENTO' THEN 'En seguimiento'
          WHEN 'CERRADO' THEN 'Cerrado'
        END AS categoria, COUNT(*) AS total
        FROM casos
        WHERE estado IN ('VALIDADO', 'LOCALIZADO', 'EN_SEGUIMIENTO', 'CERRADO')
        GROUP BY estado
        ORDER BY CASE estado
          WHEN 'VALIDADO' THEN 1
          WHEN 'LOCALIZADO' THEN 2
          WHEN 'EN_SEGUIMIENTO' THEN 3
          WHEN 'CERRADO' THEN 4
        END`),
      db.query(`SELECT departamento AS categoria, COUNT(*) AS total
        FROM casos
        WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')
        GROUP BY departamento ORDER BY total DESC, departamento`)
    ]);
    res.json({
      ...rows[0],
      porcentajeResueltos: Number(rows[0].total) ? Math.round(Number(rows[0].encontrados) / Number(rows[0].total) * 100) : 0,
      porMes: porMes.rows, porCiudad: porCiudad.rows, porSexo: porSexo.rows, porEdad: porEdad.rows,
      casosPorCiudad: casosPorCiudad.rows, casosPorEdad: casosPorEdad.rows,
      casosPorEstado: casosPorEstado.rows, casosPorDepartamento: casosPorDepartamento.rows
    });
  }));

  return router;
}
