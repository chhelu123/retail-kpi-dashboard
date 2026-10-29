/* Retail Sales KPI Dashboard - all logic runs in the browser (no backend).
 * 1. load data/orders.json   2. read filters   3. filter rows (current + previous period)
 * 4. compute KPIs & aggregates   5. draw / update charts, table and insights          */
"use strict";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const css = getComputedStyle(document.documentElement);
const C = n => css.getPropertyValue(n).trim();
const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"].map(C);
// colour follows the entity (fixed), never its rank
const CAT_COLOR = {
  "Electronics": SERIES[0], "Fashion": SERIES[1], "Home & Kitchen": SERIES[2],
  "Grocery": SERIES[3], "Beauty & Personal Care": SERIES[4],
};
const SEG_COLOR = { "Consumer": SERIES[0], "Corporate": SERIES[1], "Small Business": SERIES[2] };
const CH_COLOR = { "Website": SERIES[0], "Mobile App": SERIES[1], "Marketplace": SERIES[2], "Retail Store": SERIES[3] };

const state = { rows: [], dims: {}, startYear: 2023, maxMi: 35, charts: {} };
const $ = id => document.getElementById(id);
const FILTER_DIMS = { region: "fRegion", category: "fCategory", segment: "fSegment", channel: "fChannel" };

/* ------------------------------------------------------------ 1. load data */
async function loadData() {
  const res = await fetch("data/orders.json");
  const j = await res.json();
  const ci = Object.fromEntries(j.cols.map((c, i) => [c, i]));
  const start = new Date(j.meta.start + "T00:00:00Z");
  state.startYear = start.getUTCFullYear();
  state.dims = j.dims;
  // decode the compact array-of-arrays into plain objects
  state.rows = j.rows.map(r => {
    const d = new Date(start.getTime() + r[ci.day] * 864e5);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const o = { mi: (y - state.startYear) * 12 + m, order: r[ci.order], customer: r[ci.customer] };
    for (const k of ["region", "state", "city", "segment", "category", "sub_category", "product", "channel", "payment_mode"])
      o[k] = j.dims[k][r[ci[k]]];
    o.qty = r[ci.quantity]; o.discount = r[ci.discount];
    o.sales = r[ci.sales]; o.cost = r[ci.cost]; o.profit = r[ci.profit];
    o.days = r[ci.delivery_days]; o.returned = r[ci.returned];
    return o;
  });
  state.maxMi = Math.max(...state.rows.map(r => r.mi));
  $("dataInfo").textContent = `${num(state.rows.length)} order lines, ${j.meta.start.slice(0, 4)}–${j.meta.end.slice(0, 4)}`;
}

/* ----------------------------------------------------------- 2. filters */
const miToYm = mi => `${state.startYear + Math.floor(mi / 12)}-${String(mi % 12 + 1).padStart(2, "0")}`;
const ymToMi = ym => { const [y, m] = ym.split("-").map(Number); return (y - state.startYear) * 12 + m - 1; };
const miLabel = mi => `${MONTHS[mi % 12]} ${state.startYear + Math.floor(mi / 12)}`;

function initFilters() {
  for (const [dim, id] of Object.entries(FILTER_DIMS)) {
    $(id).innerHTML = `<option value="All">All</option>` +
      state.dims[dim].map(v => `<option>${v}</option>`).join("");
  }
  // defaults: latest full year, then override from URL query (?region=West&year=2024 ...)
  const q = new URLSearchParams(location.search);
  setYear(q.get("year") || String(state.startYear + Math.floor(state.maxMi / 12)));
  if (q.get("from")) { $("fFrom").value = q.get("from"); $("fYear").value = "custom"; }
  if (q.get("to")) { $("fTo").value = q.get("to"); $("fYear").value = "custom"; }
  for (const [dim, id] of Object.entries(FILTER_DIMS)) {
    const v = q.get(dim);
    if (v && state.dims[dim].includes(v)) $(id).value = v;
  }
  $("fYear").addEventListener("change", e => { setYear(e.target.value); render(); });
  for (const id of ["fFrom", "fTo"]) $(id).addEventListener("change", () => { $("fYear").value = "custom"; render(); });
  for (const id of Object.values(FILTER_DIMS)) $(id).addEventListener("change", render);
  $("btnReset").addEventListener("click", () => {
    for (const id of Object.values(FILTER_DIMS)) $(id).value = "All";
    setYear(String(state.startYear + Math.floor(state.maxMi / 12)));
    render();
  });
}

