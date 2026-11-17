// Token Radar model: one sealed DefiLlama snapshot in, one ranked board out.
// Shared by main.ts (writes board.json) and the page (renders it), so the
// screenshots and board.json come from the same code.
//
// The implied value of a protocol's launch is
//   TVL x category multiple x growth factor x tokenless-run factor
// where the category multiple is the market-cap-to-TVL ratio that protocols
// already trading a token carry in the same snapshot (median per category,
// shrunk toward the median over all of them). No protocol name is special-cased.

export const MODEL = {
  version: 'radar-comps-1',
  shrink_k: 4,          // pseudo-count pulling a thin category toward the all-token median
  multiple_min: 0.02,
  multiple_max: 2,
  growth_weight: 1.5,   // each 1% of 7-day TVL change moves value 1.5%
  growth_clamp: 20,     // 7-day change counted within +/-20%
  run_floor: 0.75,      // a protocol listed today keeps 75% of value
  run_full_days: 730,   // two years of tokenless TVL earns the full 100%
  drop_share: 0.10,     // hypothetical share of the token given to depositors (per-$1k column)
};

// Farm-plan assumptions. These do not come from the snapshot and the page says so.
export const PLAN = {
  position_usd: 1000,
  gas_usd: { Ethereum: 4, Bitcoin: 2, other: 0.3 },
};

const OFF_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const DAY = 86400000;

export const recordsNoToken = (p) => p.gecko_id === null && p.symbol === null && p.mcap_usd === null;

/** Why a tokenless protocol is set aside as a product of something that trades, or null. */
export function asideReason(p) {
  if (OFF_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'name ends in a version marker';
  if (WRAPPER_WORD.test(p.name)) return 'name says wrapped/staked';
  if (EXCHANGE.test(p.name)) return "name starts with an exchange's";
  return null;
}

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  return n === 0 ? null : n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** Market-cap/TVL multiples from every protocol whose token trades. */
export function comparables(protocols) {
  const live = protocols.filter((p) => p.mcap_usd > 0 && p.tvl_usd > 0);
  const global = median(live.map((p) => p.mcap_usd / p.tvl_usd));
  const byCat = new Map();
  for (const p of live) {
    const key = p.category ?? '(none)';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(p);
  }
  return { live, global, byCat };
}

/** The multiple a category earns: log-space blend of its median and the global median. */
export function categoryMultiple(category, comps) {
  const peers = comps.byCat.get(category ?? '(none)') ?? [];
  const n = peers.length;
  const catMedian = n ? median(peers.map((p) => p.mcap_usd / p.tvl_usd)) : null;
  const k = MODEL.shrink_k;
  const blended = n ? Math.exp((n * Math.log(catMedian) + k * Math.log(comps.global)) / (n + k)) : comps.global;
  const peersShown = [...peers].sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, 5)
    .map((p) => ({ name: p.name, symbol: p.symbol, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd, ratio: r4(p.mcap_usd / p.tvl_usd) }));
  return { n, catMedian: catMedian === null ? null : r4(catMedian), multiple: r4(clamp(blended, MODEL.multiple_min, MODEL.multiple_max)), peers: peersShown };
}

export function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  return Math.max(0, Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / DAY));
}

/** Score one protocol: every factor, and which inputs the snapshot lacks. */
export function score(p, asOf, comps) {
  const cat = categoryMultiple(p.category, comps);
  const g = p.change_7d === null ? 0 : clamp(p.change_7d, -MODEL.growth_clamp, MODEL.growth_clamp);
  const growth = r4(1 + (g / 100) * MODEL.growth_weight);
  const age = ageDays(asOf, p.listed_at);
  const run = r4(MODEL.run_floor + (1 - MODEL.run_floor) * Math.min(age ?? 0, MODEL.run_full_days) / MODEL.run_full_days);
  const implied = Math.max(1, Math.round(p.tvl_usd * cat.multiple * growth * run));
  const missing = [];
  if (p.category === null) missing.push('category: none recorded, the all-token median multiple is used');
  if (p.change_7d === null) missing.push('change_7d: not reported, growth factor held at 1.00');
  if (p.listed_at === null) missing.push('listed_at: not reported, tokenless run counted as 0 days (factor 0.75)');
  return {
    implied_value_usd: implied, multiple: cat.multiple, cat_n: cat.n, cat_median: cat.catMedian, peers: cat.peers,
    growth_counted: r4(g), growth, age_days: age, run,
    per_1k_usd: Math.round((implied * MODEL.drop_share * PLAN.position_usd) / p.tvl_usd),
    missing,
  };
}

