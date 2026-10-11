import 'dotenv/config';
import { createDatabase } from './db.js';

const DEPARTAMENTOS_CIUDADES = [
  { depto: 'Capital', ciudad: 'Asunción', lat: -25.2867, lng: -57.6470 },
  { depto: 'Central', ciudad: 'San Lorenzo', lat: -25.3397, lng: -57.5089 },
  { depto: 'Central', ciudad: 'Luque', lat: -25.2667, lng: -57.4871 },
  { depto: 'Central', ciudad: 'Lambaré', lat: -25.3458, lng: -57.6064 },
  { depto: 'Central', ciudad: 'Fernando de la Mora', lat: -25.3217, lng: -57.5539 },
  { depto: 'Central', ciudad: 'Capiatá', lat: -25.3553, lng: -57.4453 },
  { depto: 'Central', ciudad: 'Mariano Roque Alonso', lat: -25.2144, lng: -57.5342 },
  { depto: 'Central', ciudad: 'Ñemby', lat: -25.3947, lng: -57.5369 },
  { depto: 'Central', ciudad: 'Villa Elisa', lat: -25.3697, lng: -57.5936 },
  { depto: 'Central', ciudad: 'Itauguá', lat: -25.3853, lng: -57.3364 },
  { depto: 'Alto Paraná', ciudad: 'Ciudad del Este', lat: -25.5097, lng: -54.6111 },
  { depto: 'Alto Paraná', ciudad: 'Hernandarias', lat: -25.4058, lng: -54.6394 },
  { depto: 'Alto Paraná', ciudad: 'Presidente Franco', lat: -25.5647, lng: -54.6158 },
  { depto: 'Itapúa', ciudad: 'Encarnación', lat: -27.3306, lng: -55.8667 },
  { depto: 'Itapúa', ciudad: 'Cambyretá', lat: -27.3000, lng: -55.8167 },
  { depto: 'Caaguazú', ciudad: 'Coronel Oviedo', lat: -25.4444, lng: -56.4403 },
  { depto: 'Caaguazú', ciudad: 'Caaguazú', lat: -25.4600, lng: -56.0139 },
  { depto: 'Guairá', ciudad: 'Villarrica', lat: -25.7486, lng: -56.4344 },
  { depto: 'Amambay', ciudad: 'Pedro Juan Caballero', lat: -22.5501, lng: -55.7290 },
  { depto: 'Concepción', ciudad: 'Concepción', lat: -23.4000, lng: -57.4333 },
  { depto: 'Cordillera', ciudad: 'Caacupé', lat: -25.3858, lng: -57.1417 },
  { depto: 'Cordillera', ciudad: 'San Bernardino', lat: -25.3117, lng: -57.2961 },
  { depto: 'Paraguarí', ciudad: 'Paraguarí', lat: -25.6231, lng: -57.1517 },
  { depto: 'Misiones', ciudad: 'San Juan Bautista', lat: -26.6694, lng: -57.1458 },
  { depto: 'Ñeembucú', ciudad: 'Pilar', lat: -26.8686, lng: -58.2936 },
  { depto: 'Canindeyú', ciudad: 'Salto del Guairá', lat: -24.0625, lng: -54.3069 },
  { depto: 'Presidente Hayes', ciudad: 'Villa Hayes', lat: -25.0931, lng: -57.5236 }
];

const NOMBRES_MASC = [
  'Juan Carlos', 'Lucas Mateo', 'Rodrigo', 'Thiago Ezequiel', 'Alejandro', 'Gabriel',
  'Santiago', 'Bruno Nicolás', 'Maximiliano', 'Matías', 'Diego Armando', 'José Luis',
  'Ramón Ignacio', 'Esteban', 'Martín', 'Ángel David', 'Hugo Fernando', 'Sebastián',
  'Fabricio', 'Nelson Daniel', 'Cristhian', 'Federico', 'Samuel', 'Enzo Gabriel'
];

