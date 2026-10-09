import 'dotenv/config';
import { createDatabase, initializeDatabase } from './db.js';

async function init() {
  const db = createDatabase();
  try {
    await initializeDatabase(db);
    console.log('Tablas creadas exitosamente en PostgreSQL');
  } catch (error) {
    console.error('Error inicializando la base de datos:', error.message);
  } finally {
    await db.end();
  }
}

init();
