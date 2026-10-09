import 'dotenv/config';
import { createDatabase, seedAdministrator } from './db.js';

async function ejecutar() {
  const correo = process.env.ADMIN_IDENTIFICADOR || 'frutosnoldinkatia@gmail.com';
  const password = process.env.ADMIN_PASSWORD || 'Rastreopy123';

  // Creamos la instancia de la base de datos usando la función exportada en db.js
  const db = createDatabase();

  try {
    console.log('⏳ Conectando a PostgreSQL (NeonDB) y creando el administrador...');
    
    // Usamos la función nativa que ya tenías en tu db.js
    await seedAdministrator(db, correo, password);

    console.log('✅ ¡Usuario Administrador creado/actualizado con éxito!');
    console.log(`Email: ${correo}`);
    console.log(`Clave: ${password}`);
    
    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error al registrar el administrador:', error.message);
    await db.end();
    process.exit(1);
  }
}

ejecutar();