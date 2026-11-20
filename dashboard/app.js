// Token Radar page: renders the radar main.ts wrote to ../data.js with the same
// dashboard/model.js the program imported. Every figure is a field of that JSON.
import { MODEL, PLAN } from './model.js';

const R = window.RADAR;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const commas = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const full = (n) => `${n < 0 ? '-' : ''}$${commas(Math.abs(n))}`;
const usd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`;
const pct = (v) => v === null ? '<span class="mut">n/a</span>' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : 'mut'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
const x = (m) => `${m.toFixed(3)}×`;
const x2 = (m) => `×${m.toFixed(2)}`;
const one = (n) => `$${n.toFixed(2)}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const age = (r) => `${r.age_days}d${r.age_assumed ? '<span class="badge assume">assumed</span>' : ''}`;
const verdict = (r) => r.net_if_launch_usd > 0 ? ['FARM', 'farm'] : r.net_if_launch_usd > -10 ? ['MARGINAL', 'marg'] : ['SKIP', 'skip'];

const view = $('#view');
if (!R) { view.innerHTML = '<p class="empty">No radar loaded: run <b>node main.ts</b> to write data.js.</p>'; throw new Error('data.js missing'); }
const v = R.validation;
$('#stamp').innerHTML = `<b>SNAPSHOT</b> ${esc(R.as_of)} &middot; ${R.counts.protocols} protocols<br><b>MODEL</b> ${esc(R.model)}`;
$('#kpis').innerHTML = [
  [R.counts.ranked, 'pre-token protocols ranked'],
  [`${R.counts.watchlist_ranked}/${R.counts.watchlist}`, `watchlist · ${R.counts.below_floor_ranked} below floor`],
  [R.counts.tokenized, `tokenized · ${R.counts.clean} scored`],
  [x2(v.curve.median_miss), 'curve leave-one-out miss'],
  [`${v.band.coverage}%`, 'held-out band coverage'],
  [R.counts.set_aside, 'set aside, each with a reason'],
].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');
$('#methodbar').innerHTML = `<div class="mtext"><div class="f">value = 10<sup>a</sup> <i>×</i> TVL<sup>b</sup> <i>×</i> growth <i>×</i> maturity</div><div class="f2">fitted mcap ≈ 10^${v.curve.a.toFixed(3)} · TVL^${v.curve.b.toFixed(3)} · fit n=${v.fit_n} · scored ${v.clean_n}</div></div><button class="go" id="goMethod">Method &amp; validation →</button>`;

