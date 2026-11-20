// Token Radar page: renders the radar that main.ts wrote to ../data.js with the
// same dashboard/model.js the program imported. Every figure below is a field of
// that JSON; no number is typed into this file by hand.
import { MODEL, PLAN } from './model.js';

const R = window.RADAR;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const commas = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const full = (n) => `$${commas(n)}`;
const usd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`;
const pct = (v) => v === null ? '<span class="mut">n/a</span>' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : 'mut'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
const x = (m) => `${m.toFixed(3)}×`;
const x2 = (m) => `×${m.toFixed(2)}`;
const age = (r) => `${r.age_days}d${r.age_assumed ? '<span class="badge assume">assumed</span>' : ''}`;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const one = (n) => `$${n.toFixed(2)}`;

const view = $('#view');
if (!R) {
  view.innerHTML = '<p class="empty">No radar loaded: run <b>node main.ts</b> to write data.js beside this dashboard.</p>';
  throw new Error('data.js missing');
}

$('#stamp').innerHTML = `<b>SNAPSHOT</b> ${esc(R.as_of)} &middot; ${R.counts.protocols} protocols<br><b>SOURCE</b> DefiLlama &middot; <b>MODEL</b> ${esc(R.model)}`;
const topCats = [...R.categories].sort((a, b) => b.rows - a.rows || cmpStr(a.name, b.name)).slice(0, 4);
$('#kpis').innerHTML = [
  [R.counts.ranked, 'pre-token protocols ranked'],
  [`${R.counts.watchlist_ranked}/${R.counts.watchlist}`, 'watchlist covered'],
  [R.counts.tokenized, 'tokenized comparables fitted'],
  [x(R.global.median), 'global mcap/TVL median'],
  [x2(R.validation.median_miss_factor), 'leave-one-out median miss'],
  [R.counts.set_aside, 'set aside, each with a reason'],
].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');
$('#methodbar').innerHTML = `<div class="mtext"><div class="f">value = TVL <i>×</i> category median mcap/TVL <i>×</i> growth <i>×</i> maturity</div><div class="f2">fitted medians: ${topCats.map((k) => `${esc(k.name)} ${x(k.median)}`).join(' · ')} · global ${x(R.global.median)} (n=${R.global.n})</div></div><button class="go" id="goMethod">Method &amp; validation →</button>`;

// ---------------------------------------------------------------- board

const state = { q: '', cat: '', chain: '', minTvl: 0, watch: false, grow: false, key: 'rank', dir: 1 };
const cats = [...new Set(R.rows.map((r) => r.category ?? '(none)'))].sort(cmpStr);
const chainCount = new Map();
for (const r of R.rows) for (const c of r.chains) chainCount.set(c, (chainCount.get(c) ?? 0) + 1);
const chains = [...chainCount.keys()].sort((a, b) => chainCount.get(b) - chainCount.get(a) || cmpStr(a, b));
const maxTvl = Math.max(...R.rows.map((r) => r.tvl_usd));
const COLS = [
  ['rank', '#', 'num'], ['name', 'Protocol', ''], ['tvl_usd', 'TVL', 'num'],
  ['change_7d', '7d TVL', 'num'], ['age_days', 'No-token age', 'num'], ['multiple', 'Multiple', 'num'],
  ['implied_value_usd', 'Implied value · P25–P75', 'num'], ['net_per_hour_usd', 'Net $/h*', 'num'],
  ['hold_days', 'Plan', 'num'],
];
const get = (r, k) => r[k];
const filtered = () => {
  const q = state.q.toLowerCase();
  const rows = R.rows.filter((r) =>
    (!state.cat || (r.category ?? '(none)') === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.minTvl &&
    (!state.watch || r.watchlist) &&
    (!state.grow || (r.change_7d ?? 0) > 0) &&
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  const { key, dir } = state;
  return rows.sort((a, b) => {
    const va = get(a, key);
    const vb = get(b, key);
    if (va === vb) return a.rank - b.rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (typeof va === 'string' ? cmpStr(va, vb) : va - vb) * dir;
  });
};

function renderBoard() {
  view.innerHTML = `
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
  <p class="note">* Net $/h = (implied value × $1,000 ÷ TVL − plan gas) ÷ hours held: a comparison across plans, not a payout. <b>c</b> marks a category-median multiple, <b>g</b> the global median. <b>assumed</b> means listed_at is null and the model uses ${MODEL.age_assumed_days} days. Click a row for its inputs, interval and farm plan.</p>`;
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; fill(); });
  $('#cat').addEventListener('change', (e) => { state.cat = e.target.value; fill(); });
  $('#chain').addEventListener('change', (e) => { state.chain = e.target.value; fill(); });
  $('#minTvl').addEventListener('input', (e) => {
    state.minTvl = Number(e.target.value) * 1e6;
    $('#minOut').textContent = usd(state.minTvl);
    fill();
  });
  $('#watch').addEventListener('change', (e) => { state.watch = e.target.checked; fill(); });
  $('#grow').addEventListener('change', (e) => { state.grow = e.target.checked; fill(); });
  view.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    state.dir = state.key === k ? -state.dir : (k === 'rank' || k === 'name' ? 1 : -1);
    state.key = k;
    fill();
  }));
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
    th.setAttribute('aria-sort', on ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
    th.textContent = COLS.find((c) => c[0] === th.dataset.k)[1] + (on ? (state.dir > 0 ? ' ▲' : ' ▼') : '');
  });
  $('#rows').innerHTML = rows.length ? rows.map((r) => {
    const badge = `${r.watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">BELOW FLOOR</span>'}${r.missing.length ? `<span class="badge assume">${r.missing.length} missing</span>` : ''}`;
    return `<tr tabindex="0" data-slug="${esc(r.slug)}">
      <td class="rank${r.rank <= 3 ? ' top' : ''}">${r.rank}</td>
      <td><span class="name">${esc(r.name)}</span>${badge}<div class="sub">${esc(r.category ?? 'no category recorded')} · ${esc(r.chains[0] ?? 'no chain')}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</div></td>
      <td class="num">${usd(r.tvl_usd)}</td>
      <td class="num delta">${pct(r.change_7d)}</td>
      <td class="num">${age(r)}</td>
      <td class="num">${x(r.multiple)}<span class="src">${r.multiple_source === 'category' ? 'c' : 'g'}</span></td>
      <td class="num"><div class="val">${usd(r.implied_value_usd)}</div><div class="ivl">${usd(r.low_usd)}–${usd(r.high_usd)}</div></td>
      <td class="num up">${one(r.net_per_hour_usd)}</td>
      <td class="num plan">${r.hold_days}d · ${r.plan.length} steps</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>';
}

view.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-slug]'); if (tr) openDetail(tr.dataset.slug); });
view.addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-slug]'); if (tr && e.key === 'Enter') openDetail(tr.dataset.slug); });

// ---------------------------------------------------------------- detail

const detail = $('#detail');
const scrim = $('#scrim');
let lastFocus = null;

function bandMarkup(r) {
  const lo = Math.log10(r.low_usd);
  const hi = Math.log10(r.high_usd);
  const at = hi === lo ? 50 : ((Math.log10(r.implied_value_usd) - lo) / (hi - lo)) * 100;
  return `<div class="band"><i style="left:3%;right:3%"></i><b style="left:${at.toFixed(1)}%"></b></div>`;
}

function openDetail(slug) {
  const r = R.rows.find((o) => o.slug === slug);
  if (!r) return;
  lastFocus = document.activeElement;
  const clamped = r.change_7d !== null && r.change_7d !== r.growth_counted;
  const src = r.multiple_source === 'category'
    ? `median mcap/TVL of ${r.multiple_n} tokenized ${esc(r.category)} protocols`
    : `global median mcap/TVL of ${r.multiple_n} tokenized protocols, because this category has fewer than ${MODEL.min_peers} tokenized peers`;
  const peers = r.peers.length
    ? `<table class="mini"><tr><th>Tokenized peer</th><th class="num">Mcap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th></tr>${r.peers.map((p) => `<tr><td>${esc(p.name)} <span class="mut">${esc(p.symbol ?? '')}</span></td><td class="num">${usd(p.mcap_usd)}</td><td class="num">${usd(p.tvl_usd)}</td><td class="num">${x(p.ratio)}</td></tr>`).join('')}</table>`
    : `<p class="note">No tokenized protocol in this exact category, so the model uses the global median over all ${R.counts.tokenized}.</p>`;
  detail.innerHTML = `
  <div class="dtop">
    <div class="who">
      <div class="drank">Rank ${r.rank} of ${R.rows.length} · ${r.watchlist ? 'on the watchlist' : 'below the floor, not on the watchlist'}</div>
      <h2 class="dtitle" id="d-title">${esc(r.name)}</h2>
      <div class="dsub">${esc(r.category ?? 'no category recorded')} · ${esc(r.chains.slice(0, 5).join(', '))}${r.chains.length > 5 ? ` +${r.chains.length - 5}` : ''} · records no token in DefiLlama (no gecko id, symbol or market cap)</div>
    </div>
    <button class="dclose" id="dclose">Close ✕</button>
  </div>
  <div class="dhero">
    <div class="dvalue">
      <div class="big">${full(r.implied_value_usd)}</div>
      <div class="eq">${full(r.tvl_usd)} TVL × ${x(r.multiple)} × ${r.growth_mult.toFixed(3)} growth × ${r.maturity.toFixed(3)} maturity</div>
      <div class="note">Base ${full(r.base_usd)} × growth ${r.growth_mult.toFixed(3)} × maturity ${r.maturity.toFixed(3)}. The interval below is the same equation at the fitted multiple's p25 and p75.</div>
    </div>
    <div class="dband">
      <div class="lab">P25–P75 interval · where the same model puts this launch</div>
      <div class="nums"><span>P25 <b>${usd(r.low_usd)}</b></span><span>point <b>${usd(r.implied_value_usd)}</b></span><span>P75 <b>${usd(r.high_usd)}</b></span></div>
      ${bandMarkup(r)}
      <div class="nums" style="margin-top:6px"><span class="mut">${x(r.multiple_lo)}</span><span class="mut">${x(r.multiple)}</span><span class="mut">${x(r.multiple_hi)}</span></div>
    </div>
  </div>
  <div class="dcols">
    <div>
      <div class="card"><h3>Model inputs from the snapshot</h3>
        <div class="rows">
          <div class="row"><div class="l"><span class="k">TVL</span><span class="e">tvl_usd</span></div><span class="v">${full(r.tvl_usd)}</span></div>
          <div class="row"><div class="l"><span class="k">7d TVL change</span><span class="e">${r.change_7d === null ? 'change_7d not reported' : `change_7d ${r.change_7d.toFixed(2)}%${clamped ? `, counted ${r.growth_counted}%` : ''}`}</span></div><span class="v">${pct(r.change_7d)} → ×${r.growth_mult.toFixed(3)}</span></div>
          <div class="row"><div class="l"><span class="k">No-token age</span><span class="e">${esc(r.age_basis)}</span></div><span class="v">${r.age_days}d</span></div>
          <div class="row"><div class="l"><span class="k">Maturity</span><span class="e">${MODEL.maturity_base} + min(age, ${MODEL.maturity_days})/${MODEL.maturity_days} × ${MODEL.maturity_span}</span></div><span class="v">${r.maturity.toFixed(3)}</span></div>
          <div class="row"><div class="l"><span class="k">Multiple</span><span class="e">${src}</span></div><span class="v acc">${x(r.multiple)}</span></div>
          <div class="row"><div class="l"><span class="k">Base</span><span class="e">TVL × multiple</span></div><span class="v">${full(r.base_usd)}</span></div>
          <div class="row"><div class="l"><span class="k">Growth factor</span><span class="e">1 + clamp(change, ${MODEL.growth_lo}, ${MODEL.growth_hi})/100 × ${MODEL.growth_weight}</span></div><span class="v">×${r.growth_mult.toFixed(3)}</span></div>
          <div class="row"><div class="l"><span class="k">Maturity factor</span><span class="e">${MODEL.maturity_base} → 1.00 over ${MODEL.maturity_days} days</span></div><span class="v">×${r.maturity.toFixed(3)}</span></div>
          <div class="row"><div class="l"><span class="k">Implied value</span><span class="e">max(1, round(base × growth × maturity))</span></div><span class="v acc">${full(r.implied_value_usd)}</span></div>
          <div class="row"><div class="l"><span class="k">Per $1k TVL</span><span class="e">implied × $1,000 ÷ TVL, before gas</span></div><span class="v">${full(r.per_1k_usd)}</span></div>
          <div class="row"><div class="l"><span class="k">Net $/h</span><span class="e">(${full(r.per_1k_usd)} − ${one(r.gas_total_usd)} gas) ÷ ${r.hold_days}d hold</span></div><span class="v">${one(r.net_per_hour_usd)}</span></div>
        </div>
      </div>
      <div class="card"><h3>How the multiple is validated</h3><p class="note">Leave-one-out over the same ${R.counts.tokenized} tokenized protocols: refit without each one and predict its market cap from its TVL. Median miss ${x2(R.validation.median_miss_factor)} (one global multiple: ${x2(R.validation.global_median_miss_factor)}); ${R.validation.within_2x_pct}% land within 2×, and the P25–P75 band holds ${R.validation.interval_coverage_pct}% of held-out tokens. The interval is the honest width of a token multiple, not decoration.</p></div>
      <div class="card"><h3>Why this multiple</h3>${peers}</div>
      ${r.missing.length ? `<div class="card warn"><h3>Assumptions for missing fields</h3><ul>${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div>
      <div class="card"><h3>Farm plan · ${r.plan.length} steps · ${r.hold_days}-day hold · ${r.cooldown_days}-day cooldown</h3>
        <div class="plansum">capital ${full(PLAN.position_usd)} · gas ≈ ${one(r.gas_total_usd)} · hold ${r.hold_days} days · exit cooldown ${r.cooldown_days} days · ${r.plan.length} steps</div>
        <ol class="steps">${r.plan.map((s) => `<li>${esc(s.do)}<div class="chips"><span class="chip c">${esc(s.cost)}</span><span class="chip">${esc(s.time)}</span></div></li>`).join('')}</ol>
        <p class="note"><b>Assumptions, not snapshot data:</b> a ${full(PLAN.position_usd)} position, gas at ${esc(PLAN.gas_note)}, and the category minimum in step 3. Estimated gas for the whole plan is ${one(r.gas_total_usd)} on ${esc(r.chains[0] ?? 'the first chain')}. The ${r.hold_days}-day hold is longer for younger protocols; the exit names its own cooldown.</p>
      </div>
    </div>
  </div>`;
  detail.hidden = scrim.hidden = false;
  $('#dclose').addEventListener('click', closeDetail);
  $('#dclose').focus();
}
function closeDetail() { detail.hidden = scrim.hidden = true; if (lastFocus) lastFocus.focus(); }
scrim.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detail.hidden) closeDetail(); });

