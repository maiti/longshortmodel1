const WEIGHT_KEYS = ["momentum_weight", "reversal_weight", "volatility_weight", "illiquidity_weight"];
let schema = null;
let equityChart = null;
let walkForwardChart = null;
let turnoverChart = null;

function fmtPct(x, decimals = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return (x * 100).toFixed(decimals) + "%";
}
function fmtNum(x, decimals = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return Number(x).toFixed(decimals);
}

function fieldControl(field) {
  const id = `f_${field.key}`;
  if (field.type === "select") {
    const opts = field.options.map(o => `<option value="${o}" ${o === field.default ? "selected" : ""}>${o}</option>`).join("");
    return `<select id="${id}" data-key="${field.key}" data-type="select">${opts}</select>`;
  }
  if (field.type === "bool") {
    return `<div class="checkbox-row"><input type="checkbox" id="${id}" data-key="${field.key}" data-type="bool" ${field.default ? "checked" : ""}/><label for="${id}" style="margin:0">Enabled</label></div>`;
  }
  if (field.type === "date") {
    return `<input type="date" id="${id}" data-key="${field.key}" data-type="date" value="${field.default}"/>`;
  }
  if (field.type === "int") {
    return `<div class="range-row">
      <input type="range" id="${id}" data-key="${field.key}" data-type="int" min="${field.min}" max="${field.max}" step="${field.step}" value="${field.default}"
        oninput="document.getElementById('${id}_out').textContent=this.value"/>
      <output id="${id}_out">${field.default}</output>
    </div>`;
  }
  // float
  return `<div class="range-row">
    <input type="range" id="${id}" data-key="${field.key}" data-type="float" min="${field.min}" max="${field.max}" step="${field.step}" value="${field.default}"
      oninput="document.getElementById('${id}_out').textContent=Number(this.value).toFixed(2); onConfigChanged();"/>
    <output id="${id}_out">${Number(field.default).toFixed(2)}</output>
  </div>`;
}

function renderConfigForm() {
  const container = document.getElementById("config-form");
  container.innerHTML = schema.groups.map(group => `
    <div class="config-group">
      <h3>${group.title}</h3>
      ${group.fields.map(f => `
        <div class="field">
          <label for="f_${f.key}">${f.label}</label>
          <div class="help">${f.simple}</div>
          ${fieldControl(f)}
        </div>
      `).join("")}
    </div>
  `).join("");
  updateWeightSumNote();
}

function collectConfig() {
  const overrides = {};
  document.querySelectorAll("[data-key]").forEach(el => {
    const key = el.dataset.key;
    const type = el.dataset.type;
    if (type === "bool") overrides[key] = el.checked;
    else if (type === "int") overrides[key] = parseInt(el.value, 10);
    else if (type === "float") overrides[key] = parseFloat(el.value);
    else overrides[key] = el.value;
  });
  return overrides;
}

function updateWeightSumNote() {
  const overrides = collectConfig();
  const sum = WEIGHT_KEYS.reduce((acc, k) => acc + (overrides[k] || 0), 0);
  const note = document.getElementById("weight-sum-note");
  note.textContent = `Factor weights sum to ${sum.toFixed(2)} (must equal 1.00)`;
  note.className = "weight-sum-note " + (Math.abs(sum - 1.0) < 1e-6 ? "ok" : "bad");
  return Math.abs(sum - 1.0) < 1e-6;
}

function onConfigChanged() {
  updateWeightSumNote();
}

async function fetchSchema() {
  const res = await fetch("/api/config/schema");
  schema = await res.json();
  renderConfigForm();
}

function showError(msg) {
  const box = document.getElementById("error-box");
  if (!msg) { box.style.display = "none"; box.textContent = ""; return; }
  box.style.display = "block";
  box.textContent = msg;
}

async function runModel() {
  const overrides = collectConfig();
  const weightsOk = updateWeightSumNote();
  showError(null);
  if (!weightsOk) {
    showError("Factor weights must sum to 1.00 before running. Adjust the sliders in the sidebar.");
    return;
  }
  const btn = document.getElementById("run-btn");
  const loading = document.getElementById("loading");
  btn.disabled = true;
  loading.style.display = "flex";
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      showError(err.detail || "Run failed.");
      return;
    }
    const result = await res.json();
    renderResults(result);
  } catch (e) {
    showError("Could not reach the server: " + e.message);
  } finally {
    btn.disabled = false;
    loading.style.display = "none";
  }
}

function significanceBadge(sig, tStat) {
  if (sig) return `<span class="badge green">statistically significant</span>`;
  return `<span class="badge amber">not statistically significant</span>`;
}

