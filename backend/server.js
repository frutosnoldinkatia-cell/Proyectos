import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, normalizeEmail, seedAdministrator } from './db.js';
import { authenticate, createAuthRouter, requireAdministrator } from './auth-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedOrigins = new Set([
  'http://127.0.0.1:5500',
  'http://localhost:5500'
]);

export function createApp({ db, mailer, jwtSecret }) {
  const app = express();
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origen no permitido por CORS.'));
    }
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use('/api/auth', createAuthRouter({ db, mailer, jwtSecret }));
  app.get('/api/auth/me', authenticate(jwtSecret), (req, res) => {
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ? AND verificado = 1').get(req.auth.id);
    if (!user || user.rol !== req.auth.rol) return res.status(401).json({ error: 'La sesión no es válida.' });
    res.json({ usuario: {
      id: user.id, nombre: user.nombre_completo, correo: user.correo,
      identificador: user.correo, rol: user.rol, verificado: Boolean(user.verificado),
      acepto_terminos: Boolean(user.acepto_terminos),
      fecha_aceptacion_terminos: user.fecha_aceptacion_terminos
    } });
  });
  app.post('/api/auth/terminos', authenticate(jwtSecret), (req, res) => {
    const result = db.prepare(`
      UPDATE usuarios
      SET acepto_terminos = 1, fecha_aceptacion_terminos = CURRENT_TIMESTAMP,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id = ? AND rol = ?
    `).run(req.auth.id, req.auth.rol);
    if (!result.changes) return res.status(404).json({ error: 'No se encontró el usuario autenticado.' });
    res.json({ mensaje: 'Aceptación guardada.' });
  });
  app.get('/api/admin/health', authenticate(jwtSecret), requireAdministrator, (_req, res) => {
    res.json({ estado: 'ok' });
  });
  app.use((error, _req, res, _next) => {
    console.error('Error del servidor:', error);
    res.status(500).json({ error: 'Ocurrió un error interno. Intente nuevamente.' });
  });
  return app;
}

function requiredEnvironment() {
  const missing = ['MAIL_USER', 'MAIL_PASS', 'JWT_SECRET', 'ADMIN_IDENTIFICADOR', 'ADMIN_PASSWORD']
    .filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(`Faltan variables en backend/.env: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
  }
}

async function start() {
  requiredEnvironment();
  const db = createDatabase(path.join(__dirname, 'rastreo.db'));
  await seedAdministrator(db, normalizeEmail(process.env.ADMIN_IDENTIFICADOR), process.env.ADMIN_PASSWORD);
  const mailer = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
  });
  const app = createApp({
    db,
    mailer,
    jwtSecret: process.env.JWT_SECRET
  });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend Rastreo PY disponible en http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch(error => {
    console.error('No se pudo iniciar el backend:', error.message);
    process.exitCode = 1;
  });
}