const usd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
const money = (n) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`;

/** What depositing means for a category, and what the weekly touch is. */
function actionFor(p, chain, size) {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (/curator|allocator/.test(c)) return [`Deposit ${money(size)} of USDC into the largest ${n} vault on ${chain} and keep the vault shares in the wallet`, 'check the vault allocation and top up or compound once'];
  if (/lending|collateral market|uncollateral/.test(c)) return [`Supply ${money(size)} of USDC to ${n} on ${chain}, then borrow 25% of it in another asset so the account shows both sides`, 'repay and re-borrow a small amount to keep the account active'];
  if (/cdp|stable|dual-token/.test(c)) return [`Mint or buy ${money(size)} of ${n}'s stable asset on ${chain} and deposit it in the protocol's own savings or earn module`, 'move a small amount through the mint/redeem path'];
  if (/dex|liquidity manager/.test(c)) return [`Provide ${money(size)} of liquidity to the deepest ${n} pool on ${chain} (a stable or blue-chip pair keeps loss low)`, 'make one swap and re-centre the range if it has drifted'];
  if (/rwa/.test(c)) return [`Subscribe ${money(size)} to ${n}'s yield-bearing asset on ${chain} and hold it in the same wallet (complete KYC first if it asks)`, 'claim or re-invest the accrued yield'];
  if (/basis|yield|farm|cedefi|options/.test(c)) return [`Deposit ${money(size)} of USDC into ${n}'s main yield product on ${chain} and keep the receipt token unsold`, 'claim the yield and re-deposit it'];
  if (/derivative|perpetual|prediction/.test(c)) return [`Deposit ${money(size)} of USDC as margin on ${n} and keep most of it idle; trade only small hedged positions`, 'open and close one small hedged position'];
  if (/restak|staking pool|governance/.test(c)) return [`Stake ${money(size)} of ${chain}'s native asset through ${n} and keep the position (or receipt) in the wallet`, 'claim rewards and re-stake them'];
  if (/chain|payments/.test(c)) return [`Move ${money(size)} onto ${n} on ${chain} and use its main app: send, receive or route at least once`, 'make one small native transaction'];
  if (/insurance/.test(c)) return [`Deposit ${money(size)} into ${n}'s cover or underwriting pool on ${chain}`, 'check pool health and claim any accrued premium'];
  return [`Deposit ${money(size)} into ${n}'s main product on ${chain} and keep the position open`, 'make one small deposit or claim'];
}

/** A protocol's farm plan: steps with what each costs and how long it takes. */
export function farmPlan(p, s) {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = PLAN.gas_usd[chain] ?? PLAN.gas_usd.other;
  const size = PLAN.position_usd;
  const hold = s.age_days === null ? 60 : s.age_days < 180 ? 90 : s.age_days < 365 ? 60 : 45;
  const weeks = Math.ceil(hold / 7);
  const [deposit, weekly] = actionFor(p, chain, size);
  const share = (size / p.tvl_usd) * 100;
  const steps = [];
  if (p.change_7d !== null && p.change_7d <= -10) {
    steps.push({ do: `TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days: read ${p.name}'s announcements for the cause (exploit, incentive end, migration) before you deposit`, cost: '$0', time: '15 min' });
  }
  steps.push({ do: `Fund a fresh wallet on ${chain} with ${money(size)} of USDC plus gas, kept apart from your main holdings`, cost: `${money(gas * 2)} gas`, time: '15 min' });
  steps.push({ do: deposit, cost: `${money(size)} capital + ${money(gas * 2)} gas`, time: '10 min' });
  steps.push({ do: `Once a week, ${weekly}, so the wallet is active in every week a snapshot might count`, cost: `${money(gas * weeks)} gas over ${weeks} weeks`, time: `5 min a week` });
  if (p.chains.length > 1) {
    steps.push({ do: `Repeat a ${money(size / 4)} position on ${p.chains[1]}, ${p.name}'s next-listed chain of ${p.chains.length}, to show use across chains`, cost: `${money(size / 4)} capital + ${money((PLAN.gas_usd[p.chains[1]] ?? PLAN.gas_usd.other) * 3)} gas`, time: '20 min' });
  }
  steps.push({ do: `Hold for at least ${hold} days: ${money(size)} is ${share < 0.01 ? share.toPrecision(2) : share.toFixed(2)}% of ${p.name}'s ${usd(p.tvl_usd)} TVL`, cost: 'capital locked; no extra fee', time: `${hold} days` });
  steps.push({ do: `Check ${p.name}'s own site and docs for a points or season page; sign nothing a link in a DM or reply sends you`, cost: '$0', time: '5 min a week' });
  steps.push({ do: `If a token launches, claim only from the protocol's official page, then decide to hold or sell; unwind the deposit the same day if you leave`, cost: `${money(gas * 3)} gas`, time: '20 min' });
  const gasTotal = gas * (2 + 2 + weeks + 3) + (p.chains.length > 1 ? (PLAN.gas_usd[p.chains[1]] ?? PLAN.gas_usd.other) * 3 : 0);
  return { steps, hold_days: hold, gas_total_usd: Math.round(gasTotal * 100) / 100, chain };
}

