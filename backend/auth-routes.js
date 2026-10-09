import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { isGmail, normalizeEmail, withTransaction } from './db.js';

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;

function publicUser(user) {
  return {
    id: user.id,
    nombre: user.nombre_completo,
    correo: user.correo,
    identificador: user.correo,
    rol: user.rol,
    verificado: Boolean(user.verificado),
    acepto_terminos: Boolean(user.acepto_terminos),
    fecha_aceptacion_terminos: user.fecha_aceptacion_terminos
  };
}

function makeCode(secret) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return { code, hash: createHmac('sha256', secret).update(code).digest('hex') };
}

function codeMatches(code, storedHash, secret) {
  const candidate = Buffer.from(createHmac('sha256', secret).update(code).digest('hex'), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function codeRateLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intente nuevamente más tarde.' }
  });
}

function loginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Espere 15 minutos.' }
  });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendCodeLimiter(db) {
  return asyncRoute(async (req, res, next) => {
    const email = normalizeEmail(req.body?.correo);
    if (!email) return next();

    const allowed = await withTransaction(db, async client => {
      await client.query("DELETE FROM solicitudes_codigo WHERE creado_en < NOW() - INTERVAL '1 hour'");
      const { rows } = await client.query(`
        SELECT COUNT(*) AS total FROM solicitudes_codigo
        WHERE correo = $1 AND creado_en >= NOW() - INTERVAL '1 hour'
      `, [email]);
      if (Number(rows[0].total) >= 5) return false;
      await client.query(
        'INSERT INTO solicitudes_codigo (correo, proposito) VALUES ($1, $2)',
        [email, req.codePurpose]
      );
      return true;
    });

    if (!allowed) {
      return res.status(429).json({ error: 'Se alcanzó el límite de 5 envíos por hora para este correo.' });
    }
    next();
  });
}

function createJwt(user, secret) {
  return jwt.sign({ id: user.id, rol: user.rol }, secret, { expiresIn: '8h' });
}

export function authenticate(secret) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Debe iniciar sesión.' });
    try {
      req.auth = jwt.verify(token, secret);
      next();
    } catch {
      res.status(401).json({ error: 'La sesión venció o no es válida. Inicie sesión nuevamente.' });
    }
  };
}

export function requireAdministrator(req, res, next) {
  if (req.auth?.rol !== 'administrador') {
    return res.status(403).json({ error: 'Acceso exclusivo para administradores.' });
  }
  next();
}

