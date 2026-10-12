import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import test from 'node:test';

// Dos páginas comparten los módulos de public/js/: la web (Rastreopy.html) y la app
// (app/index.html). Esos módulos buscan contenedores fijos por id (mainContent,
// drawer, modales, franja offline...), así que las dos páginas tienen que tenerlos.
// Este test detecta si una página pierde un id que un módulo usa.
const publicDir = new URL('../../public/', import.meta.url);
const read = path => readFile(new URL(path, publicDir), 'utf8');

// Del panel de administración: solo en la web. La app no duplica el panel
// (router.js lleva al admin a /#/panel), así que no los tiene.
const ADMIN_PANEL_ONLY = ['reviewCaseDetails', 'reviewChecklistForm', 'reviewChecklistModal',
  'reviewDenuncia', 'simTimeModal', 'simulateFollowupButton'];

// ids que un archivo busca con getElementById('x') o querySelector('#x').
function idsBuscados(source) {
  return [
    ...[...source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
    ...[...source.matchAll(/querySelector(?:All)?\(\s*['"`]#([A-Za-z][\w-]*)/g)].map(m => m[1])
  ];
}

// ids que un archivo crea en sus plantillas (id="x" sin ${...}).
function idsCreados(source) {
  return [...source.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]);
}

async function jsDe(dir) {
  const files = (await readdir(new URL(dir, publicDir))).filter(file => file.endsWith('.js'));
  return Promise.all(files.map(async file => [`${dir}${file}`, await read(`${dir}${file}`)]));
}

// Los ids que una página tiene que traer en su HTML para un conjunto de módulos.
function requeridos(modulos, plantillas) {
  const creados = new Set(plantillas.flatMap(([, source]) => idsCreados(source)));
  return [...new Set(modulos.flatMap(([, source]) => idsBuscados(source)))].filter(id => !creados.has(id)).sort();
}

test('web y app tienen los contenedores e ids que esperan los módulos', async () => {
  const js = await jsDe('js/');
  const app = await jsDe('app/');
  const compartidos = js.filter(([file]) => file !== 'js/web.js');
  const web = { html: await read('Rastreopy.html'), propios: js.filter(([file]) => file === 'js/web.js') };
  const movil = { html: await read('app/index.html'), propios: app };

  const comunes = requeridos(compartidos, js);
  assert.ok(comunes.length > 20, `se esperaban más ids compartidos, hay ${comunes.length}`);
  for (const id of ADMIN_PANEL_ONLY) assert.ok(comunes.includes(id), `${id} ya no lo usa ningún módulo: sacarlo de ADMIN_PANEL_ONLY`);

  for (const [pagina, { html, propios }, excepto] of [
    ['Rastreopy.html', web, []],
    ['app/index.html', movil, ADMIN_PANEL_ONLY]
  ]) {
    const presentes = idsCreados(html);
    const duplicados = presentes.filter((id, index) => presentes.indexOf(id) !== index);
    assert.deepEqual(duplicados, [], `${pagina}: ids repetidos`);
    const necesarios = [...comunes.filter(id => !excepto.includes(id)), ...requeridos(propios, [...js, ...app])];
    const faltan = necesarios.filter(id => !presentes.includes(id));
    assert.deepEqual(faltan, [], `${pagina}: faltan ids que usan los módulos`);
  }
  const appHtml = idsCreados(movil.html);
  assert.deepEqual(ADMIN_PANEL_ONLY.filter(id => appHtml.includes(id)), [], 'la app no duplica el panel admin');
});

test('solo la app es instalable: manifest fijo en /app/ y ninguno en la web', async () => {
  const web = await read('Rastreopy.html');
  const app = await read('app/index.html');
  assert.doesNotMatch(web, /rel="manifest"/);
  assert.match(app, /<link rel="manifest" href="\/app\/manifest\.webmanifest">/);
  assert.match(app, /viewport-fit=cover/);
  assert.match(app, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(app, /name="apple-mobile-web-app-title"/);
  assert.match(app, /rel="apple-touch-icon" href="\/icons\/rastreopy-192\.png"/);
  assert.match(app, /name="theme-color"/);
  const manifest = JSON.parse(await read('app/manifest.webmanifest'));
  assert.equal(manifest.id, '/app/');
  assert.equal(manifest.start_url, '/app/');
  assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.display, 'standalone');
  for (const size of ['192x192', '512x512']) {
    for (const purpose of ['any', 'maskable']) {
      assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.purpose === purpose && icon.type === 'image/png'), `${size} ${purpose}`);
    }
  }
});

test('el APP_SHELL del service worker cubre la web, la app y sus módulos', async () => {
  const sw = await read('sw.js');
  const shell = [...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  // Rutas de página → archivo que sirve Express.
  const archivo = entry => ({ '/': 'Rastreopy.html', '/app/': 'app/index.html' })[entry] || entry.slice(1);
  for (const entry of shell) {
    assert.ok((await stat(new URL(archivo(entry), publicDir))).isFile(), `${entry} no existe en public/`);
  }
  const esperados = ['/', '/offline.html', '/app/'];
  for (const dir of ['js/', 'app/', 'icons/']) {
    for (const file of await readdir(new URL(dir, publicDir))) {
      if (file !== 'index.html') esperados.push(`/${dir}${file}`);
    }
  }
  const faltan = esperados.filter(entry => !shell.includes(entry) && !(entry === '/offline.html' && /OFFLINE_PAGE,/.test(sw)));
  assert.deepEqual(faltan, [], 'archivos de public/ que faltan en APP_SHELL (y subir la versión del caché)');
});
