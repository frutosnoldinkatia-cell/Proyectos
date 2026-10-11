import bcrypt from 'bcrypt';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

function resolveSsl(connectionString) {
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (process.env.DATABASE_SSL === 'false') return false;
  if (connectionString && (connectionString.includes('@db:') || connectionString.includes('@localhost') || connectionString.includes('@127.0.0.1'))) {
    return false;
  }
  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
}

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('Falta la variable DATABASE_URL.');
  }
  return new Pool({
    connectionString,
    ssl: resolveSsl(connectionString)
  });
}

// Aplica en orden los archivos migrations/NNN_descripcion.sql que todavía no
// figuran en schema_migrations, todo en una transacción. El advisory lock evita
// que dos procesos (por ejemplo, dos réplicas o dos archivos de test) migren a la vez.
export async function initializeDatabase(db) {
  const files = (await readdir(MIGRATIONS_DIR)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  await withTransaction(db, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['rastreopy_migraciones']);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        archivo TEXT NOT NULL,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(row => row.version));
    for (const file of files) {
      const version = file.slice(0, 3);
      if (applied.has(version)) continue;
      await client.query(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version, archivo) VALUES ($1, $2)', [version, file]);
    }
  });
}

export async function withTransaction(db, callback) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function administratorValues(email, password) {
  const correo = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || !password || password.length < 8) {
    throw new Error('ADMIN_IDENTIFICADOR debe ser un correo válido y ADMIN_PASSWORD debe tener al menos 8 caracteres.');
  }
  return ['Administrador Rastreo PY', correo, await bcrypt.hash(password, 10)];
}

// Crea o restablece el administrador: si ya existe, reemplaza su contraseña y
// cierra sus sesiones abiertas. Lo usa crear-admin.js (acción explícita).
export async function seedAdministrator(db, email, password) {
  await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado)
    VALUES ($1, $2, $3, 'administrador', TRUE)
    ON CONFLICT(correo) DO UPDATE SET
      contrasena_hash = EXCLUDED.contrasena_hash,
      rol = 'administrador',
      verificado = TRUE,
      sesion_version = usuarios.sesion_version + 1,
      actualizado_en = CURRENT_TIMESTAMP
  `, await administratorValues(email, password));
}

// Al arrancar el servidor: crea el administrador si no existe y le asegura el
// rol, pero no toca la contraseña de una cuenta existente (si se cambió, se respeta).
export async function ensureAdministrator(db, email, password) {
  await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado)
    VALUES ($1, $2, $3, 'administrador', TRUE)
    ON CONFLICT(correo) DO UPDATE SET
      rol = 'administrador',
      verificado = TRUE,
      actualizado_en = CURRENT_TIMESTAMP
    WHERE usuarios.rol <> 'administrador' OR NOT usuarios.verificado
  `, await administratorValues(email, password));
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isGmail(email) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/i.test(email);
}