function setYear(y) {
  $("fYear").value = y;
  if (y === "all") { $("fFrom").value = miToYm(0); $("fTo").value = miToYm(state.maxMi); }
  else if (/^\d{4}$/.test(y)) { $("fFrom").value = `${y}-01`; $("fTo").value = `${y}-12`; }
}

function readFilters() {
  let from = ymToMi($("fFrom").value || miToYm(0)), to = ymToMi($("fTo").value || miToYm(state.maxMi));
  if (from > to) [from, to] = [to, from];
  const f = { from, to };
  for (const [dim, id] of Object.entries(FILTER_DIMS)) f[dim] = $(id).value;
  // previous period = window of the same length immediately before
  const len = to - from + 1;
  f.prevFrom = from - len; f.prevTo = from - 1;
  return f;
}

/** keep the URL in sync so any filtered view is a shareable link */
function syncUrl(f) {
  const q = new URLSearchParams();
  const y = $("fYear").value;
  if (y === "custom") { q.set("from", miToYm(f.from)); q.set("to", miToYm(f.to)); } else q.set("year", y);
  for (const dim of Object.keys(FILTER_DIMS)) if (f[dim] !== "All") q.set(dim, f[dim]);
  history.replaceState(null, "", "?" + q.toString());
}

/* ------------------------------------------------------- 3. filter rows */
function filterRows(f, from, to) {
  return state.rows.filter(r =>
    r.mi >= from && r.mi <= to &&
    (f.region === "All" || r.region === f.region) &&
    (f.category === "All" || r.category === f.category) &&
    (f.segment === "All" || r.segment === f.segment) &&
    (f.channel === "All" || r.channel === f.channel));
}

/* ---------------------------------------------------- 4. KPIs & aggregates */
function computeKPIs(rows) {
  let revenue = 0, profit = 0, units = 0, returned = 0;
  const orders = new Map(), customers = new Set();
  for (const r of rows) {
    revenue += r.sales; profit += r.profit; units += r.qty; returned += r.returned;
    orders.set(r.order, r.days);          // delivery days are order-level
    customers.add(r.customer);
  }
  let dsum = 0; for (const d of orders.values()) dsum += d;
  const n = orders.size;
  return {
    revenue, profit, units, orders: n, customers: customers.size,
    margin: revenue ? profit / revenue : NaN,
    aov: n ? revenue / n : NaN,
    returnRate: rows.length ? returned / rows.length : NaN,
    delivery: n ? dsum / n : NaN,
  };
}

/** group rows by key, summing sales/profit/qty and counting lines/returns/orders */
function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    let g = m.get(k);
    if (!g) m.set(k, g = { key: k, sales: 0, profit: 0, qty: 0, lines: 0, returned: 0, orders: new Set(), sample: r });
    g.sales += r.sales; g.profit += r.profit; g.qty += r.qty; g.lines++; g.returned += r.returned; g.orders.add(r.order);
  }
  return [...m.values()];
}