const NOMBRES_FEM = [
  'Sofía Montserrat', 'María Belén', 'Valentina', 'Camila Nicole', 'Lucía', 'Martina',
  'Fiorella', 'Milagros', 'Bianca', 'Jazmín Rocío', 'Natalia Noemí', 'Luján',
  'Ana Paula', 'Gabriela', 'Fátima Soledad', 'Elena', 'Romina', 'Florencia',
  'Andrea Beatriz', 'Micaela', 'Agustina', 'Paola', 'Carla Patricia', 'Celeste'
];

const APELLIDOS = [
  'González', 'Benítez', 'Martínez', 'López', 'Giménez', 'Vera', 'Duarte', 'Villalba',
  'Ramírez', 'Fernández', 'Gómez', 'Acosta', 'Rojas', 'Ortiz', 'Cáceres', 'Cardozo',
  'Torres', 'Caballero', 'Franco', 'Romero', 'Ayala', 'Barreto', 'Mendoza', 'Insfrán',
  'Valenzuela', 'Bareiro', 'Silvero', 'Paredes', 'Morínigo', 'Alvarenga', 'Bogado'
];

const VESTIMENTAS = [
  'Remera blanca, jeans azules y calzado deportivo oscuro.',
  'Buzo con capucha negro, pantalón deportivo gris y zapatillas.',
  'Camisa a cuadros azul, pantalón vaquero y botas de trabajo.',
  'Uniforme escolar azul marino con camisa blanca.',
  'Vestido floreado de verano con sandalias claras.',
  'Campera rompeviento roja, remera negra y bermuda de jeans.',
  'Remera de la selección paraguaya y short negro.',
  'Chaqueta de abrigo verde militar y pantalón negro.',
  'Polera gris, campera de cuero sintético y calzado negro.'
];

const DESCRIPCIONES = [
  'Estatura aproximada 1,65 m, contextura delgada, cabello lacio oscuro.',
  'Estatura 1,75 m, contextura robusta, tez trigueña, cabello corto castaño.',
  'Estatura 1,55 m, contextura media, ojos marrones claros, cabello ondulado.',
  'Estatura 1,80 m, complexión atlética, piel clara, corte de pelo rapado a los lados.',
  'Estatura 1,60 m, contextura delgada, usa anteojos de marco negro.',
  'Estatura 1,70 m, contextura mediana, tez blanca, cabello castaño con reflejos.'
];

const SENAS = [
  'Lunar visible en la mejilla izquierda.',
  'Cicatriz pequeña en la frente.',
  'Tatuaje pequeño de una cruz en el antebrazo izquierdo.',
  'Sin señas visibles particulares.',
  'Piercing en la nariz.',
  'Cicatriz quirúrgica en la rodilla derecha.',
  'Camina rengueando levemente de la pierna izquierda.',
  'Tatuaje con la palabra "Familia" en la muñeca.'
];