function renderOverview(result) {
  const perf = result.performance;
  const cards = document.getElementById("overview-cards");
  const fp = perf.full_period, oos = perf.out_of_sample;

  cards.innerHTML = `
    <div class="metric-card">
      <div class="label">Full-period Sharpe</div>
      <div class="value">${fmtNum(fp.sharpe)}</div>
      <div class="note">${significanceBadge(fp.significant_at_95)}</div>
    </div>
    <div class="metric-card">
      <div class="label">Annualized return</div>
      <div class="value">${fmtPct(fp.annualized_return)}</div>
      <div class="note">net of estimated trading costs</div>
    </div>
    <div class="metric-card">
      <div class="label">Max drawdown</div>
      <div class="value">${fmtPct(fp.max_drawdown)}</div>
      <div class="note">worst peak-to-trough decline</div>
    </div>
    <div class="metric-card">
      <div class="label">Out-of-sample Sharpe</div>
      <div class="value">${fmtNum(oos.sharpe)}</div>
      <div class="note">${significanceBadge(oos.significant_at_95)}</div>
    </div>
  `;

  const wf = result.walk_forward.out_of_sample;
  const verdict = document.getElementById("verdict-box");
  let verdictText;
  if (oos.n_days < 60) {
    verdictText = "There isn't enough out-of-sample history yet to say much with confidence either way.";
  } else if (oos.sharpe > 0.3 && oos.significant_at_95) {
    verdictText = "The out-of-sample period shows a real, statistically meaningful edge — genuinely encouraging, though still just one historical stretch.";
  } else if (oos.sharpe > 0) {
    verdictText = "The out-of-sample period is mildly positive but <strong>not statistically distinguishable from zero</strong> — " +
      "this is a common, honest outcome for a real factor: directionally encouraging, not yet proof of a durable edge.";
  } else {
    verdictText = "The out-of-sample period was flat-to-negative. That doesn't necessarily mean the factor is fake — " +
      "it can mean the sample is too short to tell — but it does mean this specific run does not currently show a demonstrated edge.";
  }
  verdict.innerHTML = `<p><strong>Honest verdict:</strong> ${verdictText}</p>
    <p style="margin-top:8px">Across ${wf.n_windows} independent out-of-sample windows of
    ${result.config.walk_forward_window_months} months each, ${fmtPct(wf.pct_positive, 0)} were profitable
    (mean window Sharpe ${fmtNum(wf.mean_sharpe)}). ${wf.n_windows < 8 ?
      "That is a small number of independent windows — treat any single one of them as anecdote, not proof." : ""}</p>`;

  renderEquityChart(result.equity_curve);
  renderHoldings(result.current_holdings);
}

function renderEquityChart(curve) {
  const ctx = document.getElementById("equity-chart");
  const data = {
    labels: curve.dates,
    datasets: [
      { label: "Strategy (net of costs)", data: curve.strategy, borderColor: "#2563eb", borderWidth: 1.8, pointRadius: 0 },
      { label: "Equal-weight universe benchmark", data: curve.equal_weight_benchmark, borderColor: "#94a3b8", borderWidth: 1.4, pointRadius: 0 },
    ],
  };
  if (equityChart) equityChart.destroy();
  equityChart = new Chart(ctx, {
    type: "line",
    data,
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: "Growth of $1" } } },
    },
  });
}

function renderHoldings(holdings) {
  const longs = holdings.filter(h => h.side === "long").sort((a, b) => b.weight - a.weight);
  const shorts = holdings.filter(h => h.side === "short").sort((a, b) => a.weight - b.weight);
  const row = h => `<div class="holding-row">
      <span><span class="holding-ticker">${h.ticker}</span> <span class="holding-sector">${h.sector}</span></span>
      <span>${fmtPct(Math.abs(h.weight))}</span>
    </div>`;
  document.getElementById("holdings-long").innerHTML = longs.length ? longs.map(row).join("") : "<em>No positions</em>";
  document.getElementById("holdings-short").innerHTML = shorts.length ? shorts.map(row).join("") : "<em>No positions</em>";
}