/* ---------------------------------------------------------- KPI cards */
const KPI_DEFS = [
  { key: "revenue", label: "Total Revenue", fmt: v => inr(v), formula: "Σ sales", hero: true },
  { key: "profit", label: "Total Profit", fmt: v => inr(v), formula: "Σ (sales − cost)" },
  { key: "margin", label: "Profit Margin", fmt: v => pct(v), formula: "profit ÷ revenue", pp: true },
  { key: "orders", label: "Orders", fmt: num, formula: "distinct order IDs" },
  { key: "aov", label: "Avg Order Value", fmt: v => inr(v), formula: "revenue ÷ orders" },
  { key: "units", label: "Units Sold", fmt: num, formula: "Σ quantity" },
  { key: "customers", label: "Unique Customers", fmt: num, formula: "distinct customer IDs" },
  { key: "returnRate", label: "Return Rate", fmt: v => pct(v), formula: "returned lines ÷ lines", pp: true, lowerIsBetter: true },
  { key: "delivery", label: "Avg Delivery Days", fmt: v => v.toFixed(2) + " d", formula: "mean days per order", lowerIsBetter: true, abs: true },
];

function deltaHtml(def, cur, prev, hasPrev) {
  if (!hasPrev || !isFinite(prev) || !isFinite(cur)) return `<span>— no prior-period data</span>`;
  let change, txt;
  if (def.pp) { change = cur - prev; txt = `${(Math.abs(change) * 100).toFixed(1)} pp`; }
  else if (def.abs) { change = cur - prev; txt = `${Math.abs(change).toFixed(2)} d`; }
  else { change = prev ? (cur - prev) / Math.abs(prev) : 0; txt = pct(Math.abs(change)); }
  if (Math.abs(change) < 1e-9) return `<span>● no change vs prev. period</span>`;
  const up = change > 0, good = def.lowerIsBetter ? !up : up;
  return `<span class="${up ? "up" : "down"} ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${txt}</span> vs prev. period`;
}

function renderKPIs(cur, prev, hasPrev) {
  $("kpis").innerHTML = KPI_DEFS.map(d => `
    <div class="kpi ${d.hero ? "hero" : ""}">
      <div class="label"><span>${d.label}</span></div>
      <div class="value">${isFinite(cur[d.key]) ? d.fmt(cur[d.key]) : "–"}</div>
      <div class="delta">${deltaHtml(d, cur[d.key], prev[d.key], hasPrev)}</div>
      <div class="formula">${d.formula}${hasPrev && isFinite(prev[d.key]) ? ` · prev: ${d.fmt(prev[d.key])}` : ""}</div>
      ${d.hero ? `<div class="spark"><canvas id="cSpark"></canvas></div>` : ""}
    </div>`).join("");
}

/* -------------------------------------------------------------- charts */
Chart.defaults.color = C("--ink-2");
Chart.defaults.font.family = C("--font");
Chart.defaults.font.size = 12;
Chart.defaults.borderColor = C("--grid");
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.plugins.legend.labels.useBorderRadius = true;
Chart.defaults.plugins.legend.labels.borderRadius = 3;
Chart.defaults.plugins.tooltip.backgroundColor = "#0d0d0d";
Chart.defaults.plugins.tooltip.borderColor = C("--axis");
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.animation.duration = 350;
Chart.defaults.maintainAspectRatio = false;

/** create a chart once, afterwards only swap data/options and update (smooth transitions) */
function upsert(id, cfg) {
  const ch = state.charts[id];
  if (ch && ch.canvas === $(id)) { ch.data = cfg.data; ch.options = cfg.options; ch.update(); return ch; }
  if (ch) ch.destroy();
  return (state.charts[id] = new Chart($(id), cfg));
}

