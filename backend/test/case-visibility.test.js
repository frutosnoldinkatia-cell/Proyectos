import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';
import { processDueFollowups } from '../case-routes.js';

const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const windowHours = Number(process.env.VENTANA_LOCALIZADOS_HORAS ?? 24);

// authenticate revalida cada token contra la BD (rol y sesion_version). En las
// BD simuladas se responde esa consulta: id 11 es administrador, el resto ciudadano.
function withSessions(db) {
  return {
    ...db,
    async query(sql, values = []) {
      if (sql.includes('sesion_version FROM usuarios')) {
        return { rows: [{ rol: values[0] === 11 ? 'administrador' : 'ciudadano', sesion_version: 0 }] };
      }
      return db.query(sql, values);
    }
  };
}

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
    db: withSessions(db),
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

test('Mis casos limita los registros al usuario y auditoria requiere rol administrador', async () => {
  const app = await startApp();
  try {
    const citizenToken = jwt.sign({ id: 42, rol: 'ciudadano' }, secret);
    const unauthorizedCases = await fetch(app.baseUrl + '/api/mis-casos');
    assert.equal(unauthorizedCases.status, 401);
    const ownCasesResponse = await fetch(app.baseUrl + '/api/mis-casos', {
      headers: { Authorization: ['Be', 'arer'].join('') + ' ' + citizenToken }
    });
    assert.equal(ownCasesResponse.status, 200);
    assert.deepEqual((await ownCasesResponse.json()).casos, []);
    const ownCasesQuery = app.queries.find(item => item.sql.includes('WHERE reportado_por_usr_id = $1'));
    assert.deepEqual(ownCasesQuery.values, [42]);
    const forbiddenAudit = await fetch(app.baseUrl + '/api/admin/auditoria', {
      headers: { Authorization: ['Be', 'arer'].join('') + ' ' + citizenToken }
    });
    assert.equal(forbiddenAudit.status, 403);
    const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
    const auditResponse = await fetch(app.baseUrl + '/api/admin/auditoria', {
      headers: { Authorization: ['Be', 'arer'].join('') + ' ' + adminToken }
    });
    assert.equal(auditResponse.status, 200);
    assert.deepEqual((await auditResponse.json()).eventos, []);
    const auditQuery = app.queries.find(item => item.sql.includes('FROM cambios_estado_pista'));
    assert.match(auditQuery.sql, /FROM cambios_estado_caso/);
    assert.match(auditQuery.sql, /LIMIT 100/);
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
    db: withSessions(db),
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
    const statisticsQuery = app.queries.find(item => item.sql.includes('COUNT(*) FILTER'));
    assert.match(statisticsQuery.sql, /COUNT\(\*\) FILTER \(WHERE estado IN \('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO'\)\) AS total/);
    assert.ok(app.queries.some(item => item.sql.includes('GROUP BY ciudad, departamento')));
    assert.ok(app.queries.some(item => item.sql.includes("'Niñez (0–11)'")));
    assert.ok(app.queries.some(item => item.sql.includes("'Búsqueda activa'")));
    assert.ok(app.queries.some(item => item.sql.includes('GROUP BY departamento ORDER BY total DESC, departamento')));
    assert.deepEqual(result.casosPorCiudad, []);
    assert.deepEqual(result.casosPorEdad, []);
    assert.deepEqual(result.casosPorEstado, []);
    assert.deepEqual(result.casosPorDepartamento, []);
    assert.equal(Number(result.encontrados), 1);
    assert.equal(result.porcentajeResueltos, 100);
    assert.equal('casos' in result, false);
    assert.equal('nombreCompleto' in result, false);
  } finally {
    await app.close();
  }
});

