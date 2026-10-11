import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

// Mientras dure la migración a módulos (E2), los on*="..." del HTML llaman a
// funciones globales. Las que viven en un <script type="module"> o en public/js/
// solo existen en window si se exponen con Object.assign(window, { ... }) o
// window.nombre = ...; si falta alguna, el botón falla con ReferenceError.
const publicDir = new URL('../../public/', import.meta.url);
const NOT_FUNCTIONS = new Set(['document', 'event', 'if', 'return', 'this', 'window']);

function exposedNames(source) {
  const names = new Set();
  for (const [, block] of source.matchAll(/Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const [, name] of block.matchAll(/(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*(?=[,:}\n]|$)/g)) names.add(name);
  }
  for (const [, name] of source.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(name);
  return names;
}

test('cada función usada en on*="..." del HTML está disponible en window', async () => {
  const html = await readFile(new URL('Rastreopy.html', publicDir), 'utf8');
  const sources = [html];
  for (const file of await readdir(new URL('js/', publicDir)).catch(() => [])) {
    if (file.endsWith('.js')) sources.push(await readFile(new URL(`js/${file}`, publicDir), 'utf8'));
  }

  const available = new Set();
  for (const source of sources) for (const name of exposedNames(source)) available.add(name);
  // Las funciones de <script> clásicos (sin type="module") ya son globales.
  for (const [, body] of html.matchAll(/<script(?![^>]*type="module")(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    for (const [, name] of body.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) available.add(name);
  }

  const used = new Set();
  for (const [, code] of html.matchAll(/\son(?:click|change|input|submit|keydown|keyup|blur|focus)="([^"]*)"/g)) {
    for (const [, name] of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!NOT_FUNCTIONS.has(name)) used.add(name);
    }
  }

  assert.ok(used.size > 0, 'no se encontraron handlers inline');
  const missing = [...used].filter(name => !available.has(name)).sort();
  assert.deepEqual(missing, [], `funciones usadas en el HTML que no están en window: ${missing.join(', ')}`);
});