const axisInr = { ticks: { callback: v => inrAxis(v) }, grid: { color: C("--grid") }, border: { color: C("--axis") } };
const noGrid = { grid: { display: false }, border: { color: C("--axis") } };
const tipInr = { callbacks: { label: c => ` ${c.dataset.label || c.label}: ${inr(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } };

function renderTrend(f, rows, prevRows) {
  const labels = [], rev = [], prof = [], prevRev = [];
  const byMi = new Map(groupBy(rows, "mi").map(g => [g.key, g]));
  const byPrev = new Map(groupBy(prevRows, "mi").map(g => [g.key, g]));
  const len = f.to - f.from + 1;
  for (let mi = f.from; mi <= f.to; mi++) {
    labels.push(miLabel(mi));
    rev.push(byMi.get(mi)?.sales || 0);
    prof.push(byMi.get(mi)?.profit || 0);
    const pm = mi - len;
    prevRev.push(pm >= 0 ? (byPrev.get(pm)?.sales || 0) : null);
  }
  upsert("cTrend", {
    type: "bar",
    data: { labels, datasets: [
      { type: "bar", label: "Revenue", data: rev, backgroundColor: SERIES[0], borderRadius: 4, order: 2, categoryPercentage: .8, barPercentage: .9 },
      { type: "bar", label: "Profit", data: prof, backgroundColor: SERIES[1], borderRadius: 4, order: 3, categoryPercentage: .8, barPercentage: .9 },
      { type: "line", label: "Revenue – previous period", data: prevRev, borderColor: C("--muted"), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .3, order: 1, spanGaps: false },
    ] },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "top", align: "end" }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y == null ? "–" : inr(c.parsed.y)}` } } },
      scales: { x: { ...noGrid, ticks: { maxRotation: 0, autoSkipPadding: 12 } }, y: axisInr },
    },
  });
  // sparkline in the hero revenue card
  upsert("cSpark", {
    type: "line",
    data: { labels, datasets: [{ data: rev, borderColor: SERIES[0], backgroundColor: "rgba(57,135,229,.15)", fill: true, borderWidth: 2, pointRadius: 0, tension: .35 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => " " + inr(c.parsed.y) } } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } }, animation: false },
  });
}

function setFilter(dim, value) {
  const sel = $(FILTER_DIMS[dim]);
  sel.value = sel.value === value ? "All" : value;   // click again to clear
  render();
}

function renderRegion(rows) {
  const g = groupBy(rows, "region").sort((a, b) => b.sales - a.sales);
  upsert("cRegion", {
    type: "bar",
    data: { labels: g.map(x => x.key), datasets: [{ label: "Revenue", data: g.map(x => x.sales), backgroundColor: SERIES[0], borderRadius: 4, maxBarThickness: 46 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const x = g[c.dataIndex]; return [` Revenue: ${inr(x.sales)}`, ` Profit: ${inr(x.profit)} (${pct(x.profit / x.sales)})`]; } } } },
      scales: { x: noGrid, y: axisInr },
      onClick: (e, els) => els.length && setFilter("region", g[els[0].index].key),
      onHover: (e, els) => (e.native.target.style.cursor = els.length ? "pointer" : "default"),
    },
  });
}

function renderStates(rows) {
  const g = groupBy(rows, "state").sort((a, b) => b.sales - a.sales).slice(0, 10);
  upsert("cState", {
    type: "bar",
    data: { labels: g.map(x => x.key), datasets: [{ label: "Revenue", data: g.map(x => x.sales), backgroundColor: SERIES[0], borderRadius: 4, maxBarThickness: 18 }] },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` Revenue: ${inr(c.parsed.x)} · ${g[c.dataIndex].sample.region}` } } },
      scales: { x: { ...axisInr, ticks: { callback: v => inrAxis(v), maxTicksLimit: 5 } }, y: noGrid },
    },
  });
}

