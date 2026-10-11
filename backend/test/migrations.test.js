import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { createDatabase, initializeDatabase } from '../db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test('los archivos de migración tienen versión de tres dígitos única', async () => {
  const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql'));
  assert.ok(files.length > 0);
  for (const file of files) assert.match(file, /^\d{3}_[a-z0-9_]+\.sql$/, file);
  const versions = files.map(file => file.slice(0, 3));
  assert.equal(new Set(versions).size, versions.length, 'no puede haber dos migraciones con la misma versión');
});

test('migraciones con PostgreSQL: registro, repetición, base previa y procesos simultáneos', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const other = createDatabase(testDatabaseUrl);
  const versions = async () => (await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows
    .map(row => row.version);
  try {
    await initializeDatabase(db);
    const applied = await versions();
    assert.ok(applied.includes('001'));

    // Ejecutar de nuevo no aplica nada otra vez.
    await initializeDatabase(db);
    assert.deepEqual(await versions(), applied);

    // Base creada por la versión anterior (tablas existentes, sin registro): 001 es
    // idempotente y se aplica y registra sin error.
    await db.query("DELETE FROM schema_migrations WHERE version = '001'");
    await initializeDatabase(db);
    assert.deepEqual(await versions(), applied);
    assert.equal((await db.query("SELECT to_regclass('public.casos') AS tabla")).rows[0].tabla, 'casos');

    // Dos procesos a la vez (dos pools): el advisory lock los serializa.
    await db.query("DELETE FROM schema_migrations WHERE version = '001'");
    await Promise.all([initializeDatabase(db), initializeDatabase(other)]);
    assert.deepEqual(await versions(), applied);
  } finally {
    await db.end();
    await other.end();
  }
});
