// Constants shared by main.ts's fitted model and the page's own recomputation.
export const MODEL = {
  version: 'radar-curve-4',
  growth_weight: 0.35,
  growth_lo: -60,
  growth_hi: 120,
  maturity_base: 0.55,
  maturity_span: 0.45,
  maturity_days: 1095,
  age_assumed_days: 365,
  odds_max_age: 2000,
  cat_shrink_k: 12,
  min_peers: 5,
  ratio_lo: 0.005,
  ratio_hi: 50,
  drop_share: 0.07,
  deposit_usd: 1000,
  fee_usd: 2,
  value_floor_usd: 1,
};

export const PLAN = {
  position_usd: 1000,
  gas_note: '20 gwei, ETH $3,000',
  gas_usd: {
    Ethereum: 3.5, Bitcoin: 1.5, Solana: 0.01, Base: 0.15, Arbitrum: 0.2,
    Optimism: 0.2, Polygon: 0.05, Binance: 0.1, Avalanche: 0.1, Tron: 0.3,
    Monad: 0.05, Sui: 0.02, Hyperliquid: 0.05, Plasma: 0.05, Berachain: 0.1,
    Sonic: 0.1, Flare: 0.05, Stellar: 0.01, Algorand: 0.01, Hemi: 0.1,
    'Robinhood Chain': 0.05, BOB: 0.1, TAC: 0.1,
  },
};
