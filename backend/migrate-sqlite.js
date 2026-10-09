import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, initializeDatabase, withTransaction } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = process.argv[2] || path.join(__dirname, 'rastreo.db');

function toTimestamp(value) {
  if (value == null || value instanceof Date) return value;
  const normalized = typeof value === 'string' && !value.includes('T')
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Fecha SQLite no válida en la migración: ${value}`);
  }
  return timestamp;
}

async function migrate() {
  const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
  let db;
  const migrated = { usuarios: 0, codigos_verificacion: 0, solicitudes_codigo: 0 };

  try {
    db = createDatabase();
    await initializeDatabase(db);
    await withTransaction(db, async client => {
      for (const row of sqlite.prepare('SELECT * FROM usuarios ORDER BY id').all()) {
        const result = await client.query(`
          INSERT INTO usuarios (
            id, nombre_completo, correo, contrasena_hash, rol, verificado,
            acepto_terminos, fecha_aceptacion_terminos, creado_en, actualizado_en
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT DO NOTHING
        `, [
          row.id,
          row.nombre_completo,
          row.correo,
          row.contrasena_hash,
          row.rol,
          Boolean(row.verificado),
          Boolean(row.acepto_terminos),
          toTimestamp(row.fecha_aceptacion_terminos),
          toTimestamp(row.creado_en),
          toTimestamp(row.actualizado_en)
        ]);
        migrated.usuarios += result.rowCount;
      }

      for (const row of sqlite.prepare('SELECT * FROM codigos_verificacion ORDER BY id').all()) {
        const result = await client.query(`
          INSERT INTO codigos_verificacion (
            id, correo, codigo_hash, proposito, nombre_completo, contrasena_hash,
            acepto_terminos, fecha_aceptacion_terminos, expira_en, intentos, creado_en
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT DO NOTHING
        `, [
          row.id,
          row.correo,
          row.codigo_hash,
          row.proposito,
          row.nombre_completo,
          row.contrasena_hash,
          Boolean(row.acepto_terminos),
          toTimestamp(row.fecha_aceptacion_terminos),
          toTimestamp(row.expira_en),
          row.intentos,
          toTimestamp(row.creado_en)
        ]);
        migrated.codigos_verificacion += result.rowCount;
      }

      for (const row of sqlite.prepare('SELECT * FROM solicitudes_codigo ORDER BY id').all()) {
        const result = await client.query(`
          INSERT INTO solicitudes_codigo (id, correo, proposito, creado_en)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [row.id, row.correo, row.proposito, toTimestamp(row.creado_en)]);
        migrated.solicitudes_codigo += result.rowCount;
      }

      for (const table of Object.keys(migrated)) {
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('${table}', 'id'),
            COALESCE(MAX(id), 1),
            MAX(id) IS NOT NULL
          )
          FROM ${table}
        `);
      }
    });

    console.log('Migración SQLite → PostgreSQL completada:', migrated);
  } finally {
    sqlite.close();
    if (db) await db.end();
  }
}

migrate().catch(error => {
  console.error('No se pudo migrar la base SQLite:', error.message);
  process.exitCode = 1;
});
