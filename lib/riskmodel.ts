// Risk-Adjusted Token Radar: a token launch radar that ranks by what a protocol
// would be worth after its risks are priced in, not by size alone.
//
// The model has two halves, both computed from the snapshot's own figures only:
//
//   1. Comparable value. A protocol's raw implied value is its TVL times the
//      multiple the market already pays for live tokens in the same category:
//      the median market-cap / TVL of the category's live-token protocols,
//      clamped to [0.05, 1.5]. A category with fewer than three live comparables
//      falls back to the global median. Growth and maturity adjust it the way
//      any buyer would: a rising TVL is worth more, a protocol that has run
//      longer with no token is worth more.
//
//   2. Risk score (0-100, higher is riskier), five parts that sum to the score:
//      growth risk (wild 7-day moves cut both ways), age risk (young or
//      undated protocols), concentration risk (one chain is one point of
//      failure), size risk (small TVL is thin ice), and comparables risk
//      (a category whose live multiples disagree wildly has no anchor).
//
//   risk-adjusted value = raw implied x (1 - 0.55 x risk / 100)
//
// No protocol name is ever special-cased: the same functions score every row.
// A board row's `implied_value_usd` is the risk-adjusted value, so rank 1 is
// the best risk-adjusted claim on the board. The dashboard shows the raw
// value, the risk score and every risk part beside it, so a reader can see
// exactly what the ranking charged each protocol for its risk.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  min_comps: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  risk_haircut: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  min_comps: 3,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  risk_haircut: 0.55,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'risk-adjusted-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Already trading view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One risk part: its name, its points out of its cap, and its cap. */
export interface RiskPart {
  key: string;
  label: string;
  points: number;
  cap: number;
}

/** The five risk parts of one protocol, and the total score. */
export interface RiskScore {
  total: number;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  parts: RiskPart[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    raw_implied_usd: number;
    risk_score: number;
    risk_band: string;
    risk_factor: number;
    age_days: number | null;
  };
  risk: RiskScore;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  raw_implied_usd: number;
  risk_score: number;
  risk_band: string;
  risk_parts: RiskPart[];
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One category's comparable multiple, for the dashboard's "how the multiple was set" table. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  comps: number;
  dispersion: number;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  multiples: CategoryMultiple[];
  bands: { band: string; from: number; to: number; count: number }[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a sorted-or-not array of numbers; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Mean and standard deviation of an array; nulls when empty. */
function meanStd(values: number[]): { mean: number; std: number } | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** A category's live comparables: the market-cap / TVL ratios of its live-token protocols. */
export interface ComparableSet {
  multiple: number;
  comps: number;
  dispersion: number;
  ratios: number[];
}

/**
 * The comparable multiple for every category, from the live-token protocols
 * in the snapshot itself. A category with fewer than `min_comps` live
 * comparables takes the global median multiple instead, and says so: its
 * comps count is what it had, and the dashboard shows the fallback.
 */
export function comparableMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Map<string, ComparableSet> {
  const byCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const global = median(allRatios) ?? 0.25;
  const globalClamped = Math.min(model.multiple_cap, Math.max(model.multiple_floor, global));
  const out = new Map<string, ComparableSet>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= model.min_comps) {
      const m = median(ratios) ?? global;
      const stats = meanStd(ratios);
      const dispersion = stats !== null && stats.mean > 0 ? round4(stats.std / stats.mean) : 0;
      out.set(category, {
        multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, m)),
        comps: ratios.length,
        dispersion,
        ratios,
      });
    } else {
      out.set(category, { multiple: globalClamped, comps: ratios.length, dispersion: 0, ratios });
    }
  }
  return out;
}

/** The fallback multiple for a category with no live comparables at all. */
function fallbackMultiple(multiples: Map<string, ComparableSet>): number {
  const all = [...multiples.values()].map((c) => c.multiple);
  return median(all) ?? 0.25;
}

/** The risk band a total score falls in. */
export function riskBand(total: number): RiskScore['band'] {
  if (total < 25) return 'LOW';
  if (total < 45) return 'MEDIUM';
  if (total < 65) return 'HIGH';
  return 'EXTREME';
}

/**
 * The five risk parts for one protocol. Every part is computed from the
 * protocol's own record and the category comparables, never from its name.
 */
