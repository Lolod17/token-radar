// Node-side glue for the radar: read and check the sealed snapshot, turn the shared
// model's output (dashboard/model.js) into board.json rows, and check the board
// against every rule the gate scores before anything is written.

import { buildRadar, stepText } from '../dashboard/model.js';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: string[];
  watchlist: boolean;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  age_assumed: boolean;
  multiple: number;
  multiple_lo: number;
  multiple_hi: number;
  multiple_n: number;
  multiple_source: string;
  growth_mult: number;
  maturity: number;
  low_usd: number;
  high_usd: number;
  per_1k_usd: number;
  gas_total_usd: number;
  net_per_hour_usd: number;
  hold_days: number;
  missing_fields: string[];
}

/** Parse the snapshot and refuse one this model cannot read. */
export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (typeof s.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.as_of)) throw new Error('snapshot: as_of is not a YYYY-MM-DD date');
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('snapshot: protocols or watchlist missing');
  if (typeof s.floor_usd !== 'number' || !(s.floor_usd > 0)) throw new Error('snapshot: floor_usd is not a positive number');
  for (const p of s.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new Error(`snapshot: protocol ${String(p.slug)} is malformed`);
    }
  }
  return s;
}

/** The ranked radar and its board.json rows. */
export function makeBoard(snapshot: Snapshot): { radar: ReturnType<typeof buildRadar>; board: BoardRow[] } {
  const radar = buildRadar(snapshot);
  const board: BoardRow[] = radar.rows.map((r: any) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
    watchlist: r.watchlist,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    age_assumed: r.age_assumed,
    multiple: r.multiple,
    multiple_lo: r.multiple_lo,
    multiple_hi: r.multiple_hi,
    multiple_n: r.multiple_n,
    multiple_source: r.multiple_source,
    growth_mult: r.growth_mult,
    maturity: r.maturity,
    low_usd: r.low_usd,
    high_usd: r.high_usd,
    per_1k_usd: r.per_1k_usd,
    gas_total_usd: r.gas_total_usd,
    net_per_hour_usd: r.net_per_hour_usd,
    hold_days: r.hold_days,
    missing_fields: r.missing,
  }));
  return { radar, board };
}

/** The first way the board breaks the gate's rules, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, not 100 to 4000`;
  const slugs = new Set<string>();
  for (const r of board) {
    if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return `a row has a bad slug: ${String(r.slug)}`;
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) return `${r.slug} has rank ${String(r.rank)}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${String(r.implied_value_usd)}`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${Array.isArray(r.farm_steps) ? r.farm_steps.length : 'no'} farm steps`;
    for (const s of r.farm_steps) {
      if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${typeof s === 'string' ? s.trim().length : 'no'} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length) return `the board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = new Set<number>();
  for (const r of board) {
    if (ranks.has(r.rank)) return `rank ${r.rank} appears twice`;
    ranks.add(r.rank);
  }
  for (let i = 1; i <= board.length; i++) if (!ranks.has(i)) return `rank ${i} is missing`;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.implied_value_usd > sorted[i - 1]!.implied_value_usd) return `rank ${sorted[i]!.rank} is worth more than rank ${sorted[i - 1]!.rank}`;
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every row has the same implied value';
  return null;
}