function renderMath(result) {
  const icRows = result.information_coefficient.map(r => `
    <tr>
      <td>${r.factor}</td>
      <td class="num">${fmtNum(r.mean_ic, 4)}</td>
      <td class="num">${fmtNum(r.ic_std, 4)}</td>
      <td class="num">${fmtNum(r.ic_ir, 3)}</td>
      <td class="num">${fmtPct(r.pct_positive, 0)}</td>
      <td class="num">${r.n_periods}</td>
    </tr>`).join("");
  document.getElementById("ic-table").innerHTML = `
    <thead><tr><th>Factor</th><th class="num">Mean IC</th><th class="num">IC Std</th><th class="num">IC IR</th><th class="num">% Positive</th><th class="num">Periods</th></tr></thead>
    <tbody>${icRows}</tbody>`;

  const perfOrder = ["full_period", "in_sample", "out_of_sample"];
  const perfRows = perfOrder.map(key => {
    const p = result.performance[key];
    return `<tr>
      <td>${p.label}</td>
      <td class="num">${fmtNum(p.sharpe)}</td>
      <td class="num">±${fmtNum(p.sharpe_se)}</td>
      <td class="num">${fmtNum(p.t_stat)}</td>
      <td>${significanceBadge(p.significant_at_95)}</td>
      <td class="num">${fmtPct(p.annualized_return)}</td>
      <td class="num">${fmtPct(p.max_drawdown)}</td>
      <td class="num">${p.n_days}</td>
    </tr>`;
  }).join("");
  document.getElementById("perf-table").innerHTML = `
    <thead><tr><th>Period</th><th class="num">Sharpe</th><th class="num">Std Error</th><th class="num">t-stat</th><th>Significant?</th><th class="num">Ann. Return</th><th class="num">Max DD</th><th class="num">Days</th></tr></thead>
    <tbody>${perfRows}</tbody>`;

  renderWalkForwardChart(result.walk_forward);

  const wfSummaryRows = ["pooled", "in_sample", "out_of_sample"].map(key => {
    const agg = result.walk_forward[key];
    const title = { pooled: "Pooled (all windows)", in_sample: "In-sample windows", out_of_sample: "Out-of-sample windows" }[key];
    return `<tr><td>${title}</td><td class="num">${fmtNum(agg.mean_sharpe)}</td><td class="num">${fmtPct(agg.pct_positive, 0)}</td><td class="num">${agg.n_windows}</td></tr>`;
  }).join("");
  document.getElementById("walkforward-summary-table").innerHTML = `
    <thead><tr><th>Aggregate</th><th class="num">Mean Sharpe</th><th class="num">% Positive</th><th class="num">Windows</th></tr></thead>
    <tbody>${wfSummaryRows}</tbody>`;

  renderTurnoverChart(result);

  document.getElementById("run-config-dump").textContent =
    `Universe: ${result.universe_size} tickers, ${result.n_trading_days} trading days (${result.date_range.start} to ${result.date_range.end}). ` +
    `Average turnover per rebalance: ${fmtPct(result.turnover.average_per_rebalance)}. ` +
    `Total cost drag over full backtest: ${fmtPct(result.total_cost_drag)}.`;
}

function renderWalkForwardChart(wf) {
  const ctx = document.getElementById("walkforward-chart");
  const labels = wf.windows.map(w => w.window_start);
  const sharpes = wf.windows.map(w => w.sharpe);
  const colors = wf.windows.map(w => (w.in_sample ? "#94a3b8" : "#2563eb"));
  if (walkForwardChart) walkForwardChart.destroy();
  walkForwardChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Window Sharpe (gray = in-sample, blue = out-of-sample)", data: sharpes, backgroundColor: colors }] },
    options: { responsive: true, animation: false, plugins: { legend: { display: true } } },
  });
}

function renderTurnoverChart(result) {
  const ctx = document.getElementById("turnover-chart");
  const dates = Object.keys(result.turnover.history);
  const turnover = Object.values(result.turnover.history);
  const leverage = dates.map(d => result.leverage_history[d]);
  if (turnoverChart) turnoverChart.destroy();
  turnoverChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        { label: "Turnover per rebalance", data: turnover, borderColor: "#dc2626", pointRadius: 0, yAxisID: "y" },
        { label: "Leverage multiplier", data: leverage, borderColor: "#16a34a", pointRadius: 0, yAxisID: "y1" },
      ],
    },
    options: {
      responsive: true, animation: false,
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { position: "left", title: { display: true, text: "Turnover (fraction of book)" } },
        y1: { position: "right", title: { display: true, text: "Leverage" }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

function renderResults(result) {
  renderOverview(result);
  renderMath(result);
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    });
  });
}

async function init() {
  setupTabs();
  await fetchSchema();
  document.getElementById("run-btn").addEventListener("click", runModel);
  document.querySelectorAll("[data-key]").forEach(el => el.addEventListener("change", onConfigChanged));
  await runModel(); // run once with defaults so the page isn't empty
}

init();