export function createAuthRouter({ db, mailer, jwtSecret }) {
  const router = express.Router();
  const sendLimiter = codeRateLimiter();
  const loginLimiter = loginRateLimiter();

  async function sendCode({ correo, nombre, code, purpose }) {
    const subject = purpose === 'registro'
      ? 'Código de verificación - Rastreo PY'
      : 'Código para restablecer la contraseña - Rastreo PY';
    const greeting = nombre ? `Estimado/a ${nombre},` : 'Estimado/a usuario/a,';
    await mailer.sendMail({
      from: `"Rastreo PY" <${process.env.MAIL_USER}>`,
      to: correo,
      subject,
      text: `${greeting}\n\nSu código de verificación es: ${code}\n\nEste código vence en 10 minutos. Si usted no solicitó esta operación, ignore este mensaje.`,
      html: `<p>${escapeHtml(greeting)}</p><p>Su código de verificación es:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>Este código vence en 10 minutos. Si usted no solicitó esta operación, ignore este mensaje.</p>`
    });
  }

  async function persistCode({ correo, codeHash, proposito, nombre = null, passwordHash = null, accepted = false }) {
    const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS);
    await db.query(`
      INSERT INTO codigos_verificacion (
        correo, codigo_hash, proposito, nombre_completo, contrasena_hash,
        acepto_terminos, fecha_aceptacion_terminos, expira_en, intentos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
      ON CONFLICT(correo, proposito) DO UPDATE SET
        codigo_hash = EXCLUDED.codigo_hash,
        nombre_completo = EXCLUDED.nombre_completo,
        contrasena_hash = EXCLUDED.contrasena_hash,
        acepto_terminos = EXCLUDED.acepto_terminos,
        fecha_aceptacion_terminos = EXCLUDED.fecha_aceptacion_terminos,
        expira_en = EXCLUDED.expira_en,
        intentos = 0,
        creado_en = CURRENT_TIMESTAMP
    `, [
      correo,
      codeHash,
      proposito,
      nombre,
      passwordHash,
      accepted,
      accepted ? new Date() : null,
      expiresAt
    ]);
  }

  async function checkCode(correo, proposito, code, res) {
    const { rows } = await db.query(
      'SELECT * FROM codigos_verificacion WHERE correo = $1 AND proposito = $2',
      [correo, proposito]
    );
    const pending = rows[0];
    if (!pending) {
      res.status(400).json({ error: 'No hay un código pendiente. Solicite uno nuevo.' });
      return null;
    }
    if (Date.parse(pending.expira_en) <= Date.now()) {
      res.status(400).json({ error: 'El código venció. Solicite uno nuevo.' });
      return null;
    }
    if (pending.intentos >= 5) {
      res.status(429).json({ error: 'Demasiados intentos. Solicite un código nuevo.' });
      return null;
    }
    if (!codeMatches(code, pending.codigo_hash, jwtSecret)) {
      const result = await db.query(
        'UPDATE codigos_verificacion SET intentos = intentos + 1 WHERE id = $1 RETURNING intentos',
        [pending.id]
      );
      const attempts = result.rows[0]?.intentos ?? pending.intentos + 1;
      if (attempts >= 5) {
        await db.query(
          'DELETE FROM codigos_verificacion WHERE id = $1',
          [pending.id]
        );
        res.status(429).json({ error: 'Demasiados intentos. Solicite un código nuevo.' });
      } else {
        res.status(400).json({ error: `Código incorrecto. Le quedan ${5 - attempts} intentos.` });
      }
      return null;
    }
    return pending;
  }

  function validGmail(value) {
    const email = normalizeEmail(value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isGmail(email)) return '';
    return email;
  }

  router.post('/registro', (req, res, next) => {
    req.codePurpose = 'registro';
    next();
  }, sendLimiter, sendCodeLimiter(db), asyncRoute(async (req, res) => {
    const nombre = typeof req.body?.nombre_completo === 'string' ? req.body.nombre_completo.trim() : '';
    const correo = validGmail(req.body?.correo);
    const password = req.body?.contrasena;
    const accepted = req.body?.acepto_terminos === true;
    if (nombre.length < 3) return res.status(400).json({ error: 'El nombre completo debe tener al menos 3 caracteres.' });
    if (!correo) return res.status(400).json({ error: 'Ingrese una cuenta de Gmail válida (terminada en @gmail.com).' });
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    if (!accepted) return res.status(400).json({ error: 'Debe aceptar las bases y condiciones para registrarse.' });

    const { rows } = await db.query(
      'SELECT id FROM usuarios WHERE correo = $1 AND verificado = TRUE',
      [correo]
    );
    if (rows[0]) return res.status(409).json({ error: 'Este Gmail ya está registrado. Inicie sesión.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const { code, hash } = makeCode(jwtSecret);
    await persistCode({
      correo, codeHash: hash, proposito: 'registro', nombre,
      passwordHash, accepted
    });
    try {
      await sendCode({ correo, nombre, code, purpose: 'registro' });
    } catch (error) {
      await db.query(
        'DELETE FROM codigos_verificacion WHERE correo = $1 AND proposito = $2',
        [correo, 'registro']
      );
      console.error('No se pudo enviar el correo de verificación:', error);
      return res.status(503).json({ error: 'No se pudo enviar el correo. Intente nuevamente.' });
    }
    res.json({ mensaje: 'Código enviado al Gmail.', correo });
  }));

  router.post('/verificar', asyncRoute(async (req, res) => {
    const correo = validGmail(req.body?.correo);
    const code = typeof req.body?.codigo === 'string' ? req.body.codigo.trim() : '';
    if (!correo || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Ingrese el Gmail y el código de 6 dígitos.' });
    }
    const pending = await checkCode(correo, 'registro', code, res);
    if (!pending) return;

    try {
      await withTransaction(db, async client => {
        await client.query(`
          INSERT INTO usuarios (
            nombre_completo, correo, contrasena_hash, rol, verificado,
            acepto_terminos, fecha_aceptacion_terminos
          ) VALUES ($1, $2, $3, 'ciudadano', TRUE, $4, $5)
        `, [
          pending.nombre_completo,
          pending.correo,
          pending.contrasena_hash,
          pending.acepto_terminos,
          pending.fecha_aceptacion_terminos
        ]);
        await client.query('DELETE FROM codigos_verificacion WHERE id = $1', [pending.id]);
      });
      res.status(201).json({ mensaje: 'Cuenta creada correctamente.', correo });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Este Gmail ya está registrado. Inicie sesión.' });
      }
      throw error;
    }
  }));

  router.post('/registro/reenviar', (req, res, next) => {
    req.codePurpose = 'registro';
    next();
  }, sendLimiter, sendCodeLimiter(db), asyncRoute(async (req, res) => {
    const correo = validGmail(req.body?.correo);
    if (!correo) return res.status(400).json({ error: 'Ingrese una cuenta de Gmail válida (terminada en @gmail.com).' });
    const { rows } = await db.query(`
      SELECT * FROM codigos_verificacion WHERE correo = $1 AND proposito = 'registro'
    `, [correo]);
    const pending = rows[0];
    if (!pending) return res.status(404).json({ error: 'No hay un registro pendiente. Complete el formulario nuevamente.' });
    const recent = Date.parse(pending.creado_en);
    if (Number.isFinite(recent) && Date.now() - recent < RESEND_INTERVAL_MS) {
      return res.status(429).json({ error: 'Espere 60 segundos antes de solicitar otro código.' });
    }
    const { code, hash } = makeCode(jwtSecret);
    await persistCode({
      correo, codeHash: hash, proposito: 'registro', nombre: pending.nombre_completo,
      passwordHash: pending.contrasena_hash, accepted: pending.acepto_terminos
    });
    try {
      await sendCode({ correo, nombre: pending.nombre_completo, code, purpose: 'registro' });
      res.json({ mensaje: 'Código reenviado.' });
    } catch (error) {
      await db.query(
        'DELETE FROM codigos_verificacion WHERE correo = $1 AND proposito = $2',
        [correo, 'registro']
      );
      console.error('No se pudo reenviar el correo de verificación:', error);
      res.status(503).json({ error: 'No se pudo enviar el correo. Intente nuevamente.' });
    }
  }));

  router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
    const correo = normalizeEmail(req.body?.correo);
    const password = req.body?.contrasena;
    const { rows } = await db.query(
      'SELECT * FROM usuarios WHERE correo = $1 AND verificado = TRUE',
      [correo]
    );
    const user = rows[0];
    if (!user || typeof password !== 'string' || !await bcrypt.compare(password, user.contrasena_hash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    res.json({ token: createJwt(user, jwtSecret), usuario: publicUser(user) });
  }));

  router.post('/restablecer/solicitar', (req, res, next) => {
    req.codePurpose = 'restablecer';
    next();
  }, sendLimiter, sendCodeLimiter(db), asyncRoute(async (req, res) => {
    const correo = validGmail(req.body?.correo);
    if (!correo) return res.status(400).json({ error: 'Ingrese una cuenta de Gmail válida (terminada en @gmail.com).' });
    const { rows } = await db.query(
      'SELECT id, nombre_completo FROM usuarios WHERE correo = $1 AND verificado = TRUE',
      [correo]
    );
    const user = rows[0];
    if (!user) return res.json({ mensaje: 'Si la cuenta existe, recibirá un código de restablecimiento.' });

    const { code, hash } = makeCode(jwtSecret);
    await persistCode({ correo, codeHash: hash, proposito: 'restablecer', nombre: user.nombre_completo });
    try {
      await sendCode({ correo, nombre: user.nombre_completo, code, purpose: 'restablecer' });
      res.json({ mensaje: 'Si la cuenta existe, recibirá un código de restablecimiento.' });
    } catch (error) {
      await db.query(
        'DELETE FROM codigos_verificacion WHERE correo = $1 AND proposito = $2',
        [correo, 'restablecer']
      );
      console.error('No se pudo enviar el correo de restablecimiento:', error);
      res.status(503).json({ error: 'No se pudo enviar el correo. Intente nuevamente.' });
    }
  }));

  router.post('/restablecer/confirmar', asyncRoute(async (req, res) => {
    const correo = validGmail(req.body?.correo);
    const code = typeof req.body?.codigo === 'string' ? req.body.codigo.trim() : '';
    const password = req.body?.nueva_contrasena;
    if (!correo || !/^\d{6}$/.test(code) || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Ingrese un código válido y una contraseña de al menos 8 caracteres.' });
    }
    const pending = await checkCode(correo, 'restablecer', code, res);
    if (!pending) return;

    const passwordHash = await bcrypt.hash(password, 10);
    await withTransaction(db, async client => {
      await client.query(`
        UPDATE usuarios SET contrasena_hash = $1, actualizado_en = CURRENT_TIMESTAMP
        WHERE correo = $2 AND verificado = TRUE
      `, [passwordHash, correo]);
      await client.query('DELETE FROM codigos_verificacion WHERE id = $1', [pending.id]);
    });
    res.json({ mensaje: 'Contraseña actualizada correctamente.' });
  }));

  return router;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
