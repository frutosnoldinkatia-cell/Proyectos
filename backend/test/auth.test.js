import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { createDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';

test('registro, verificación, login persistente y autorización por rol', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rastreo-auth-'));
  const databaseFile = path.join(directory, 'rastreo.db');
  let db = createDatabase(databaseFile);
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  const sentMessages = [];
  const mailer = {
    async sendMail(message) {
      sentMessages.push(message);
    }
  };
  await seedAdministrator(db, 'admin.demo@gmail.com', 'Admin-password-123');
  const server = createApp({ db, mailer, jwtSecret: secret }).listen(0, '127.0.0.1');
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

  try {
    const invalidGmail = await post('/api/auth/registro', {
      nombre_completo: 'Ciudadano Demo',
      correo: 'persona@example.com',
      contrasena: 'Password-test-1',
      acepto_terminos: true
    });
    assert.equal(invalidGmail.response.status, 400);
    assert.equal(invalidGmail.data.error, 'Ingrese una cuenta de Gmail válida (terminada en @gmail.com).');

    const registration = await post('/api/auth/registro', {
      nombre_completo: 'Ciudadano Demo',
      correo: ' Citizen.Demo@GMAIL.com ',
      contrasena: 'Password-test-1',
      acepto_terminos: true,
      rol: 'administrador'
    });
    assert.equal(registration.response.status, 200);
    assert.equal(registration.data.correo, 'citizen.demo@gmail.com');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usuarios WHERE correo = ?')
      .get('citizen.demo@gmail.com').count, 0, 'el usuario no debe crearse antes de verificar el código');
    assert.match(sentMessages[0].subject, /Código de verificación - Rastreo PY/);
    const verificationCode = sentMessages[0].text.match(/código de verificación es: (\d{6})/)[1];

    const verified = await post('/api/auth/verificar', {
      correo: 'citizen.demo@gmail.com',
      codigo: verificationCode
    });
    assert.equal(verified.response.status, 201);
    assert.equal(verified.data.mensaje, 'Cuenta creada correctamente.');
    const createdUser = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get('citizen.demo@gmail.com');
    assert.equal(createdUser.rol, 'ciudadano');
    assert.equal(createdUser.verificado, 1);
    assert.equal(createdUser.acepto_terminos, 1);
    assert.notEqual(createdUser.contrasena_hash, 'Password-test-1');
    assert.equal(await bcrypt.compare('Password-test-1', createdUser.contrasena_hash), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM codigos_verificacion WHERE correo = ?')
      .get('citizen.demo@gmail.com').count, 0);

    const duplicate = await post('/api/auth/registro', {
      nombre_completo: 'Ciudadano Demo',
      correo: 'citizen.demo@gmail.com',
      contrasena: 'Password-test-1',
      acepto_terminos: true
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.data.error, 'Este Gmail ya está registrado. Inicie sesión.');

    const citizenLogin = await post('/api/auth/login', {
      correo: 'CITIZEN.DEMO@gmail.com',
      contrasena: 'Password-test-1'
    });
    assert.equal(citizenLogin.response.status, 200);
    assert.equal(citizenLogin.data.usuario.rol, 'ciudadano');
    const citizenAdminRequest = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { Authorization: `Bearer ${citizenLogin.data.token}` }
    });
    assert.equal(citizenAdminRequest.status, 403);

    const adminLogin = await post('/api/auth/login', {
      correo: 'admin.demo@gmail.com',
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
      correo: 'otra.persona@gmail.com',
      contrasena: 'Password-test-2',
      acepto_terminos: true
    });
    assert.equal(pending.response.status, 200);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invalidCode = await post('/api/auth/verificar', {
        correo: 'otra.persona@gmail.com',
        codigo: '000000'
      });
      assert.equal(invalidCode.response.status, attempt === 4 ? 429 : 400);
      if (attempt === 3) assert.equal(invalidCode.data.error, 'Código incorrecto. Le quedan 1 intentos.');
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usuarios WHERE correo = ?')
      .get('otra.persona@gmail.com').count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM codigos_verificacion WHERE correo = ?')
      .get('otra.persona@gmail.com').count, 0);

    await new Promise(resolve => server.close(resolve));
    db.close();
    db = createDatabase(databaseFile);
    const restartedApp = createApp({ db, mailer, jwtSecret: secret }).listen(0, '127.0.0.1');
    await new Promise(resolve => restartedApp.once('listening', resolve));
    const restartedLoginResponse = await fetch(`http://127.0.0.1:${restartedApp.address().port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo: 'citizen.demo@gmail.com', contrasena: 'Password-test-1' })
    });
    assert.equal(restartedLoginResponse.status, 200);
    await new Promise(resolve => restartedApp.close(resolve));
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (db.open) db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
