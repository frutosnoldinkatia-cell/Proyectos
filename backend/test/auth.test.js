import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createDatabase, ensureAdministrator, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test('sirve la página desde Express con el origen público y headers de seguridad', async () => {
  const app = createApp({
    db: { query: async () => ({ rows: [], rowCount: 0 }) },
    mailer: { sendMail: async () => {} },
    jwtSecret: 'test-secret-with-at-least-thirty-two-characters',
    appUrl: 'https://rastreo.example'
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    assert.equal(app.get('trust proxy'), 1);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      headers: { Origin: 'https://rastreo.example' }
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://rastreo.example');
    assert.match(response.headers.get('content-security-policy'), /script-src/);
    // Sin scripts ni handlers inline (E2): protege contra XSS por inyección de HTML.
    assert.doesNotMatch(response.headers.get('content-security-policy'), /script-src[^;]*unsafe-inline/);
    assert.match(response.headers.get('content-security-policy'), /script-src-attr 'none'/);
    // Las vistas previas de fotos usan URL blob: generadas en el navegador.
    assert.match(response.headers.get('content-security-policy'), /img-src[^;]*blob:/);
    assert.match(response.headers.get('content-security-policy'), /tile\.openstreetmap\.org/);
    assert.match(response.headers.get('content-security-policy'), /connect-src[^;]*nominatim\.openstreetmap\.org/);
    assert.match(await response.text(), /<script type="module" src="\/js\/app\.js"><\/script>/);
    const configModule = await fetch(`http://127.0.0.1:${server.address().port}/js/config.js`);
    assert.match(configModule.headers.get('content-type'), /javascript/);
    assert.match(await configModule.text(), /export const API_BASE = '\/api'/);
    // Solo la app (/app/) es instalable; la web en / no tiene manifest.
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/manifest.webmanifest`)).status, 404);
    assert.match(await (await fetch(`http://127.0.0.1:${server.address().port}/app/manifest.webmanifest`)).text(), /"display": "standalone"/);
    const appPage = await fetch(`http://127.0.0.1:${server.address().port}/app/`);
    assert.equal(appPage.status, 200);
    assert.equal(appPage.headers.get('content-security-policy'), response.headers.get('content-security-policy'), 'la app tiene la misma CSP');
    assert.match(await appPage.text(), /<link rel="manifest" href="\/app\/manifest\.webmanifest">/);
    const appRedirect = await fetch(`http://127.0.0.1:${server.address().port}/app?x=1`, { redirect: 'manual' });
    assert.equal(appRedirect.status, 301);
    assert.equal(appRedirect.headers.get('location'), '/app/?x=1');
    for (const appFile of ['/app/app.css', '/app/app-movil.js', '/app/pwa.js', '/js/conexion.js', '/js/web.js']) {
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${appFile}`)).status, 200, appFile);
    }
    assert.match(await (await fetch(`http://127.0.0.1:${server.address().port}/sw.js`)).text(), /notificationclick/);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/icons/rastreopy.svg`)).status, 200);
    assert.equal((await fetch(
      `http://127.0.0.1:${server.address().port}/backend/.env.example`
    )).status, 404);
    assert.equal((await fetch(
      `http://127.0.0.1:${server.address().port}/%62ackend/.env.example`
    )).status, 404);
    // Solo se sirve el frontend; los archivos internos de la raíz no.
    for (const publicPath of ['/Rastreopy.html', '/styles.css', '/fonts/Inter-400.ttf', '/data/paraguay-ubicaciones.json']) {
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${publicPath}`)).status, 200, publicPath);
    }
    for (const internalPath of ['/docker-compose.yml', '/Dockerfile', '/ROLES_Y_PERMISOS.txt', '/.gitignore']) {
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${internalPath}`)).status, 404, internalPath);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('registro, verificación, login persistente y autorización por rol', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const adminEmail = `admin.${suffix}@gmail.com`;
  const citizenEmail = `citizen.${suffix}@gmail.com`;
  const pendingEmail = `pending.${suffix}@gmail.com`;
  const invalidEmail = `invalid.${suffix}@example.com`;
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  const sentMessages = [];
  const mailer = {
    async sendMail(message) {
      sentMessages.push(message);
    }
  };
  let server;
  let databaseInitialized = false;

  try {
    await initializeDatabase(db);
    databaseInitialized = true;
    await seedAdministrator(db, adminEmail, 'Admin-password-123');
    server = createApp({
      db,
      mailer,
      jwtSecret: secret,
      appUrl: 'https://rastreo.example'
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function post(endpoint, body, token) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
      });
      return { response, data: await response.json() };
    }

    assert.equal((await fetch(baseUrl, { headers: { Origin: 'https://otro.example' } })).status, 500);

    const invalidGmail = await post('/api/auth/registro', {
      nombre_completo: 'Ciudadano Demo',
      correo: invalidEmail,
      contrasena: 'Password-test-1',
      acepto_terminos: true
    });
    assert.equal(invalidGmail.response.status, 400);
    assert.equal(invalidGmail.data.error, 'Ingrese una cuenta de Gmail válida (terminada en @gmail.com).');

    const registration = await post('/api/auth/registro', {
      nombre_completo: 'Ciudadano Demo',
      correo: citizenEmail,
      contrasena: 'Password-test-1',
      acepto_terminos: true,
      rol: 'administrador'
    });
    assert.equal(registration.response.status, 200);
    assert.equal(registration.data.correo, citizenEmail);
    assert.equal((await db.query(
      'SELECT COUNT(*) AS count FROM usuarios WHERE correo = $1',
      [citizenEmail]
    )).rows[0].count, '0', 'el usuario no debe crearse antes de verificar el código');
    assert.match(sentMessages[0].subject, /Código de verificación - Rastreo PY/);
    const verificationCode = sentMessages[0].text.match(/código de verificación es: (\d{6})/)[1];

    const verified = await post('/api/auth/verificar', {
      correo: citizenEmail,
      codigo: verificationCode
    });
    assert.equal(verified.response.status, 201);
    assert.equal(verified.data.mensaje, 'Cuenta creada correctamente.');
    const createdUser = (await db.query(
      'SELECT * FROM usuarios WHERE correo = $1',
      [citizenEmail]
    )).rows[0];
    assert.equal(createdUser.rol, 'ciudadano');
    assert.equal(createdUser.verificado, true);
    assert.equal(createdUser.acepto_terminos, true);
    assert.notEqual(createdUser.contrasena_hash, 'Password-test-1');
    assert.equal(await bcrypt.compare('Password-test-1', createdUser.contrasena_hash), true);
    assert.equal((await db.query(
      'SELECT COUNT(*) AS count FROM codigos_verificacion WHERE correo = $1',
      [citizenEmail]
    )).rows[0].count, '0');

    const duplicate = await post('/api/auth/registro', {
      nombre_completo: 'Ciudadano Demo',
      correo: citizenEmail,
      contrasena: 'Password-test-1',
      acepto_terminos: true
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.data.error, 'Este Gmail ya está registrado. Inicie sesión.');

    const citizenLogin = await post('/api/auth/login', {
      correo: citizenEmail.toUpperCase(),
      contrasena: 'Password-test-1'
    });
    assert.equal(citizenLogin.response.status, 200);
    assert.equal(citizenLogin.data.usuario.rol, 'ciudadano');
    const citizenAdminRequest = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { Authorization: `Bearer ${citizenLogin.data.token}` }
    });
    assert.equal(citizenAdminRequest.status, 403);

    const adminLogin = await post('/api/auth/login', {
      correo: adminEmail,
      contrasena: 'Admin-password-123'
    });
    assert.equal(adminLogin.response.status, 200);
    assert.equal(adminLogin.data.usuario.rol, 'administrador');
    const adminRequest = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { Authorization: `Bearer ${adminLogin.data.token}` }
    });
    assert.equal(adminRequest.status, 200);

    const pending = await post('/api/auth/registro', {
      nombre_completo: 'Otra Persona',
      correo: pendingEmail,
      contrasena: 'Password-test-2',
      acepto_terminos: true
    });
    assert.equal(pending.response.status, 200);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invalidCode = await post('/api/auth/verificar', {
        correo: pendingEmail,
        codigo: '000000'
      });
      assert.equal(invalidCode.response.status, attempt === 4 ? 429 : 400);
      if (attempt === 3) assert.equal(invalidCode.data.error, 'Código incorrecto. Le quedan 1 intentos.');
    }
    assert.equal((await db.query(
      'SELECT COUNT(*) AS count FROM usuarios WHERE correo = $1',
      [pendingEmail]
    )).rows[0].count, '0');
    assert.equal((await db.query(
      'SELECT COUNT(*) AS count FROM codigos_verificacion WHERE correo = $1',
      [pendingEmail]
    )).rows[0].count, '0');

    await new Promise(resolve => server.close(resolve));
    server = createApp({ db, mailer, jwtSecret: secret, appUrl: 'https://rastreo.example' })
      .listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const restartedLogin = await fetch(
      `http://127.0.0.1:${server.address().port}/api/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: citizenEmail, contrasena: 'Password-test-1' })
      }
    );
    assert.equal(restartedLogin.status, 200);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (databaseInitialized) {
      const emails = [adminEmail, citizenEmail, pendingEmail, invalidEmail];
      await db.query('DELETE FROM solicitudes_codigo WHERE correo = ANY($1)', [emails]);
      await db.query('DELETE FROM codigos_verificacion WHERE correo = ANY($1)', [emails]);
      await db.query('DELETE FROM usuarios WHERE correo = ANY($1)', [emails]);
    }
    await db.end();
  }
});

function mockDatabase(handler) {
  const queries = [];
  const query = async (sql, values = []) => {
    queries.push({ sql, values });
    return handler(sql, values) || { rows: [], rowCount: 0 };
  };
  return { queries, db: { query, connect: async () => ({ query, release() {} }) } };
}

test('restablecer contraseña valida datos y no revela si la cuenta existe', async () => {
  const { db, queries } = mockDatabase(sql => {
    if (sql.includes('COUNT(*) AS total')) return { rows: [{ total: '0' }] };
    return null;
  });
  const sentMessages = [];
  const app = createApp({
    db,
    mailer: { sendMail: async message => { sentMessages.push(message); } },
    jwtSecret: 'test-secret-with-at-least-thirty-two-characters',
    appUrl: 'http://127.0.0.1'
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = async (endpoint, body) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    const invalid = await post('/api/auth/restablecer/solicitar', { correo: 'alguien@example.com' });
    assert.equal(invalid.status, 400);

    const unknown = await post('/api/auth/restablecer/solicitar', { correo: 'NoExiste@Gmail.com' });
    assert.equal(unknown.status, 200);
    assert.match(unknown.data.mensaje, /Si el Gmail está registrado/);
    assert.equal(sentMessages.length, 0, 'no se envía correo a cuentas inexistentes');
    assert.ok(queries.some(({ sql, values }) => sql.includes('FROM usuarios') && values[0] === 'noexiste@gmail.com'));

    const before = queries.length;
    const shortPassword = await post('/api/auth/restablecer/confirmar', {
      correo: 'alguien@gmail.com', codigo: '123456', nueva_contrasena: 'corta'
    });
    assert.equal(shortPassword.status, 400);
    assert.equal(shortPassword.data.error, 'La contraseña debe tener al menos 8 caracteres.');
    assert.equal(queries.length, before, 'una contraseña inválida no consume intentos del código');

    const badCode = await post('/api/auth/restablecer/confirmar', {
      correo: 'alguien@gmail.com', codigo: '12ab', nueva_contrasena: 'Password-nueva-1'
    });
    assert.equal(badCode.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('restablecer contraseña cambia la clave con el código del correo', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const email = `reset.${randomUUID().replaceAll('-', '')}@gmail.com`;
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  const sentMessages = [];
  let server;
  let databaseInitialized = false;

  try {
    await initializeDatabase(db);
    databaseInitialized = true;
    await db.query(`
      INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado)
      VALUES ('Persona Reset', $1, $2, 'ciudadano', TRUE)
    `, [email, await bcrypt.hash('Password-vieja-1', 10)]);
    server = createApp({
      db,
      mailer: { sendMail: async message => { sentMessages.push(message); } },
      jwtSecret: secret,
      appUrl: 'https://rastreo.example'
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const post = async (endpoint, body) => {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: response.status, data: await response.json() };
    };

    const me = token => fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const oldSession = await post('/api/auth/login', { correo: email, contrasena: 'Password-vieja-1' });
    assert.equal(oldSession.status, 200);
    assert.equal((await me(oldSession.data.token)).status, 200);

    const requested = await post('/api/auth/restablecer/solicitar', { correo: email });
    assert.equal(requested.status, 200);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].subject, /restablecer la contraseña/);
    assert.match(sentMessages[0].text, /Persona Reset/);
    const code = sentMessages[0].text.match(/código de verificación es: (\d{6})/)[1];
    const wrongCode = code === '000000' ? '111111' : '000000';

    const wrong = await post('/api/auth/restablecer/confirmar', {
      correo: email, codigo: wrongCode, nueva_contrasena: 'Password-nueva-1'
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.error, 'Código incorrecto. Le quedan 4 intentos.');

    const confirmed = await post('/api/auth/restablecer/confirmar', {
      correo: email, codigo: code, nueva_contrasena: 'Password-nueva-1'
    });
    assert.equal(confirmed.status, 200);

    const reused = await post('/api/auth/restablecer/confirmar', {
      correo: email, codigo: code, nueva_contrasena: 'Password-otra-1'
    });
    assert.equal(reused.status, 400, 'el código no se puede reutilizar');

    assert.equal((await post('/api/auth/login', { correo: email, contrasena: 'Password-vieja-1' })).status, 401);
    const newSession = await post('/api/auth/login', { correo: email, contrasena: 'Password-nueva-1' });
    assert.equal(newSession.status, 200);
    assert.equal((await me(oldSession.data.token)).status, 401, 'la sesión anterior al cambio queda cerrada');
    assert.equal((await me(newSession.data.token)).status, 200);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (databaseInitialized) {
      await db.query('DELETE FROM solicitudes_codigo WHERE correo = $1', [email]);
      await db.query('DELETE FROM codigos_verificacion WHERE correo = $1', [email]);
      await db.query('DELETE FROM usuarios WHERE correo = $1', [email]);
    }
    await db.end();
  }
});

test('reenviar código de registro exige un registro pendiente', async () => {
  const { db } = mockDatabase(sql => {
    if (sql.includes('COUNT(*) AS total')) return { rows: [{ total: '0' }] };
    return null;
  });
  const sentMessages = [];
  const server = createApp({
    db,
    mailer: { sendMail: async message => { sentMessages.push(message); } },
    jwtSecret: 'test-secret-with-at-least-thirty-two-characters',
    appUrl: 'http://127.0.0.1'
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = async body => {
    const response = await fetch(`${baseUrl}/api/auth/registro/reenviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    assert.equal((await post({ correo: 'alguien@example.com' })).status, 400);
    const withoutPending = await post({ correo: 'alguien@gmail.com' });
    assert.equal(withoutPending.status, 400);
    assert.match(withoutPending.data.error, /No hay un registro pendiente/);
    assert.equal(sentMessages.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('reenviar código de registro respeta el intervalo e invalida el código anterior', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const email = `resend.${randomUUID().replaceAll('-', '')}@gmail.com`;
  const sentMessages = [];
  let server;
  let databaseInitialized = false;

  try {
    await initializeDatabase(db);
    databaseInitialized = true;
    server = createApp({
      db,
      mailer: { sendMail: async message => { sentMessages.push(message); } },
      jwtSecret: 'test-secret-with-at-least-thirty-two-characters',
      appUrl: 'https://rastreo.example'
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const post = async (endpoint, body) => {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: response.status, data: await response.json() };
    };
    const codeFrom = message => message.text.match(/código de verificación es: (\d{6})/)[1];

    const registration = await post('/api/auth/registro', {
      nombre_completo: 'Persona Reenvio',
      correo: email,
      contrasena: 'Password-reenvio-1',
      acepto_terminos: true
    });
    assert.equal(registration.status, 200);
    const firstCode = codeFrom(sentMessages[0]);

    const tooSoon = await post('/api/auth/registro/reenviar', { correo: email });
    assert.equal(tooSoon.status, 429);
    assert.equal(sentMessages.length, 1);

    await db.query(`
      UPDATE codigos_verificacion SET creado_en = CURRENT_TIMESTAMP - INTERVAL '2 minutes'
      WHERE correo = $1 AND proposito = 'registro'
    `, [email]);
    const resent = await post('/api/auth/registro/reenviar', { correo: email });
    assert.equal(resent.status, 200);
    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[1].text, /Persona Reenvio/);
    const secondCode = codeFrom(sentMessages[1]);

    if (firstCode !== secondCode) {
      const oldCode = await post('/api/auth/verificar', { correo: email, codigo: firstCode });
      assert.equal(oldCode.status, 400, 'el código anterior deja de servir');
    }
    const verified = await post('/api/auth/verificar', { correo: email, codigo: secondCode });
    assert.equal(verified.status, 201);
    assert.equal((await post('/api/auth/login', { correo: email, contrasena: 'Password-reenvio-1' })).status, 200);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (databaseInitialized) {
      await db.query('DELETE FROM solicitudes_codigo WHERE correo = $1', [email]);
      await db.query('DELETE FROM codigos_verificacion WHERE correo = $1', [email]);
      await db.query('DELETE FROM usuarios WHERE correo = $1', [email]);
    }
    await db.end();
  }
});