const state = { q: '', cat: '', chain: '', minTvl: 0, watch: false, grow: false, key: 'rank', dir: 1 };
const cats = [...new Set(R.rows.map((r) => r.category ?? '(none)'))].sort(cmp);
const chainCount = new Map();
for (const r of R.rows) for (const c of r.chains) chainCount.set(c, (chainCount.get(c) ?? 0) + 1);
const chains = [...chainCount.keys()].sort((a, b) => chainCount.get(b) - chainCount.get(a) || cmp(a, b));
const maxTvl = Math.max(...R.rows.map((r) => r.tvl_usd));
const COLS = [
  ['rank', '#', 'num'], ['name', 'Protocol', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num'],
  ['age_days', 'Age', 'num'], ['implied_value_usd', 'Implied · P25–P75', 'num'],
  ['drop_per_1k_usd', 'Drop / $1k', 'num'], ['net_if_launch_usd', 'Net if launch', 'num'],
  ['net_per_hour_usd', 'Net $/h', 'num'], ['hold_days', 'Plan', 'num'],
];
const filtered = () => {
  const q = state.q.toLowerCase();
  const rows = R.rows.filter((r) => (!state.cat || (r.category ?? '(none)') === state.cat) && (!state.chain || r.chains.includes(state.chain)) && r.tvl_usd >= state.minTvl && (!state.watch || r.watchlist) && (!state.grow || (r.change_7d ?? 0) > 0) && (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  return rows.sort((a, b) => { const va = a[state.key], vb = b[state.key]; if (va === vb) return a.rank - b.rank; if (va === null) return 1; if (vb === null) return -1; return (typeof va === 'string' ? cmp(va, vb) : va - vb) * state.dir; });
};

function chartSvg() {
  const out = new Set(v.outliers.map((o) => o.slug));
  const pts = R.live.map((p) => ({ x: p.tvl_usd, y: p.mcap_usd, o: out.has(p.slug) }));
  const faint = R.rows.map((r) => ({ x: r.tvl_usd, y: r.implied_value_usd }));
  const xs = pts.concat(faint).map((p) => Math.log10(p.x));
  const ys = pts.concat(faint).map((p) => Math.log10(p.y));
  const x0 = Math.min(...xs) - 0.1, x1 = Math.max(...xs) + 0.1, y0 = Math.min(...ys) - 0.1, y1 = Math.max(...ys) + 0.1;
  const W = 268, H = 174, L = 30, B = 18, T = 8, Rr = 6;
  const sx = (val) => L + ((Math.log10(val) - x0) / (x1 - x0)) * (W - L - Rr);
  const sy = (val) => H - B - ((Math.log10(val) - y0) / (y1 - y0)) * (H - B - T);
  let grid = '';
  for (let p = Math.ceil(x0); p <= Math.floor(x1); p++) grid += `<line x1="${sx(10 ** p)}" y1="${T}" x2="${sx(10 ** p)}" y2="${H - B}" class="gl"/><text x="${sx(10 ** p)}" y="${H - 5}" class="tl" text-anchor="middle">10^${p}</text>`;
  for (let p = Math.ceil(y0); p <= Math.floor(y1); p++) grid += `<line x1="${L}" y1="${sy(10 ** p)}" x2="${W - Rr}" y2="${sy(10 ** p)}" class="gl"/><text x="${L - 3}" y="${sy(10 ** p) + 3}" class="tl" text-anchor="end">10^${p}</text>`;
  let line = '';
  for (let i = 0; i <= 40; i++) { const lx = x0 + ((x1 - x0) * i) / 40; const ly = v.curve.a + v.curve.b * lx; line += `${i ? 'L' : 'M'}${sx(10 ** lx).toFixed(1)},${sy(10 ** ly).toFixed(1)}`; }
  const cx = (a) => a.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.o ? 2.2 : 1.6}" class="${p.o ? 'od' : 'fd'}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="log-log scatter of TVL against market cap">${grid}<path d="${line}" class="fl"/>${faint.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="1" class="rd"/>`).join('')}${cx(pts)}</svg>`;
}

function proofHtml() {
  return `<aside class="proof"><h3>Out-of-sample check</h3>
    <div class="peq">mcap ≈ 10^${v.curve.a.toFixed(3)} · TVL^${v.curve.b.toFixed(3)}</div>
    <div class="psub">fit n=${v.fit_n} · scored ${v.clean_n} · ${v.outlier_n} ratio outliers flagged</div>
    <div class="pstats">
      <div><b>${x2(v.curve.median_miss)}</b><span>median miss</span></div>
      <div><b>${v.curve.within_2x}%</b><span>within 2×</span></div>
      <div><b>${v.band.coverage}%</b><span>band coverage</span></div>
      <div><b>${v.curve.spearman}</b><span>Spearman</span></div>
    </div>
    ${chartSvg()}
    <div class="plegend"><i class="ld"></i> tokenized mcap/TVL <i class="lr"></i> ranked implied <i class="lo"></i> flagged ratio</div>
    <div class="psub">global multiple ${x2(v.global.median_miss)} · house model ${x2(v.house.median_miss)} · walk-forward ${x2(v.walk.median_miss)} on n=${v.walk.test_n}</div>
  </aside>`;
}

function renderBoard() {
  view.innerHTML = `<div class="boardgrid"><div class="boardmain">
    <div class="controls">
      <input type="search" id="q" placeholder="Search protocol" value="${esc(state.q)}" aria-label="Search protocol">
      <select id="cat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c)}"${c === state.cat ? ' selected' : ''}>${esc(c)} (${R.rows.filter((r) => (r.category ?? '(none)') === c).length})</option>`).join('')}</select>
      <select id="chain" aria-label="Chain"><option value="">All chains</option>${chains.map((c) => `<option value="${esc(c)}"${c === state.chain ? ' selected' : ''}>${esc(c)} (${chainCount.get(c)})</option>`).join('')}</select>
      <label class="slider">min TVL <input type="range" id="minTvl" min="0" max="${Math.ceil(maxTvl / 1e7) * 10}" step="5" value="${state.minTvl / 1e6}" aria-label="Minimum TVL in millions"><output id="minOut">${usd(state.minTvl)}</output></label>
      <label class="check"><input type="checkbox" id="watch"${state.watch ? ' checked' : ''}> watchlist only</label>
      <label class="check"><input type="checkbox" id="grow"${state.grow ? ' checked' : ''}> 7d growing</label>
      <span class="count" id="count"></span>
    </div>
    <div class="wrap"><table><thead><tr>${COLS.map(([k, l, c]) => `<th data-k="${k}" class="${c}" aria-sort="none">${l}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div>
    <p class="note">Drop / $1k = implied value × ${MODEL.drop_share * 100}% × $${commas(MODEL.deposit_usd)} ÷ TVL, a stated airdrop assumption. Net if launch = drop − plan gas − $${MODEL.fee_usd}. Net $/h = net if launch ÷ hours held. Verdict: FARM above $0 net, MARGINAL above −$10, SKIP below. Click a row for its inputs, interval and plan.</p>
  </div>${proofHtml()}</div>`;
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; fill(); });
  $('#cat').addEventListener('change', (e) => { state.cat = e.target.value; fill(); });
  $('#chain').addEventListener('change', (e) => { state.chain = e.target.value; fill(); });
  $('#minTvl').addEventListener('input', (e) => { state.minTvl = Number(e.target.value) * 1e6; $('#minOut').textContent = usd(state.minTvl); fill(); });
  $('#watch').addEventListener('change', (e) => { state.watch = e.target.checked; fill(); });
  $('#grow').addEventListener('change', (e) => { state.grow = e.target.checked; fill(); });
  view.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.k; state.dir = state.key === k ? -state.dir : (k === 'rank' || k === 'name' ? 1 : -1); state.key = k; fill(); }));
  fill();
}

