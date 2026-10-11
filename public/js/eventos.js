// Delegación de eventos: reemplaza los on*="..." del HTML para que la política de
// seguridad (CSP) no necesite 'unsafe-inline'. Cada elemento lleva
// data-on-<evento>="expresión" con la misma expresión que tenía el on*="...", pero
// no se evalúa con eval: un intérprete chico solo acepta llamadas a acciones
// registradas, separadas por ";", con estos argumentos:
//   textos ('...' o "..."), números, true, false, null, objetos { clave: valor }
//   y referencias this.x.y (el elemento), event.x (el evento) o estado.x.
import { estado } from './estado.js';

export const EVENTOS = ['click', 'change', 'input', 'submit', 'keydown'];

function tokenizar(texto) {
  const tokens = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '"' || c === "'") {
      let valor = '';
      i += 1;
      while (i < texto.length && texto[i] !== c) {
        if (texto[i] === '\\') i += 1;
        valor += texto[i];
        i += 1;
      }
      if (i >= texto.length) throw new SyntaxError(`Texto sin cerrar en: ${texto}`);
      tokens.push({ tipo: 'texto', valor });
      i += 1;
      continue;
    }
    const numero = /^-?\d+(\.\d+)?/.exec(texto.slice(i));
    if (numero) { tokens.push({ tipo: 'numero', valor: Number(numero[0]) }); i += numero[0].length; continue; }
    const nombre = /^[A-Za-z_$][\w$]*/.exec(texto.slice(i));
    if (nombre) { tokens.push({ tipo: 'nombre', valor: nombre[0] }); i += nombre[0].length; continue; }
    if ('(),;{}:.'.includes(c)) { tokens.push({ tipo: c }); i += 1; continue; }
    throw new SyntaxError(`Carácter no permitido "${c}" en: ${texto}`);
  }
  return tokens;
}

// Devuelve [{ accion, args }] donde cada arg es un nodo a evaluar en el evento.
export function parsearExpresion(texto) {
  const tokens = tokenizar(texto);
  let pos = 0;
  const ver = () => tokens[pos];
  const tomar = tipo => {
    const token = tokens[pos];
    if (!token || (tipo && token.tipo !== tipo)) throw new SyntaxError(`Se esperaba "${tipo}" en: ${texto}`);
    pos += 1;
    return token;
  };
  const valor = () => {
    const token = ver();
    if (!token) throw new SyntaxError(`Expresión incompleta: ${texto}`);
    if (token.tipo === 'texto' || token.tipo === 'numero') { pos += 1; return { literal: token.valor }; }
    if (token.tipo === '{') {
      pos += 1;
      const campos = [];
      while (ver()?.tipo !== '}') {
        const clave = tomar();
        if (clave.tipo !== 'nombre' && clave.tipo !== 'texto') throw new SyntaxError(`Clave inválida en: ${texto}`);
        tomar(':');
        campos.push([clave.valor, valor()]);
        if (ver()?.tipo === ',') pos += 1;
      }
      tomar('}');
      return { objeto: campos };
    }
    if (token.tipo === 'nombre') {
      pos += 1;
      if (token.valor === 'true' || token.valor === 'false') return { literal: token.valor === 'true' };
      if (token.valor === 'null') return { literal: null };
      if (!['this', 'event', 'estado'].includes(token.valor)) {
        throw new SyntaxError(`Solo se permiten this, event y estado como referencias (no "${token.valor}"): ${texto}`);
      }
      const ruta = [token.valor];
      while (ver()?.tipo === '.') { pos += 1; ruta.push(tomar('nombre').valor); }
      return { ruta };
    }
    throw new SyntaxError(`Argumento inválido en: ${texto}`);
  };
  const llamadas = [];
  while (pos < tokens.length) {
    if (ver().tipo === ';') { pos += 1; continue; }
    const accion = tomar('nombre').valor;
    tomar('(');
    const args = [];
    while (ver()?.tipo !== ')') {
      args.push(valor());
      if (ver()?.tipo === ',') pos += 1;
    }
    tomar(')');
    llamadas.push({ accion, args });
  }
  return llamadas;
}

// En un on*="..." nativo, event.currentTarget es el elemento del atributo; con un
// listener en document sería document. Se entrega el evento real con currentTarget
// corregido (los métodos, como preventDefault, siguen actuando sobre el real).
function eventoDelElemento(event, elemento) {
  return new Proxy(event, {
    get(objetivo, propiedad) {
      if (propiedad === 'currentTarget') return elemento;
      const valor = Reflect.get(objetivo, propiedad);
      return typeof valor === 'function' ? valor.bind(objetivo) : valor;
    }
  });
}

function evaluar(nodo, contexto) {
  if ('literal' in nodo) return nodo.literal;
  if (nodo.objeto) return Object.fromEntries(nodo.objeto.map(([clave, v]) => [clave, evaluar(v, contexto)]));
  const [raiz, ...resto] = nodo.ruta;
  let actual = raiz === 'this' ? contexto.elemento
    : raiz === 'event' ? eventoDelElemento(contexto.event, contexto.elemento) : estado;
  for (const propiedad of resto) actual = actual?.[propiedad];
  return actual;
}

const cache = new Map();

function ejecutar(texto, contexto, acciones) {
  if (!cache.has(texto)) cache.set(texto, parsearExpresion(texto));
  for (const { accion, args } of cache.get(texto)) {
    const funcion = acciones[accion];
    if (typeof funcion !== 'function') throw new ReferenceError(`Acción no registrada: ${accion}`);
    funcion(...args.map(arg => evaluar(arg, contexto)));
  }
}

// Un listener por tipo de evento en document. Como con los on*="..." nativos, se
// ejecutan el elemento más cercano y luego sus ancestros con el mismo atributo, y
// un error en uno no impide los demás (se informa como error no capturado).
export function iniciarEventos(acciones) {
  for (const tipo of EVENTOS) {
    const atributo = `data-on-${tipo}`;
    document.addEventListener(tipo, event => {
      let elemento = event.target instanceof Element ? event.target.closest(`[${atributo}]`) : null;
      while (elemento) {
        try {
          ejecutar(elemento.getAttribute(atributo), { elemento, event }, acciones);
        } catch (error) {
          queueMicrotask(() => { throw error; });
        }
        elemento = elemento.parentElement?.closest(`[${atributo}]`);
      }
    });
  }
}
