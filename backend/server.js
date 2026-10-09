import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  initializeDatabase,
  normalizeEmail,
  seedAdministrator
} from './db.js';
import { authenticate, createAuthRouter, requireAdministrator } from './auth-routes.js';
import { createCaseRouter } from './case-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createApp({ db, mailer, jwtSecret, appUrl = process.env.APP_URL }) {
  const app = express();
  app.set('trust proxy', 1);
  const allowedOrigin = appUrl ? new URL(appUrl).origin : '';

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://unpkg.com', 'https://images.unsplash.com', 'https://tile.openstreetmap.org'],
        fontSrc: ["'self'", 'data:', 'https://unpkg.com'],
        connectSrc: ["'self'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === allowedOrigin) return callback(null, true);
      return callback(new Error('Origen no permitido por CORS.'));
    }
  }));
  app.use(express.json({ limit: '12mb' }));
  app.use('/api', createCaseRouter({ db, jwtSecret }));
  app.use('/api/auth', createAuthRouter({ db, mailer, jwtSecret }));
  app.get('/api/auth/me', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      'SELECT * FROM usuarios WHERE id = $1 AND verificado = TRUE',
      [req.auth.id]
    );
    const user = rows[0];
    if (!user || user.rol !== req.auth.rol) {
      return res.status(401).json({ error: 'La sesión no es válida.' });
    }
    res.json({ usuario: {
      id: user.id, nombre: user.nombre_completo, correo: user.correo,
      identificador: user.correo, rol: user.rol, verificado: Boolean(user.verificado),
      acepto_terminos: Boolean(user.acepto_terminos),
      fecha_aceptacion_terminos: user.fecha_aceptacion_terminos
    } });
  }));
  app.post('/api/auth/terminos', authenticate(jwtSecret), asyncRoute(async (req, res) => {
    const result = await db.query(`
      UPDATE usuarios
      SET acepto_terminos = TRUE, fecha_aceptacion_terminos = CURRENT_TIMESTAMP,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $1 AND rol = $2
    `, [req.auth.id, req.auth.rol]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'No se encontró el usuario autenticado.' });
    }
    res.json({ mensaje: 'Aceptación guardada.' });
  }));
  app.get('/api/admin/health', authenticate(jwtSecret), requireAdministrator, (_req, res) => {
    res.json({ estado: 'ok' });
  });
  app.get('/', (_req, res) => {
    res.sendFile(path.join(projectRoot, 'Rastreopy.html'));
  });
  app.use((req, res, next) => {
    let decodedPath = req.path;
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const nextPath = decodeURIComponent(decodedPath);
        if (nextPath === decodedPath) break;
        decodedPath = nextPath;
      }
    } catch {
      return res.sendStatus(400);
    }
    if (/%[0-9a-f]{2}/i.test(decodedPath)) return res.sendStatus(400);

    const relativePath = path.relative(projectRoot, path.resolve(projectRoot, `.${decodedPath}`));
    const protectedDirectory = relativePath.split(path.sep)[0]?.toLowerCase();
    if (
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath) ||
      ['backend', '.git', 'node_modules'].includes(protectedDirectory)
    ) {
      return res.sendStatus(404);
    }
    next();
  });
  app.use(express.static(projectRoot, { dotfiles: 'deny', index: false }));
  app.use((error, _req, res, _next) => {
    console.error('Error del servidor:', error);
    res.status(500).json({ error: 'Ocurrió un error interno. Intente nuevamente.' });
  });
  return app;
}

function requiredEnvironment() {
  const missing = [
    'DATABASE_URL',
    'MAIL_USER',
    'MAIL_PASS',
    'JWT_SECRET',
    'ADMIN_IDENTIFICADOR',
    'ADMIN_PASSWORD',
    'APP_URL'
  ].filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(`Faltan variables en backend/.env: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
  }
  try {
    new URL(process.env.APP_URL);
  } catch {
    throw new Error('APP_URL debe ser una URL válida, incluyendo el protocolo.');
  }
}

async function start() {
  requiredEnvironment();
  const db = createDatabase(process.env.DATABASE_URL);
  await initializeDatabase(db);
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
    jwtSecret: process.env.JWT_SECRET,
    appUrl: process.env.APP_URL
  });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor Rastreo PY disponible en el puerto ${port}.`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch(error => {
    console.error('No se pudo iniciar el backend:', error.message);
    process.exitCode = 1;
  });
}
