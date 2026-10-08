function obtenerUsuarios() {
  try { return JSON.parse(localStorage.getItem("rastreo_usuarios")) || []; }
  catch (e) { return []; }
}

function guardarUsuarios(lista) {
  localStorage.setItem("rastreo_usuarios", JSON.stringify(lista));
}

function normalizarIdentificador(texto) {
  let t = String(texto || "").trim();
  if (t.includes("@")) return t.toLowerCase();
  t = t.replace(/[\s\-\(\)\.]/g, "");
  if (t.startsWith("+595")) t = "0" + t.slice(4);
  else if (t.startsWith("595")) t = "0" + t.slice(3);
  return t;
}

async function hashContrasena(contrasena, sal) {
  const datos = new TextEncoder().encode(sal + contrasena);
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", datos);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  let hash = 2166136261;
  for (const byte of datos) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: 8 }, (_, index) => {
    hash = Math.imul(hash ^ (hash >>> 13) ^ index, 2246822519);
    return (hash >>> 0).toString(16).padStart(8, "0");
  }).join("");
}

window.obtenerUsuarios = obtenerUsuarios;
window.guardarUsuarios = guardarUsuarios;
window.normalizarIdentificador = normalizarIdentificador;
window.hashContrasena = hashContrasena;