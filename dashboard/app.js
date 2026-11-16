// Token Radar page: computes the radar from the sealed snapshot (data.js) with model.js,
// the same module main.ts uses for board.json, then renders the board, detail, and model views.
import { buildRadar, MODEL, PLAN } from './model.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const usd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`;
const full = (n) => `$${n.toLocaleString('en-US')}`;
const pct = (n) => n === null ? '<span class="mut">n/a</span>' : `<span class="${n > 0 ? 'up' : n < 0 ? 'down' : 'mut'}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
const days = (d) => d === null ? '<span class="mut">unknown</span>' : d >= 365 ? `${(d / 365).toFixed(1)}y` : `${d}d`;
const x = (m) => `${m.toFixed(3)}×`;

const snap = window.SNAPSHOT;
const view = $('#view');
if (!snap) {
  view.innerHTML = '<p class="empty">No snapshot loaded: run <code>node main.ts</code> to write data.js beside this folder.</p>';
  throw new Error('data.js missing');
}
const R = buildRadar(snap);
const maxLog = Math.log10(R.rows[0].implied_value_usd);
const minLog = Math.log10(R.rows[R.rows.length - 1].implied_value_usd);

$('#meta').innerHTML = `Snapshot ${esc(R.as_of)} · ${esc(R.source)}<br>Model ${MODEL.version} · same code writes board.json`;
const below = R.rows.filter((r) => !r.watchlist).length;
$('#stats').innerHTML = [
  [R.rows.length, 'ranked, no token recorded'],
  [`${R.rows.filter((r) => r.watchlist).length}/${R.watch_n}`, `watchlist ≥ ${usd(R.floor_usd)} covered`],
  [below, 'early, below the floor'],
  [R.live.length, 'live tokens, the comparables'],
  [R.aside.length, 'products, set aside'],
  [x(R.global_multiple), 'median mcap ÷ TVL'],
].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');

// ---- board -------------------------------------------------------------
const state = { q: '', scope: 'all', cat: '', chain: '', growing: false, key: 'rank', dir: 1 };
const cats = [...new Set(R.rows.map((r) => r.category ?? '(none)'))].sort();
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
const COLS = [
  ['rank', '#', ''], ['name', 'Protocol', ''], ['chains', 'Chains', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d TVL', 'num'],
  ['age_days', 'Tokenless run', 'num'], ['multiple', 'Multiple', 'num'], ['implied_value_usd', 'Implied launch value', 'num'],
  ['per_1k_usd', 'Per $1k*', 'num'], ['hold', 'Plan', 'num'],
];
const get = (r, k) => k === 'hold' ? r.plan.hold_days : k === 'chains' ? r.chains.length : r[k];

function filtered() {
  const q = state.q.toLowerCase();
  const rows = R.rows.filter((r) =>
    (state.scope === 'all' || (state.scope === 'watch') === r.watchlist) &&
    (!state.cat || (r.category ?? '(none)') === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    (!state.growing || (r.change_7d ?? 0) > 0) &&
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  const { key, dir } = state;
  return rows.sort((a, b) => {
    const va = get(a, key), vb = get(b, key);
    if (va === vb) return a.rank - b.rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
  });
}

function renderBoard() {
  view.innerHTML = `
  <div class="controls">
    <input type="search" id="q" placeholder="Search protocol" value="${esc(state.q)}" aria-label="Search protocol">
    <div class="seg" role="group" aria-label="Scope">${[['all', 'All'], ['watch', 'Watchlist'], ['early', 'Below floor']]
      .map(([k, l]) => `<button data-scope="${k}" aria-pressed="${state.scope === k}">${l}</button>`).join('')}</div>
    <select id="cat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option${c === state.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select id="chain" aria-label="Chain"><option value="">All chains</option>${chains.map((c) => `<option${c === state.chain ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" id="grow"${state.growing ? ' checked' : ''}> TVL growing (7d &gt; 0)</label>
    <span class="count" id="count"></span>
  </div>
  <div class="wrap"><table><thead><tr>${COLS.map(([k, l, c]) => `<th data-k="${k}" class="${c}" aria-sort="none">${l}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div>
  <p class="note">* Per $1k: what a $1,000 deposit would receive if ${MODEL.drop_share * 100}% of the implied value went to depositors pro rata by TVL. A hypothetical for comparing plans, not an expected payout. Click a column to sort, a row for its reasoning and farm plan.</p>`;
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; fill(); });
  view.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    state.scope = b.dataset.scope;
    view.querySelectorAll('[data-scope]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    fill();
  }));
  $('#cat').addEventListener('change', (e) => { state.cat = e.target.value; fill(); });
  $('#chain').addEventListener('change', (e) => { state.chain = e.target.value; fill(); });
  $('#grow').addEventListener('change', (e) => { state.growing = e.target.checked; fill(); });
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
  $('#count').textContent = `${rows.length} of ${R.rows.length} protocols`;
  view.querySelectorAll('th[data-k]').forEach((th) => {
    const on = th.dataset.k === state.key;
    th.classList.toggle('sorted', on);
    th.setAttribute('aria-sort', on ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
    th.textContent = COLS.find((c) => c[0] === th.dataset.k)[1] + (on ? (state.dir > 0 ? ' ▲' : ' ▼') : '');
  });
  $('#rows').innerHTML = rows.length ? rows.map((r) => {
    const w = maxLog === minLog ? 100 : 6 + 94 * (Math.log10(r.implied_value_usd) - minLog) / (maxLog - minLog);
    return `<tr tabindex="0" data-slug="${esc(r.slug)}">
      <td class="rank">${r.rank}</td>
      <td><span class="name">${esc(r.name)}</span>${r.watchlist ? '<span class="wl">WATCHLIST</span>' : ''}${r.missing.length ? `<span class="miss" title="${esc(r.missing.join('; '))}">◆ ${r.missing.length} field${r.missing.length > 1 ? 's' : ''} missing</span>` : ''}<div class="sub">${esc(r.category ?? 'no category recorded')}</div></td>
      <td class="sub">${esc(r.chains[0] ?? 'none recorded')}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</td>
      <td class="num">${usd(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${days(r.age_days)}</td>
      <td class="num">${x(r.multiple)}</td>
      <td class="num val-cell"><div class="val">${usd(r.implied_value_usd)}<span class="bar"><i style="width:${w.toFixed(1)}%"></i></span></div></td>
      <td class="num">${usd(r.per_1k_usd)}</td>
      <td class="num sub">${r.plan.hold_days}d · ${r.plan.steps.length} steps</td></tr>`;
  }).join('') : '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>';
}