export function riskScore(
  p: SnapshotProtocol,
  age: number | null,
  comps: ComparableSet | undefined,
): RiskScore {
  const parts: RiskPart[] = [];

  // Growth risk (cap 25): a 7-day move inside [-10%, +30%] is ordinary. A
  // steep fall may be an exit; a vertical rise may be a spike that reverses.
  // No 7-day figure at all is its own risk: the move is unknown.
  let growth = 0;
  const d = p.change_7d;
  if (d === null || !Number.isFinite(d)) growth = 12;
  else if (d < -10) growth = Math.min(25, Math.round((-10 - d) * 0.6));
  else if (d > 30) growth = Math.min(25, Math.round((d - 30) * 0.3));
  parts.push({ key: 'growth', label: '7-day move', points: growth, cap: 25 });

  // Age risk (cap 20): a protocol that has run for years with no token has
  // survived; one listed weeks ago has not, and an undated one cannot prove it.
  let ageRisk = 0;
  if (age === null) ageRisk = 16;
  else if (age < 90) ageRisk = 20;
  else if (age < 180) ageRisk = 14;
  else if (age < 365) ageRisk = 8;
  else if (age < 730) ageRisk = 4;
  parts.push({ key: 'age', label: 'Track record', points: ageRisk, cap: 20 });

  // Concentration risk (cap 20): one chain is one point of failure.
  const chains = p.chains.length;
  const concentration = chains === 0 ? 20 : chains === 1 ? 14 : chains === 2 ? 7 : 0;
  parts.push({ key: 'concentration', label: 'Chain concentration', points: concentration, cap: 20 });

  // Size risk (cap 15): small TVL is thin ice — a few withdrawals move it.
  let size = 0;
  if (p.tvl_usd < 10_000_000) size = 15;
  else if (p.tvl_usd < 25_000_000) size = 11;
  else if (p.tvl_usd < 50_000_000) size = 7;
  else if (p.tvl_usd < 200_000_000) size = 3;
  parts.push({ key: 'size', label: 'Thin TVL', points: size, cap: 15 });

  // Comparables risk (cap 20): when a category's live multiples disagree
  // wildly there is no anchor to price against; with fewer than three live
  // comparables there is barely an anchor at all.
  let compRisk = 0;
  if (comps === undefined || comps.comps < MODEL.min_comps) compRisk = 20;
  else compRisk = Math.min(20, Math.round(comps.dispersion * 12));
  parts.push({ key: 'comps', label: 'Noisy comparables', points: compRisk, cap: 20 });

  const total = Math.min(100, parts.reduce((a, part) => a + part.points, 0));
  return { total, band: riskBand(total), parts };
}

/** The raw implied value and the risk-adjusted value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants = MODEL,
): { raw: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const raw = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  return { raw, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, best risk-adjusted value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = comparableMultiples(snapshot, model);
  const fallback = fallbackMultiple(multiples);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const key = p.category ?? 'Uncategorised';
    const comps = multiples.get(key);
    const multiple = comps !== undefined ? comps.multiple : fallback;
    const { raw, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, multiple, model);
    const risk = riskScore(p, age, comps);
    const riskFactor = round4(1 - model.risk_haircut * (risk.total / 100));
    const adjusted = Math.max(1, Math.round(raw * riskFactor));
    return { p, multiple, comps: comps?.comps ?? 0, raw, growthPct, growthMult, maturityMult, age, risk, riskFactor, adjusted };
  });
  scored.sort(
    (a, b) => b.adjusted - a.adjusted || b.raw - a.raw || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.adjusted,
    model: {
      category_multiple: round4(s.multiple),
      category_comps: s.comps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      raw_implied_usd: s.raw,
      risk_score: s.risk.total,
      risk_band: s.risk.band,
      risk_factor: s.riskFactor,
      age_days: s.age,
    },
    risk: s.risk,
    farm_steps: farmSteps(s.p, s.age, s.risk).map(stepText),
  }));
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The most the position should hold, from the protocol's risk band. */
function capitalFor(band: RiskScore['band']): number {
  if (band === 'LOW') return 250;
  if (band === 'MEDIUM') return 150;
  if (band === 'HIGH') return 75;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name} on ${chain} and leave the loan open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it in place.`;
  }
  if (c.includes('bridge')) {
    return `Move $${capital} of USDC onto ${chain} through ${name}, then put the bridged funds to work in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  }
  if (c.includes('prediction')) {
    return `Fund your account with $${capital} and take one position in a ${name} market.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Put $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is sized to the protocol's risk band and derived from its own
 * record (category, chains, TVL, age, risk), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, risk: RiskScore): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(risk.band);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `This protocol scores ${risk.total}/100 risk (${risk.band} band), so cap the position at $${capital}: ${action.charAt(0).toLowerCase()}${action.slice(1)}`,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and check its TVL weekly: unwind if it falls 30% in a week.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    raw_implied_usd: row.model.raw_implied_usd,
    risk_score: row.risk.total,
    risk_band: row.risk.band,
    risk_parts: row.risk.parts,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = comparableMultiples(snapshot, model);
  const multTable: CategoryMultiple[] = [...multiples.entries()]
    .map(([category, c]) => ({ category, multiple: c.multiple, comps: c.comps, dispersion: c.dispersion }))
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const bands = (['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] as const).map((band) => {
    const rows = board.filter((r) => r.risk.band === band);
    const scores = rows.map((r) => r.risk.total);
    return {
      band,
      from: scores.length > 0 ? Math.min(...scores) : 0,
      to: scores.length > 0 ? Math.max(...scores) : 0,
      count: rows.length,
    };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    multiples: multTable,
    bands,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
