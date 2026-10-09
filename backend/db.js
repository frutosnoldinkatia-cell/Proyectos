import bcrypt from 'bcrypt';
import pg from 'pg';

const { Pool } = pg;

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('Falta la variable DATABASE_URL.');
  }
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
}

export async function initializeDatabase(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre_completo TEXT NOT NULL,
      correo TEXT NOT NULL UNIQUE,
      contrasena_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'ciudadano' CHECK (rol IN ('ciudadano', 'administrador')),
      verificado BOOLEAN NOT NULL DEFAULT FALSE,
      acepto_terminos BOOLEAN NOT NULL DEFAULT FALSE,
      fecha_aceptacion_terminos TIMESTAMPTZ,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS codigos_verificacion (
      id SERIAL PRIMARY KEY,
      correo TEXT NOT NULL,
      codigo_hash TEXT NOT NULL,
      proposito TEXT NOT NULL CHECK (proposito IN ('registro', 'restablecer')),
      nombre_completo TEXT,
      contrasena_hash TEXT,
      acepto_terminos BOOLEAN NOT NULL DEFAULT FALSE,
      fecha_aceptacion_terminos TIMESTAMPTZ,
      expira_en TIMESTAMPTZ NOT NULL,
      intentos INTEGER NOT NULL DEFAULT 0,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (correo, proposito)
    );

    CREATE TABLE IF NOT EXISTS solicitudes_codigo (
      id SERIAL PRIMARY KEY,
      correo TEXT NOT NULL,
      proposito TEXT NOT NULL CHECK (proposito IN ('registro', 'restablecer')),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_solicitudes_correo_fecha
      ON solicitudes_codigo (correo, creado_en);
  `);
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

export async function seedAdministrator(db, email, password) {
  const correo = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || !password || password.length < 8) {
    throw new Error('ADMIN_IDENTIFICADOR debe ser un correo válido y ADMIN_PASSWORD debe tener al menos 8 caracteres.');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado)
    VALUES ($1, $2, $3, 'administrador', TRUE)
    ON CONFLICT(correo) DO UPDATE SET
      contrasena_hash = EXCLUDED.contrasena_hash,
      rol = 'administrador',
      verificado = TRUE,
      actualizado_en = CURRENT_TIMESTAMP
  `, ['Administrador Rastreo PY', correo, passwordHash]);
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isGmail(email) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/i.test(email);
}