view.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-slug]'); if (tr) openDetail(tr.dataset.slug); });
view.addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-slug]'); if (tr && e.key === 'Enter') openDetail(tr.dataset.slug); });

// ---- detail ------------------------------------------------------------
const detail = $('#detail'), scrim = $('#scrim');
let lastFocus = null;
function openDetail(slug) {
  const r = R.rows.find((o) => o.slug === slug);
  lastFocus = document.activeElement;
  const g = r.change_7d === null ? 'not reported → 1.000' : `${r.change_7d.toFixed(2)}%${r.change_7d !== r.growth_counted ? ` (counted ${r.growth_counted}%)` : ''} × ${MODEL.growth_weight} → ${r.growth.toFixed(3)}`;
  const age = r.age_days === null ? 'listed_at not reported → 0 d' : `${r.age_days} d since ${r.listed_at}`;
  const pos = R.rows.indexOf(r);
  const above = pos > 0 ? R.rows[pos - 1] : null;
  detail.innerHTML = `
  <div class="d-head"><div>
    <div class="sub">Rank ${r.rank} of ${R.rows.length}${r.watchlist ? ' · on the watchlist' : ' · below the floor, not on the watchlist'}</div>
    <h2 id="d-title">${esc(r.name)}</h2>
    <div class="sub">${esc(r.category ?? 'no category recorded')} · ${r.chains.length ? esc(r.chains.join(', ')) : 'no chain recorded'}</div>
  </div><button class="close" id="close">Close ✕</button></div>
  <div class="d-grid">
    <div>
      <div class="card"><h3>Implied launch value</h3>
        <div class="hero">${full(r.implied_value_usd)}</div>
        <div class="eq">${usd(r.tvl_usd)} TVL × ${x(r.multiple)} multiple × ${r.growth.toFixed(3)} growth × ${r.run.toFixed(3)} run</div>
        <p class="note">${above ? `Ranks below ${esc(above.name)} (${usd(above.implied_value_usd)}).` : 'The board’s most valuable protocol.'} Records no token: no CoinGecko id, symbol or market cap in DefiLlama’s record.</p>
      </div>
      <div class="card" style="margin-top:12px"><h3>The numbers behind the rank</h3>
        <div class="kv">
          <span>TVL</span><em>tvl_usd</em><span class="num">${full(r.tvl_usd)}</span>
          <span>Category multiple</span><em>${r.cat_n ? `${r.cat_n} live peer${r.cat_n > 1 ? 's' : ''}, median ${x(r.cat_median)}` : 'no live peer'}, shrunk to ${x(R.global_multiple)}</em><span class="num">${x(r.multiple)}</span>
          <span>Growth factor</span><em>${g}</em><span class="num">${r.growth.toFixed(3)}</span>
          <span>Tokenless run</span><em>${age}</em><span class="num">${r.run.toFixed(3)}</span>
          <span>Per $1k*</span><em>${MODEL.drop_share * 100}% of value ÷ TVL × $1,000</em><span class="num">${full(r.per_1k_usd)}</span>
        </div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Live-token peers in ${esc(r.category ?? 'this category')}</h3>
        ${r.peers.length ? `<table class="mini"><tr><th>Token</th><th class="num">Mcap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th></tr>${r.peers.map((p) => `<tr><td>${esc(p.name)} <span class="mut">${esc(p.symbol ?? '')}</span></td><td class="num">${usd(p.mcap_usd)}</td><td class="num">${usd(p.tvl_usd)}</td><td class="num">${x(p.ratio)}</td></tr>`).join('')}</table>`
          : `<p class="note">No protocol in this category trades a token in the snapshot, so the all-token median ${x(R.global_multiple)} is used.</p>`}
      </div>
      ${r.missing.length ? `<div class="card warn" style="margin-top:12px"><h3>Missing from the snapshot</h3><ul>${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div class="card"><h3>Farm plan · ${r.plan.steps.length} steps · ${r.plan.hold_days}-day hold</h3>
      <ol class="steps">${r.plan.steps.map((s) => `<li>${esc(s.do)}.<div class="chips"><span class="chip c">${esc(s.cost)}</span><span class="chip">${esc(s.time)}</span></div></li>`).join('')}</ol>
      <p class="note">Total gas ≈ $${r.plan.gas_total_usd.toFixed(2)} on ${esc(r.plan.chain)} for a $${PLAN.position_usd.toLocaleString('en-US')} position. Gas per transaction ($${PLAN.gas_usd.Ethereum} Ethereum, $${PLAN.gas_usd.Bitcoin} Bitcoin, $${PLAN.gas_usd.other.toFixed(2)} elsewhere) and the position size are plan assumptions, not snapshot figures. The hold is longer for younger protocols: 90 d under six months listed, 60 d under a year or unknown, 45 d after.</p>
    </div>
  </div>`;
  detail.hidden = scrim.hidden = false;
  $('#close').addEventListener('click', closeDetail);
  $('#close').focus();
}
function closeDetail() { detail.hidden = scrim.hidden = true; if (lastFocus) lastFocus.focus(); }
scrim.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detail.hidden) closeDetail(); });

// ---- other tabs ---------------------------------------------------------
function renderLive() {
  view.innerHTML = `<div class="controls"><span class="mut">These ${R.live.length} protocols already trade a token, so they are not ranked. Their market cap ÷ TVL is what sets every category multiple on the board.</span></div>
  <div class="wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th><th class="num">7d TVL</th></tr></thead><tbody>
  ${R.live.map((p) => `<tr><td><span class="name">${esc(p.name)}</span> <span class="mut">${esc(p.symbol ?? '')}</span></td><td class="sub">${esc(p.category ?? 'none recorded')}</td><td class="num">${usd(p.mcap_usd)}</td><td class="num">${usd(p.tvl_usd)}</td><td class="num">${x(p.ratio)}</td><td class="num">${pct(p.change_7d)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function renderAside() {
  view.innerHTML = `<div class="controls"><span class="mut">${R.aside.length} protocols record no token but are left off the board as a wrapped, staked, bridged or child product, by the watchlist’s own rule.</span></div>
  <div class="wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Why it is set aside</th></tr></thead><tbody>
  ${R.aside.map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="sub">${esc(p.category ?? 'none recorded')}</td><td class="num">${usd(p.tvl_usd)}</td><td class="sub">${esc(p.why)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function renderModel() {
  view.innerHTML = `<div class="prose">
  <h2>Implied launch value</h2>
  <p><code>value = TVL × category multiple × growth × tokenless run</code>, using only the snapshot’s own fields. The same function in <code>model.js</code> writes board.json and draws this page. No protocol name is special-cased.</p>
  <h2>Category multiple, from the market</h2>
  <p>For the ${R.live.length} protocols whose token trades, market cap ÷ TVL is a price the market already sets. A category’s multiple is the median of its peers, blended in log space with the median over all of them (${x(R.global_multiple)}), with weight n against ${MODEL.shrink_k}: a category with one peer leans on the overall median, one with fifteen leans on its own. Clamped to ${MODEL.multiple_min}–${MODEL.multiple_max}×.</p>
  <h2>Growth</h2>
  <p><code>1 + ${MODEL.growth_weight} × change_7d / 100</code>, with change_7d held within ±${MODEL.growth_clamp}%, so one week moves value by at most ±${MODEL.growth_weight * MODEL.growth_clamp}%. Not reported → 1.</p>
  <h2>Tokenless run</h2>
  <p><code>${MODEL.run_floor} + ${(1 - MODEL.run_floor).toFixed(2)} × min(days since listed_at, ${MODEL.run_full_days}) / ${MODEL.run_full_days}</code>. TVL that has stayed without a token for two years is proven demand; a new listing is discounted 25%. listed_at not reported → counted as new.</p>
  <h2>What is on the board</h2>
  <p>All ${R.watch_n} watchlist protocols, plus every protocol below the ${usd(R.floor_usd)} floor that records no token and passes the watchlist’s product tests (category, version marker, wrapped/staked wording, exchange name). Above the floor, a tokenless protocol that passes those tests but is off the watchlist can only have been left out for a parent protocol on record, so it is set aside too. The snapshot has no parent field below the floor, so a row there may still be a child product.</p>
  <h2>Limits</h2>
  <p>The value is a claim about the record as it stands, not a forecast of whether or when a token launches. Farm-plan gas and position sizes are assumptions and are labelled as such.</p></div>`;
}

const TABS = { board: renderBoard, live: renderLive, aside: renderAside, model: renderModel };
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
  TABS[b.dataset.tab]();
}));
renderBoard();