const ESTADOS = [
  'VALIDADO', 'VALIDADO', 'VALIDADO', 'VALIDADO', 'VALIDADO',
  'EN_SEGUIMIENTO', 'EN_SEGUIMIENTO',
  'LOCALIZADO',
  'PENDIENTE'
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function jitter(coord, factor = 0.03) {
  return Number((coord + (Math.random() - 0.5) * factor).toFixed(6));
}

async function sembrar100() {
  const db = createDatabase();
  try {
    console.log('⏳ Conectando a la base de datos...');

    // Buscamos o creamos el usuario reportante
    let usuarioId = 1;
    const { rows: userRows } = await db.query('SELECT id FROM usuarios LIMIT 1');
    if (userRows.length > 0) {
      usuarioId = userRows[0].id;
    }

    console.log('🧹 Limpiando registros anteriores de pruebas masivas (seed_100_)...');
    await db.query("DELETE FROM notificaciones WHERE caso_id LIKE 'seed_100_%'");
    await db.query("DELETE FROM pistas WHERE caso_id LIKE 'seed_100_%'");
    await db.query("DELETE FROM cambios_estado_caso WHERE caso_id LIKE 'seed_100_%'");
    await db.query("DELETE FROM suscripciones_caso WHERE caso_id LIKE 'seed_100_%'");
    await db.query("DELETE FROM casos WHERE id LIKE 'seed_100_%'");

    console.log('🚀 Generando e insertando 100 casos realistas para Paraguay...');
    const ahora = Date.now();

    for (let i = 1; i <= 100; i++) {
      const id = `seed_100_${String(i).padStart(3, '0')}`;
      const esFemenino = Math.random() < 0.5;
      const nombre = esFemenino ? randomChoice(NOMBRES_FEM) : randomChoice(NOMBRES_MASC);
      const apellido1 = randomChoice(APELLIDOS);
      const apellido2 = randomChoice(APELLIDOS);
      const nombreCompleto = `${nombre} ${apellido1} ${apellido2}`;
      
      const edad = randomInt(8, 78);
      const sexo = esFemenino ? 'Femenino' : 'Masculino';
      const loc = randomChoice(DEPARTAMENTOS_CIUDADES);
      const latitud = jitter(loc.lat, 0.04);
      const longitud = jitter(loc.lng, 0.04);
      
      const horasAtras = randomInt(4, 300);
      const fechaDesaparicion = new Date(ahora - horasAtras * 3600 * 1000);
      
      const estado = randomChoice(ESTADOS);
      let localizadoEn = null;
      let motivoCierre = null;
      if (estado === 'LOCALIZADO') {
        localizadoEn = new Date(ahora - randomInt(1, 12) * 3600 * 1000);
        motivoCierre = 'Localizado por familiares en buen estado de salud.';
      }

      const numDenuncia = estado === 'PENDIENTE' ? '' : `DEN-2026-${String(1000 + i).padStart(5, '0')}`;
      const etapa = estado === 'EN_SEGUIMIENTO' ? randomInt(1, 3) : 0;
      const proximoSeguimiento = estado === 'EN_SEGUIMIENTO' 
        ? new Date(ahora + randomInt(12, 72) * 3600 * 1000) 
        : null;

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
          id,
          nombreCompleto,
          edad,
          sexo,
          loc.ciudad,
          loc.depto,
          randomChoice(DESCRIPCIONES),
          randomChoice(VESTIMENTAS),
          randomChoice(SENAS),
          fechaDesaparicion,
          latitud,
          longitud,
          `Barrio Centro / Inmediaciones de ${loc.ciudad}`,
          numDenuncia,
          estado,
          usuarioId,
          localizadoEn,
          proximoSeguimiento,
          etapa,
          motivoCierre,
          edad < 18,
          estado !== 'PENDIENTE'
        ]
      );
    }

    const { rows: [total] } = await db.query(
      "SELECT COUNT(*) as cantidad, COUNT(*) FILTER (WHERE estado = 'VALIDADO') as validados, COUNT(*) FILTER (WHERE estado = 'EN_SEGUIMIENTO') as seguimiento, COUNT(*) FILTER (WHERE estado = 'LOCALIZADO') as localizados, COUNT(*) FILTER (WHERE estado = 'PENDIENTE') as pendientes FROM casos WHERE id LIKE 'seed_100_%'"
    );

    console.log(`✅ ¡Éxito! Se cargaron ${total.cantidad} casos de prueba masivos.`);
    console.log(`   - Validados: ${total.validados}`);
    console.log(`   - En Seguimiento: ${total.seguimiento}`);
    console.log(`   - Localizados: ${total.localizados}`);
    console.log(`   - Pendientes: ${total.pendientes}`);

  } catch (error) {
    console.error('❌ Error al sembrar los 100 casos:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

sembrar100();
