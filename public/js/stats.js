// Estadísticas públicas y métricas.
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { getStore } from './store.js';
import { labelButtons } from './ui.js';

export function renderAnalyticsBars(rows, color = 'navy') {
  const maxValue = Math.max(...rows.map(row => Number(row.total)), 1);
  return rows.length
    ? rows.map(row => {
      const count = Number(row.total);
      const label = escapeHtml(row.departamento
        ? `${row.categoria}, ${row.departamento}`
        : row.categoria || row.periodo || 'Sin categoría');
      return `<div class="analytics-row">
        <div class="analytics-label"><span>${label}</span><strong>${count}</strong></div>
        <div class="analytics-track"><span class="analytics-bar analytics-bar-${color}" style="--bar-width:${Math.max(count / maxValue * 100, 2)}%"></span></div>
      </div>`;
    }).join('')
    : '<p class="analytics-empty">Sin datos disponibles.</p>';
}

export function buildAgeAnalyticsRows(statistics, cases) {
  const counts = new Map((statistics.casosPorEdad || []).map(row => [row.categoria, Number(row.total)]));
  return [
    ['Niñez (0–11)', c => Number(c.edad) <= 11],
    ['Adolescentes (12–17)', c => Number(c.edad) >= 12 && Number(c.edad) <= 17],
    ['Adultos (18–64)', c => Number(c.edad) >= 18 && Number(c.edad) <= 64],
    ['Mayores (65+)', c => Number(c.edad) >= 65]
  ].map(([categoria, matches]) => ({
    categoria,
    total: counts.get(categoria) ?? cases.filter(matches).length
  }));
}

export function buildStateAnalyticsRows(statistics, cases) {
  const counts = new Map((statistics.casosPorEstado || []).map(row => [row.categoria, Number(row.total)]));
  return [
    ['Búsqueda activa', 'VALIDADO'],
    ['Localizada', 'LOCALIZADO'],
    ['En seguimiento', 'EN_SEGUIMIENTO'],
    ['Cerrado', 'CERRADO']
  ].map(([categoria, state]) => ({
    categoria,
    total: counts.get(categoria) ?? cases.filter(c => c.estado === state).length
  }));
}