test('el servidor rechaza publicar sin la lista de validación ni reportes sin consentimiento', async () => {
  const app = await startApp();
  try {
    const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
    const citizenToken = jwt.sign({ id: 10, rol: 'ciudadano' }, secret);
    const approval = await fetch(`${app.baseUrl}/api/admin/casos/pending/estado`, {
      method: 'POST',
      headers: { Authorization: ['Be', 'arer'].join('') + ' ' + adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'VALIDADO', numeroDenuncia: 'DEN-1' })
    });
    assert.equal(approval.status, 400);
    assert.match((await approval.json()).error, /lista de validación/);

    const report = await fetch(`${app.baseUrl}/api/casos`, {
      method: 'POST',
      headers: { Authorization: ['Be', 'arer'].join('') + ' ' + citizenToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombreCompleto: 'Persona de prueba',
        edad: 16,
        sexo: 'Otro',
        ciudad: 'Asunción',
        descripcionFisica: 'Descripción',
        vestimenta: 'Vestimenta',
        fechaHoraDesaparicion: new Date().toISOString(),
        ubicacion: { lat: -25.2867, lng: -57.6333 },
        declaraMayorEdad: true,
        autorizacionParental: false,
        avisoPrivacidadAceptado: false
      })
    });
    assert.equal(report.status, 400);
    assert.match((await report.json()).error, /incompletos/);

    const excessivePhotos = await fetch(`${app.baseUrl}/api/casos/case-1/pistas`, {
      method: 'POST',
      headers: { Authorization: ['Be', 'arer'].join('') + ' ' + citizenToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descripcion: 'Avistamiento de prueba',
        fechaHoraAvistamiento: new Date().toISOString(),
        ubicacion: { lat: -25.2867, lng: -57.6333 },
        fotos: Array(4).fill('data:image/jpeg;base64,AAAA')
      })
    });
    assert.equal(excessivePhotos.status, 400);

    const rejectedClueWithoutReason = await fetch(`${app.baseUrl}/api/admin/pistas/clue-1/estado`, {
      method: 'POST',
      headers: { Authorization: ['Be', 'arer'].join('') + ' ' + adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'RECHAZADA' })
    });
    assert.equal(rejectedClueWithoutReason.status, 400);
  } finally {
    await app.close();
  }
});

