import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
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
    assert.match(await response.text(), /const API_BASE = '\/api'/);
    assert.equal((await fetch(
      `http://127.0.0.1:${server.address().port}/backend/.env.example`
    )).status, 404);
    assert.equal((await fetch(
      `http://127.0.0.1:${server.address().port}/%62ackend/.env.example`
    )).status, 404);
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
