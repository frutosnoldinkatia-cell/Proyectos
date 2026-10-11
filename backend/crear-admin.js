import 'dotenv/config';
import { createDatabase, seedAdministrator } from './db.js';

async function ejecutar() {
  const correo = process.env.ADMIN_IDENTIFICADOR;
  const password = process.env.ADMIN_PASSWORD;
  if (!correo || !password) {
    console.error('❌ Defina ADMIN_IDENTIFICADOR y ADMIN_PASSWORD en backend/.env antes de ejecutar este script.');
    process.exit(1);
  }

  // Creamos la instancia de la base de datos usando la función exportada en db.js
  const db = createDatabase();

  try {
    console.log('⏳ Conectando a PostgreSQL y creando el administrador...');

    await seedAdministrator(db, correo, password);

    console.log('✅ ¡Usuario Administrador creado/actualizado con éxito!');
    console.log(`Email: ${correo}`);
    console.log('Clave: la definida en ADMIN_PASSWORD (no se muestra por seguridad).');

    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error al registrar el administrador:', error.message);
    await db.end();
    process.exit(1);
  }
}

ejecutar();
