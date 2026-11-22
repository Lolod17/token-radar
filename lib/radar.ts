// Token Radar model: the sealed snapshot in, the ranked radar out.
// mcap ~= 10^a * TVL^b is fitted on the tokenized protocols; implied value is
// curve(TVL) x growth x maturity, with the interval from held-out ratios.
//   growth   = 1 + clamp(change_7d, -60, 120)/100 x 0.35
//   maturity = 0.55 + min(age_days, 1095)/1095 x 0.45
//   implied  = max(1, round(curve(TVL) x growth x maturity))
//   low/high = implied x p25/p75 of actual mcap / predicted implied, held out

import { MODEL, PLAN } from '../dashboard/model.js';

const DAY_MS = 86400000;
const CATEGORY_WRAPPER = /^(Bridge|Canonical Bridge|Cross Chain Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|Restaking|CEX|Stablecoin Wrapper)$/i;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORD = /(\bwrapped\b|\bstaked\b|\bstaking\b|\brestaked\b|steth|reth|seth)/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

const round = (x, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** A quantile by linear interpolation on an ascending copy. */
export function quantile(values, p) {
  if (values.length === 0) return 0;
  const a = [...values].sort((x, y) => x - y);
  const at = (a.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, a.length - 1);
  return a[lo] + (a[hi] - a[lo]) * (at - lo);
}

/** A protocol records no token when DefiLlama carries no CoinGecko id, symbol or market cap. */
export const recordsNoToken = (p) => p.gecko_id === null && p.symbol === null && p.mcap_usd === null;

/** A tokenized protocol is one the market already prices: positive mcap and TVL. */
export const isTokenized = (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;

/** Fit the category medians; the comps curve, not these, sets the point estimate. */
export function fitMultiples(protocols) {
  const live = protocols.filter(isTokenized);
  const ratios = live.map((p) => p.mcap_usd / p.tvl_usd);
  const global = {
    n: live.length,
    p25: round(quantile(ratios, 0.25)),
    median: round(quantile(ratios, 0.5)),
    p75: round(quantile(ratios, 0.75)),
  };
  const grouped = new Map();
  for (const p of live) {
    const key = p.category ?? '(none)';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
  }
  const categories = new Map();
  for (const [name, peers] of grouped) {
    if (peers.length < MODEL.min_peers) continue;
    const rs = peers.map((p) => p.mcap_usd / p.tvl_usd);
    categories.set(name, {
      n: peers.length,
      p25: round(quantile(rs, 0.25)),
      median: round(quantile(rs, 0.5)),
      p75: round(quantile(rs, 0.75)),
    });
  }
  return { live, ratios, global, categories };
}

/** OLS of log10(mcap) on log10(tvl): mcap ~= 10^a * tvl^b. */
export function logFit(ps) {
  const xs = ps.map((p) => Math.log10(p.tvl_usd));
  const ys = ps.map((p) => Math.log10(p.mcap_usd));
  const n = xs.length;
  if (n < 2) return { a: 0, b: 1, n };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const b = den === 0 ? 0 : num / den;
  return { a: my - b * mx, b, n };
}

/** Fit the comps curve + Empirical-Bayes category residual shrinkage (k=12).
 * Seven ratios outside [0.005, 50] are flagged and excluded from scoring (121 of 128). */
export function fitCurve(protocols, asOf) {
  const live = protocols.filter(isTokenized);
  const inWindow = (p) => {
    const r = p.mcap_usd / p.tvl_usd;
    return r >= MODEL.ratio_lo && r <= MODEL.ratio_hi;
  };
  const clean = live.filter(inWindow);
  const outliers = live.filter((p) => !inWindow(p)).map((p) => ({
    slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd, ratio: round(p.mcap_usd / p.tvl_usd, 6),
  }));
  const fitCatAdj = (train, f) => {
    const byCat = new Map();
    for (const q of train) {
      const c = q.category ?? '(none)';
      const res = Math.log10(q.mcap_usd) - (f.a + f.b * Math.log10(q.tvl_usd));
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(res);
    }
    const adj = {};
    for (const [c, rs] of byCat) {
      const mean = rs.reduce((s, v) => s + v, 0) / (rs.length + MODEL.cat_shrink_k);
      adj[c] = round(mean, 5);
    }
    return adj;
  };
  const fit = logFit(live);
  const filtered = logFit(clean);
  const catAdj = fitCatAdj(live, fit);
  const predict = (tvl, category) => {
    const adj = catAdj[category ?? '(none)'] ?? 0;
    return 10 ** (fit.a + fit.b * Math.log10(tvl) + adj);
  };
  const ratios = [];
  const curvePreds = [];
  for (const p of clean) {
    const tr = live.filter((x) => x !== p);
    const f = logFit(tr);
    const cAdj = fitCatAdj(tr, f);
    const adj = cAdj[p.category ?? '(none)'] ?? 0;
    const pred = 10 ** (f.a + f.b * Math.log10(p.tvl_usd) + adj) * growthFactor(p) * maturityFactor(p, asOf);
    ratios.push(p.mcap_usd / pred);
    curvePreds.push(pred);
  }
  const band = {
    n: ratios.length,
    p10: round(quantile(ratios, 0.1)),
    p25: round(quantile(ratios, 0.25)),
    p75: round(quantile(ratios, 0.75)),
    p90: round(quantile(ratios, 0.9)),
  };
  // Deterministic seeded bootstrap (200 resamples) for 90% CI on curve slope b and intercept a.
  let seed = 20261122;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bootA = [];
  const bootB = [];
  for (let t = 0; t < 200; t++) {
    const sample = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(nextRand() * live.length)]);
    const bf = logFit(sample);
    bootA.push(bf.a);
    bootB.push(bf.b);
  }
  const boot = {
    n: 200,
    a_lo: round(quantile(bootA, 0.05), 3),
    a_hi: round(quantile(bootA, 0.95), 3),
    b_lo: round(quantile(bootB, 0.05), 3),
    b_hi: round(quantile(bootB, 0.95), 3),
  };
  return { live, clean, outliers, fit, filtered, catAdj, fitCatAdj, predict, ratios, curvePreds, band, boot };
}