function donut(id, rows, dim, colors) {
  const order = state.dims[dim];
  const g = new Map(groupBy(rows, dim).map(x => [x.key, x]));
  const labels = order.filter(k => g.has(k));
  const total = labels.reduce((s, k) => s + g.get(k).sales, 0);
  upsert(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data: labels.map(k => g.get(k).sales), backgroundColor: labels.map(k => colors[k]), borderColor: C("--surface"), borderWidth: 2, hoverOffset: 6 }] },
    options: {
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { generateLabels: ch => labels.map((k, i) => ({ text: `${k}  ${pct(g.get(k).sales / total)}`, fillStyle: colors[k], strokeStyle: colors[k], fontColor: C("--ink-2"), index: i, hidden: false })) } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${inr(c.parsed)} (${pct(c.parsed / total)})` } },
      },
      onClick: (e, els) => els.length && setFilter(dim, labels[els[0].index]),
      onHover: (e, els) => (e.native.target.style.cursor = els.length ? "pointer" : "default"),
    },
  });
}

function renderSubcat(rows) {
  const g = groupBy(rows, "sub_category").sort((a, b) => b.sales - a.sales);
  $("catLegend").innerHTML = state.dims.category.map(c => `<span><i style="background:${CAT_COLOR[c]}"></i>${c}</span>`).join("");
  upsert("cSubcat", {
    type: "bar",
    data: { labels: g.map(x => x.key), datasets: [{ label: "Revenue", data: g.map(x => x.sales), backgroundColor: g.map(x => CAT_COLOR[x.sample.category]), borderRadius: 4, maxBarThickness: 30 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: c => `${g[c[0].dataIndex].key} (${g[c[0].dataIndex].sample.category})`,
        label: c => { const x = g[c.dataIndex]; return [` Revenue: ${inr(x.sales)}`, ` Profit: ${inr(x.profit)} (${pct(x.profit / x.sales)})`, ` Units: ${num(x.qty)}`]; } } } },
      scales: { x: { ...noGrid, ticks: { maxRotation: 50, minRotation: 35, autoSkip: false, font: { size: 11 } } }, y: axisInr },
    },
  });
}

function renderProducts(rows) {
  const g = groupBy(rows, "product").sort((a, b) => b.sales - a.sales).slice(0, 10);
  const max = g[0]?.sales || 1;
  $("tProducts").querySelector("tbody").innerHTML = g.length ? g.map((x, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${x.key}</td>
      <td><span class="dot" style="background:${CAT_COLOR[x.sample.category]}"></span>${x.sample.category}</td>
      <td class="num">${num(x.qty)}</td>
      <td class="num bar-cell">${inr(x.sales)}<span class="bar" style="width:${Math.max(4, 70 * x.sales / max)}px"></span></td>
      <td class="num ${x.profit < 0 ? "neg" : ""}">${inr(x.profit)}</td>
      <td class="num ${x.profit < 0 ? "neg" : ""}">${pct(x.profit / x.sales)}</td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty">No data for this selection</td></tr>`;
}

function renderPayment(rows) {
  const g = groupBy(rows, "payment_mode").map(x => ({ ...x, n: x.orders.size })).sort((a, b) => b.n - a.n);
  const total = new Set(rows.map(r => r.order)).size || 1;
  upsert("cPayment", {
    type: "bar",
    data: { labels: g.map(x => x.key), datasets: [{ label: "Share of orders", data: g.map(x => x.n / total * 100), backgroundColor: SERIES[6], borderRadius: 4, maxBarThickness: 22 }] },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.x.toFixed(1)}% of orders (${num(g[c.dataIndex].n)})` } } },
      scales: { x: { ticks: { callback: v => v + "%" }, grid: { color: C("--grid") }, border: { color: C("--axis") }, beginAtZero: true }, y: noGrid },
    },
  });
}

function renderScatter(rows) {
  // deterministic sample so the chart is stable between renders
  const step = Math.max(1, Math.floor(rows.length / 1200));
  const pts = [];
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    if (!r.sales) continue;
    const jitter = ((i * 9301 + 49297) % 233280) / 233280 - 0.5;   // cheap pseudo-random
    pts.push({ x: r.discount * 100 + jitter * 3.2, y: Math.max(-120, r.profit / r.sales * 100) });
  }
  const avg = groupBy(rows, "discount").sort((a, b) => a.key - b.key).map(x => ({ x: x.key * 100, y: x.profit / x.sales * 100 }));
  upsert("cScatter", {
    type: "scatter",
    data: { datasets: [
      { label: "Order line", data: pts, backgroundColor: "rgba(57,135,229,.35)", pointRadius: 2.5, pointHoverRadius: 5, order: 2 },
      { type: "line", label: "Average margin", data: avg, borderColor: SERIES[1], backgroundColor: SERIES[1], borderWidth: 2, pointRadius: 4, pointBorderColor: C("--surface"), pointBorderWidth: 2, order: 1 },
    ] },
    options: {
      plugins: { legend: { position: "top", align: "end" }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: discount ${Math.round(c.parsed.x)}%, margin ${c.parsed.y.toFixed(1)}%` } } },
      scales: {
        x: { type: "linear", min: -3, max: 53, title: { display: true, text: "Discount %", color: C("--muted") }, afterBuildTicks: ax => { ax.ticks = [0, 10, 20, 30, 40, 50].map(value => ({ value })); }, ticks: { callback: v => v + "%" }, grid: { color: C("--grid") } },
        y: { title: { display: true, text: "Profit margin %", color: C("--muted") }, ticks: { callback: v => v + "%" }, grid: { color: c => (c.tick.value === 0 ? C("--ink-2") : C("--grid")) } },
      },
    },
  });
}

