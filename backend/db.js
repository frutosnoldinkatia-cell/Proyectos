import bcrypt from 'bcrypt';
import pg from 'pg';

const { Pool } = pg;

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('Falta la variable DATABASE_URL.');
  }
  return new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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

    CREATE TABLE IF NOT EXISTS casos (
      id TEXT PRIMARY KEY,
      nombre_completo TEXT NOT NULL,
      edad INTEGER NOT NULL,
      sexo TEXT NOT NULL,
      ciudad TEXT NOT NULL,
      departamento TEXT NOT NULL DEFAULT '',
      descripcion_fisica TEXT NOT NULL,
      vestimenta TEXT NOT NULL,
      senas_particulares TEXT NOT NULL DEFAULT '',
      fecha_hora_desaparicion TIMESTAMPTZ NOT NULL,
      foto TEXT NOT NULL DEFAULT '',
      latitud DOUBLE PRECISION NOT NULL,
      longitud DOUBLE PRECISION NOT NULL,
      direccion TEXT NOT NULL DEFAULT '',
      numero_denuncia TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'PENDIENTE',
      motivo_rechazo TEXT,
      reportado_por_usr_id INTEGER REFERENCES usuarios(id),
      localizado_en TIMESTAMPTZ,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      proximo_seguimiento TIMESTAMPTZ,
      reportante_mayor_edad BOOLEAN NOT NULL DEFAULT FALSE,
      autorizacion_parental BOOLEAN NOT NULL DEFAULT FALSE,
      aviso_privacidad_aceptado BOOLEAN NOT NULL DEFAULT FALSE,
      checklist_denuncia BOOLEAN NOT NULL DEFAULT FALSE,
      checklist_coherencia BOOLEAN NOT NULL DEFAULT FALSE,
      checklist_duplicados BOOLEAN NOT NULL DEFAULT FALSE,
      checklist_menores BOOLEAN NOT NULL DEFAULT FALSE,
      motivo_cierre TEXT,
      seguimiento_etapa SMALLINT NOT NULL DEFAULT 0
    );

    ALTER TABLE casos ADD COLUMN IF NOT EXISTS localizado_en TIMESTAMPTZ;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS departamento TEXT NOT NULL DEFAULT '';
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS reportante_mayor_edad BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS autorizacion_parental BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS aviso_privacidad_aceptado BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS checklist_denuncia BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS checklist_coherencia BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS checklist_duplicados BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS checklist_menores BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS motivo_cierre TEXT;
    ALTER TABLE casos ADD COLUMN IF NOT EXISTS seguimiento_etapa SMALLINT NOT NULL DEFAULT 0;
    UPDATE casos SET localizado_en = CURRENT_TIMESTAMP
      WHERE estado = 'LOCALIZADO' AND localizado_en IS NULL;

    CREATE INDEX IF NOT EXISTS idx_casos_estado_localizado
      ON casos (estado, localizado_en);
    CREATE INDEX IF NOT EXISTS idx_casos_seguimiento_due
      ON casos (proximo_seguimiento) WHERE proximo_seguimiento IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_casos_creado_en ON casos (creado_en);

    CREATE TABLE IF NOT EXISTS pistas (
      id TEXT PRIMARY KEY,
      caso_id TEXT NOT NULL REFERENCES casos(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      descripcion TEXT NOT NULL,
      fecha_hora_avistamiento TIMESTAMPTZ NOT NULL,
      latitud DOUBLE PRECISION NOT NULL,
      longitud DOUBLE PRECISION NOT NULL,
      direccion TEXT NOT NULL DEFAULT '',
      fotos TEXT[] NOT NULL DEFAULT '{}',
      estado TEXT NOT NULL DEFAULT 'PENDIENTE',
      fecha_envio TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE pistas ADD COLUMN IF NOT EXISTS fotos TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE pistas ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'PENDIENTE';

    CREATE TABLE IF NOT EXISTS cambios_estado_pista (
      id BIGSERIAL PRIMARY KEY,
      pista_id TEXT NOT NULL REFERENCES pistas(id),
      estado_anterior TEXT,
      estado_nuevo TEXT NOT NULL,
      motivo TEXT,
      cambiado_por INTEGER REFERENCES usuarios(id),
      cambiado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cambios_estado_caso (
      id BIGSERIAL PRIMARY KEY,
      caso_id TEXT NOT NULL REFERENCES casos(id),
      estado_anterior TEXT,
      estado_nuevo TEXT NOT NULL,
      cambiado_por INTEGER REFERENCES usuarios(id),
      cambiado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suscripciones_caso (
      caso_id TEXT NOT NULL REFERENCES casos(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      PRIMARY KEY (caso_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS notificaciones (
      id BIGSERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      caso_id TEXT REFERENCES casos(id),
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      tipo TEXT NOT NULL,
      leida BOOLEAN NOT NULL DEFAULT FALSE,
      creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS leida BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_pistas_caso ON pistas (caso_id, fecha_envio);
    CREATE INDEX IF NOT EXISTS idx_cambios_estado_caso ON cambios_estado_caso (caso_id, cambiado_en);
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
