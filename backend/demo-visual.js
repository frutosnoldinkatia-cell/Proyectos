// MODO DEMO VISUAL - solo para desarrollo (npm run demo-visual).
// Levanta la app real (createApp de server.js: misma CSP, mismo public/) con una
// base PostgreSQL en memoria (PGlite) y datos de ejemplo ficticios, para ver el
// frontend sin Docker ni PostgreSQL. Los datos se pierden al reiniciar.
// No se usa en producción: no entra en la imagen Docker (.dockerignore) y PGlite
// es devDependency (el Dockerfile instala con --omit=dev).
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { PGlite, types } from '@electric-sql/pglite';
import { initializeDatabase } from './db.js';
import { createApp } from './server.js';

export const USUARIOS_DEMO = {
  ciudadano: { correo: 'demo.ciudadano@gmail.com', contrasena: 'DemoCiudadano1', nombre: 'Ciudadana Demo' },
  administrador: { correo: 'demo.admin@gmail.com', contrasena: 'DemoAdmin1', nombre: 'Administración Demo' }
};

// server.js carga backend/.env si existe. La demo nunca usa la base real
// (DATABASE_URL) y no necesita el resto: lo que falte se completa con valores de
// demostración solo en este proceso. requiredEnvironment() no se llama (la demo no
// usa start()), pero así nada depende de que exista backend/.env.
function prepararEntorno(port) {
  delete process.env.DATABASE_URL;
  const valores = {
    JWT_SECRET: randomBytes(32).toString('hex'),
    MAIL_USER: 'demo@rastreopy.invalid',
    MAIL_PASS: 'demo-sin-correo',
    APP_URL: `http://localhost:${port}`,
    ADMIN_IDENTIFICADOR: USUARIOS_DEMO.administrador.correo,
    ADMIN_PASSWORD: USUARIOS_DEMO.administrador.contrasena
  };
  for (const [clave, valor] of Object.entries(valores)) process.env[clave] ||= valor;
}

// PGlite expuesto como el Pool de pg que usa la app: query(sql, valores),
// connect() -> cliente con query/release (transacciones de db.js) y end().
// PGlite tiene una sola conexión: un candado evita que otro pedido se meta en
// medio de una transacción abierta.
function comoPool(pg) {
  let cola = Promise.resolve();
  const turno = () => {
    let liberar;
    const anterior = cola;
    cola = new Promise(resolve => { liberar = resolve; });
    return anterior.then(() => liberar);
  };
  const ejecutar = async (sql, valores = []) => {
    // Sin parámetros puede venir más de una sentencia (las migraciones): exec.
    const resultado = valores.length ? await pg.query(sql, valores) : (await pg.exec(sql)).at(-1);
    const rows = resultado?.rows || [];
    return { rows, rowCount: resultado?.affectedRows || rows.length };
  };
  return {
    async query(sql, valores) {
      const liberar = await turno();
      try { return await ejecutar(sql, valores); } finally { liberar(); }
    },
    async connect() {
      const liberar = await turno();
      return { query: ejecutar, release: liberar };
    },
    end: () => pg.close()
  };
}