function fill() {
  const rows = filtered();
  const bits = [];
  if (state.cat) bits.push(state.cat);
  if (state.chain) bits.push(state.chain);
  if (state.minTvl > 0) bits.push(`TVL ≥ ${usd(state.minTvl)}`);
  if (state.watch) bits.push('watchlist only');
  if (state.grow) bits.push('7d growing');
  if (state.q) bits.push(`“${state.q}”`);
  $('#count').innerHTML = `<b>${rows.length}</b> of ${R.rows.length} rows${bits.length ? ` &middot; <span class="flt">${esc(bits.join(' · '))}</span>` : ''}`;
  view.querySelectorAll('th[data-k]').forEach((th) => {
    const on = th.dataset.k === state.key;
    th.classList.toggle('sorted', on);
    th.textContent = COLS.find((c) => c[0] === th.dataset.k)[1] + (on ? (state.dir > 0 ? ' ▲' : ' ▼') : '');
  });
  $('#rows').innerHTML = rows.length ? rows.map((r) => {
    const badge = `${r.watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">BELOW FLOOR</span>'}${r.missing.length ? `<span class="badge assume">${r.missing.length} missing</span>` : ''}`;
    const [vl, vc] = verdict(r);
    return `<tr tabindex="0" data-slug="${esc(r.slug)}">
      <td class="rank${r.rank <= 3 ? ' top' : ''}">${r.rank}</td>
      <td><span class="name">${esc(r.name)}</span>${badge}<div class="sub">${esc(r.category ?? 'no category')} · ${esc(r.chains[0] ?? 'no chain')}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</div></td>
      <td class="num">${usd(r.tvl_usd)}</td><td class="num delta">${pct(r.change_7d)}</td><td class="num">${age(r)}</td>
      <td class="num"><div class="val">${usd(r.implied_value_usd)}</div><div class="ivl">${usd(r.low_usd)}–${usd(r.high_usd)}</div></td>
      <td class="num">${full(r.drop_per_1k_usd)}</td>
      <td class="num ${r.net_if_launch_usd >= 0 ? 'up' : 'down'}">${full(r.net_if_launch_usd)}</td>
      <td class="num up">${one(r.net_per_hour_usd)}<span class="src">/h</span></td>
      <td class="num plan"><span class="vbadge ${vc}">${vl}</span> ${r.hold_days}d · ${r.plan.length}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>';
}

view.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-slug]'); if (tr) openDetail(tr.dataset.slug); });
view.addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-slug]'); if (tr && e.key === 'Enter') openDetail(tr.dataset.slug); });

const detail = $('#detail'), scrim = $('#scrim');
let lastFocus = null;
const bandMarkup = (r) => {
  const lo = Math.log10(r.low_usd), hi = Math.log10(r.high_usd);
  const at = hi === lo ? 50 : ((Math.log10(r.implied_value_usd) - lo) / (hi - lo)) * 100;
  return `<div class="band"><i style="left:3%;right:3%"></i><b style="left:${at.toFixed(1)}%"></b></div>`;
};

function openDetail(slug) {
  const r = R.rows.find((o) => o.slug === slug);
  if (!r) return;
  lastFocus = document.activeElement;
  detail.innerHTML = `
  <div class="dtop"><div class="who"><div class="drank">Rank ${r.rank} of ${R.rows.length} · ${r.watchlist ? 'on the watchlist' : 'below the floor'}</div>
    <h2 class="dtitle" id="d-title">${esc(r.name)}</h2>
    <div class="dsub">${esc(r.category ?? 'no category')} · ${esc(r.chains.slice(0, 5).join(', '))}${r.chains.length > 5 ? ` +${r.chains.length - 5}` : ''} · records no token in DefiLlama</div></div>
    <button class="dclose" id="dclose">Close ✕</button></div>
  <div class="dhero"><div class="dvalue"><div class="big">${full(r.implied_value_usd)}</div>
    <div class="eq">curve(${usd(r.tvl_usd)}) = ${full(r.base_usd)} × ${r.growth_mult.toFixed(3)} growth × ${r.maturity.toFixed(3)} maturity</div>
    <div class="note">Base from 10^${v.curve.a.toFixed(3)} · TVL^${v.curve.b.toFixed(3)}; the interval is the same value at the held-out p25 and p75 ratios (${r.ratio_lo.toFixed(3)}× and ${r.ratio_hi.toFixed(3)}×).</div></div>
    <div class="dband"><div class="lab">P25–P75 interval from held-out ratios</div>
      <div class="nums"><span>P25 <b>${usd(r.low_usd)}</b></span><span>point <b>${usd(r.implied_value_usd)}</b></span><span>P75 <b>${usd(r.high_usd)}</b></span></div>${bandMarkup(r)}
      <div class="nums" style="margin-top:6px"><span class="mut">${r.ratio_lo.toFixed(3)}×</span><span class="mut">1.000×</span><span class="mut">${r.ratio_hi.toFixed(3)}×</span></div></div></div>
  <div class="dcols"><div>
    <div class="card"><h3>Model inputs from the snapshot</h3><div class="rows">
      <div class="row"><div class="l"><span class="k">TVL</span><span class="e">tvl_usd</span></div><span class="v">${full(r.tvl_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">7d TVL change</span><span class="e">${r.change_7d === null ? 'not reported' : `${r.change_7d.toFixed(2)}%, counted ${r.growth_counted}%`}</span></div><span class="v">${pct(r.change_7d)} → ×${r.growth_mult.toFixed(3)}</span></div>
      <div class="row"><div class="l"><span class="k">No-token age</span><span class="e">${esc(r.age_basis)}</span></div><span class="v">${r.age_days}d</span></div>
      <div class="row"><div class="l"><span class="k">Curve base</span><span class="e">10^a × TVL^b</span></div><span class="v">${full(r.base_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Maturity</span><span class="e">${MODEL.maturity_base} + min(age, ${MODEL.maturity_days})/${MODEL.maturity_days} × ${MODEL.maturity_span}</span></div><span class="v">×${r.maturity.toFixed(3)}</span></div>
      <div class="row"><div class="l"><span class="k">Implied value</span><span class="e">max(1, round(base × growth × maturity))</span></div><span class="v acc">${full(r.implied_value_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Drop / $1k</span><span class="e">implied × ${MODEL.drop_share * 100}% × $1,000 ÷ TVL</span></div><span class="v">${full(r.drop_per_1k_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Net if launch</span><span class="e">drop − ${one(r.gas_total_usd)} gas − $${MODEL.fee_usd} fee</span></div><span class="v">${full(r.net_if_launch_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Net $/h</span><span class="e">net if launch ÷ ${r.hold_days}d hold</span></div><span class="v">${one(r.net_per_hour_usd)}</span></div>
    </div></div>
    <div class="card"><h3>Out-of-sample check</h3><p class="note">Curve ${x2(v.curve.median_miss)} miss, ${v.curve.within_2x}% within 2×, ${v.curve.within_3x}% within 3×, Spearman ${v.curve.spearman}. Global ${x2(v.global.median_miss)}; house ${x2(v.house.median_miss)}; band ${v.band.coverage}%; walk-forward ${x2(v.walk.median_miss)} on n=${v.walk.test_n}.</p></div>
    ${r.missing.length ? `<div class="card warn"><h3>Assumptions for missing fields</h3><ul>${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
  </div><div>
    <div class="card"><h3>Farm plan · ${r.plan.length} steps · ${r.hold_days}-day hold</h3>
      <div class="plansum">capital ${full(PLAN.position_usd)} · gas ≈ ${one(r.gas_total_usd)} · exit cooldown ${r.cooldown_days} days · ${r.plan.length} steps</div>
      <ol class="steps">${r.plan.map((s) => `<li>${esc(s.do)}<div class="chips"><span class="chip c">${esc(s.cost)}</span><span class="chip">${esc(s.time)}</span></div></li>`).join('')}</ol>
      <p class="note"><b>Assumptions:</b> ${full(PLAN.position_usd)} position, gas at ${esc(PLAN.gas_note)}. Hold and $${MODEL.fee_usd} exit fee are comparisons, not quotes.</p></div>
  </div></div>`;
  detail.hidden = scrim.hidden = false;
  $('#dclose').addEventListener('click', closeDetail);
  $('#dclose').focus();
}
function closeDetail() { detail.hidden = scrim.hidden = true; if (lastFocus) lastFocus.focus(); }
scrim.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detail.hidden) closeDetail(); });

function renderLive() {
  view.innerHTML = `<div class="controls"><span class="mut">These ${R.live.length} protocols record a token and a positive mcap and TVL. The curve is fitted on them; the ${v.outlier_n} flagged ratios are outside the scoring window.</span></div>
  <div class="wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap/TVL</th><th class="num">7d</th></tr></thead><tbody>
  ${R.live.map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="sub">${esc(p.category ?? 'none')}</td><td class="num">${usd(p.tvl_usd)}</td><td class="num">${usd(p.mcap_usd)}</td><td class="num">${x(p.ratio)}</td><td class="num">${pct(p.change_7d)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderAside() {
  const labels = { 'wrapper-category': 'wrapper category', versioned: 'version marker', 'wrapper-name': 'wrapped/staked name', exchange: 'exchange product', 'parent-product': 'child of a recorded parent' };
  const by = new Map();
  for (const p of R.aside) by.set(p.code, (by.get(p.code) ?? 0) + 1);
  const summary = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${labels[c] ?? c} ${n}`).join(' · ');
  view.innerHTML = `<div class="controls"><span class="mut">${R.aside.length} tokenless protocols set aside: ${esc(summary)}. The rule is a pattern, not a name list; Method states it.</span></div>
  <div class="wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Why</th></tr></thead><tbody>
  ${R.aside.map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="sub">${esc(p.category ?? 'none')}</td><td class="num">${usd(p.tvl_usd)}</td><td class="sub">${esc(p.why)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderMethod() {
  const c = R.counts;
  const catRows = R.categories.map((k) => `<tr><td>${esc(k.name)}</td><td class="num">${k.n}</td><td class="num">${x(k.median)}</td><td class="num">${k.rows}</td></tr>`).join('');
  const outRows = v.outliers.map((o) => `<tr><td>${esc(o.name)}</td><td class="sub">${esc(o.category ?? 'none')}</td><td class="num">${o.ratio}</td><td class="num">${usd(o.tvl_usd)}</td></tr>`).join('');
  const modelRow = (name, s) => `<tr><td>${name}</td><td class="num">${x2(s.median_miss)}</td><td class="num">${s.within_2x}%</td><td class="num">${s.within_3x}%</td><td class="num">${s.spearman}</td></tr>`;
  view.innerHTML = `<div class="prose">
  <h2>The comps curve, its constants and its held-out test</h2>
  <div class="formula">
    <div>mcap ≈ 10^${v.curve.a.toFixed(4)} · TVL^${v.curve.b.toFixed(4)} <span>OLS on log10 mcap against log10 TVL, fitted on ${v.fit_n} tokenized protocols</span></div>
    <div>base = curve(tvl_usd); implied = max(1, round(base × growth × maturity))</div>
    <div>growth = 1 + clamp(change_7d, ${MODEL.growth_lo}, ${MODEL.growth_hi})/100 × ${MODEL.growth_weight}; maturity = ${MODEL.maturity_base} + min(age, ${MODEL.maturity_days})/${MODEL.maturity_days} × ${MODEL.maturity_span}</div>
    <div>interval = implied × p25/p75 of actual mcap ÷ predicted implied, from the leave-one-out refits</div>
  </div>
  <div class="mgrid"><div>
    <div class="card"><h3>Leave-one-out, three models</h3>
      <table class="mtab"><tr><th>Model</th><th class="num">Median miss</th><th class="num">≤2×</th><th class="num">≤3×</th><th class="num">Spearman</th></tr>
      ${modelRow('Comps curve', v.curve)}${modelRow('Global median multiple', v.global)}${modelRow('House model', v.house)}</table>
      <p class="note">Scored on the ${v.clean_n} protocols whose mcap/TVL is inside [${MODEL.ratio_lo}, ${MODEL.ratio_hi}]; the two baselines use all ${v.fit_n}. Median miss is 10^median|log10(predicted/actual)|, so ×3.17 means a typical miss of 3.17 in either direction. The ${v.outlier_n} flagged ratios are excluded from this score and from the interval.</p></div>
    <div class="card"><h3>Walk-forward</h3><p class="note">Sort the clean fit set by listed_at; fit the older ${v.walk.train_n} and predict the newer ${v.walk.test_n}. Median miss ${x2(v.walk.median_miss)}, ${v.walk.within_2x}% within 2×, ${v.walk.within_3x}% within 3×. The forward fit is a=10^${v.walk.a.toFixed(3)}, b=${v.walk.b.toFixed(3)}. listed_at null is left out of this test.</p></div>
    <div class="card"><h3>Seven flagged ratio outliers</h3><table class="mtab"><tr><th>Protocol</th><th>Category</th><th class="num">Mcap/TVL</th><th class="num">TVL</th></tr>${outRows}</table>
      <p class="note">Outside [${MODEL.ratio_lo}, ${MODEL.ratio_hi}]. They are still in the curve fit so the high-TVL end is anchored; refitting without them gives a=${v.curve.filtered_a.toFixed(3)}, b=${v.curve.filtered_b.toFixed(3)} and predicts high-TVL protocols far too low.</p></div>
  </div><div>
    <div class="card"><h3>Category medians, cross-check only</h3><table class="mtab"><tr><th>Category</th><th class="num">n</th><th class="num">Median</th><th class="num">Rows</th></tr>${catRows}</table>
      <p class="note">The point estimate no longer uses these. Global median ${x(R.global.median)} over ${R.global.n}; they are shown to show the spread a single constant misses.</p></div>
    <div class="card"><h3>What is on the board</h3><p class="note">${c.protocols} protocols: ${c.recorded_token} record a token (${c.tokenized} with mcap and TVL), ${c.tokenless} record none. ${c.ranked} ranked = ${c.watchlist_ranked} watchlist + ${c.below_floor_ranked} below the ${usd(R.floor_usd)} floor; ${c.set_aside} set aside by rule; ${c.no_tvl} excluded for missing TVL.</p>
      <p class="note"><b>Rule, not a name list:</b> wrapper category, version marker, wrapped/staked/restaked/stETH/rETH/sETH name, exchange prefix, or an above-floor child of a recorded parent. Any mcap, gecko_id or symbol makes a protocol a non-candidate.</p></div>
    <div class="card"><h3>Assumptions and limits</h3><p class="note">Drop / $1k assumes ${MODEL.drop_share * 100}% of implied value to a $${commas(MODEL.deposit_usd)} depositor; net if launch subtracts gas and a $${MODEL.fee_usd} fee. Gas at ${esc(PLAN.gas_note)}. Age is days since DefiLlama tracking, not launch; null → ${MODEL.age_assumed_days}d. One sealed day: LOO and walk-forward are the only tests it supports; implied value is not a launch forecast.</p></div>
  </div></div></div>`;
}

const TABS = { board: renderBoard, live: renderLive, aside: renderAside, method: renderMethod };
function selectTab(name) { document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name))); TABS[name](); }
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
document.addEventListener('click', (e) => { if (e.target.id === 'goMethod') selectTab('method'); });
renderBoard();
window.__RADAR_READY = true;
