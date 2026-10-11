import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

// El frontend no usa JavaScript inline (la CSP lo prohíbe): los eventos se declaran
// con data-on-<evento>="acción(args)" y public/js/eventos.js los interpreta con las
// funciones registradas en `acciones` (public/js/app.js). Si una acción no está
// registrada o la expresión no la entiende el intérprete, el botón no hace nada.
const publicDir = new URL('../../public/', import.meta.url);

async function frontendSources() {
  const sources = [['Rastreopy.html', await readFile(new URL('Rastreopy.html', publicDir), 'utf8')]];
  for (const file of await readdir(new URL('js/', publicDir))) {
    if (file.endsWith('.js')) sources.push([`js/${file}`, await readFile(new URL(`js/${file}`, publicDir), 'utf8')]);
  }
  return sources;
}

test('el HTML y los templates no usan JavaScript inline', async () => {
  for (const [file, source] of await frontendSources()) {
    const inline = [...source.matchAll(/[\s"'](on(?:click|change|input|submit|keydown|keyup|load|error|focus|blur|mouse\w+)=)["']/gi)]
      .map(match => match[1]);
    assert.deepEqual(inline, [], `${file} tiene handlers inline`);
    assert.doesNotMatch(source, /href=["']javascript:/i, `${file} tiene enlaces javascript:`);
  }
  const [, html] = (await frontendSources())[0];
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
  assert.equal(inlineScripts.length, 0, 'Rastreopy.html no puede tener <script> sin src');
});

test('cada data-on-* se entiende y usa acciones registradas en app.js', async () => {
  const { parsearExpresion, EVENTOS } = await import(new URL('js/eventos.js', publicDir));
  const sources = await frontendSources();
  const app = sources.find(([file]) => file === 'js/app.js')[1];
  const registro = /export const acciones = \{([\s\S]*?)\};/.exec(app);
  assert.ok(registro, 'app.js debe exportar `acciones`');
  const registradas = new Set(registro[1].split(',').map(name => name.trim()).filter(Boolean));

  const usadas = new Set();
  let expresiones = 0;
  for (const [file, source] of sources) {
    for (const [, evento, expresion] of source.matchAll(/data-on-([a-z]+)="([^"]*)"/g)) {
      assert.ok(EVENTOS.includes(evento), `${file}: evento no soportado data-on-${evento}`);
      // En los templates, ${...} se resuelve antes; se reemplaza por un valor de ejemplo.
      const ejemplo = expresion.replace(/\$\{[^}]*\}/g, '0');
      let llamadas;
      assert.doesNotThrow(() => { llamadas = parsearExpresion(ejemplo); }, `${file}: no se puede interpretar "${expresion}"`);
      for (const { accion } of llamadas) usadas.add(accion);
      expresiones += 1;
    }
  }
  assert.ok(expresiones > 100, `se esperaban más de 100 expresiones, hay ${expresiones}`);
  const faltan = [...usadas].filter(accion => !registradas.has(accion)).sort();
  assert.deepEqual(faltan, [], `acciones usadas en data-on-* que no están en \`acciones\`: ${faltan.join(', ')}`);
});

test('el delegador imita a on*="...": this, currentTarget, preventDefault y burbujeo', async () => {
  // DOM mínimo: lo justo que usa iniciarEventos (closest, getAttribute, parentElement).
  class FakeElement {
    constructor(attrs = {}, parent = null) { this.attrs = attrs; this.parentElement = parent; this.dataset = attrs.dataset || {}; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    closest(selector) {
      const name = selector.slice(1, -1);
      for (let el = this; el; el = el.parentElement) if (el.getAttribute(name) !== null) return el;
      return null;
    }
  }
  const previousElement = globalThis.Element;
  const previousDocument = globalThis.document;
  globalThis.Element = FakeElement;
  globalThis.document = new EventTarget();
  try {
    const { iniciarEventos } = await import(new URL('js/eventos.js', publicDir));
    const llamadas = [];
    iniciarEventos({
      enviar(event, el) { llamadas.push(['enviar', event.currentTarget === el, el.dataset.id]); event.preventDefault(); },
      exterior(el) { llamadas.push(['exterior', el.dataset.id]); }
    });
    const exterior = new FakeElement({ 'data-on-submit': 'exterior(this)', dataset: { id: 'afuera' } });
    const formulario = new FakeElement({ 'data-on-submit': 'enviar(event, this)', dataset: { id: 'form' } }, exterior);
    const boton = new FakeElement({}, formulario);
    const event = new Event('submit', { cancelable: true });
    Object.defineProperty(event, 'target', { value: boton });
    document.dispatchEvent(event);
    assert.deepEqual(llamadas, [['enviar', true, 'form'], ['exterior', 'afuera']]);
    assert.equal(event.defaultPrevented, true, 'preventDefault debe actuar sobre el evento real');
  } finally {
    globalThis.Element = previousElement;
    globalThis.document = previousDocument;
  }
});

test('el intérprete de eventos solo acepta llamadas con argumentos simples', async () => {
  const { parsearExpresion } = await import(new URL('js/eventos.js', publicDir));
  assert.deepEqual(parsearExpresion("navigateTo('auth', {authMode: 'login'})"), [{
    accion: 'navigateTo',
    args: [{ literal: 'auth' }, { objeto: [['authMode', { literal: 'login' }]] }]
  }]);
  assert.deepEqual(
    parsearExpresion('toggleDrawer(false); toggleNotificationsModal()').map(l => l.accion),
    ['toggleDrawer', 'toggleNotificationsModal']
  );
  assert.deepEqual(parsearExpresion('f(this.dataset.caseId, event, estado.leadMarker, 3)')[0].args, [
    { ruta: ['this', 'dataset', 'caseId'] }, { ruta: ['event'] }, { ruta: ['estado', 'leadMarker'] }, { literal: 3 }
  ]);
  for (const peligrosa of ['alert(document.cookie)', 'f(window.x)', 'f(1+1)', 'fetch(`x`)', 'a.b()', 'f(x=1)']) {
    assert.throws(() => parsearExpresion(peligrosa), SyntaxError, peligrosa);
  }
});