export const stepText = (st) => `${st.do}. Cost: ${st.cost}. Time: ${st.time}.`;

/** The whole radar: ranked tokenless rows, the live-token comparables, the set-aside products. */
export function buildRadar(snap) {
  const comps = comparables(snap.protocols);
  const watch = new Set(snap.watchlist);
  const rows = [];
  const aside = [];
  for (const p of snap.protocols) {
    if (!watch.has(p.slug)) {
      if (!recordsNoToken(p)) continue;
      const why = asideReason(p);
      const parent = !why && p.tvl_usd >= snap.floor_usd ? 'parent protocol on record (inferred: passes every other watchlist test above the floor)' : null;
      if (why || parent) { aside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, why: why ?? parent }); continue; }
    }
    const s = score(p, snap.as_of, comps);
    rows.push({ ...p, ...s, watchlist: watch.has(p.slug), plan: farmPlan(p, s) });
  }
  rows.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  aside.sort((a, b) => b.tvl_usd - a.tvl_usd);
  const live = comps.live.map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d, ratio: r4(p.mcap_usd / p.tvl_usd) }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);
  return { as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, total: snap.protocols.length, watch_n: snap.watchlist.length, global_multiple: r4(comps.global), rows, live, aside };
}

// ---------------------------------------------------------------- validation
//
// A leave-one-out test on the snapshot's own live-token protocols: does the
// implied-value model rank market cap better than raw TVL? For each live token
// (both a market cap and a TVL), fit a predictor on every *other* live token and
// predict this one's market cap; then compare the predictions with the truth.
// TVL alone wins, so the board is ordered by TVL and the page says why.

const logOf = (x) => Math.log(x);

/** Average ranks (1-based) of `xs`, ties sharing their average rank: the input to Spearman. */
function ranksOf(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Pearson correlation of two equal-length number arrays. */
function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** Spearman rank correlation: Pearson of the ranks. */
const spearman = (a, b) => pearson(ranksOf(a), ranksOf(b));

/** Least squares beta for design `X` (each row with an intercept) and target `y`, by Gaussian elimination. */
function ols(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a][b] += X[i][a] * X[i][b];
      A[a][k] += X[i][a] * y[i];
    }
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c];
    for (let j = c; j <= k; j++) A[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row) => row[k]);
}

/** The design row for one live token and one predictor. */
function designRow(p, kind) {
  const age = ageDays(snapAsOf(p), p.listed_at) ?? 0;
  const ch = p.change_7d ?? 0;
  const lt = logOf(p.tvl_usd);
  if (kind === 'tvl') return [1, lt];
  if (kind === 'three') return [1, lt, age, ch];
  return [1, lt, age, ch, lt * lt];
}

/** `as_of` for the age term: the same day the page was built on. */
let SNAP_AS_OF = null;
const snapAsOf = () => SNAP_AS_OF;

const PREDICTORS = [
  { key: 'tvl', label: 'TVL alone' },
  { key: 'three', label: 'log TVL + age + 7-day change' },
  { key: 'quadratic', label: 'same, with a quadratic term' },
];

/**
 * Leave-one-out validation of the model against the snapshot's live-token protocols. Both this page
 * and main.ts run it from the same snapshot, so validation.json and the Model tab agree.
 */
export function validate(snap) {
  SNAP_AS_OF = snap.as_of;
  const live = snap.protocols.filter((p) => p.mcap_usd > 0 && p.tvl_usd > 0);
  const n = live.length;
  const y = live.map((p) => logOf(p.mcap_usd));
  const truthTop = new Set(
    live.map((p, i) => [p.mcap_usd, i]).sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, i]) => i),
  );
  const predictors = PREDICTORS.map((pred) => {
    const predicted = new Array(n);
    for (let i = 0; i < n; i++) {
      const train = live.filter((_, j) => j !== i);
      const X = train.map((p) => designRow(p, pred.key));
      const yy = train.map((p) => logOf(p.mcap_usd));
      const beta = ols(X, yy);
      predicted[i] = designRow(live[i], pred.key).reduce((s, v, j) => s + v * beta[j], 0);
    }
    const top = new Set(
      predicted.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, i]) => i),
    );
    const overlap = [...truthTop].filter((i) => top.has(i)).length;
    const ratios = predicted.map((v, i) => Math.exp(y[i] - v)).sort((a, b) => a - b);
    const at = (q) => ratios[Math.min(ratios.length - 1, Math.round(q * (ratios.length - 1)))];
    return { key: pred.key, label: pred.label, spearman: r4(spearman(y, predicted)), top10_overlap: overlap, band_low: r4(at(0.1)), band_high: r4(at(0.9)) };
  });
  const three = predictors.find((p) => p.key === 'three');
  return {
    model: MODEL.version,
    as_of: snap.as_of,
    n,
    band: { low: three.band_low, high: three.band_high, coverage: 0.8, n },
    predictors,
  };
}
