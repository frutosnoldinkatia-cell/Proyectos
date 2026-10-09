/**
 * Carga datos de demostración en la base configurada en DATABASE_URL.
 *
 * Todos los registros son FICTICIOS y existen solo para poder recorrer la
 * aplicación con contenido. No representan denuncias reales.
 *
 * Es idempotente: borra lo que haya sembrado antes (todo lo que lleva el
 * prefijo "demo_") y vuelve a insertarlo. No toca ningún otro registro, así
 * que se puede correr sobre una base que ya tenga datos propios.
 *
 *   npm run seed:demo
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { createDatabase } from './db.js';

// Credenciales de la cuenta de demostración. Son públicas a propósito: solo
// sirven en una base de demostración local.
const DEMO_EMAIL = 'ciudadano.demo@rastreopy.test';
const DEMO_PASSWORD = 'Demo-rastreo-2026';

const hoy = Date.now();
const hace = horas => new Date(hoy - horas * 3600 * 1000);
const dentroDe = horas => new Date(hoy + horas * 3600 * 1000);

const CASOS = [
  {
    id: 'demo_001',
    nombre_completo: 'Sofía Montserrat Giménez',
    edad: 16, sexo: 'Femenino', ciudad: 'Asunción', departamento: 'Central',
    descripcion_fisica: 'Estatura 1,62 m, contextura delgada, cabello castaño largo.',
    vestimenta: 'Buzo gris con capucha, pantalón vaquero azul y zapatillas blancas.',
    senas_particulares: 'Lunar sobre la ceja izquierda.',
    fecha_hora_desaparicion: hace(50),
    latitud: -25.2985, longitud: -57.6359, direccion: 'Av. Eusebio Ayala y Santa Teresa',
    numero_denuncia: 'DEN-2026-00418', estado: 'EN_SEGUIMIENTO',
    proximo_seguimiento: hace(2), seguimiento_etapa: 2
  },
  {
    id: 'demo_002',
    nombre_completo: 'Carlos Alberto Benítez',
    edad: 42, sexo: 'Masculino', ciudad: 'Ciudad del Este', departamento: 'Alto Paraná',
    descripcion_fisica: 'Estatura 1,78 m, contextura robusta, cabello corto entrecano.',
    vestimenta: 'Camisa celeste a cuadros y pantalón de trabajo verde.',
    senas_particulares: 'Cicatriz en el antebrazo derecho.',
    fecha_hora_desaparicion: hace(20),
    latitud: -25.5097, longitud: -54.6111, direccion: 'Km 4 Monday',
    numero_denuncia: '', estado: 'PENDIENTE',
    proximo_seguimiento: null, seguimiento_etapa: 0
  },
  {
    id: 'demo_003',
    nombre_completo: 'Rosa Elena Cabral',
    edad: 73, sexo: 'Femenino', ciudad: 'Luque', departamento: 'Central',
    descripcion_fisica: 'Estatura 1,55 m, cabello blanco corto, camina con bastón.',
    vestimenta: 'Vestido floreado y rebozo marrón.',
    senas_particulares: 'Desorientación por cuadro de demencia diagnosticado.',
    fecha_hora_desaparicion: hace(8),
    latitud: -25.2667, longitud: -57.4871, direccion: 'Barrio Mora Kue',
    numero_denuncia: 'DEN-2026-00431', estado: 'VALIDADO',
    proximo_seguimiento: dentroDe(40), seguimiento_etapa: 0
  },
  {
    id: 'demo_004',
    nombre_completo: 'Mateo Villalba Ortiz',
    edad: 9, sexo: 'Masculino', ciudad: 'Encarnación', departamento: 'Itapúa',
    descripcion_fisica: 'Estatura 1,32 m, cabello negro lacio, ojos marrones.',
    vestimenta: 'Remera roja de fútbol y short azul.',
    senas_particulares: 'Usa anteojos recetados.',
    fecha_hora_desaparicion: hace(96),
    latitud: -27.3309, longitud: -55.8663, direccion: 'Costanera de Encarnación',
    numero_denuncia: 'DEN-2026-00377', estado: 'LOCALIZADO',
    proximo_seguimiento: null, seguimiento_etapa: 0, localizado_en: hace(3)
  },
  {
    id: 'demo_005',
    nombre_completo: 'Lucía Fernanda Ayala',
    edad: 27, sexo: 'Femenino', ciudad: 'Capiatá', departamento: 'Central',
    descripcion_fisica: 'Estatura 1,68 m, cabello rubio teñido hasta los hombros.',
    vestimenta: 'Campera de jean y pantalón negro.',
    senas_particulares: 'Tatuaje de una golondrina en la muñeca izquierda.',
    fecha_hora_desaparicion: hace(300),
    latitud: -25.3553, longitud: -57.4456, direccion: 'Ruta PY02 Km 20',
    numero_denuncia: 'DEN-2026-00188', estado: 'CERRADO',
    proximo_seguimiento: null, seguimiento_etapa: 0, motivo_cierre: 'Regresó por sus propios medios al domicilio familiar.'
  },
  {
    id: 'demo_006',
    nombre_completo: 'Diego Armando Recalde',
    edad: 34, sexo: 'Masculino', ciudad: 'Pedro Juan Caballero', departamento: 'Amambay',
    descripcion_fisica: 'Estatura 1,74 m, contextura media, barba candado.',
    vestimenta: 'Remera negra lisa y bermuda caqui.',
    senas_particulares: '',
    fecha_hora_desaparicion: hace(14),
    latitud: -22.5472, longitud: -55.7336, direccion: 'Barrio Obrero',
    numero_denuncia: 'DEN-2026-00440', estado: 'VALIDADO',
    proximo_seguimiento: dentroDe(34), seguimiento_etapa: 0
  }
];

const PISTAS = [
  {
    id: 'demo_pst_001', caso_id: 'demo_001',
    descripcion: 'La vi esperando en la parada de colectivos sobre Eusebio Ayala, sola, cerca de las 17:00.',
    fecha_hora_avistamiento: hace(44),
    latitud: -25.2931, longitud: -57.6204, direccion: 'Parada Eusebio Ayala c/ Medallistas',
    estado: 'APROBADA'
  },
  {
    id: 'demo_pst_002', caso_id: 'demo_003',
    descripcion: 'Una señora con la misma descripción preguntaba por una dirección en el mercado de Luque.',
    fecha_hora_avistamiento: hace(5),
    latitud: -25.2702, longitud: -57.4891, direccion: 'Mercado Municipal de Luque',
    estado: 'PENDIENTE'
  },
  {
    id: 'demo_pst_003', caso_id: 'demo_006',
    descripcion: 'Creo haberlo visto subir a una camioneta blanca en la zona del Barrio Obrero.',
    fecha_hora_avistamiento: hace(10),
    latitud: -22.5501, longitud: -55.7290, direccion: 'Barrio Obrero, Pedro Juan Caballero',
    estado: 'PENDIENTE'
  }
];

async function sembrar() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Cancelado: este script carga datos ficticios y no debe correr en producción.');
    process.exitCode = 1;
    return;
  }

  const db = createDatabase();
  try {
    // Cuenta ciudadana de demostración.
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const { rows: [usuario] } = await db.query(
      `INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
       VALUES ($1, $2, $3, 'ciudadano', TRUE, TRUE, CURRENT_TIMESTAMP)
       ON CONFLICT (correo) DO UPDATE
         SET contrasena_hash = EXCLUDED.contrasena_hash,
             verificado = TRUE,
             acepto_terminos = TRUE
       RETURNING id`,
      ['Ciudadano de demostración', DEMO_EMAIL, hash]
    );

    // Limpieza de lo sembrado antes, respetando las claves foráneas.
    await db.query("DELETE FROM notificaciones WHERE caso_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM pistas WHERE id LIKE 'demo\\_%'");
    await db.query("DELETE FROM cambios_estado_pista WHERE pista_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM cambios_estado_caso WHERE caso_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM suscripciones_caso WHERE caso_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM casos WHERE id LIKE 'demo\\_%'");

    for (const c of CASOS) {
      await db.query(
        `INSERT INTO casos (
           id, nombre_completo, edad, sexo, ciudad, departamento,
           descripcion_fisica, vestimenta, senas_particulares,
           fecha_hora_desaparicion, latitud, longitud, direccion,
           numero_denuncia, estado, reportado_por_usr_id, localizado_en,
           proximo_seguimiento, seguimiento_etapa, motivo_cierre,
           reportante_mayor_edad, autorizacion_parental, aviso_privacidad_aceptado,
           checklist_denuncia, checklist_coherencia, checklist_duplicados, checklist_menores
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                   TRUE, $21, TRUE, $22, $22, $22, $22)`,
        [
          c.id, c.nombre_completo, c.edad, c.sexo, c.ciudad, c.departamento,
          c.descripcion_fisica, c.vestimenta, c.senas_particulares,
          c.fecha_hora_desaparicion, c.latitud, c.longitud, c.direccion,
          c.numero_denuncia, c.estado, usuario.id, c.localizado_en ?? null,
          c.proximo_seguimiento, c.seguimiento_etapa, c.motivo_cierre ?? null,
          c.edad < 18, c.estado !== 'PENDIENTE'
        ]
      );
    }

    for (const p of PISTAS) {
      await db.query(
        `INSERT INTO pistas (id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento,
                             latitud, longitud, direccion, estado, fecha_envio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CURRENT_TIMESTAMP)`,
        [p.id, p.caso_id, usuario.id, p.descripcion, p.fecha_hora_avistamiento,
         p.latitud, p.longitud, p.direccion, p.estado]
      );
    }

    await db.query(
      `INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, leida)
       VALUES ($1, 'demo_001', 'Seguimiento vencido',
               'Han pasado 48 horas sin novedades sobre Sofía Montserrat Giménez. Indicanos si la búsqueda sigue activa.',
               'SEGUIMIENTO_VENCIDO', FALSE),
              ($1, 'demo_004', 'Caso marcado como localizado',
               'Mateo Villalba Ortiz fue reportado como localizado. Gracias por colaborar.',
               'ESTADO_CASO', FALSE)`,
      [usuario.id]
    );

    const { rows: [conteo] } = await db.query(
      `SELECT (SELECT COUNT(*) FROM casos WHERE id LIKE 'demo\\_%') AS casos,
              (SELECT COUNT(*) FROM pistas WHERE id LIKE 'demo\\_%') AS pistas`
    );
    console.log(`Datos de demostración cargados: ${conteo.casos} casos, ${conteo.pistas} pistas.`);
    console.log(`Cuenta ciudadana de prueba: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.log('Todos los registros son ficticios. Volvé a correr el script para regenerarlos.');
  } catch (error) {
    console.error('No se pudieron cargar los datos de demostración:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

sembrar();
