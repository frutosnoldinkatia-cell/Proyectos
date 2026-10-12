import assert from 'node:assert/strict';
import test from 'node:test';
import { iniciarDemo, USUARIOS_DEMO } from '../demo-visual.js';

// npm run demo-visual: la app real con PGlite en memoria. PGlite tarda unos
// segundos en arrancar, así que el test tiene un tiempo límite propio.
test('la demo visual arranca, sirve web y app y trae datos de ejemplo', { timeout: 60_000 }, async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://no-usar@base-real.invalid/rastreo';
  const demo = await iniciarDemo({ port: 0, silencioso: true });
  try {
    assert.equal(process.env.DATABASE_URL, undefined, 'la demo nunca usa la base real');
    assert.equal((await fetch(`${demo.url}/`)).status, 200);
    assert.equal((await fetch(`${demo.url}/app/`)).status, 200);

    const { casos } = await (await fetch(`${demo.url}/api/casos`)).json();
    assert.equal(casos.length, 10);
    assert.ok(casos.every(caso => caso.nombreCompleto.endsWith('(demo)')), 'solo nombres ficticios');
    assert.deepEqual([...new Set(casos.map(caso => caso.estado))].sort(), ['EN_SEGUIMIENTO', 'LOCALIZADO', 'VALIDADO']);
    const foto = await fetch(`${demo.url}${casos[0].fotoUrl}`);
    assert.equal(foto.headers.get('content-type'), 'image/png');

    for (const { correo, contrasena } of Object.values(USUARIOS_DEMO)) {
      const login = await fetch(`${demo.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, contrasena })
      });
      assert.equal(login.status, 200, correo);
    }
  } finally {
    await demo.cerrar();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('la demo visual no arranca con NODE_ENV=production', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(iniciarDemo({ port: 0, silencioso: true }), /solo para desarrollo/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
