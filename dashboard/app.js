// Token Radar page: renders data.js, then recomputes every row from the fitted
// constants and stamps the result in the integrity strip. No figure is typed by hand.
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
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const verdictNet = (net) => net > 0 ? ['FARM', 'farm'] : net > -10 ? ['MARGINAL', 'marg'] : ['SKIP', 'skip'];
const verdict = (r) => verdictNet(r.net_if_launch_usd);

const view = $('#view');
if (!R) { view.innerHTML = '<p class="empty">No radar loaded: run <b>node main.ts</b> to write data.js.</p>'; throw new Error('data.js missing'); }
const v = R.validation;
const baseBrier = R.odds.base_rate * (1 - R.odds.base_rate);

/** Recompute one row from snapshot inputs, constants, curve, EB category adj and odds. */
function rec(r, pos = MODEL.deposit_usd, share = MODEL.drop_share) {
  const g = Math.round((1 + (clamp(r.change_7d ?? 0, MODEL.growth_lo, MODEL.growth_hi) / 100) * MODEL.growth_weight) * 1e4) / 1e4;
  const a = r.age_assumed ? MODEL.age_assumed_days : r.age_days;
  const mat = Math.round((MODEL.maturity_base + (Math.min(a, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_span) * 1e4) / 1e4;
  const adj = (R.curve.cat_adj && R.curve.cat_adj[r.category ?? '(none)']) ?? 0;
  const base = 10 ** (R.curve.a + R.curve.b * Math.log10(r.tvl_usd) + adj);
  const ifLaunch = Math.max(1, Math.round(base * g * mat));
  const z = R.odds.beta[0] + R.odds.beta[1] * Math.log10(r.tvl_usd) + R.odds.beta[2] * Math.log10(1 + Math.min(a, MODEL.odds_max_age));
  const odds = 1 / (1 + Math.exp(-z));
  const implied = Math.max(1, Math.round(ifLaunch * odds));
  const low = Math.max(1, Math.round(implied * R.curve.band.p25));
  const high = Math.max(1, Math.round(implied * R.curve.band.p75));
  const drop = Math.round((implied * share * pos) / r.tvl_usd);
  const net = drop - r.gas_total_usd - MODEL.fee_usd;
  const hours = r.hold_days * 24 + (r.family === 'rwa' ? 8 : r.family === 'staking' ? 4 : 1);
  return { base, adj, ifLaunch, odds: Math.round(odds * 1e4) / 1e4, implied, low, high, drop, net: Math.round(net * 100) / 100, netHour: Math.round((net / hours) * 1e4) / 1e4 };
}
const close = (a, b, tol) => Math.abs(a - b) <= tol;
function integrity() {
  let ok = 0;
  for (const r of R.rows) {
    const c = rec(r);
    if (c.ifLaunch === r.if_launch_usd && c.implied === r.implied_value_usd && c.low === r.low_usd && c.high === r.high_usd && c.drop === r.drop_per_1k_usd && close(c.odds, r.odds, 0.0002) && close(c.net, r.net_if_launch_usd, 0.011) && close(c.netHour, r.net_per_hour_usd, 0.0002)) ok++;
  }
  const sum = R.rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const sum2 = R.rows.reduce((s, r) => s + rec(r).implied, 0);
  const L = R.ledger;
  const seg = L.ranked_watchlist + L.ranked_early + L.token_trades + L.token_no_cap + L.set_aside;
  return { ok, sum, sum2, seg, L };
}

$('#stamp').innerHTML = `<b>SNAPSHOT</b> ${esc(R.as_of)} &middot; ${R.counts.protocols} protocols<br><b>MODEL</b> ${esc(R.model)}`;
$('#kpis').innerHTML = [
  [R.counts.ranked, 'pre-token protocols ranked'],
  [`${R.counts.watchlist_ranked}/${R.counts.watchlist}`, 'watchlist covered'],
  [x2(v.curve.median_miss), 'value leave-one-out miss'],
  [`${R.odds.brier_loo.toFixed(3)} / ${baseBrier.toFixed(3)}`, 'odds Brier vs base'],
  [`${v.band.coverage}%`, 'range covers (stated 50%)'],
  [R.counts.set_aside, 'set aside by rule'],
].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');
$('#methodbar').innerHTML = `<div class="mtext"><div class="f">expected = 10<sup>a + b·logTVL + δ<sub>cat</sub></sup> <i>×</i> growth <i>×</i> maturity <i>×</i> token odds</div><div class="f2">curve a=${v.curve.a.toFixed(3)} b=${v.curve.b.toFixed(3)} [90% CI ${v.curve.boot.b_lo}–${v.curve.boot.b_hi}] + EB cat (k=${MODEL.cat_shrink_k}) · odds β=[${R.odds.beta.map((z) => z.toFixed(2)).join(', ')}] · fit ${R.counts.tokenized} priced + ${R.counts.protocols} odds</div></div><button class="go" id="goMethod">Method &amp; validation →</button>`;

const state = { q: '', cat: '', chain: '', minTvl: 0, watch: false, grow: false, verdict: 'all', key: 'rank', dir: 1, pos: MODEL.deposit_usd, share: MODEL.drop_share };
const cats = [...new Set(R.rows.map((r) => r.category ?? '(none)'))].sort(cmp);
const chainCount = new Map();
for (const r of R.rows) for (const c of r.chains) chainCount.set(c, (chainCount.get(c) ?? 0) + 1);
const chains = [...chainCount.keys()].sort((a, b) => chainCount.get(b) - chainCount.get(a) || cmp(a, b));
const maxTvl = Math.max(...R.rows.map((r) => r.tvl_usd));
const COLS = [
  ['rank', '#', 'num'], ['name', 'Protocol', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num'],
  ['age_days', 'Age', 'num'], ['odds', 'Odds', 'num'], ['if_launch_usd', 'If launch', 'num'],
  ['implied_value_usd', 'Expected', 'num'], ['drop_per_1k_usd', 'Drop/$1k', 'num'],
  ['net_if_launch_usd', 'Net if launch', 'num'], ['net_per_hour_usd', 'Net $/h', 'num'], ['hold_days', 'Plan', 'num'],
];
const preVerdict = () => {
  const q = state.q.toLowerCase();
  return R.rows.filter((r) => (!state.cat || (r.category ?? '(none)') === state.cat) && (!state.chain || r.chains.includes(state.chain)) && r.tvl_usd >= state.minTvl && (!state.watch || r.watchlist) && (!state.grow || (r.change_7d ?? 0) > 0) && (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
};
const filtered = () => preVerdict().filter((r) => state.verdict === 'all' || verdict(r)[1] === state.verdict).sort((a, b) => {
  const va = a[state.key], vb = b[state.key];
  if (va === vb) return a.rank - b.rank;
  if (va === null) return 1;
  if (vb === null) return -1;
  return (typeof va === 'string' ? cmp(va, vb) : va - vb) * state.dir;
});

function ribbon() {
  const L = R.ledger;
  const segs = [['ranked watchlist', L.ranked_watchlist, 'r1'], ['ranked early', L.ranked_early, 'r2'], ['token trades', L.token_trades, 'r3'], ['token, no usable cap', L.token_no_cap, 'r4'], ['set aside', L.set_aside, 'r5']];
  return `<div class="ribbon"><div class="rbar">${segs.map(([, n, c]) => `<i class="${c}" style="width:${((n / L.total) * 100).toFixed(2)}%"></i>`).join('')}</div><div class="rlegend">${segs.map(([label, n, c]) => `<span><i class="${c}"></i>${label} <b>${n}</b></span>`).join('')}<span class="rtotal">${L.total} = ${L.token_recorded} token + ${L.no_token} no token</span></div></div>`;
}
function evidence() {
  const t = R.terms;
  const kept = '<span class="keep">kept</span>';
  const drop = '<span class="drop">dropped</span>';
  return `<div class="evidence">
    <div class="ecard"><h4>Value if it launches — terms tested (LOO)</h4>
      <div class="eline">flat median <b>${x2(t.flat)}</b> → size curve <b>${x2(t.size)}</b> → +priors <b>${x2(t.priors)}</b></div>
      <div class="eline">+ EB category (k=${MODEL.cat_shrink_k}) <b>${x2(t.curve)}</b> ${kept} · walk-fwd <b>${x2(v.walk.median_miss)}</b></div>
      <div class="eline">+ fitted 7d growth <b>${x2(t.growth)}</b> ${drop} · + fitted maturity <b>${x2(t.maturity)}</b> ${drop}</div></div>
    <div class="ecard"><h4>Token odds — Brier</h4>
      <div class="eline">base rate Brier <b>${baseBrier.toFixed(3)}</b> · logistic in-sample <b>${R.odds.brier_in.toFixed(3)}</b></div>
      <div class="eline">logistic leave-one-out <b>${R.odds.brier_loo.toFixed(3)}</b> ${kept}</div>
      <div class="eline">walk-forward <b>${R.odds.walk.brier.toFixed(3)}</b> vs base ${R.odds.walk.base_brier.toFixed(3)} (n=${R.odds.walk.test_n})</div></div>
    <div class="ecard"><h4>Is the printed range honest?</h4>
      <div class="bigstat">${v.band.coverage}% <span class="substat">(50% nom) · ${v.band.coverage80}% (80% nom)</span></div>
      <div class="eline">P25–P75: ${R.curve.band.p25.toFixed(3)}×–${R.curve.band.p75.toFixed(3)}× · P10–P90: ${R.curve.band.p10.toFixed(3)}×–${R.curve.band.p90.toFixed(3)}×</div>
      <div class="eline hi">curve+EB ${x2(v.curve.median_miss)} · global ${x2(v.global.median_miss)} · house ${x2(v.house.median_miss)}</div></div>
  </div>`;
}
function chartSvg(W = 620, H = 280) {
  const out = new Set(v.outliers.map((o) => o.slug));
  const pts = R.live.map((p) => ({ x: p.tvl_usd, y: p.mcap_usd, o: out.has(p.slug) }));
  const faint = R.rows.map((r) => ({ x: r.tvl_usd, y: r.implied_value_usd }));
  const xs = pts.concat(faint).map((p) => Math.log10(p.x));
  const ys = pts.concat(faint).map((p) => Math.log10(p.y));
  const x0 = Math.min(...xs) - 0.1, x1 = Math.max(...xs) + 0.1, y0 = Math.min(...ys) - 0.1, y1 = Math.max(...ys) + 0.1;
  const L = 42, B = 28, T = 10, Rr = 8;
  const sx = (val) => L + ((Math.log10(val) - x0) / (x1 - x0)) * (W - L - Rr);
  const sy = (val) => H - B - ((Math.log10(val) - y0) / (y1 - y0)) * (H - B - T);
  let grid = '';
  for (let p = Math.ceil(x0); p <= Math.floor(x1); p++) grid += `<line x1="${sx(10 ** p)}" y1="${T}" x2="${sx(10 ** p)}" y2="${H - B}" class="gl"/><text x="${sx(10 ** p)}" y="${H - 9}" class="tl" text-anchor="middle">10^${p}</text>`;
  for (let p = Math.ceil(y0); p <= Math.floor(y1); p++) grid += `<line x1="${L}" y1="${sy(10 ** p)}" x2="${W - Rr}" y2="${sy(10 ** p)}" class="gl"/><text x="${L - 4}" y="${sy(10 ** p) + 3}" class="tl" text-anchor="end">10^${p}</text>`;
  let line = '';
  for (let i = 0; i <= 40; i++) { const lx = x0 + ((x1 - x0) * i) / 40; const ly = v.curve.a + v.curve.b * lx; line += `${i ? 'L' : 'M'}${sx(10 ** lx).toFixed(1)},${sy(10 ** ly).toFixed(1)}`; }
  const dot = (p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.o ? 3 : 2.2}" class="${p.o ? 'od' : 'fd'}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="log-log scatter of TVL against market cap">${grid}<path d="${line}" class="fl"/>${faint.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="1.2" class="rd"/>`).join('')}${pts.map(dot).join('')}<text x="${W - 8}" y="${H - 9}" class="tl" text-anchor="end">TVL</text><text x="6" y="10" class="tl">mcap</text></svg>`;
}

function renderBoard() {
  view.innerHTML = `<div class="controls">
    <input type="search" id="q" placeholder="Search protocol" value="${esc(state.q)}" aria-label="Search protocol">
    <select id="cat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c)}"${c === state.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select id="chain" aria-label="Chain"><option value="">All chains</option>${chains.map((c) => `<option value="${esc(c)}"${c === state.chain ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <label class="slider">min TVL <input type="range" id="minTvl" min="0" max="${Math.ceil(maxTvl / 1e7) * 10}" step="5" value="${state.minTvl / 1e6}" aria-label="Minimum TVL in millions"><output id="minOut">${usd(state.minTvl)}</output></label>
    <label class="check"><input type="checkbox" id="watch"${state.watch ? ' checked' : ''}> watchlist</label>
    <label class="check"><input type="checkbox" id="grow"${state.grow ? ' checked' : ''}> 7d+</label>
    <label class="miniinp">pos <select id="posSel" aria-label="Position size">${[500, 1000, 5000, 10000].map((v2) => `<option value="${v2}"${v2 === state.pos ? ' selected' : ''}>${full(v2)}</option>`).join('')}</select></label>
    <label class="miniinp">drop <select id="shareSel" aria-label="Airdrop share">${[0.05, 0.07, 0.1].map((v2) => `<option value="${v2}"${v2 === state.share ? ' selected' : ''}>${Math.round(v2 * 100)}%</option>`).join('')}</select></label>
    <span class="vchips" id="vchips"></span>
    <span class="count" id="count"></span>
  </div>
  ${ribbon()}
  ${evidence()}
  <div class="strips"><div class="integrity" id="integrity"></div><div class="book" id="book"></div></div>
  <div class="wrap"><table><thead><tr>${COLS.map(([k, l, c]) => `<th data-k="${k}" class="${c}" aria-sort="none">${l}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div>
  <p class="note">Odds = logistic p(token) from TVL and age; expected = if-launch value × odds. Drop/$1k = expected × ${Math.round(MODEL.drop_share * 100)}% × $${commas(MODEL.deposit_usd)} ÷ TVL. Net if launch = drop − gas − $${MODEL.fee_usd}. Verdict: FARM above $0 net, MARGINAL above −$10, SKIP below. The range is expected value × held-out p25/p75 ratios.</p>`;
  const run = () => fill();
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; run(); });
  $('#cat').addEventListener('change', (e) => { state.cat = e.target.value; run(); });
  $('#chain').addEventListener('change', (e) => { state.chain = e.target.value; run(); });
  $('#minTvl').addEventListener('input', (e) => { state.minTvl = Number(e.target.value) * 1e6; $('#minOut').textContent = usd(state.minTvl); run(); });
  $('#watch').addEventListener('change', (e) => { state.watch = e.target.checked; run(); });
  $('#grow').addEventListener('change', (e) => { state.grow = e.target.checked; run(); });
  $('#posSel').addEventListener('change', (e) => { state.pos = Number(e.target.value); run(); });
  $('#shareSel').addEventListener('change', (e) => { state.share = Number(e.target.value); run(); });
  view.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.k; state.dir = state.key === k ? -state.dir : (k === 'rank' || k === 'name' ? 1 : -1); state.key = k; run(); }));
  fill();
  const I = integrity();
  $('#integrity').innerHTML = `<b>${I.ok} of ${R.rows.length}</b> rows recomputed here &middot; totals equal ${full(I.sum)} &middot; ledger ${I.L.total} = ${I.L.token_recorded} token + ${I.L.no_token} no token &middot; segments ${I.seg}`;
}

function fill() {
  const pre = preVerdict();
  const liveRow = (r) => (state.pos === MODEL.deposit_usd && state.share === MODEL.drop_share) ? r : (() => { const c = rec(r, state.pos, state.share); return { ...r, drop_per_1k_usd: c.drop, net_if_launch_usd: c.net, net_per_hour_usd: c.netHour }; })();
  const preLive = pre.map(liveRow);
  const counts = { all: preLive.length, farm: 0, marg: 0, skip: 0 };
  for (const r of preLive) counts[verdict(r)[1]]++;
  $('#vchips').innerHTML = [['all', 'All'], ['farm', 'Farm'], ['marg', 'Marginal'], ['skip', 'Skip']].map(([k, l]) => `<button class="vchip${state.verdict === k ? ' on' : ''}" data-v="${k}">${l} ${counts[k]}</button>`).join('');
  view.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { state.verdict = b.dataset.v; fill(); }));
  const rows = preLive.filter((r) => state.verdict === 'all' || verdict(r)[1] === state.verdict).sort((a, b) => {
    const va = a[state.key], vb = b[state.key];
    if (va === vb) return a.rank - b.rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (typeof va === 'string' ? cmp(va, vb) : va - vb) * state.dir;
  });
  const bits = [];
  if (state.cat) bits.push(state.cat);
  if (state.chain) bits.push(state.chain);
  if (state.minTvl > 0) bits.push(`TVL ≥ ${usd(state.minTvl)}`);
  if (state.watch) bits.push('watchlist only');
  if (state.grow) bits.push('7d growing');
  if (state.verdict !== 'all') bits.push(`${state.verdict} verdict`);
  if (state.pos !== MODEL.deposit_usd || state.share !== MODEL.drop_share) bits.push(`${full(state.pos)} @ ${Math.round(state.share * 100)}%`);
  if (state.q) bits.push(`“${state.q}”`);
  $('#count').innerHTML = `<b>${rows.length}</b> of ${R.rows.length} rows${bits.length ? ` &middot; <span class="flt">${esc(bits.join(' · '))}</span>` : ''}`;
  const topFarm = preLive.filter((r) => r.net_if_launch_usd > 0).sort((a, b) => b.net_if_launch_usd - a.net_if_launch_usd).slice(0, 5);
  const bkCap = topFarm.length * state.pos;
  const bkGas = topFarm.reduce((s, r) => s + r.gas_total_usd + MODEL.fee_usd, 0);
  const bkNet = topFarm.reduce((s, r) => s + r.net_if_launch_usd, 0);
  $('#book').innerHTML = topFarm.length
    ? `<b>TOP-${topFarm.length} FARM BOOK</b> (${full(state.pos)}/ea @ ${Math.round(state.share * 100)}%) &middot; capital ${full(bkCap)} &middot; cost ${one(bkGas)} &middot; est. net <b class="up">${full(bkNet)}</b> (${((bkNet / bkCap) * 100).toFixed(1)}%)`
    : `<b>FARM BOOK</b> &middot; no positive-net protocols in current filter`;
  view.querySelectorAll('th[data-k]').forEach((th) => {
    const on = th.dataset.k === state.key;
    th.classList.toggle('sorted', on);
    const baseLabel = th.dataset.k === 'drop_per_1k_usd' ? `Drop/${usd(state.pos)}` : COLS.find((c) => c[0] === th.dataset.k)[1];
    th.textContent = baseLabel + (on ? (state.dir > 0 ? ' ▲' : ' ▼') : '');
  });
  $('#rows').innerHTML = rows.length ? rows.map((r) => {
    const badge = `${r.watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">BELOW FLOOR</span>'}${r.missing.length ? `<span class="badge assume">${r.missing.length} missing</span>` : ''}`;
    const [vl, vc] = verdict(r);
    return `<tr tabindex="0" data-slug="${esc(r.slug)}">
      <td class="rank${r.rank <= 3 ? ' top' : ''}">${r.rank}</td>
      <td><span class="name">${esc(r.name)}</span>${badge}<div class="sub">${esc(r.category ?? 'no category')} · ${esc(r.chains[0] ?? 'no chain')}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</div></td>
      <td class="num">${usd(r.tvl_usd)}</td><td class="num delta">${pct(r.change_7d)}</td><td class="num">${age(r)}</td>
      <td class="num">${(r.odds * 100).toFixed(1)}%</td><td class="num">${usd(r.if_launch_usd)}</td>
      <td class="num"><div class="val">${usd(r.implied_value_usd)}</div><div class="ivl">${usd(r.low_usd)}–${usd(r.high_usd)}</div></td>
      <td class="num">${full(r.drop_per_1k_usd)}</td><td class="num ${r.net_if_launch_usd >= 0 ? 'up' : 'down'}">${full(r.net_if_launch_usd)}</td>
      <td class="num up">${one(r.net_per_hour_usd)}<span class="src">/h</span></td>
      <td class="num plan"><span class="vbadge ${vc}">${vl}</span> ${r.hold_days}d · ${r.plan.length}</td></tr>`;
  }).join('') : '<tr><td colspan="12" class="empty">No protocol matches these filters.</td></tr>';
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
  const c = rec(r);
  const peers = R.live.filter((p) => (p.category ?? '(none)') === (r.category ?? '(none)')).sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, 6);
  const peerRows = peers.length ? `<table class="mini"><tr><th>Tokenized peer</th><th class="num">Mcap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th></tr>${peers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${usd(p.mcap_usd)}</td><td class="num">${usd(p.tvl_usd)}</td><td class="num">${x(p.ratio)}</td></tr>`).join('')}</table>` : '<p class="note">No tokenized peer in this category.</p>';
  const a = r.age_assumed ? MODEL.age_assumed_days : r.age_days;
  const x1 = Math.log10(r.tvl_usd), x2v = Math.log10(1 + Math.min(a, MODEL.odds_max_age));
  const z = R.odds.beta[0] + R.odds.beta[1] * x1 + R.odds.beta[2] * x2v;
  detail.innerHTML = `
  <div class="dtop"><div class="who"><div class="drank">Rank ${r.rank} of ${R.rows.length} · ${r.watchlist ? 'on the watchlist' : 'below the floor'}</div>
    <h2 class="dtitle" id="d-title">${esc(r.name)}</h2>
    <div class="dsub">${esc(r.category ?? 'no category')} · ${esc(r.chains.slice(0, 5).join(', '))}${r.chains.length > 5 ? ` +${r.chains.length - 5}` : ''} · records no token in DefiLlama</div></div>
    <button class="dclose" id="dclose">Close ✕</button></div>
  <div class="dhero"><div class="dvalue"><div class="big">${full(r.implied_value_usd)} <span class="heroSub">expected</span></div>
    <div class="eq">${full(r.if_launch_usd)} if it launches × ${(r.odds * 100).toFixed(1)}% odds = ${full(r.implied_value_usd)} expected</div>
    <div class="note">if-launch = 10^(${v.curve.a.toFixed(3)} + ${v.curve.b.toFixed(3)}·logTVL ${(c.adj >= 0 ? '+' : '−')} ${Math.abs(c.adj).toFixed(3)} EB cat) × ${r.growth_mult.toFixed(3)} growth × ${r.maturity.toFixed(3)} maturity. Interval = expected × held-out ${r.ratio_lo.toFixed(3)}× / ${r.ratio_hi.toFixed(3)}×.<br>Recomputed here: <b>${full(c.implied)}</b>; the row says <b>${full(r.implied_value_usd)}</b> — ${c.implied === r.implied_value_usd ? 'match' : 'MISMATCH'}.</div></div>
    <div class="dband"><div class="lab">P25–P75 (${v.band.coverage}% cov) &amp; P10–P90 (${v.band.coverage80}% cov) interval</div>
      <div class="nums"><span>P25 <b>${usd(r.low_usd)}</b></span><span>expected <b>${usd(r.implied_value_usd)}</b></span><span>P75 <b>${usd(r.high_usd)}</b></span></div>${bandMarkup(r)}
      <div class="nums" style="margin-top:6px"><span class="mut">P10 ${usd(Math.max(1, Math.round(r.implied_value_usd * R.curve.band.p10)))}</span><span class="mut">${r.ratio_lo.toFixed(3)}×–${r.ratio_hi.toFixed(3)}×</span><span class="mut">P90 ${usd(Math.max(1, Math.round(r.implied_value_usd * R.curve.band.p90)))}</span></div></div></div>
  <div class="dcols"><div>
    <div class="card"><h3>Model inputs from the snapshot</h3><div class="rows">
      <div class="row"><div class="l"><span class="k">TVL</span><span class="e">tvl_usd</span></div><span class="v">${full(r.tvl_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">7d TVL change</span><span class="e">${r.change_7d === null ? 'not reported' : `${r.change_7d.toFixed(2)}%, counted ${r.growth_counted}%`}</span></div><span class="v">${pct(r.change_7d)} → ×${r.growth_mult.toFixed(3)}</span></div>
      <div class="row"><div class="l"><span class="k">No-token age</span><span class="e">${esc(r.age_basis)}</span></div><span class="v">${r.age_days}d</span></div>
      <div class="row"><div class="l"><span class="k">Curve + EB cat</span><span class="e">10^(a + b·logTVL + ${(c.adj >= 0 ? '+' : '') + c.adj.toFixed(4)})</span></div><span class="v">${full(r.base_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">If it launches</span><span class="e">base × growth × maturity</span></div><span class="v">${full(r.if_launch_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Expected value</span><span class="e">if launches × token odds</span></div><span class="v acc">${full(r.implied_value_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Drop / $1k</span><span class="e">expected × ${Math.round(MODEL.drop_share * 100)}% × $1,000 ÷ TVL</span></div><span class="v">${full(r.drop_per_1k_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Net if launch</span><span class="e">drop − ${one(r.gas_total_usd)} gas − $${MODEL.fee_usd} fee</span></div><span class="v">${full(r.net_if_launch_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Net $/h</span><span class="e">net if launch ÷ ${r.hold_days}d hold</span></div><span class="v">${one(r.net_per_hour_usd)}</span></div>
      <div class="row"><div class="l"><span class="k">Break-even drop share</span><span class="e">min % of supply to cover gas + $${MODEL.fee_usd} fee</span></div><span class="v">${(((r.gas_total_usd + MODEL.fee_usd) * r.tvl_usd) / (r.implied_value_usd * MODEL.deposit_usd) * 100).toFixed(2)}%</span></div>
    </div></div>
  </div><div>
    <div class="card"><h3>Token odds inputs</h3><div class="rows">
      <div class="row"><div class="l"><span class="k">x1 = log10(TVL)</span><span class="e">${full(r.tvl_usd)}</span></div><span class="v">${x1.toFixed(3)}</span></div>
      <div class="row"><div class="l"><span class="k">x2 = log10(1 + min(age, ${MODEL.odds_max_age}))</span><span class="e">${r.age_days}d ${r.age_assumed ? '(assumed)' : ''}</span></div><span class="v">${x2v.toFixed(3)}</span></div>
      <div class="row"><div class="l"><span class="k">β0, β1, β2</span><span class="e">IRLS logistic, 30 fixed iterations</span></div><span class="v">${R.odds.beta.map((z2) => z2.toFixed(3)).join(', ')}</span></div>
      <div class="row"><div class="l"><span class="k">z = β0 + β1x1 + β2x2</span><span class="e">p = 1 / (1 + e^−z)</span></div><span class="v acc">${z.toFixed(3)} → ${(r.odds * 100).toFixed(1)}%</span></div>
    </div><p class="note">This is a cross-sectional base rate from the snapshot, not a forecast that a token launches.</p></div>
    <div class="card"><h3>Row recomputation</h3><p class="note">10^${v.curve.a.toFixed(3)} · ${full(r.tvl_usd)}^${v.curve.b.toFixed(3)} × ${r.growth_mult.toFixed(3)} × ${r.maturity.toFixed(3)} × ${(r.odds * 100).toFixed(1)}% = <b>${full(c.implied)}</b>; the row says <b>${full(r.implied_value_usd)}</b> — ${c.implied === r.implied_value_usd ? 'match' : 'MISMATCH'}.</p></div>
    <div class="card"><h3>Out-of-sample check</h3><p class="note">Value curve ${x2(v.curve.median_miss)} miss, ${v.curve.within_2x}% within 2×; global ${x2(v.global.median_miss)}; house ${x2(v.house.median_miss)}; range covers ${v.band.coverage}%; walk-forward ${x2(v.walk.median_miss)} on n=${v.walk.test_n}. Odds Brier ${R.odds.brier_loo.toFixed(3)} vs base ${baseBrier.toFixed(3)}; walk ${R.odds.walk.brier.toFixed(3)} vs ${R.odds.walk.base_brier.toFixed(3)}.</p></div>
    <div class="card"><h3>Tokenized peers in ${esc(r.category ?? 'this category')}</h3>${peerRows}</div>
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
  const c = R.counts, t = R.terms, o = R.odds;
  const status = (n, cut) => n <= cut ? '<span class="keep">kept</span>' : '<span class="drop">dropped</span>';
  const termRows = [
    ['Flat global median multiple', t.flat, '<span class="drop">baseline</span>'],
    ['Log-log size curve (TVL)', t.size, '<span class="keep">kept</span>'],
    ['+ stated growth & maturity priors', t.priors, '<span class="keep">kept</span>'],
    [`+ EB category shrinkage (k=${MODEL.cat_shrink_k})`, t.curve, '<span class="keep">kept</span>'],
    ['+ fitted 7-day growth', t.growth, status(t.growth, t.curve)],
    ['+ fitted maturity', t.maturity, status(t.maturity, t.curve)],
  ].map(([n, m, s]) => `<tr><td>${n}</td><td class="num">${x2(m)}</td><td>${s}</td></tr>`).join('');
  const catRows = R.categories.filter((k) => k.n >= 5).sort((a, b) => b.n - a.n || cmp(a.name, b.name)).map((k) => `<tr><td>${esc(k.name)}</td><td class="num">${k.n}</td><td class="num">${x(k.median)}</td><td class="num">${k.rows}</td></tr>`).join('');
  const outRows = v.outliers.map((q) => `<tr><td>${esc(q.name)}</td><td class="sub">${esc(q.category ?? 'none')}</td><td class="num">${q.ratio}</td><td class="num">${usd(q.tvl_usd)}</td></tr>`).join('');
  const modelRow = (name, s) => `<tr><td>${name}</td><td class="num">${x2(s.median_miss)}</td><td class="num">${s.within_2x}%</td><td class="num">${s.within_3x}%</td><td class="num">${s.spearman}</td></tr>`;
  view.innerHTML = `<div class="prose">
  <h2>Two fitted models, one expected value</h2>
  <div class="formula">
    <div>if-launch = 10^(${v.curve.a.toFixed(4)} + ${v.curve.b.toFixed(4)}·logTVL + δ<sub>cat</sub>) × growth × maturity <span>OLS on ${v.fit_n} tokenized (b 90% boot CI: ${v.curve.boot.b_lo}–${v.curve.boot.b_hi}, n=${v.curve.boot.n})</span></div>
    <div>odds = 1 / (1 + e^−z), z = ${o.beta[0].toFixed(3)} + ${o.beta[1].toFixed(4)}·log10(TVL) + ${o.beta[2].toFixed(4)}·log10(1 + min(age, ${MODEL.odds_max_age}))</div>
    <div>expected = max(1, round(if-launch × odds)); range = expected × held-out p25/p75 ratios</div>
    <div>growth = 1 + clamp(change_7d, ${MODEL.growth_lo}, ${MODEL.growth_hi})/100 × ${MODEL.growth_weight}; maturity = ${MODEL.maturity_base} + min(age, ${MODEL.maturity_days})/${MODEL.maturity_days} × ${MODEL.maturity_span}</div>
  </div>
  <div class="mgrid"><div>
    <div class="card"><h3>Terms tested, held out</h3><table class="mtab"><tr><th>Model</th><th class="num">Median miss</th><th>Decision</th></tr>${termRows}</table>
      <p class="note">The flat multiple misses ${x2(t.flat)}; the curve and stated priors miss ${x2(t.curve)}. Fitting growth freely gives ${x2(t.growth)} and fitting maturity freely ${x2(t.maturity)} — both worse than the priors, so growth ${MODEL.growth_weight} and maturity ${MODEL.maturity_base}–1.00 stay as stated priors. n=${t.n}.</p></div>
    <div class="card"><h3>Token odds, Brier against the base rate</h3><table class="mtab"><tr><th>Block</th><th class="num">Logistic</th><th class="num">Base rate</th></tr>
      <tr><td>In-sample</td><td class="num">${o.brier_in.toFixed(3)}</td><td class="num">${baseBrier.toFixed(3)}</td></tr>
      <tr><td>Leave-one-out</td><td class="num">${o.brier_loo.toFixed(3)}</td><td class="num">${baseBrier.toFixed(3)}</td></tr>
      <tr><td>Walk-forward n=${o.walk.test_n}</td><td class="num">${o.walk.brier.toFixed(3)}</td><td class="num">${o.walk.base_brier.toFixed(3)}</td></tr></table>
      <p class="note">Base rate ${(o.base_rate * 100).toFixed(1)}%. Fit on the older ${o.walk.train_n} dated protocols, tested on the newer ${o.walk.test_n}. It is a cross-sectional base rate, not a forecast that a token launches. ${o.brier_loo < baseBrier ? 'Kept: the logistic beats the base rate.' : 'Not kept: it does not beat the base rate.'}</p></div>
  </div><div>
    <div class="card"><h3>Value model, three ways</h3><table class="mtab"><tr><th>Model</th><th class="num">Miss</th><th class="num">≤2×</th><th class="num">≤3×</th><th class="num">Spearman</th></tr>${modelRow('Comps curve', v.curve)}${modelRow('Global median', v.global)}${modelRow('House model', v.house)}</table>
      <p class="note">Scored on ${v.clean_n} clean ratios; baselines on all ${v.fit_n}. Walk-forward value: older ${v.walk.train_n} → newer ${v.walk.test_n}, miss ${x2(v.walk.median_miss)}. The ${v.outlier_n} flagged ratios are excluded from the score and interval but kept in the curve fit to anchor the high-TVL end.</p></div>
    <div class="card"><h3>Category medians, cross-check only</h3><table class="mtab"><tr><th>Category</th><th class="num">n</th><th class="num">Median</th><th class="num">Rows</th></tr>${catRows}</table><p class="note">Categories with n≥5 only. The point estimate uses the curve; these medians show the spread a single constant would miss.</p></div>
  </div><div>
    <div class="card"><h3>Log-log comps and the fitted curve</h3>${chartSvg()}<div class="plegend"><i class="ld"></i> tokenized mcap/TVL <i class="lr"></i> ranked expected <i class="lo"></i> flagged ratio</div><div class="rline">Range: P25 ${R.curve.band.p25.toFixed(3)}× – P75 ${R.curve.band.p75.toFixed(3)}× · ${v.band.coverage}% of held-out actuals inside, stated 50%.</div></div>
    <div class="card"><h3>Seven flagged ratio outliers</h3><table class="mtab"><tr><th>Protocol</th><th>Category</th><th class="num">Mcap/TVL</th><th class="num">TVL</th></tr>${outRows}</table><p class="note">Outside [${MODEL.ratio_lo}, ${MODEL.ratio_hi}]. Refitting without them gives a=${v.curve.filtered_a.toFixed(3)}, b=${v.curve.filtered_b.toFixed(3)} and predicts high-TVL protocols far too low.</p></div>
  </div></div></div>`;
}

const TABS = { board: renderBoard, live: renderLive, aside: renderAside, method: renderMethod };
function selectTab(name) { document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name))); TABS[name](); }
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
document.addEventListener('click', (e) => { if (e.target.id === 'goMethod') selectTab('method'); });
renderBoard();
window.__RADAR_READY = true;