// ---------- Fotos generadas: siluetas genéricas en PNG (nunca fotos reales) ----------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
export function siluetaPng([fr, fg, fb], ancho = 240, alto = 300) {
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y += 1) {
    filas[y * (ancho * 3 + 1)] = 0;
    for (let x = 0; x < ancho; x += 1) {
      const cabeza = (x - ancho / 2) ** 2 + (y - alto * 0.37) ** 2 < (ancho * 0.2) ** 2;
      const hombros = ((x - ancho / 2) / (ancho * 0.42)) ** 2 + ((y - alto) / (alto * 0.36)) ** 2 < 1;
      const [r, g, b] = cabeza || hombros ? [fr * 0.45, fg * 0.45, fb * 0.45] : [fr, fg, fb];
      filas.set([r, g, b].map(Math.round), y * (ancho * 3 + 1) + 1 + x * 3);
    }
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', cabecera), bloque('IDAT', deflateSync(filas)), bloque('IEND', Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ---------- Datos de ejemplo (todos ficticios, marcados "(demo)") ----------
const horas = h => new Date(Date.now() - h * 3600 * 1000);
const COLORES = [[176, 196, 222], [204, 222, 190], [233, 214, 180], [214, 196, 226], [190, 222, 222]];

// [id, nombre, edad, sexo, ciudad, departamento, barrio, lat, lng, estado, horas desde la desaparición, extra]
const CASOS = [
  ['demo-01', 'Ana Ejemplo (demo)', 16, 'Femenino', 'Asunción', 'Capital', 'Sajonia', -25.2965, -57.6540, 'VALIDADO', 20],
  ['demo-02', 'Carlos Prueba (demo)', 34, 'Masculino', 'Ciudad del Este', 'Alto Paraná', '', -25.5097, -54.6111, 'EN_SEGUIMIENTO', 70],
  ['demo-03', 'Lucía Muestra (demo)', 72, 'Femenino', 'Encarnación', 'Itapúa', '', -27.3306, -55.8667, 'EN_SEGUIMIENTO', 150, { etapa: 2 }],
  ['demo-04', 'Jorge Ficticio (demo)', 25, 'Masculino', 'Luque', 'Central', '', -25.2667, -57.4872, 'VALIDADO', 30],
  ['demo-05', 'Marta Simulada (demo)', 41, 'Femenino', 'San Lorenzo', 'Central', '', -25.3397, -57.5089, 'LOCALIZADO', 90, { localizadoHace: 3 }],
  ['demo-06', 'Pedro Inventado (demo)', 19, 'Masculino', 'Pedro Juan Caballero', 'Amambay', '', -22.5472, -55.7333, 'VALIDADO', 12],
  ['demo-07', 'Rosa Ejemplar (demo)', 58, 'Femenino', 'Concepción', 'Concepción', '', -23.4064, -57.4344, 'EN_SEGUIMIENTO', 200],
  ['demo-08', 'Diego Ensayo (demo)', 13, 'Masculino', 'Villarrica', 'Guairá', '', -25.7500, -56.4333, 'VALIDADO', 8],
  ['demo-09', 'Sofía Borrador (demo)', 29, 'Femenino', 'Asunción', 'Capital', 'Recoleta', -25.2930, -57.6060, 'LOCALIZADO', 60, { localizadoHace: 10 }],
  ['demo-10', 'Hugo Maqueta (demo)', 47, 'Masculino', 'Ciudad del Este', 'Alto Paraná', '', -25.5200, -54.6300, 'VALIDADO', 40],
  // Del ciudadano demo, para "Mis casos" y la bandeja del admin (no son públicos).
  ['demo-11', 'Elena Pendiente (demo)', 37, 'Femenino', 'Encarnación', 'Itapúa', '', -27.3400, -55.8600, 'PENDIENTE', 5, { delCiudadano: true, sinDenuncia: true }],
  ['demo-12', 'Raúl Rechazado (demo)', 52, 'Masculino', 'Luque', 'Central', '', -25.2700, -57.4900, 'RECHAZADO', 300, { delCiudadano: true, motivoRechazo: 'Datos insuficientes (ejemplo de rechazo de la demo).' }]
];
// Del ciudadano demo también son demo-02 (en seguimiento) y demo-05 (localizado).
const DEL_CIUDADANO = new Set(['demo-02', 'demo-05']);

// [id, caso, descripción, horas, lat, lng, dirección, estado, con foto]
const PISTAS = [
  ['pista-demo-01', 'demo-01', 'Vista cerca de una parada de colectivo en Sajonia (pista de ejemplo).', 6, -25.2990, -57.6510, 'Sajonia, Asunción', 'VALIDADA', true],
  ['pista-demo-02', 'demo-02', 'Persona parecida en la zona del Puente de la Amistad (pista de ejemplo).', 30, -25.5090, -54.6040, 'Ciudad del Este', 'VALIDADA', false],
  ['pista-demo-03', 'demo-03', 'Una señora con esa descripción preguntaba por la costanera (pista de ejemplo).', 50, -27.3350, -55.8700, 'Costanera, Encarnación', 'VALIDADA', false],
  ['pista-demo-04', 'demo-06', 'Visto en una terminal de ómnibus (pista de ejemplo).', 4, -22.5480, -55.7300, 'Terminal, Pedro Juan Caballero', 'VALIDADA', true],
  ['pista-demo-05', 'demo-08', 'Compañeros de escuela dicen que lo vieron en la plaza (pista de ejemplo).', 2, -25.7490, -56.4350, 'Plaza central, Villarrica', 'VALIDADA', false],
  ['pista-demo-06', 'demo-04', 'Pista pendiente de moderación (ejemplo para el panel admin).', 1, -25.2660, -57.4880, 'Luque', 'PENDIENTE', false]
];

async function cargarDatos(db) {
  const hash = contrasena => bcrypt.hash(contrasena, 8);
  const { rows: [ciudadano] } = await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
    VALUES ($1, $2, $3, 'ciudadano', TRUE, TRUE, CURRENT_TIMESTAMP) RETURNING id
  `, [USUARIOS_DEMO.ciudadano.nombre, USUARIOS_DEMO.ciudadano.correo, await hash(USUARIOS_DEMO.ciudadano.contrasena)]);
  const { rows: [admin] } = await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
    VALUES ($1, $2, $3, 'administrador', TRUE, TRUE, CURRENT_TIMESTAMP) RETURNING id
  `, [USUARIOS_DEMO.administrador.nombre, USUARIOS_DEMO.administrador.correo, await hash(USUARIOS_DEMO.administrador.contrasena)]);

  for (const [index, [id, nombre, edad, sexo, ciudad, departamento, barrio, lat, lng, estado, desde, extra = {}]] of CASOS.entries()) {
    const delCiudadano = extra.delCiudadano || DEL_CIUDADANO.has(id);
    const revisado = !['PENDIENTE', 'RECHAZADO'].includes(estado);
    await db.query(`
      INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, departamento, barrio, descripcion_fisica,
        vestimenta, senas_particulares, fecha_hora_desaparicion, foto, latitud, longitud, direccion,
        numero_denuncia, estado, motivo_rechazo, reportado_por_usr_id, localizado_en, creado_en,
        proximo_seguimiento, reportante_mayor_edad, autorizacion_parental, aviso_privacidad_aceptado,
        checklist_denuncia, checklist_coherencia, checklist_duplicados, checklist_menores, seguimiento_etapa)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $5, $15, $16, $17, $18, $19, $20,
        $21, TRUE, $22, TRUE, $23, $23, $23, $23, $24)
    `, [
      id, nombre, edad, sexo, ciudad, departamento, barrio,
      'Contextura media, cabello oscuro (descripción de ejemplo).',
      'Remera de color y pantalón de jean (ejemplo).',
      index % 3 === 0 ? 'Lunar en la mejilla (ejemplo).' : '',
      horas(desde), siluetaPng(COLORES[index % COLORES.length]), lat, lng,
      extra.sinDenuncia ? '' : `DEMO-${String(index + 1).padStart(4, '0')}`,
      estado, extra.motivoRechazo || null, delCiudadano ? ciudadano.id : null,
      extra.localizadoHace ? horas(extra.localizadoHace) : null, horas(desde - 1),
      ['VALIDADO', 'EN_SEGUIMIENTO'].includes(estado) ? new Date(Date.now() + 24 * 3600 * 1000) : null,
      edad < 18, revisado, extra.etapa || 0
    ]);
    if (revisado || estado === 'RECHAZADO') {
      await db.query(`
        INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo, cambiado_por, cambiado_en)
        VALUES ($1, 'PENDIENTE', $2, $3, $4)
      `, [id, estado === 'RECHAZADO' ? 'RECHAZADO' : 'VALIDADO', admin.id, horas(desde - 2)]);
    }
  }

  for (const [id, caso, descripcion, desde, lat, lng, direccion, estado, conFoto] of PISTAS) {
    await db.query(`
      INSERT INTO pistas (id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento, latitud, longitud,
        direccion, fotos, estado, fecha_envio)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [id, caso, ciudadano.id, descripcion, horas(desde + 1), lat, lng, direccion,
      conFoto ? [siluetaPng([200, 200, 200])] : [], estado, horas(desde)]);
    await db.query(`
      INSERT INTO suscripciones_caso (caso_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [caso, ciudadano.id]);
  }

  const avisos = [
    [ciudadano.id, 'demo-02', 'Caso validado', 'Tu reporte de Carlos Prueba (demo) fue validado y publicado.', 'CASO_VALIDADO', false],
    [ciudadano.id, 'demo-01', 'Pista validada', 'Una pista que enviaste fue validada (ejemplo).', 'PISTA_VALIDADA', false],
    [ciudadano.id, 'demo-05', 'Caso resuelto', 'Marta Simulada (demo) fue localizada.', 'CASO_LOCALIZADO', true],
    [ciudadano.id, 'demo-12', 'Reporte rechazado', 'Raúl Rechazado (demo): datos insuficientes (ejemplo).', 'CASO_RECHAZADO', true],
    [admin.id, 'demo-11', 'Nuevo reporte para validar', 'Se recibió un reporte de Elena Pendiente (demo) y espera validación.', 'CASO_PENDIENTE', false]
  ];
  for (const aviso of avisos) {
    await db.query(`
      INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, leida) VALUES ($1, $2, $3, $4, $5, $6)
    `, aviso);
  }
}

// Arranca la demo. Devuelve { url, server, cerrar }.
export async function iniciarDemo({ port = Number(process.env.PORT) || 3100, silencioso = false } = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('demo-visual.js es solo para desarrollo y no arranca con NODE_ENV=production.');
  }
  prepararEntorno(port);
  // int8 (COUNT, BIGSERIAL) como texto, igual que el driver pg de producción.
  const pg = await PGlite.create({ parsers: { [types.INT8]: valor => valor } });
  const db = comoPool(pg);
  await initializeDatabase(db);
  await cargarDatos(db);

  // Sin correo real: el código OTP del registro o de "olvidé mi contraseña" se ve en la consola.
  const mailer = {
    async sendMail({ to, subject, text }) {
      console.log(`\n[demo] Correo simulado para ${to} · ${subject}\n${text}\n`);
    }
  };
  const app = createApp({ db, mailer, jwtSecret: randomBytes(32).toString('hex'), appUrl: `http://localhost:${port}` });
  const server = await new Promise((resolve, reject) => {
    const servidor = app.listen(port, () => resolve(servidor));
    servidor.once('error', reject);
  });
  const url = `http://localhost:${server.address().port}`;
  if (!silencioso) {
    console.log(`
==============================================================
 MODO DEMO VISUAL: los datos son de ejemplo y se pierden al reiniciar
==============================================================
 Web: ${url}
 App: ${url}/app/

 Ciudadano:     ${USUARIOS_DEMO.ciudadano.correo} / ${USUARIOS_DEMO.ciudadano.contrasena}
 Administrador: ${USUARIOS_DEMO.administrador.correo} / ${USUARIOS_DEMO.administrador.contrasena}

 Base en memoria (PGlite): no usa DATABASE_URL ni toca la base real.
 Ctrl+C para detener.
`);
  }
  return {
    url,
    server,
    cerrar: async () => {
      await new Promise(resolve => server.close(resolve));
      await db.end();
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  iniciarDemo().catch(error => {
    console.error(error.code === 'EADDRINUSE'
      ? `El puerto ya está en uso. Probá con otro, por ejemplo en PowerShell: $env:PORT=3200; npm run demo-visual`
      : `No se pudo iniciar la demo visual: ${error.message}`);
    process.exitCode = 1;
  });
}