function renderReturns(rows) {
  const g = groupBy(rows, "category").sort((a, b) => b.returned / b.lines - a.returned / a.lines);
  upsert("cReturns", {
    type: "bar",
    data: { labels: g.map(x => x.key), datasets: [{ label: "Return rate", data: g.map(x => x.returned / x.lines * 100), backgroundColor: g.map(x => CAT_COLOR[x.key]), borderRadius: 4, maxBarThickness: 22 }] },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.x.toFixed(1)}% returned (${num(g[c.dataIndex].returned)} of ${num(g[c.dataIndex].lines)} lines)` } } },
      scales: { x: { ticks: { callback: v => v + "%" }, grid: { color: C("--grid") }, beginAtZero: true }, y: noGrid },
    },
  });
}

/* ------------------------------------------------------------- insights */
function renderInsights(f, rows, cur, prev, hasPrev) {
  const out = [];
  const add = (ico, html) => out.push(`<li><span class="ico">${ico}</span><span>${html}</span></li>`);
  if (!rows.length) { $("insights").innerHTML = `<li>No orders match the current filters.</li>`; return; }

  if (hasPrev && prev.revenue) {
    const g = (cur.revenue - prev.revenue) / prev.revenue;
    add(g >= 0 ? "▲" : "▼", `Revenue ${g >= 0 ? "grew" : "fell"} <b>${pct(Math.abs(g))}</b> vs the previous period (${inr(prev.revenue)} → <b>${inr(cur.revenue)}</b>); profit moved ${inr(prev.profit)} → ${inr(cur.profit)}.`);
  }
  const months = groupBy(rows, "mi").sort((a, b) => b.sales - a.sales);
  if (months.length > 2) {
    const pk = months[0], m = pk.key % 12;
    const why = m === 9 || m === 10 ? " — the Diwali festive rush" : m === 0 ? " — Republic Day sale" : m === 7 ? " — Independence Day sale" : m === 11 ? " — year-end sale" : "";
    add("★", `Peak month was <b>${miLabel(pk.key)}</b> with ${inr(pk.sales)}${why}.`);
  }
  if (f.region === "All") {
    const reg = groupBy(rows, "region").sort((a, b) => b.sales - a.sales);
    add("⌖", `<b>${reg[0].key}</b> is the top region with <b>${pct(reg[0].sales / cur.revenue)}</b> of revenue; ${reg.at(-1).key} is smallest at ${pct(reg.at(-1).sales / cur.revenue)}.`);
  } else {
    const st = groupBy(rows, "city").sort((a, b) => b.sales - a.sales);
    add("⌖", `In ${f.region}, <b>${st[0].key}</b> is the biggest city (${pct(st[0].sales / cur.revenue)} of revenue).`);
  }
  const cats = groupBy(rows, "category").sort((a, b) => b.sales - a.sales);
  if (cats.length > 1) {
    const best = [...cats].sort((a, b) => b.profit / b.sales - a.profit / a.sales)[0];
    add("◆", `<b>${cats[0].key}</b> brings ${pct(cats[0].sales / cur.revenue)} of revenue at a ${pct(cats[0].profit / cats[0].sales)} margin; <b>${best.key}</b> is the most profitable category (${pct(best.profit / best.sales)} margin).`);
  }
  const losers = groupBy(rows, "sub_category").filter(x => x.profit < 0).sort((a, b) => a.profit - b.profit);
  if (losers.length) add("!", `Loss-making sub-categories: <b>${losers.slice(0, 3).map(x => `${x.key} (${inr(x.profit)})`).join(", ")}</b>.`);
  const lo = rows.filter(r => r.discount <= 0.10), hi = rows.filter(r => r.discount >= 0.30);
  const m = a => a.reduce((s, r) => s + r.profit, 0) / (a.reduce((s, r) => s + r.sales, 0) || 1);
  if (lo.length && hi.length)
    add("%", `Discounts of <b>30%+</b> earn a <b>${pct(m(hi))}</b> margin vs ${pct(m(lo))} at ≤10% — ${m(hi) < 0 ? "deep discounting is destroying profit" : "deep discounts squeeze margin"}.`);
  const rc = cats.filter(x => x.lines > 30).sort((a, b) => b.returned / b.lines - a.returned / a.lines);
  if (rc.length > 1) add("↺", `<b>${rc[0].key}</b> has the highest return rate (${pct(rc[0].returned / rc[0].lines)}) vs ${pct(cur.returnRate)} overall.`);
  const pay = groupBy(rows, "payment_mode").sort((a, b) => b.orders.size - a.orders.size);
  add("₹", `<b>${pay[0].key}</b> is the leading payment mode with ${pct(pay[0].orders.size / cur.orders)} of orders.`);
  if (f.channel === "All") {
    const ch = groupBy(rows, "channel").sort((a, b) => b.sales - a.sales);
    add("⇄", `<b>${ch[0].key}</b> is the largest channel (${pct(ch[0].sales / cur.revenue)} of revenue); average order value is <b>${inr(cur.aov)}</b>.`);
  }
  $("insights").innerHTML = out.join("");
}

/* -------------------------------------------------------------- 5. render */
function render() {
  const f = readFilters();
  const rows = filterRows(f, f.from, f.to);
  const prevRows = f.prevFrom >= 0 ? filterRows(f, f.prevFrom, f.prevTo) : [];
  const hasPrev = f.prevFrom >= 0 && prevRows.length > 0;
  const cur = computeKPIs(rows), prev = computeKPIs(prevRows);

  $("periodLabel").innerHTML = `Showing <b>${miLabel(f.from)} – ${miLabel(f.to)}</b>` +
    (hasPrev ? ` &nbsp;vs&nbsp; ${miLabel(f.prevFrom)} – ${miLabel(f.prevTo)}` : " &nbsp;(no earlier period in data)");
  for (const id of Object.values(FILTER_DIMS)) $(id).classList.toggle("active", $(id).value !== "All");

  state.charts.cSpark?.destroy();        // its canvas is re-created with the KPI cards
  delete state.charts.cSpark;
  renderKPIs(cur, prev, hasPrev);
  renderTrend(f, rows, prevRows);
  renderRegion(rows);
  renderStates(rows);
  donut("cSegment", rows, "segment", SEG_COLOR);
  donut("cChannel", rows, "channel", CH_COLOR);
  renderSubcat(rows);
  renderProducts(rows);
  renderPayment(rows);
  renderScatter(rows);
  renderReturns(rows);
  renderInsights(f, rows, cur, prev, hasPrev);
  syncUrl(f);
}

loadData().then(() => { initFilters(); render(); })
  .catch(err => { document.querySelector("main").innerHTML = `<p class="empty">Could not load data/orders.json — serve this folder over HTTP (e.g. <code>py -m http.server</code>).<br>${err}</p>`; });