test('al crear un caso se asocia al ciudadano y se notifica a administración', async () => {
  const statements = [];
  const createdCase = {
    id: 'new-case',
    nombre_completo: 'Persona reportada',
    edad: 16,
    sexo: 'Otro',
    ciudad: 'Asunción',
    departamento: 'Capital',
    descripcion_fisica: 'Descripción física',
    vestimenta: 'Campera azul',
    senas_particulares: '',
    fecha_hora_desaparicion: new Date(),
    latitud: -25.2867,
    longitud: -57.6333,
    direccion: 'Asunción',
    numero_denuncia: 'DEN-123',
    estado: 'PENDIENTE',
    reportado_por_usr_id: 42,
    seguimiento_etapa: 0,
    creado_en: new Date()
  };
  const db = {
    async query() { return { rows: [] }; },
    async connect() {
      return {
        async query(sql, values = []) {
          statements.push({ sql, values });
          if (sql.includes('INSERT INTO casos')) return { rows: [createdCase], rowCount: 1 };
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    }
  };
  const server = createApp({
    db: withSessions(db),
    mailer: { sendMail: async () => {} },
    jwtSecret: secret,
    appUrl: 'http://127.0.0.1'
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const citizenToken = jwt.sign({ id: 42, rol: 'ciudadano' }, secret);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/casos`, {
      method: 'POST',
      headers: {
        Authorization: ['Be', 'arer'].join('') + ' ' + citizenToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nombreCompleto: createdCase.nombre_completo,
        edad: 16,
        sexo: 'Otro',
        ciudad: 'Asunción',
        departamento: 'Capital',
        descripcionFisica: 'Descripción física',
        vestimenta: 'Campera azul',
        fechaHoraDesaparicion: new Date().toISOString(),
        ubicacion: { lat: -25.2867, lng: -57.6333 },
        numeroDenuncia: 'DEN-123',
        declaraMayorEdad: true,
        autorizacionParental: true,
        avisoPrivacidadAceptado: true
      })
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).caso.estado, 'PENDIENTE');
    const insert = statements.find(item => item.sql.includes('INSERT INTO casos'));
    assert.equal(insert.values[16], 'PENDIENTE');
    assert.equal(insert.values[17], 42);
    assert.ok(statements.some(item => item.sql.includes('INSERT INTO suscripciones_caso')));
    assert.ok(statements.some(item => item.sql.includes('INSERT INTO notificaciones')
      && item.sql.includes("LOWER(rol) = 'administrador'")));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('rechazar un caso notifica al ciudadano reportante', async () => {
  const statements = [];
  const currentCase = {
    id: 'case-to-reject',
    nombre_completo: 'Persona reportada',
    estado: 'PENDIENTE',
    reportado_por_usr_id: 42,
    seguimiento_etapa: 0
  };
  const db = {
    async query() { return { rows: [] }; },
    async connect() {
      return {
        async query(sql, values = []) {
          statements.push({ sql, values });
          if (sql.includes('SELECT * FROM casos WHERE id = $1 FOR UPDATE')) {
            return { rows: [currentCase] };
          }
          if (sql.includes('UPDATE casos SET estado = $2')) {
            return { rows: [{ ...currentCase, estado: values[1] }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    }
  };
  const server = createApp({
    db: withSessions(db),
    mailer: { sendMail: async () => {} },
    jwtSecret: secret,
    appUrl: 'http://127.0.0.1'
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/casos/case-to-reject/estado`, {
      method: 'POST',
      headers: {
        Authorization: ['Be', 'arer'].join('') + ' ' + adminToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ estado: 'RECHAZADO', motivo: 'Falta confirmar la denuncia.' })
    });
    assert.equal(response.status, 200);
    const notification = statements.find(item => item.sql.includes('INSERT INTO notificaciones')
      && item.sql.includes('VALUES ($1, $2, $3, $4, $5)'));
    assert.deepEqual(notification.values, [
      42,
      'case-to-reject',
      'Reporte rechazado',
      'El reporte de Persona reportada fue rechazado: Falta confirmar la denuncia.',
      'CASO_RECHAZADO'
    ]);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('las pistas exigen sesión, se guardan con su autor y se publican anónimas', async () => {
  const statements = [];
  let publicCluesQuery = '';
  const activeCase = { id: 'public-case', estado: 'VALIDADO' };
  const db = {
    async query(sql) {
      if (sql.includes('SELECT p.id, p.caso_id')) {
        publicCluesQuery = sql;
        return {
          rows: [{
            id: 'approved-clue',
            caso_id: 'public-case',
            descripcion: 'Pista aprobada',
            fecha_hora_avistamiento: new Date(),
            latitud: -25.2867,
            longitud: -57.6333,
            direccion: 'Asunción',
            fotos: ['data:image/jpeg;base64,AAAA', 'javascript:alert(1)'],
            fecha_envio: new Date()
          }]
        };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          statements.push({ sql, values });
          if (sql.includes('SELECT * FROM casos WHERE')) return { rows: [activeCase] };
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    }
  };
  const server = createApp({
    db: withSessions(db),
    mailer: { sendMail: async () => {} },
    jwtSecret: secret,
    appUrl: 'http://127.0.0.1'
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const clueBody = JSON.stringify({
      descripcion: 'Avistamiento en espacio público',
      fechaHoraAvistamiento: new Date().toISOString(),
      ubicacion: { lat: -25.2867, lng: -57.6333 },
      fotos: []
    });
    const anonymousResponse = await fetch(`${baseUrl}/api/casos/public-case/pistas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: clueBody
    });
    assert.equal(anonymousResponse.status, 401);
    assert.equal(statements.some(statement => statement.sql.includes('INSERT INTO pistas')), false);

    const citizenToken = jwt.sign({ id: 10, rol: 'ciudadano' }, secret);
    const response = await fetch(`${baseUrl}/api/casos/public-case/pistas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: clueBody
    });
    assert.equal(response.status, 201);
    const insertedClue = statements.find(statement => statement.sql.includes('INSERT INTO pistas'));
    assert.equal(insertedClue.values[2], 10);
    assert.ok(statements.some(statement => statement.sql.includes('INSERT INTO suscripciones_caso')));
    assert.ok(statements.some(statement => statement.sql.includes('INSERT INTO notificaciones')
      && statement.sql.includes("WHERE rol IN ('administrador', 'ADMINISTRADOR')")));
    const publicClues = await (await fetch(`${baseUrl}/api/pistas`)).json();
    assert.deepEqual(publicClues.pistas[0].fotos, ['data:image/jpeg;base64,AAAA']);
    assert.equal('autor' in publicClues.pistas[0], false);
    assert.doesNotMatch(publicCluesQuery, /usuario_id|correo/);
    assert.match(publicCluesQuery, /p\.estado = 'VALIDADA'/);

    const invalidTokenResponse = await fetch(`${baseUrl}/api/casos/public-case/pistas`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer not-a-valid-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        descripcion: 'Pista con token inválido',
        fechaHoraAvistamiento: new Date().toISOString(),
        ubicacion: { lat: -25.2867, lng: -57.6333 },
        fotos: []
      })
    });
    assert.equal(invalidTokenResponse.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('el proceso de seguimiento envía la consulta tras 48 h y escala tras el reintento', async () => {
  const rows = [
    { id: 'first', nombre_completo: 'Caso uno', reportado_por_usr_id: 10, estado: 'VALIDADO', seguimiento_etapa: 0 },
    { id: 'retry', nombre_completo: 'Caso dos', reportado_por_usr_id: 11, estado: 'VALIDADO', seguimiento_etapa: 1 }
  ];
  const statements = [];
  const db = {
    async connect() {
      return {
        async query(sql) {
          statements.push(sql);
          if (sql.includes('SELECT id, nombre_completo')) return { rows };
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    }
  };
  const result = await processDueFollowups(db);
  assert.deepEqual(result, { consultasEnviadas: 1, casosEnSeguimiento: 1 });
  assert.ok(statements.some(sql => sql.includes("INTERVAL '24 hours'")));
  assert.ok(statements.some(sql => sql.includes("SET estado = 'EN_SEGUIMIENTO'")));
  assert.ok(statements.some(sql => sql.includes("'SEGUIMIENTO')")));
  assert.ok(statements.some(sql => sql.includes("'CASO_SIN_ACTUALIZAR'")));
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
  let citizenId;

  try {
    await initializeDatabase(db);
    const foundBefore = Number((await db.query(`
      SELECT COUNT(*) AS total FROM casos WHERE estado IN ('LOCALIZADO', 'CERRADO')
    `)).rows[0].total);
    await seedAdministrator(db, adminEmail, adminPassword);
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    citizenId = (await db.query(`
      INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado)
      VALUES ('Ciudadano Prueba', $1, 'sin-uso', 'ciudadano', TRUE) RETURNING id
    `, [`citizen.${suffix}@gmail.com`])).rows[0].id;
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
    const citizenToken = jwt.sign({ id: citizenId, rol: 'ciudadano' }, secret);
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
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    }
    await db.end();
  }
});

test('matriz de permisos: sin sesión 401, ciudadano 403 en rutas de administración', async () => {
  const app = await startApp();
  const citizenToken = jwt.sign({ id: 10, rol: 'ciudadano' }, secret);
  const call = (method, path, token) => fetch(`${app.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: method === 'GET' ? undefined : '{}'
  });
  const citizenRoutes = [
    ['GET', '/api/mis-casos'],
    ['POST', '/api/casos'],
    ['POST', '/api/casos/c1/pistas'],
    ['POST', '/api/casos/c1/seguimiento'],
    ['GET', '/api/notificaciones'],
    ['POST', '/api/notificaciones/leidas']
  ];
  const adminRoutes = [
    ['GET', '/api/admin/casos'],
    ['GET', '/api/admin/pistas'],
    ['POST', '/api/admin/pistas/p1/estado'],
    ['GET', '/api/admin/auditoria'],
    ['GET', '/api/admin/casos/c1/foto'],
    ['GET', '/api/admin/historial-localizados'],
    ['GET', '/api/admin/historial-localizados/c1'],
    ['POST', '/api/admin/casos/c1/estado'],
    ['POST', '/api/admin/simulador/avanzar-48h']
  ];
  const publicRoutes = [
    ['GET', '/api/casos'],
    ['GET', '/api/pistas'],
    ['GET', '/api/estadisticas']
  ];
  try {
    for (const [method, path] of [...citizenRoutes, ...adminRoutes]) {
      assert.equal((await call(method, path)).status, 401, `${method} ${path} sin sesión`);
    }
    for (const [method, path] of adminRoutes) {
      assert.equal((await call(method, path, citizenToken)).status, 403, `${method} ${path} como ciudadano`);
    }
    // El administrador no reporta ni sigue casos propios (ROLES_Y_PERMISOS.txt).
    const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
    for (const [method, path] of [['GET', '/api/mis-casos'], ['POST', '/api/casos'], ['POST', '/api/casos/c1/seguimiento']]) {
      const response = await call(method, path, adminToken);
      assert.equal(response.status, 403, `${method} ${path} como administrador`);
      assert.match((await response.json()).error, /administrador no reporta/);
    }
    for (const [method, path] of publicRoutes) {
      assert.equal((await call(method, path)).status, 200, `${method} ${path} sin sesión`);
    }
    const forgedToken = jwt.sign({ id: 10, rol: 'administrador' }, 'otro-secreto-de-al-menos-treinta-y-dos-caracteres');
    assert.equal((await call('GET', '/api/admin/casos', forgedToken)).status, 401);
  } finally {
    await app.close();
  }
});

test('el administrador ve quién envió cada pista', async () => {
  let adminQuery = '';
  const app = createApp({
    db: withSessions({
      async query(sql) {
        adminQuery = sql;
        return { rows: [{
          id: 'p1', caso_id: 'c1', nombre_completo: 'Caso', descripcion: 'Pista',
          fecha_hora_avistamiento: new Date(), latitud: 0, longitud: 0, direccion: '',
          fotos: [], estado: 'PENDIENTE', fecha_envio: new Date(), cambios_estado: [],
          autor_id: 10, autor_nombre: 'Ciudadana Test', autor_correo: 'test@gmail.com'
        }] };
      }
    }),
    mailer: { sendMail: async () => {} },
    jwtSecret: secret,
    appUrl: 'http://127.0.0.1'
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/pistas`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(response.status, 200);
    assert.match(adminQuery, /LEFT JOIN usuarios u ON u\.id = p\.usuario_id/);
    assert.deepEqual((await response.json()).pistas[0].autor,
      { id: 10, nombre: 'Ciudadana Test', correo: 'test@gmail.com' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('solo se aceptan ubicaciones de la lista oficial de Paraguay', async () => {
  const { ubicacionValida } = await import('../ubicaciones.js');
  assert.equal(ubicacionValida('Central', 'Luque'), true);
  assert.equal(ubicacionValida('central', 'LUQUE'), true);
  assert.equal(ubicacionValida('Capital', 'Asunción', 'Villa Morra'), true);
  assert.equal(ubicacionValida('Central', 'Ciudad del Este'), false);
  assert.equal(ubicacionValida('Buenos Aires', 'Palermo'), false);
  assert.equal(ubicacionValida('Central', 'Luque', 'Barrio inventado'), false);

  const app = await startApp();
  try {
    const citizenToken = jwt.sign({ id: 10, rol: 'ciudadano' }, secret);
    const response = await fetch(`${app.baseUrl}/api/casos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombreCompleto: 'Persona', edad: 30, sexo: 'Otro', ciudad: 'Palermo', departamento: 'Buenos Aires',
        descripcionFisica: 'x', vestimenta: 'x', fechaHoraDesaparicion: new Date().toISOString(),
        ubicacion: { lat: -25.2867, lng: -57.6333 }, declaraMayorEdad: true, avisoPrivacidadAceptado: true
      })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /lista de Paraguay/);
  } finally {
    await app.close();
  }
});

test('el listado público no lee la foto de la base y pagina solo si se pide', async () => {
  const app = await startApp();
  try {
    assert.equal((await fetch(`${app.baseUrl}/api/casos`)).status, 200);
    const unpaginated = app.queries.find(item => item.sql.includes('ORDER BY creado_en DESC'));
    assert.doesNotMatch(unpaginated.sql, /SELECT \*/);
    assert.match(unpaginated.sql, /\(foto <> ''\) AS tiene_foto/);
    assert.deepEqual(unpaginated.values.slice(-2), [null, 0], 'sin ?limite no se limita');

    const paginatedResponse = await fetch(`${app.baseUrl}/api/casos?pagina=3&limite=500`);
    assert.equal(paginatedResponse.status, 200);
    const body = await paginatedResponse.json();
    assert.equal(body.pagina, 3);
    assert.equal(body.limite, 100, 'el límite máximo es 100');
    const paginatedQuery = app.queries.filter(item => item.sql.includes('ORDER BY creado_en DESC')).at(-1);
    assert.deepEqual(paginatedQuery.values.slice(-2), [100, 200]);
  } finally {
    await app.close();
  }
});

test('paginación del listado público con PostgreSQL', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const marker = `Pagina${randomUUID().replaceAll('-', '')}`;
  const ids = [1, 2, 3].map(n => `cas_test_pag_${n}_${marker}`);
  let server;
  let databaseInitialized = false;
  try {
    await initializeDatabase(db);
    databaseInitialized = true;
    for (const [index, id] of ids.entries()) {
      await db.query(`
        INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, departamento, descripcion_fisica,
          vestimenta, fecha_hora_desaparicion, foto, latitud, longitud, estado, creado_en)
        VALUES ($1, $2, 30, 'Femenino', 'Asunción', 'Capital', 'Descripción', 'Ropa',
          CURRENT_TIMESTAMP, $3, -25.3, -57.6, 'VALIDADO', CURRENT_TIMESTAMP - ($4 * INTERVAL '1 minute'))
      `, [id, `Persona ${marker} ${index}`, index === 0 ? 'data:image/png;base64,iVBORw0KGgo=' : '', index]);
    }
    server = createApp({
      db,
      mailer: { sendMail: async () => {} },
      jwtSecret: secret,
      appUrl: 'http://127.0.0.1'
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const all = await (await fetch(`${baseUrl}/api/casos?q=${marker}`)).json();
    assert.equal(all.casos.length, 3);
    assert.equal(all.total, 3);
    assert.equal(all.casos[0].fotoUrl, `/api/casos/${ids[0]}/foto`);
    assert.equal(all.casos[1].fotoUrl, '');

    const page1 = await (await fetch(`${baseUrl}/api/casos?q=${marker}&limite=2&pagina=1`)).json();
    const page2 = await (await fetch(`${baseUrl}/api/casos?q=${marker}&limite=2&pagina=2`)).json();
    assert.deepEqual(page1.casos.map(item => item.id), [ids[0], ids[1]]);
    assert.deepEqual(page2.casos.map(item => item.id), [ids[2]]);
    assert.equal(page1.total, 3);
    assert.equal(page2.total, 3);
    assert.equal((await fetch(`${baseUrl}/api/casos/${ids[0]}/foto`)).status, 200);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (databaseInitialized) await db.query('DELETE FROM casos WHERE id = ANY($1)', [ids]);
    await db.end();
  }
});