// ---------------------------------------------------------------- other views

function renderLive() {
  view.innerHTML = `<div class="controls"><span class="mut">These ${R.live.length} protocols record a token and a positive market cap and TVL. They are the fitting sample, not ranked: their mcap ÷ TVL is what sets every multiple above.</span></div>
  <div class="wrap"><table><thead><tr><th>Protocol</th><th>Symbol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap/TVL</th><th class="num">7d TVL</th></tr></thead><tbody>
  ${R.live.map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="mut">${esc(p.symbol ?? '')}</td><td class="sub">${esc(p.category ?? 'none recorded')}</td><td class="num">${usd(p.tvl_usd)}</td><td class="num">${usd(p.mcap_usd)}</td><td class="num">${x(p.ratio)}</td><td class="num">${pct(p.change_7d)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderAside() {
  const labels = { 'wrapper-category': 'wrapper category', versioned: 'version marker', 'wrapper-name': 'wrapped/staked name', exchange: 'exchange product', 'parent-product': 'child of a recorded parent' };
  const byCode = new Map();
  for (const p of R.aside) byCode.set(p.code, (byCode.get(p.code) ?? 0) + 1);
  const summary = [...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${labels[c] ?? c} ${n}`).join(' · ');
  view.innerHTML = `<div class="controls"><span class="mut">${R.aside.length} protocols record no token but are set aside: ${esc(summary)}. The rule is a pattern, not a list of names; the Method tab states it.</span></div>
  <div class="wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Why it is set aside</th></tr></thead><tbody>
  ${R.aside.map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="sub">${esc(p.category ?? 'none recorded')}</td><td class="num">${usd(p.tvl_usd)}</td><td class="sub">${esc(p.why)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderMethod() {
  const v = R.validation;
  const c = R.counts;
  const catRows = R.categories.map((k) => `<tr><td>${esc(k.name)}</td><td class="num">${k.n}</td><td class="num">${x(k.p25)}</td><td class="num">${x(k.median)}</td><td class="num">${x(k.p75)}</td><td class="num">${k.rows}</td></tr>`).join('');
  view.innerHTML = `<div class="prose">
  <h2>The model, with its constants and where they came from</h2>
  <div class="formula">
    <div>multiple_i <span>= median(mcap_usd / tvl_usd of the tokenized protocols in category_i);</span> n ≥ ${MODEL.min_peers}, else the global median</div>
    <div>base_i <span>=</span> tvl_usd_i × multiple_i</div>
    <div>growth_i <span>=</span> 1 + clamp(change_7d_i, ${MODEL.growth_lo}, ${MODEL.growth_hi}) / 100 × ${MODEL.growth_weight}</div>
    <div>maturity_i <span>=</span> ${MODEL.maturity_base} + min(age_days_i, ${MODEL.maturity_days}) / ${MODEL.maturity_days} × ${MODEL.maturity_span}</div>
    <div>implied_i <span>=</span> max(${MODEL.value_floor_usd}, round(base_i × growth_i × maturity_i))</div>
    <div>interval_i <span>=</span> the same formula at the fitted multiple's p25 and p75 (category when n ≥ ${MODEL.min_peers}, else global)</div>
  </div>
  <p>Nothing here is a constant typed in by hand. The multiple is refitted from the snapshot's own ${c.tokenized} tokenized protocols every run; a category with fewer than ${MODEL.min_peers} tokenized peers borrows the global median. Growth counts a week of TVL change at ${MODEL.growth_weight}× and clamps it to ${MODEL.growth_lo}/${MODEL.growth_hi}%. Maturity rises from ${MODEL.maturity_base} to 1.00 over ${MODEL.maturity_days} days: TVL that has run three years without a token is treated as proven demand.</p>
  <div class="mgrid">
    <div class="card"><h3>Category medians fitted from the tokenized set</h3>
      <table class="mtab"><tr><th>Category</th><th class="num">n</th><th class="num">P25</th><th class="num">Median</th><th class="num">P75</th><th class="num">Rows</th></tr>
      ${catRows}<tr class="global"><td>All tokenized (global fallback)</td><td class="num">${R.global.n}</td><td class="num">${x(R.global.p25)}</td><td class="num">${x(R.global.median)}</td><td class="num">${x(R.global.p75)}</td><td class="num">${c.global_multiple_rows}</td></tr></table>
      <p class="note">A category earns its own row only at n ≥ ${MODEL.min_peers}. ${c.global_multiple_rows} of the ${c.ranked} ranked rows use the global fallback; the table shows how many rows each fitted category serves.</p>
    </div>
    <div>
      <div class="card"><h3>Leave-one-out validation, stated honestly</h3>
        <div class="statline">
          <div class="statbox"><b>${x2(v.median_miss_factor)}</b><span>median miss, category model</span></div>
          <div class="statbox"><b>${x2(v.global_median_miss_factor)}</b><span>median miss, one global multiple</span></div>
          <div class="statbox"><b>${v.within_2x_pct}%</b><span>within 2× of the traded mcap</span></div>
          <div class="statbox"><b>${v.interval_coverage_pct}%</b><span>inside the held-out P25–P75 band</span></div>
          <div class="statbox"><b>${v.spearman}</b><span>Spearman, predicted vs actual</span></div>
          <div class="statbox"><b>${v.median_abs_pct}%</b><span>median absolute error</span></div>
        </div>
        <p class="note"><b>Method:</b> for each of the ${v.sample} tokenized protocols, refit the multiple with that protocol removed, predict its market cap from its TVL, and compare. The median miss is ${x2(v.median_miss_factor)}; a single global multiple misses by ${x2(v.global_median_miss_factor)}. The category split improves the median but not every tail, and ${v.within_2x_pct}% of held-out tokens land within 2×. That is the honest width of a token multiple, and the reason every row carries a P25–P75 interval instead of one number.</p>
      </div>
      <div class="card"><h3>What is on the board, and what is not</h3>
        <p class="note">${c.protocols} protocols in the snapshot. ${c.recorded_token} record a token; ${c.tokenized} of those have a positive market cap and TVL and are the fitting sample. ${c.tokenless} record no token. ${c.ranked} are ranked: all ${c.watchlist_ranked} watchlist protocols plus ${c.below_floor_ranked} below the ${usd(R.floor_usd)} floor. ${c.set_aside} are set aside with a reason; ${c.no_tvl} were excluded for missing or zero TVL.</p>
        <p class="note"><b>Set-aside rule, not a name list:</b> a tokenless protocol is left off when its category is a bridge, liquid staking, restaking, CEX or stablecoin wrapper; its name ends in a version marker; its name contains wrapped, staked, staking, restaked, stETH, rETH or sETH; or it begins with an exchange name. Above the floor, a tokenless protocol off the watchlist that passes every test is set aside as a child of a recorded parent. A protocol with any of mcap_usd, gecko_id or symbol set is never a candidate.</p>
      </div>
    </div>
  </div>
  <h2>Known limits</h2>
  <p>Ages are days since DefiLlama began tracking a protocol, not days since a token launch. When listed_at is null the age is assumed to be ${MODEL.age_assumed_days} days and the row says so. Farm-plan gas, minimums and the ${full(PLAN.position_usd)} position are assumptions for comparison, not quotes. The snapshot is one sealed day: there is no walk-forward window, no Brier score and no out-of-sample period, so this page reports a leave-one-out fit rather than inventing them. Implied value is a claim about the record as it stands, not a forecast that a token launches.</p>
  </div>`;
}

const TABS = { board: renderBoard, live: renderLive, aside: renderAside, method: renderMethod };
function selectTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  TABS[name]();
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
document.addEventListener('click', (e) => { if (e.target.id === 'goMethod') selectTab('method'); });
renderBoard();
window.__RADAR_READY = true;