/** Days between the snapshot day and the day DefiLlama began tracking the protocol. */
export function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  const parse = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
    return Date.UTC(y, m - 1, d);
  };
  const a = parse(asOf);
  const b = parse(listedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export const growthFactor = (p) => round(1 + (clamp(p.change_7d ?? 0, MODEL.growth_lo, MODEL.growth_hi) / 100) * MODEL.growth_weight);
export const maturityFactor = (p, asOf) => {
  const age = ageDays(asOf, p.listed_at) ?? MODEL.age_assumed_days;
  return round(MODEL.maturity_base + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_span);
};

/** Why a tokenless protocol is set aside as a product of something that trades, or null. */
export function asideReason(p) {
  if (p.category !== null && CATEGORY_WRAPPER.test(p.category)) {
    return { code: 'wrapper-category', text: `category ${p.category}: a bridge, staking or exchange wrapper rather than a first token` };
  }
  if (VERSIONED.test(p.name)) return { code: 'versioned', text: 'name ends in a version marker, so it is a later version of an existing product' };
  if (WRAPPER_WORD.test(p.name)) return { code: 'wrapper-name', text: 'name records itself as wrapped, staked or staking' };
  if (EXCHANGE.test(p.name)) return { code: 'exchange', text: "name begins with an exchange's, so it is an exchange product" };
  return null;
}

/** Score one tokenless protocol: if-launch value from the curve, times token odds. */
export function score(p, asOf, curve, odds) {
  const counted = clamp(p.change_7d ?? 0, MODEL.growth_lo, MODEL.growth_hi);
  const growth = growthFactor(p);
  const actualAge = ageDays(asOf, p.listed_at);
  const assumed = actualAge === null;
  const age = assumed ? MODEL.age_assumed_days : actualAge;
  const maturity = maturityFactor(p, asOf);
  const base = curve.predict(p.tvl_usd, p.category);
  const catAdj = curve.catAdj[p.category ?? '(none)'] ?? 0;
  const ifLaunch = Math.max(MODEL.value_floor_usd, Math.round(base * growth * maturity));
  const implied = Math.max(MODEL.value_floor_usd, Math.round(ifLaunch * odds));
  const low = Math.max(MODEL.value_floor_usd, Math.round(implied * curve.band.p25));
  const high = Math.max(MODEL.value_floor_usd, Math.round(implied * curve.band.p75));
  const missing = [];
  if (p.category === null) missing.push('category: not recorded; EB category adjustment held at 0');
  if (p.change_7d === null) missing.push('change_7d: not reported, the growth factor is held at 1.000');
  if (p.listed_at === null) missing.push(`listed_at: not reported, age is assumed to be ${MODEL.age_assumed_days} days (maturity ${maturity.toFixed(3)})`);
  return {
    growth_counted: round(counted),
    growth_mult: growth,
    maturity,
    age_days: age,
    age_assumed: assumed,
    age_basis: assumed ? `assumed ${MODEL.age_assumed_days} days: listed_at is not reported` : `${age} days since DefiLlama began tracking it`,
    cat_adj: catAdj,
    base_usd: Math.round(base),
    odds: round(odds, 4),
    if_launch_usd: ifLaunch,
    curve_ratio: round(base / p.tvl_usd, 6),
    ratio_lo: curve.band.p25,
    ratio_hi: curve.band.p75,
    implied_value_usd: implied,
    low_usd: low,
    high_usd: high,
    missing,
  };
}

// ---------------------------------------------------------------- farm plans

const money = (n) => {
  const v = Math.abs(n) < 1 ? n.toFixed(2) : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${v}`;
};
const usdShort = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`;
const shareOfTvl = (size, tvl) => {
  const pct = (size / tvl) * 100;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  if (pct >= 0.0001) return `${pct.toFixed(4)}%`;
  return `${pct.toPrecision(2)}%`;
};

function familyOf(category) {
  const c = (category ?? '').toLowerCase();
  if (/risk curator|allocator|asset management|index/.test(c)) return 'vault';
  if (/lending|collateral market|uncollateral/.test(c)) return 'lending';
  if (/cdp|stable|dual-token/.test(c)) return 'stable';
  if (/dex|liquidity manager|leveraged farming/.test(c)) return 'dex';
  if (/anchor btc|decentralized btc|btc/.test(c)) return 'btc';
  if (/rwa|real.world/.test(c)) return 'rwa';
  if (/restak|staking pool/.test(c)) return 'staking';
  if (/chain|payments|crypto card/.test(c)) return 'chain';
  if (/insurance/.test(c)) return 'insurance';
  if (/derivative|prediction|option/.test(c)) return 'derivatives';
  return 'yield';
}

const FAMILY = {
  vault: {
    noun: 'vault', cooldown: 2,
    deposit: (n, c) => `Deposit ${money(PLAN.position_usd)} USDC into ${n}'s largest curated vault on ${c} (minimum ${money(100)}); check the curator fee and the share price before signing, and approve the exact amount.`,
    weekly: "check the vault's share price and curator fee, and compound any rewards",
    exit: 'request a share redemption from the vault and wait for its withdrawal queue',
    exitTime: '1–2 days',
  },
  lending: {
    noun: 'lending market', cooldown: 0,
    deposit: (n, c) => `Supply ${money(PLAN.position_usd)} USDC to ${n} on ${c} (minimum ${money(50)}), then borrow about 25% in a blue-chip asset and keep the health factor above 2.0.`,
    weekly: 'check the health factor and repay or re-borrow a small amount to keep the account active',
    exit: 'repay the borrow and withdraw the supplied USDC',
    exitTime: '15 min',
  },
  stable: {
    noun: 'stable asset', cooldown: 0,
    deposit: (n, c) => `Mint or buy ${n}'s stable asset with ${money(PLAN.position_usd)} USDC on ${c} (minimum ${money(50)}), then deposit it in the protocol's own savings module; check the peg and collateral ratio first.`,
    weekly: 'check the peg and collateral ratio, and move a small amount through the mint and redeem path',
    exit: 'redeem the stable asset for USDC through the protocol',
    exitTime: '15 min',
  },
  dex: {
    noun: 'liquidity pool', cooldown: 0,
    deposit: (n, c) => `Provide ${money(PLAN.position_usd)} of liquidity to ${n}'s deepest stable or blue-chip pool on ${c} (minimum ${money(100)}), in a narrow range if the pool is concentrated.`,
    weekly: 'claim trading fees and re-centre the range if it has drifted outside the price',
    exit: 'remove the liquidity and swap the receipt token back to USDC',
    exitTime: '15 min',
  },
  rwa: {
    noun: 'yield-bearing asset', cooldown: 7,
    deposit: (n, c) => `Complete ${n}'s KYC if it asks, then subscribe ${money(PLAN.position_usd)} to its yield-bearing asset on ${c} (minimum ${money(1000)}); read the redemption window and transfer restrictions before funding.`,
    weekly: 'claim or re-invest the accrued yield and re-read the redemption terms',
    exit: 'submit a redemption request and wait for the next subscription or redemption window',
    exitTime: '7–30 days',
  },
  btc: {
    noun: 'BTC yield product', cooldown: 3,
    deposit: (n, c) => `Acquire ${money(PLAN.position_usd)} of BTC on ${c} (or bridge wrapped BTC), then deposit it into ${n}'s BTC yield or custody product (minimum ${money(250)}); verify the custody and proof-of-reserves page.`,
    weekly: 'check the custody attestation and claim or compound the BTC yield',
    exit: 'withdraw the BTC from the yield product and bridge or sell it back to USDC',
    exitTime: '1–3 days',
  },
  yield: {
    noun: 'yield strategy', cooldown: 1,
    deposit: (n, c) => `Deposit ${money(PLAN.position_usd)} USDC into ${n}'s main yield strategy on ${c} (minimum ${money(50)}) and keep the receipt token in the same wallet, unsold.`,
    weekly: 'claim the yield and re-deposit it rather than leave it idle',
    exit: 'withdraw from the strategy and claim any pending rewards',
    exitTime: '1–2 days',
  },
  staking: {
    noun: 'staking position', cooldown: 3,
    deposit: (n, c) => `Stake the ${c} native asset worth ${money(PLAN.position_usd)} through ${n} (minimum ${money(100)}), keep the receipt or staked position in the wallet, and note the unstaking queue.`,
    weekly: 'claim staking rewards and re-stake them',
    exit: 'unstake and wait for the protocol or chain unstaking queue',
    exitTime: '2–7 days',
  },
  chain: {
    noun: 'network app', cooldown: 0,
    deposit: (n, c) => `Move ${money(PLAN.position_usd)} USDC onto ${n} on ${c} (minimum ${money(20)}) and use its main app: one send, one receive or one swap, so the wallet has real activity.`,
    weekly: 'make one small native transaction and keep the balance active',
    exit: 'bridge the balance back to the chain you started on',
    exitTime: '10–30 min',
  },
  insurance: {
    noun: 'cover pool', cooldown: 7,
    deposit: (n, c) => `Deposit ${money(PLAN.position_usd)} USDC into ${n}'s cover or underwriting pool on ${c} (minimum ${money(100)}); read which risks the pool covers and the lock-up before depositing.`,
    weekly: 'check pool health and claim any accrued premium',
    exit: "withdraw after the pool's lock-up ends",
    exitTime: '7–30 days',
  },
  derivatives: {
    noun: 'margin account', cooldown: 0,
    deposit: (n, c) => `Deposit ${money(PLAN.position_usd)} USDC as margin on ${n} on ${c} (minimum ${money(250)}), then open and close one small hedged position rather than a directional bet.`,
    weekly: 'check margin and close any position before its funding or expiry date',
    exit: 'close the position and withdraw the margin',
    exitTime: '15 min',
  },
};

const gasFor = (chain) => PLAN.gas_usd[chain] ?? 0.25;
const bridgeFor = (chain) => (chain === 'Ethereum' || chain === 'Bitcoin' ? 2.5 : 0.6);
const gasText = (n) => `${money(n)} gas (${PLAN.gas_note})`;

/** A protocol's farm plan: concrete steps, each with what it costs and how long it takes. */
export function farmPlan(p, s) {
  const chain = p.chains[0] ?? 'its first chain';
  const chain2 = p.chains.find((c) => c !== chain) ?? null;
  const family = familyOf(p.category);
  const f = FAMILY[family];
  const gas = gasFor(chain);
  const size = PLAN.position_usd;
  const hold = s.age_days < 180 ? 90 : s.age_days < 365 ? 60 : 45;
  const weeks = Math.ceil(hold / 7);
  const share = shareOfTvl(size, p.tvl_usd);
  const steps = [
    { do: `Open ${p.name}'s official site and docs and confirm the ${f.noun} contract address on ${chain} from that page; do not use a link sent in a DM or reply.`, cost: '$0', time: '10–15 min' },
    { do: `Bridge or withdraw ${money(size)} USDC to a fresh wallet on ${chain}, keep about $10 of gas, and record the wallet so the position is easy to unwind.`, cost: `${money(bridgeFor(chain))} bridge + ${gasText(gas * 2)}`, time: '5–20 min' },
    { do: f.deposit(p.name, chain), cost: `${money(size)} capital + ${gasText(gas * 2)}`, time: '10–20 min' },
  ];
  if (p.change_7d !== null && p.change_7d <= -10) {
    steps.splice(1, 0, { do: `TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the last seven days: read ${p.name}'s announcements for the cause (incentive end, exploit, migration) and wait a week if it is unresolved before funding the wallet.`, cost: '$0', time: '15–30 min' });
  } else if (p.change_7d !== null && p.change_7d >= 50) {
    steps.splice(1, 0, { do: `TVL rose ${p.change_7d.toFixed(1)}% in seven days: check whether that is a temporary incentive or a one-off deposit; the model counts only the clamped week, and the plan's hold assumes the TVL stays.`, cost: '$0', time: '15–30 min' });
  }
  if (chain2 !== null) {
    const gas2 = gasFor(chain2);
    steps.push({ do: `Repeat a ${money(size / 4)} position on ${chain2}, ${p.name}'s second-listed chain of ${p.chains.length}, to show use across chains; use the same official contract list.`, cost: `${money(size / 4)} capital + ${gasText(gas2 * 3)}`, time: '20 min' });
  }
  steps.push({ do: `Once a week, ${f.weekly}, so the wallet is active in every week a snapshot might count; ${money(size)} is ${share} of ${p.name}'s ${usdShort(p.tvl_usd)} TVL.`, cost: `${money(gas * weeks)} gas over ${weeks} weeks`, time: '5 min a week' });
  steps.push({ do: `Hold for at least ${hold} days: ${p.name} has run ${s.age_days} days without a recorded token, and the maturity factor is ${s.maturity.toFixed(3)} of its maximum.`, cost: 'capital locked; no extra fee', time: `${hold} days` });
  steps.push({ do: `Exit by choosing to ${f.exit}; plan for ${f.cooldown} days of cooldown and keep the receipt or position until the withdrawal settles.`, cost: `${gasText(gas * 2)}`, time: f.exitTime });
  steps.push({ do: `Watch ${p.name}'s official announcements and docs for a points season or token page; claim only from the official site and never sign a link sent in a DM.`, cost: '$0', time: '5 min a week' });
  const gasTotal = round(gas * (2 + 2 + weeks + 2) + bridgeFor(chain) + (chain2 !== null ? gasFor(chain2) * 3 : 0), 2);
  return { steps, hold_days: hold, cooldown_days: f.cooldown, gas_total_usd: gasTotal, chain, family };
}

export const stepText = (st) => `${st.do} Cost: ${st.cost}. Time: ${st.time}.`;

// ---------------------------------------------------------------- validation

/** Spearman's rank correlation, ties broken by position (deterministic). */
function spearman(xs, ys) {
  const rank = (a) => {
    const order = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const r = new Array(a.length);
    order.forEach(([, i], j) => { r[i] = j + 1; });
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

const LOG2 = Math.log10(2);
const LOG3 = Math.log10(3);
const statBlock = (preds, actuals) => {
  const e = preds.map((x, i) => Math.abs(Math.log10(x / actuals[i])));
  return {
    median_miss: round(10 ** quantile(e, 0.5), 3),
    within_2x: round((e.filter((x) => x <= LOG2).length / e.length) * 100, 1),
    within_3x: round((e.filter((x) => x <= LOG3).length / e.length) * 100, 1),
    spearman: round(spearman(preds, actuals), 4),
    n: e.length,
  };
};

const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
const solve3 = (A, b) => {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c] || 1e-12;
    for (let j = c; j < 4; j++) m[c][j] /= d;
    for (let r = 0; r < 3; r++) if (r !== c) {
      const f = m[r][c];
      for (let j = c; j < 4; j++) m[r][j] -= f * m[c][j];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
};
const oddsX = (p, asOf) => {
  const age = ageDays(asOf, p.listed_at) ?? MODEL.age_assumed_days;
  return [1, Math.log10(Math.max(p.tvl_usd, 1)), Math.log10(1 + Math.min(age, MODEL.odds_max_age))];
};
const dot = (x, b) => x[0] * b[0] + x[1] * b[1] + x[2] * b[2];

/** IRLS logistic fit, fixed 30 iterations. y=1 when the record carries a token. */
function logistic(rows, asOf) {
  const X = rows.map((p) => oddsX(p, asOf));
  const y = rows.map((p) => (recordsNoToken(p) ? 0 : 1));
  let beta = [0, 0, 0];
  for (let it = 0; it < 30; it++) {
    const A = [[1e-8, 0, 0], [0, 1e-8, 0], [0, 0, 1e-8]];
    const rhs = [0, 0, 0];
    for (let i = 0; i < X.length; i++) {
      const p = sigmoid(dot(X[i], beta));
      const w = Math.max(p * (1 - p), 1e-9);
      const z = dot(X[i], beta) + (y[i] - p) / w;
      for (let a = 0; a < 3; a++) {
        rhs[a] += X[i][a] * w * z;
        for (let b = 0; b < 3; b++) A[a][b] += X[i][a] * w * X[i][b];
      }
    }
    beta = solve3(A, rhs);
  }
  return { beta, X, y };
}
const brier = (ps, ys) => ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / ps.length;

export function fitOdds(protocols, asOf) {
  const fitted = logistic(protocols, asOf);
  const ps = fitted.X.map((x) => sigmoid(dot(x, fitted.beta)));
  const base = fitted.y.reduce((s, v) => s + v, 0) / fitted.y.length;
  const inSample = brier(ps, fitted.y);
  let loo = 0;
  for (let i = 0; i < protocols.length; i++) {
    const f = logistic(protocols.filter((_, j) => j !== i), asOf);
    loo += (sigmoid(dot(fitted.X[i], f.beta)) - fitted.y[i]) ** 2;
  }
  const dated = protocols.filter((p) => p.listed_at).slice().sort((a, b) => (a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : 0));
  const cut = Math.floor(dated.length * 0.6);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  const wf = logistic(train, asOf);
  const wfPs = test.map((p) => sigmoid(dot(oddsX(p, asOf), wf.beta)));
  const wfYs = test.map((p) => (recordsNoToken(p) ? 0 : 1));
  const baseTrain = train.reduce((s, p) => s + (recordsNoToken(p) ? 0 : 1), 0) / train.length;
  return {
    beta: fitted.beta, base_rate: round(base, 4),
    brier_in: round(inSample, 4), brier_loo: round(loo / protocols.length, 4),
    walk: { train_n: train.length, test_n: test.length, brier: round(brier(wfPs, wfYs), 4), base_brier: round(brier(wfYs.map(() => baseTrain), wfYs), 4) },
  };
}
export const oddsAt = (tvl, age, beta) => sigmoid(beta[0] + beta[1] * Math.log10(Math.max(tvl, 1)) + beta[2] * Math.log10(1 + Math.min(age ?? MODEL.age_assumed_days, MODEL.odds_max_age)));

function olsMulti(X, y) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rhs = [0, 0, 0];
  for (let i = 0; i < X.length; i++) for (let a = 0; a < 3; a++) {
    rhs[a] += X[i][a] * y[i];
    for (let b = 0; b < 3; b++) A[a][b] += X[i][a] * X[i][b];
  }
  for (let a = 0; a < 3; a++) A[a][a] += 1e-9;
  return solve3(A, rhs);
}

/** Cumulative held-out term tests — tested TWICE: LOO (n=121) and Walk-Forward (older 60% -> newer 40%). */
export function termsTest(protocols, curve, asOf) {
  const live = curve.live;
  const clean = curve.clean;
  const flat = [];
  const curveOnly = [];
  const curvePriors = [];
  for (const p of clean) {
    const tr = live.filter((x) => x !== p);
    const m = quantile(tr.map((x) => x.mcap_usd / x.tvl_usd), 0.5);
    flat.push(Math.abs(Math.log10((p.tvl_usd * m) / p.mcap_usd)));
    const f = logFit(tr);
    const base = 10 ** f.a * p.tvl_usd ** f.b;
    curveOnly.push(Math.abs(Math.log10(base / p.mcap_usd)));
    curvePriors.push(Math.abs(Math.log10((base * growthFactor(p) * maturityFactor(p, asOf)) / p.mcap_usd)));
  }
  const ebErr = curve.ratios.map((r) => Math.abs(Math.log10(r)));
  const data = (term) => live.map((p) => [1, Math.log10(p.tvl_usd), term(p)]).map((x, i) => ({ x, y: Math.log10(live[i].mcap_usd), p: live[i] }));
  const fitTerm = (term) => {
    const rows = data(term);
    const errs = [];
    for (const p of clean) {
      const train = rows.filter((r) => r.p !== p);
      const beta = olsMulti(train.map((r) => r.x), train.map((r) => r.y));
      const x = [1, Math.log10(p.tvl_usd), term(p)];
      errs.push(Math.abs(Math.log10(10 ** (beta[0] + beta[1] * x[1] + beta[2] * x[2]) / p.mcap_usd)));
    }
    return round(10 ** quantile(errs, 0.5), 3);
  };
  const g = (p) => clamp(p.change_7d ?? 0, MODEL.growth_lo, MODEL.growth_hi) / 100;
  const age = (p) => maturityFactor(p, asOf);

  // Second held-out test: Walk-forward (older 60% dated -> newer 40% dated)
  const dated = clean.filter((p) => p.listed_at).slice().sort((a, b) => (a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(dated.length * 0.6);
  const wfTr = dated.slice(0, cut);
  const wfTe = dated.slice(cut);
  const wfMed = quantile(wfTr.map((x) => x.mcap_usd / x.tvl_usd), 0.5);
  const wfF = logFit(wfTr);
  const wfCat = curve.fitCatAdj(wfTr, wfF);
  const wfMiss = (preds) => round(10 ** quantile(preds.map((pr, i) => Math.abs(Math.log10(pr / wfTe[i].mcap_usd))), 0.5), 3);
  const wfTerm = (term) => {
    const beta = olsMulti(wfTr.map((p) => [1, Math.log10(p.tvl_usd), term(p)]), wfTr.map((p) => Math.log10(p.mcap_usd)));
    return wfMiss(wfTe.map((p) => 10 ** (beta[0] + beta[1] * Math.log10(p.tvl_usd) + beta[2] * term(p))));
  };

  return {
    flat: round(10 ** quantile(flat, 0.5), 3),
    size: round(10 ** quantile(curveOnly, 0.5), 3),
    priors: round(10 ** quantile(curvePriors, 0.5), 3),
    curve: round(10 ** quantile(ebErr, 0.5), 3),
    growth: fitTerm(g),
    maturity: fitTerm(age),
    wf: {
      flat: wfMiss(wfTe.map((p) => p.tvl_usd * wfMed)),
      size: wfMiss(wfTe.map((p) => 10 ** (wfF.a + wfF.b * Math.log10(p.tvl_usd)))),
      priors: wfMiss(wfTe.map((p) => 10 ** (wfF.a + wfF.b * Math.log10(p.tvl_usd)) * growthFactor(p) * maturityFactor(p, asOf))),
      curve: wfMiss(wfTe.map((p) => 10 ** (wfF.a + wfF.b * Math.log10(p.tvl_usd) + (wfCat[p.category ?? '(none)'] ?? 0)) * growthFactor(p) * maturityFactor(p, asOf))),
      growth: wfTerm(g),
      maturity: wfTerm(age),
      n: wfTe.length,
    },
    n: clean.length,
  };
}

/** Curve, global multiple and house model: leave-one-out, within-2x/3x, Spearman,
 * held-out band coverage, and a walk-forward fit on the older 60% of the clean set. */
export function validate(protocols, curve, asOf) {
  const live = curve.live;
  const clean = curve.clean;

  const globalPreds = [];
  for (const p of live) {
    const median = quantile(live.filter((x) => x !== p).map((x) => x.mcap_usd / x.tvl_usd), 0.5);
    globalPreds.push(p.tvl_usd * median);
  }
  const housePreds = live.map((p) => {
    const growth = 1 + (clamp(p.change_7d ?? 0, MODEL.growth_lo, MODEL.growth_hi) / 100) * 0.5;
    const age = ageDays(asOf, p.listed_at) ?? MODEL.age_assumed_days;
    const maturity = 0.6 + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * 0.4;
    return p.tvl_usd * 0.25 * growth * maturity;
  });
  const actuals = clean.map((p) => p.mcap_usd);
  const band = curve.band;
  const bandHits = curve.ratios.filter((r) => r >= band.p25 && r <= band.p75).length;
  const band80Hits = curve.ratios.filter((r) => r >= band.p10 && r <= band.p90).length;

  const dated = clean.filter((p) => p.listed_at).slice().sort((a, b) => (a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(dated.length * 0.6);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  const wf = logFit(train);
  const wfCat = curve.fitCatAdj(train, wf);
  const wfPreds = test.map((p) => 10 ** (wf.a + wf.b * Math.log10(p.tvl_usd) + (wfCat[p.category ?? '(none)'] ?? 0)) * growthFactor(p) * maturityFactor(p, asOf));
  const wfStats = statBlock(wfPreds, test.map((p) => p.mcap_usd));

  return {
    fit_n: live.length,
    clean_n: clean.length,
    outlier_n: curve.outliers.length,
    curve: { a: curve.fit.a, b: curve.fit.b, filtered_a: curve.filtered.a, filtered_b: curve.filtered.b, boot: curve.boot, ...statBlock(curve.curvePreds, actuals) },
    global: { median: round(quantile(live.map((p) => p.mcap_usd / p.tvl_usd), 0.5)), ...statBlock(globalPreds, live.map((p) => p.mcap_usd)) },
    house: { ...statBlock(housePreds, live.map((p) => p.mcap_usd)) },
    band: { ...band, coverage: round((bandHits / curve.ratios.length) * 100, 1), coverage80: round((band80Hits / curve.ratios.length) * 100, 1) },
    walk: { train_n: train.length, test_n: test.length, a: wf.a, b: wf.b, ...wfStats },
    outliers: curve.outliers,
  };
}

// ---------------------------------------------------------------- the radar

const clean = (p) => ({
  slug: p.slug,
  name: p.name,
  category: p.category,
  chains: [...p.chains],
  tvl_usd: p.tvl_usd,
  change_7d: p.change_7d,
  listed_at: p.listed_at,
});

/**
 * The whole radar: ranked tokenless rows, the tokenized comparables, and every
 * protocol set aside with the rule that set it aside.
 */
export function buildRadar(snap) {
  const curve = fitCurve(snap.protocols, snap.as_of);
  const oddsModel = fitOdds(snap.protocols, snap.as_of);
  const fits = fitMultiples(snap.protocols);
  const watch = new Set(snap.watchlist);
  const rows = [];
  const aside = [];
  let recordedToken = 0;
  let tokenless = 0;
  let noTvl = 0;
  for (const p of snap.protocols) {
    if (!recordsNoToken(p)) { recordedToken++; continue; }
    tokenless++;
    if (!(p.tvl_usd > 0)) { noTvl++; continue; }
    const onWatch = watch.has(p.slug);
    if (!onWatch) {
      const why = asideReason(p);
      if (why !== null) {
        aside.push({ ...clean(p), code: why.code, why: why.text });
        continue;
      }
      if (p.tvl_usd >= snap.floor_usd) {
        aside.push({ ...clean(p), code: 'parent-product', why: `above the ${usdShort(snap.floor_usd)} floor but off the watchlist: it passes every name and category test, so the house rule left it out as a child of a recorded parent protocol` });
        continue;
      }
    }
    const age = ageDays(snap.as_of, p.listed_at) ?? MODEL.age_assumed_days;
    const odds = oddsAt(p.tvl_usd, age, oddsModel.beta);
    const s = score(p, snap.as_of, curve, odds);
    const plan = farmPlan(p, s);
    const drop = Math.round((s.implied_value_usd * MODEL.drop_share * MODEL.deposit_usd) / p.tvl_usd);
    const net = drop - plan.gas_total_usd - MODEL.fee_usd;
    const hours = plan.hold_days * 24 + (plan.family === 'rwa' ? 8 : plan.family === 'staking' ? 4 : 1);
    rows.push({
      ...clean(p),
      watchlist: onWatch,
      ...s,
      drop_per_1k_usd: drop,
      gas_total_usd: plan.gas_total_usd,
      net_if_launch_usd: round(net, 2),
      net_per_hour_usd: round(net / hours, 4),
      hold_days: plan.hold_days,
      cooldown_days: plan.cooldown_days,
      family: plan.family,
      farm_steps: plan.steps.map(stepText),
      plan: plan.steps,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  aside.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  const used = new Map();
  for (const r of rows) {
    const key = r.category ?? '(none)';
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  const categories = [...fits.categories.entries()]
    .map(([name, f]) => ({ name, n: f.n, p25: f.p25, median: f.median, p75: f.p75, rows: used.get(name) ?? 0 }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const live = curve.live
    .map((p) => ({
      slug: p.slug, name: p.name, symbol: p.symbol, category: p.category,
      chains: [...p.chains], tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd,
      ratio: round(p.mcap_usd / p.tvl_usd), change_7d: p.change_7d,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));

  return {
    model: MODEL.version,
    as_of: snap.as_of,
    source: String(snap.source).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(),
    floor_usd: snap.floor_usd,
    counts: {
      protocols: snap.protocols.length,
      recorded_token: recordedToken,
      tokenless,
      tokenized: curve.live.length,
      clean: curve.clean.length,
      outliers: curve.outliers.length,
      watchlist: snap.watchlist.length,
      ranked: rows.length,
      watchlist_ranked: rows.filter((r) => r.watchlist).length,
      below_floor_ranked: rows.filter((r) => !r.watchlist).length,
      token_no_cap: recordedToken - curve.live.length,
      set_aside: aside.length,
      no_tvl: noTvl,
    },
    curve: { a: curve.fit.a, b: curve.fit.b, fit_n: curve.live.length, clean_n: curve.clean.length, band: curve.band, cat_adj: curve.catAdj },
    odds: oddsModel,
    terms: termsTest(snap.protocols, curve, snap.as_of),
    ledger: {
      total: snap.protocols.length, token_recorded: recordedToken, no_token: tokenless,
      ranked_watchlist: rows.filter((r) => r.watchlist).length,
      ranked_early: rows.filter((r) => !r.watchlist).length,
      token_trades: curve.live.length,
      token_no_cap: recordedToken - curve.live.length,
      set_aside: aside.length,
    },
    totals: { implied: rows.reduce((s, r) => s + r.implied_value_usd, 0), if_launch: rows.reduce((s, r) => s + r.if_launch_usd, 0) },
    global: fits.global,
    categories,
    validation: validate(snap.protocols, curve, snap.as_of),
    rows,
    live,
    aside,
  };
}