export function updatePublicMetricCards(statistics) {
  const cases = getStore().casos;
  const total = Number(statistics.total ?? cases.length);
  const found = Number(statistics.localizados ?? statistics.encontrados
    ?? cases.filter(c => c.estado === 'LOCALIZADO').length);
  const active = Number(statistics.activos
    ?? cases.filter(c => c.estado === 'VALIDADO' || c.estado === 'EN_SEGUIMIENTO').length);
  const outdated = cases.filter(c => c.estado === 'EN_SEGUIMIENTO' && Number(c.seguimientoEtapa) >= 2).length;
  const effectiveness = total ? Math.round(found / total * 100) : 0;
  const values = {
    metricTotal: total,
    metricFound: found,
    metricActive: active,
    metricOutdated: `En seguimiento activo · ${outdated} sin actualizar`,
    metricEffectiveness: `${effectiveness}%`
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
  const cityRows = statistics.casosPorCiudad || [];
  [
    ['analyticsByCity', cityRows, 'navy'],
    ['analyticsByAge', buildAgeAnalyticsRows(statistics, cases), 'navy'],
    ['analyticsByState', buildStateAnalyticsRows(statistics, cases), 'status']
  ].forEach(([id, rows, color]) => {
    const container = document.getElementById(id);
    if (container) container.innerHTML = renderAnalyticsBars(rows, color);
  });
}

// ==========================================
// VISTA 6: ESTADÍSTICAS COMPACTAS 2x2 (SECCIÓN 8)
// ==========================================
export function setStatsView(view) {
  estado.activeStatsView = view;
  const main = document.getElementById('mainContent');
  if (main && window.currentStatistics) {
    main.innerHTML = renderStatsView(window.currentStatistics);
    labelButtons(main);
  }
}

export function renderStatsView(stats) {
  window.currentStatistics = stats;
  const total = Number(stats.total);
  const encontrados = Number(stats.encontrados);
  const activos = Number(stats.activos);
  const pct = Number(stats.porcentajeResueltos);
  const referenceMonths = [
    { month: 'Ene', reports: 230, located: 185 },
    { month: 'Feb', reports: 220, located: 175 },
    { month: 'Mar', reports: 230, located: 185 },
    { month: 'Abr', reports: 220, located: 175 },
    { month: 'May', reports: 210, located: 170 },
    { month: 'Jun', reports: 220, located: 180 },
    { month: 'Jul', reports: 210, located: 170 },
    { month: 'Ago', reports: 220, located: 175 },
    { month: 'Sep', reports: 230, located: 185 },
    { month: 'Oct', reports: 220, located: 180 },
    { month: 'Nov', reports: 210, located: 170 },
    { month: 'Dic', reports: 180, located: 150 }
  ];
  const referenceMax = Math.max(...referenceMonths.map(month => month.reports));
  const monthlyBars = referenceMonths.map(month => `<div class="monthly-chart-column" aria-label="${month.month}: ${month.reports} denuncias de referencia, ${month.located} localizadas">
    <div class="monthly-chart-bars">
      <span class="monthly-chart-bar monthly-reports" style="--bar-height:${month.reports / referenceMax * 100}%"></span>
      <span class="monthly-chart-bar monthly-located" style="--bar-height:${month.located / referenceMax * 100}%"></span>
    </div><span class="monthly-chart-month">${month.month}</span>
  </div>`).join('');
  const departments = stats.casosPorDepartamento || [];
  const maxDepartmentCount = Math.max(...departments.map(row => Number(row.total)), 1);
  const departmentBars = departments.length ? departments.map(row => `<div class="department-row">
    <div class="department-label"><span>${escapeHtml(row.categoria || 'Sin especificar')}</span><strong>${Number(row.total)}</strong></div>
    <div class="analytics-track"><span class="analytics-bar analytics-bar-navy" style="--bar-width:${Math.max(Number(row.total) / maxDepartmentCount * 100, 2)}%"></span></div>
  </div>`).join('') : '<p class="analytics-empty">Sin datos disponibles.</p>';
  const chartViews = {
    porMes: ['Personas localizadas por mes', stats.porMes],
    porCiudad: ['Personas localizadas por ciudad', stats.porCiudad],
    porSexo: ['Personas localizadas por sexo', stats.porSexo],
    porEdad: ['Personas localizadas por edad', stats.porEdad]
  };
  const [chartTitle, chartRows = []] = chartViews[estado.activeStatsView] || chartViews.porMes;
  const maxValue = Math.max(...chartRows.map(row => Number(row.total)), 1);
  const chart = chartRows.length ? chartRows.map(row => {
    const value = Number(row.total);
    const label = escapeHtml(row.periodo || row.categoria || 'Sin categoría');
    return `<div class="chart-row">
      <div class="chart-label"><span>${label}</span><strong>${value}</strong></div>
      <div class="chart-track"><span class="chart-bar" style="--bar-width:${Math.max(value / maxValue * 100, 2)}%"></span></div>
    </div>`;
  }).join('') : '<p class="muted">Sin datos disponibles.</p>';

  return `
    <div>
      <header class="page-heading">
        <span class="section-kicker">Datos de la plataforma</span>
        <h1>Estadísticas nacionales de búsqueda</h1>
        <p>Indicadores agregados de los casos publicados y de la referencia histórica 2025.</p>
      </header>

      <p class="stats-disclaimer">Datos agregados y anónimos de personas. La referencia 2025 proviene del documento del proyecto; la distribución mensual es ilustrativa.</p>
      <section class="historical-metrics" aria-label="Indicadores de referencia y datos en vivo">
        <article><strong>2.600</strong><span>Denuncias 2025 ref.</span></article>
        <article class="historical-found"><strong>2.100</strong><span>Localizadas 2025 ref.</span></article>
        <article class="historical-rate"><strong>81%</strong><span>Tasa de localización</span></article>
        <article class="historical-live"><strong>${activos}</strong><span>Activas hoy en la plataforma</span></article>
      </section>
      <div class="stats-live-secondary">
        <span>Plataforma: ${total} casos publicados</span><span>${encontrados} localizados · ${pct}% de resolución en registros publicados</span>
      </div>

      <div class="stats-analytics-layout">
        <section class="card monthly-chart-panel" aria-labelledby="monthlyChartHeading">
          <div class="analytics-panel-heading"><div><span class="section-kicker">Referencia anual</span><h2 id="monthlyChartHeading">Denuncias y localizadas · 2025</h2></div><span class="illustrative-badge">Distribución ilustrativa</span></div>
          <div class="monthly-chart-legend"><span><i class="legend-reports"></i>Denuncias</span><span><i class="legend-located"></i>Localizadas</span></div>
          <div class="monthly-chart" role="img" aria-label="Gráfico mensual agrupado de denuncias y personas localizadas en 2025">${monthlyBars}</div>
          <p class="monthly-chart-note">Totales de referencia: 2.600 denuncias · 2.100 localizadas.</p>
        </section>
        <aside class="stats-side-panels">
          <section class="card operational-panel"><span class="section-kicker">Indicadores operativos</span><h2>Seguimiento de gestión</h2>
            <p class="operational-disclaimer">Valores ilustrativos del prototipo</p>
            <div class="operational-item"><strong>12 min</strong><span>Validación promedio <small>Meta &lt; 15 min</small></span></div>
            <div class="operational-item"><strong>67%</strong><span>Seguimiento al día <small>De casos activos</small></span></div>
            <div class="operational-item"><strong>67%</strong><span>Pistas con GPS <small>De 3 pistas · referencia</small></span></div>
          </section>
          <section class="card department-panel"><span class="section-kicker">Distribución geográfica</span><h2>Casos publicados por departamento</h2><div class="department-chart">${departmentBars}</div></section>
        </aside>
      </div>

      <section class="card stats-chart stats-live-chart" aria-labelledby="statsChartHeading">
        <h2 id="statsChartHeading">${chartTitle}</h2>
        <div class="filter-chips" role="group" aria-label="Vista de estadísticas en vivo">
          <button class="filter-chip ${estado.activeStatsView === 'porMes' ? 'active' : ''}" data-on-click="setStatsView('porMes')" aria-label="Ver estadísticas por mes">Mes</button>
          <button class="filter-chip ${estado.activeStatsView === 'porCiudad' ? 'active' : ''}" data-on-click="setStatsView('porCiudad')" aria-label="Ver estadísticas por ciudad">Ciudad</button>
          <button class="filter-chip ${estado.activeStatsView === 'porSexo' ? 'active' : ''}" data-on-click="setStatsView('porSexo')" aria-label="Ver estadísticas por sexo">Sexo</button>
          <button class="filter-chip ${estado.activeStatsView === 'porEdad' ? 'active' : ''}" data-on-click="setStatsView('porEdad')" aria-label="Ver estadísticas por edad">Edad</button>
        </div>
        <div class="chart-list">${chart}</div>
      </section>
    </div>
  `;
}
