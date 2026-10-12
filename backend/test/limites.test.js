import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp, trustProxyHops } from '../server.js';

// Límites pensados para el Workshop: ~100 celulares salen por la misma IP, así que
// nada se puede limitar solo por IP con números bajos.
const secret = 'test-secret-with-at-least-thirty-two-characters';

async function startApp() {
  const db = {
    async query(sql, values = []) {
      // authenticate revalida el token: id 11 es administrador, el resto ciudadano.
      if (sql.includes('sesion_version FROM usuarios')) {
        return { rows: [{ rol: values[0] === 11 ? 'administrador' : 'ciudadano', sesion_version: 0 }] };
      }
      if (sql.includes('COUNT(*) FILTER')) return { rows: [{ total: '0' }] };
      return { rows: [], rowCount: 0 };
    }
  };
  const app = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    app,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

const login = (baseUrl, correo, headers = {}) => fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ correo, contrasena: 'incorrecta' })
});

test('login: el límite es por IP + correo, no bloquea al resto de la misma red', async () => {
  const { baseUrl, close } = await startApp();
  try {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await login(baseUrl, 'ana@gmail.com')).status, 401, `intento ${i + 1}`);
    }
    assert.equal((await login(baseUrl, 'ana@gmail.com')).status, 429, 'el 11.º intento contra la misma cuenta');
    assert.equal((await login(baseUrl, 'Ana@Gmail.com')).status, 429, 'el correo se normaliza');
    // Otra persona en la misma red (misma IP) puede seguir ingresando.
    assert.equal((await login(baseUrl, 'beto@gmail.com')).status, 401);
  } finally {
    await close();
  }
});

test('lectura pública: límite por IP configurable con LIMITE_LECTURA_PUBLICA_POR_MINUTO', async () => {
  const previous = process.env.LIMITE_LECTURA_PUBLICA_POR_MINUTO;
  process.env.LIMITE_LECTURA_PUBLICA_POR_MINUTO = '3';
  const { baseUrl, close } = await startApp();
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await fetch(`${baseUrl}/api/casos`)).status, 200);
    const limited = await fetch(`${baseUrl}/api/pistas`);
    assert.equal(limited.status, 429, 'casos, pistas y estadísticas comparten el límite');
    assert.match((await limited.json()).error, /Demasiadas consultas/);
  } finally {
    await close();
    if (previous === undefined) delete process.env.LIMITE_LECTURA_PUBLICA_POR_MINUTO;
    else process.env.LIMITE_LECTURA_PUBLICA_POR_MINUTO = previous;
  }
});

test('TRUST_PROXY_HOPS: 1 por defecto, entero >= 0', () => {
  assert.equal(trustProxyHops(undefined), 1);
  assert.equal(trustProxyHops(''), 1);
  assert.equal(trustProxyHops('2'), 2);
  assert.equal(trustProxyHops('0'), 0);
  for (const bad of ['-1', '1.5', 'true', 'abc']) assert.throws(() => trustProxyHops(bad), /TRUST_PROXY_HOPS/, bad);
});

test('diagnóstico de red: solo admin, muestra la IP que ve el servidor detrás del proxy', async () => {
  const { app, baseUrl, close } = await startApp();
  const adminToken = jwt.sign({ id: 11, rol: 'administrador' }, secret);
  const citizenToken = jwt.sign({ id: 10, rol: 'ciudadano' }, secret);
  const diagnose = (token, headers = {}) => fetch(`${baseUrl}/api/admin/diagnostico-red`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
  });
  try {
    assert.equal((await diagnose()).status, 401);
    assert.equal((await diagnose(citizenToken)).status, 403);
    // Con 1 proxy de confianza, req.ip es la última IP que agregó ese proxy.
    const viaProxy = await (await diagnose(adminToken, {
      'X-Forwarded-For': '198.51.100.9, 203.0.113.7',
      'X-Forwarded-Proto': 'https'
    })).json();
    assert.equal(viaProxy.ip, '203.0.113.7');
    assert.equal(viaProxy.protocolo, 'https');
    assert.equal(viaProxy.trustProxyHops, 1);
    // Con 2 saltos se toma una IP más atrás en la cadena.
    app.set('trust proxy', 2);
    const twoHops = await (await diagnose(adminToken, { 'X-Forwarded-For': '198.51.100.9, 203.0.113.7' })).json();
    assert.equal(twoHops.ip, '198.51.100.9');
  } finally {
    await close();
  }
});
