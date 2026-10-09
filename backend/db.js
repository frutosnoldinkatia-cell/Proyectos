import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

export function createDatabase(filename = 'rastreo.db') {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_completo TEXT NOT NULL,
      correo TEXT NOT NULL UNIQUE,
      contrasena_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'ciudadano' CHECK (rol IN ('ciudadano', 'administrador')),
      verificado INTEGER NOT NULL DEFAULT 0 CHECK (verificado IN (0, 1)),
      acepto_terminos INTEGER NOT NULL DEFAULT 0 CHECK (acepto_terminos IN (0, 1)),
      fecha_aceptacion_terminos TEXT,
      creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS codigos_verificacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correo TEXT NOT NULL,
      codigo_hash TEXT NOT NULL,
      proposito TEXT NOT NULL CHECK (proposito IN ('registro', 'restablecer')),
      nombre_completo TEXT,
      contrasena_hash TEXT,
      acepto_terminos INTEGER NOT NULL DEFAULT 0,
      fecha_aceptacion_terminos TEXT,
      expira_en TEXT NOT NULL,
      intentos INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (correo, proposito)
    );

    CREATE TABLE IF NOT EXISTS solicitudes_codigo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correo TEXT NOT NULL,
      proposito TEXT NOT NULL CHECK (proposito IN ('registro', 'restablecer')),
      creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_solicitudes_correo_fecha
      ON solicitudes_codigo (correo, creado_en);
  `);
  return db;
}

export async function seedAdministrator(db, email, password) {
  const correo = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || !password || password.length < 8) {
    throw new Error('ADMIN_IDENTIFICADOR debe ser un correo válido y ADMIN_PASSWORD debe tener al menos 8 caracteres.');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado)
    VALUES (?, ?, ?, 'administrador', 1)
    ON CONFLICT(correo) DO UPDATE SET
      contrasena_hash = excluded.contrasena_hash,
      rol = 'administrador',
      verificado = 1,
      actualizado_en = CURRENT_TIMESTAMP
  `).run('Administrador Rastreo PY', correo, passwordHash);
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isGmail(email) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/i.test(email);
}
