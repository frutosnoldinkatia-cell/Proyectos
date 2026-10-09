import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';

const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const windowHours = Number(process.env.VENTANA_LOCALIZADOS_HORAS ?? 24);

async function startApp() {
  const queries = [];
  const db = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('COUNT(*) FILTER')) {
        return { rows: [{ total: '1', encontrados: '1', activos: '0', localizados: '1', cerrados: '0' }] };
      }
      return { rows: [] };
    }
  };
  const app = createApp({
    db,
    mailer: { sendMail: async () => {} },
    jwtSecret: secret,
    appUrl: 'http://127.0.0.1'
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    queries,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

test('API pública limita listado, detalle y fotografías mediante localizado_en', async () => {
  const app = await startApp();
  try {
    const listing = await fetch(`${app.baseUrl}/api/casos?q=${randomUUID()}`);
    assert.equal(listing.status, 200);
    const query = app.queries.find(item => item.sql.includes('FROM casos') && item.sql.includes('ORDER BY creado_en'));
    assert.match(query.sql, /CURRENT_TIMESTAMP < localizado_en \+ \(\$1 \* INTERVAL '1 hour'\)/);
    assert.equal(query.values[0], windowHours);

    const detail = await fetch(`${app.baseUrl}/api/casos/expired-case`);
    assert.equal(detail.status, 404);
    assert.equal((await detail.json()).error, 'Caso no disponible');
    const image = await fetch(`${app.baseUrl}/api/casos/expired-case/foto`);
    assert.equal(image.status, 404);
    const photoQuery = app.queries.find(item => item.sql.includes('SELECT foto FROM casos'));
    assert.deepEqual(photoQuery.values, [windowHours, 'expired-case']);
  } finally {
    await app.close();
  }
});

test('el historial de localizados exige el rol de administrador', async () => {
  const app = await startApp();
  try {
    const citizenToken = jwt.sign({ id: 10, rol: 'ciudadano' }, secret);
    const citizenResponse = await fetch(`${app.baseUrl}/api/admin/historial-localizados`, {
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert.equal(citizenResponse.status, 403);
    assert.equal((await citizenResponse.json()).error, 'Acceso exclusivo para administradores.');

    const missingTokenResponse = await fetch(`${app.baseUrl}/api/admin/historial-localizados`);
    assert.equal(missingTokenResponse.status, 401);
    const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
    const adminResponse = await fetch(`${app.baseUrl}/api/admin/historial-localizados?q=Ana&page=2`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminResponse.status, 200);
    const historyQuery = app.queries.find(item => item.sql.includes('COUNT(*) OVER()'));
    assert.match(historyQuery.sql, /c\.estado = 'LOCALIZADO'/);
    assert.deepEqual(historyQuery.values.slice(0, 2), ['%Ana%', null]);
  } finally {
    await app.close();
  }
});

test('marcar como localizado guarda el timestamp y notifica a suscriptores', async () => {
  const currentCase = {
    id: 'case-to-locate',
    nombre_completo: 'Persona de prueba',
    edad: 29,
    sexo: 'Otro',
    ciudad: 'Asunción',
    descripcion_fisica: 'Descripción',
    vestimenta: 'Vestimenta',
    senas_particulares: '',
    fecha_hora_desaparicion: new Date(),
    foto: '',
    latitud: -25.2867,
    longitud: -57.6333,
    direccion: 'Asunción',
    numero_denuncia: '',
    estado: 'VALIDADO',
    localizado_en: null,
    creado_en: new Date()
  };
  const executions = [];
  const db = {
    async query() {
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql) {
          executions.push(sql);
          if (sql.trimStart().startsWith('SELECT * FROM casos')) return { rows: [currentCase] };
          if (sql.trimStart().startsWith('UPDATE casos')) {
            return {
              rows: [{ ...currentCase, estado: 'LOCALIZADO', localizado_en: new Date() }]
            };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    }
  };
  const server = createApp({
    db,
    mailer: { sendMail: async () => {} },
    jwtSecret: secret,
    appUrl: 'http://127.0.0.1'
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/casos/case-to-locate/estado`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'LOCALIZADO' })
    });
    assert.equal(response.status, 200);
    const { caso } = await response.json();
    assert.equal(caso.estado, 'LOCALIZADO');
    assert.ok(caso.localizadoEn);
    assert.ok(caso.visibleHasta);
    assert.ok(executions.some(sql => sql.includes("THEN CURRENT_TIMESTAMP")));
    assert.ok(executions.some(sql => sql.includes('INSERT INTO notificaciones')
      && sql.includes('FROM suscripciones_caso')));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('estadísticas agregan localizados sin exponer registros personales', async () => {
  const app = await startApp();
  try {
    const response = await fetch(`${app.baseUrl}/api/estadisticas`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(Number(result.encontrados), 1);
    assert.equal(result.porcentajeResueltos, 100);
    assert.equal('casos' in result, false);
    assert.equal('nombreCompleto' in result, false);
  } finally {
    await app.close();
  }
});

test('el ciclo localizado permanece oculto tras 36 segundos y reiniciar Express', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de persistencia con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const adminEmail = `localized.${suffix}@gmail.com`;
  const caseId = `case_${suffix}`;
  const adminPassword = 'Integration-test-password-123';
  let server;
  let adminId;

  try {
    await initializeDatabase(db);
    const foundBefore = Number((await db.query(`
      SELECT COUNT(*) AS total FROM casos WHERE estado IN ('LOCALIZADO', 'CERRADO')
    `)).rows[0].total);
    await seedAdministrator(db, adminEmail, adminPassword);
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    await db.query(`
      INSERT INTO casos (
        id, nombre_completo, edad, sexo, ciudad, descripcion_fisica, vestimenta,
        fecha_hora_desaparicion, foto, latitud, longitud, estado, reportado_por_usr_id
      ) VALUES ($1, 'Caso de prueba', 31, 'Otro', 'Asunción', 'Descripción de prueba',
        'Vestimenta de prueba', CURRENT_TIMESTAMP, 'data:image/jpeg;base64,/9j/2Q==',
        -25.2867, -57.6333, 'VALIDADO', $2)
    `, [caseId, adminId]);
    await db.query(`
      INSERT INTO pistas (id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento, latitud, longitud)
      VALUES ($1, $2, $3, 'Pista de prueba', CURRENT_TIMESTAMP, -25.29, -57.63)
    `, [`clue_${suffix}`, caseId, adminId]);

    const adminToken = jwt.sign({ id: adminId, rol: 'administrador' }, secret);
    const citizenToken = jwt.sign({ id: 987654321, rol: 'ciudadano' }, secret);
    const createServer = async () => {
      const app = createApp({
        db,
        mailer: { sendMail: async () => {} },
        jwtSecret: secret,
        appUrl: 'http://127.0.0.1'
      }).listen(0, '127.0.0.1');
      await new Promise(resolve => app.once('listening', resolve));
      return app;
    };
    const stopServer = async () => {
      if (!server) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server = null;
    };
    const get = (baseUrl, path, token) => fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    server = await createServer();
    let baseUrl = `http://127.0.0.1:${server.address().port}`;
    const marked = await fetch(`${baseUrl}/api/admin/casos/${caseId}/estado`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'LOCALIZADO' })
    });
    assert.equal(marked.status, 200);
    let list = await (await get(baseUrl, '/api/casos')).json();
    assert.ok(list.casos.some(item => item.id === caseId && item.estado === 'LOCALIZADO'));
    assert.equal((await get(baseUrl, `/api/casos/${caseId}/foto`)).status, 200);

    if (windowHours > 0 && windowHours <= 0.01) {
      await new Promise(resolve => setTimeout(resolve, Math.ceil(windowHours * 3600000) + 1000));
    } else {
      await db.query(`
        UPDATE casos
        SET localizado_en = CURRENT_TIMESTAMP - ($2 * INTERVAL '1 hour') - INTERVAL '1 second'
        WHERE id = $1
      `, [caseId, windowHours]);
    }
    list = await (await get(baseUrl, '/api/casos')).json();
    assert.equal(list.casos.some(item => item.id === caseId), false);
    assert.equal((await get(baseUrl, `/api/casos/${caseId}`)).status, 404);
    assert.equal((await get(baseUrl, `/api/casos/${caseId}/foto`)).status, 404);

    const stats = await (await get(baseUrl, '/api/estadisticas')).json();
    assert.equal(Number(stats.encontrados), foundBefore + 1);
    const forbidden = await get(baseUrl, '/api/admin/historial-localizados', citizenToken);
    assert.equal(forbidden.status, 403);
    const history = await (await get(baseUrl, '/api/admin/historial-localizados?q=prueba', adminToken)).json();
    const historicalCase = history.casos.find(item => item.id === caseId);
    assert.ok(historicalCase);
    assert.equal(historicalCase.pistas[0].descripcion, 'Pista de prueba');
    assert.ok(historicalCase.cambiosEstado.some(item => item.estadoNuevo === 'LOCALIZADO'));

    await stopServer();
    server = await createServer();
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    list = await (await get(baseUrl, '/api/casos')).json();
    assert.equal(list.casos.some(item => item.id === caseId), false);
    assert.equal(
      Number((await (await get(baseUrl, '/api/estadisticas')).json()).encontrados),
      foundBefore + 1
    );
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (adminId) {
      await db.query('DELETE FROM notificaciones WHERE caso_id = $1', [caseId]);
      await db.query('DELETE FROM suscripciones_caso WHERE caso_id = $1', [caseId]);
      await db.query('DELETE FROM cambios_estado_caso WHERE caso_id = $1', [caseId]);
      await db.query('DELETE FROM pistas WHERE caso_id = $1', [caseId]);
      await db.query('DELETE FROM casos WHERE id = $1', [caseId]);
      await db.query('DELETE FROM usuarios WHERE id = $1', [adminId]);
    }
    await db.end();
  }
});
