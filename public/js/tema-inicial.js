// Aplica el tema guardado antes del primer pintado. Sin esto la página
// se dibuja en claro y recién después salta a oscuro: se ve un flash.
// Es un script clásico (no módulo) cargado en <head> para que corra antes de
// dibujar; está en un archivo porque la CSP no permite scripts inline.
try {
  const saved = localStorage.getItem('rastreo_theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
} catch (error) {
  /* Modo privado o almacenamiento bloqueado: se queda el tema claro por defecto. */
}