test('cada request revalida rol y versión de sesión contra la base', async () => {
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  // En la BD el usuario 5 es ciudadano y cambió la contraseña una vez (versión 1).
  const { db } = mockDatabase((sql, values) => {
    if (sql.includes('sesion_version FROM usuarios')) {
      return { rows: values[0] === 5 ? [{ rol: 'ciudadano', sesion_version: 1 }] : [] };
    }
    return null;
  });
  const server = createApp({
    db,
    mailer: { sendMail: async () => {} },
    jwtSecret: secret,
    appUrl: 'http://127.0.0.1'
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = (path, payload) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: { Authorization: `Bearer ${jwt.sign(payload, secret)}` }
  });

  try {
    assert.equal((await get('/api/notificaciones', { id: 5, rol: 'ciudadano', ver: 1 })).status, 200);
    assert.equal((await get('/api/notificaciones', { id: 5, rol: 'ciudadano', ver: 0 })).status, 401,
      'token emitido antes del cambio de contraseña');
    assert.equal((await get('/api/notificaciones', { id: 5, rol: 'ciudadano' })).status, 401,
      'token viejo sin versión');
    assert.equal((await get('/api/admin/health', { id: 5, rol: 'administrador', ver: 1 })).status, 401,
      'el rol del token ya no coincide con la base');
    assert.equal((await get('/api/notificaciones', { id: 99, rol: 'ciudadano', ver: 0 })).status, 401,
      'usuario inexistente o no verificado');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('al arrancar se crea el administrador sin pisar su contraseña; crear-admin la restablece', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const email = `admin.ensure.${randomUUID().replaceAll('-', '')}@gmail.com`;
  const admin = async () => (await db.query(
    'SELECT rol, verificado, contrasena_hash, sesion_version FROM usuarios WHERE correo = $1', [email]
  )).rows[0];
  let databaseInitialized = false;
  try {
    await initializeDatabase(db);
    databaseInitialized = true;

    await ensureAdministrator(db, email, 'Clave-inicial-123');
    const created = await admin();
    assert.equal(created.rol, 'administrador');
    assert.equal(created.verificado, true);
    assert.equal(await bcrypt.compare('Clave-inicial-123', created.contrasena_hash), true);

    // El admin cambió su contraseña; un reinicio no debe revertirla.
    await db.query('UPDATE usuarios SET contrasena_hash = $2 WHERE correo = $1',
      [email, await bcrypt.hash('Clave-cambiada-456', 10)]);
    await ensureAdministrator(db, email, 'Clave-inicial-123');
    const restarted = await admin();
    assert.equal(await bcrypt.compare('Clave-cambiada-456', restarted.contrasena_hash), true);
    assert.equal(restarted.sesion_version, created.sesion_version, 'reiniciar no cierra sesiones');

    // Si la cuenta perdió el rol, el arranque se lo devuelve (sin tocar la contraseña).
    await db.query("UPDATE usuarios SET rol = 'ciudadano' WHERE correo = $1", [email]);
    await ensureAdministrator(db, email, 'Clave-inicial-123');
    const repaired = await admin();
    assert.equal(repaired.rol, 'administrador');
    assert.equal(await bcrypt.compare('Clave-cambiada-456', repaired.contrasena_hash), true);

    // crear-admin.js (seedAdministrator) sí restablece y cierra las sesiones abiertas.
    await seedAdministrator(db, email, 'Clave-reseteada-789');
    const reset = await admin();
    assert.equal(await bcrypt.compare('Clave-reseteada-789', reset.contrasena_hash), true);
    assert.equal(reset.sesion_version, repaired.sesion_version + 1);
  } finally {
    if (databaseInitialized) await db.query('DELETE FROM usuarios WHERE correo = $1', [email]);
    await db.end();
  }
});
