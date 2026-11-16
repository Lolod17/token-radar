// Node-side glue for the radar: read and check the sealed snapshot, turn the shared model's
// output (dashboard/model.js) into board.json rows, and check the board against the gate's rules
// before anything is written.

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
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  model: { multiple: number; category_peers: number; growth_factor: number; tokenless_run_factor: number };
  missing_fields: string[];
}

/** Parse the snapshot and refuse one this model cannot read. */
export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (typeof s.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.as_of)) throw new Error('snapshot: as_of is not a YYYY-MM-DD date');
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('snapshot: protocols or watchlist missing');
  for (const p of s.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) throw new Error(`snapshot: protocol ${String(p.slug)} is malformed`);
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
    farm_steps: r.plan.steps.map(stepText),
    watchlist: r.watchlist,
    category: r.category,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    model: { multiple: r.multiple, category_peers: r.cat_n, growth_factor: r.growth, tokenless_run_factor: r.run },
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
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length) return `the board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `row ${i} has rank ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `rank ${i + 1} is worth more than rank ${i}`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  return null;
}
