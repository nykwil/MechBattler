/**
 * Round-robin balance harness (docs/05 R4): every template vs every other,
 * seeded and headless. Run it on every tuning change. The kill criterion:
 * any template with > 70% overall win rate gets a targeted nerf; if a whole
 * *class* of strategy dominates regardless of numbers, revisit arena design.
 */
import { runBattle, type VictoryReason } from './combat.js';
import { getPart } from './catalog.js';
import type { Build } from './types.js';
import type { TemplateDef } from './templates.js';

/** Tier-point budget of a build (docs/04 §5: enemy strength is Σ part tiers). */
export function computeBudget(build: Build): number {
  return build.parts.reduce((sum, p) => sum + getPart(p.partId).tier, 0);
}

export interface MatchupResult {
  a: string;
  b: string;
  aWins: number;
  bWins: number;
  draws: number;
  avgDurationS: number;
  reasons: Record<VictoryReason, number>;
}

export interface TemplateStanding {
  id: string;
  budget: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface RoundRobinReport {
  seedsPerPair: number;
  battles: number;
  matchups: MatchupResult[];
  standings: TemplateStanding[];
  /** Templates whose overall win rate exceeds the docs/05 R4 kill criterion (70%). */
  flagged: string[];
}

export const R4_WIN_RATE_FLAG = 0.7;
/**
 * Fighting-game matchup band (docs/05 R10): stock-vs-stock, a matchup should
 * land inside [35%, 65%]. Outside the band it must at least be *soft* --
 * recoverable by fitting-only adaptation (see adaptation.ts); a hard sweep
 * with no adaptation path is the failure mode (one persistent mech per run
 * means an unfixable counter is a run-ender, not a character-select moment).
 */
export const MATCHUP_BAND_LOW = 0.35;
export const MATCHUP_BAND_HIGH = 0.65;

export function runRoundRobin(
  templates: TemplateDef[],
  options: { seedsPerPair?: number; timeoutS?: number; baseSeed?: number } = {},
): RoundRobinReport {
  const seedsPerPair = options.seedsPerPair ?? 20;
  const baseSeed = options.baseSeed ?? 1;
  const tally = new Map<string, { wins: number; losses: number; draws: number }>();
  for (const t of templates) tally.set(t.id, { wins: 0, losses: 0, draws: 0 });

  const matchups: MatchupResult[] = [];
  let battles = 0;

  for (let i = 0; i < templates.length; i++) {
    for (let j = i + 1; j < templates.length; j++) {
      const a = templates[i]!;
      const b = templates[j]!;
      const result: MatchupResult = {
        a: a.id, b: b.id, aWins: 0, bWins: 0, draws: 0, avgDurationS: 0,
        reasons: { 'core-kill': 0, 'mission-kill': 0, judges: 0 },
      };
      for (let s = 0; s < seedsPerPair; s++) {
        // Alternate spawn sides so any side asymmetry washes out.
        const flip = s % 2 === 1;
        const seed = baseSeed + i * 7919 + j * 104729 + s;
        const report = runBattle({
          builds: flip ? [b.build, a.build] : [a.build, b.build],
          seed,
          timeoutS: options.timeoutS,
          recordFrames: false,
        });
        battles++;
        result.avgDurationS += report.durationS;
        result.reasons[report.reason]++;
        const winnerId = report.winner === 'draw' ? null : (report.winner === 0) !== flip ? a.id : b.id;
        if (winnerId === a.id) result.aWins++;
        else if (winnerId === b.id) result.bWins++;
        else result.draws++;
      }
      result.avgDurationS /= seedsPerPair;
      matchups.push(result);
      tally.get(a.id)!.wins += result.aWins;
      tally.get(a.id)!.losses += result.bWins;
      tally.get(a.id)!.draws += result.draws;
      tally.get(b.id)!.wins += result.bWins;
      tally.get(b.id)!.losses += result.aWins;
      tally.get(b.id)!.draws += result.draws;
    }
  }

  const budgetById = new Map(templates.map((t) => [t.id, computeBudget(t.build)]));
  const standings: TemplateStanding[] = [...tally.entries()]
    .map(([id, t]) => ({
      id, budget: budgetById.get(id) ?? 0, ...t,
      winRate: t.wins + t.losses + t.draws > 0 ? t.wins / (t.wins + t.losses + t.draws) : 0,
    }))
    .sort((x, y) => y.winRate - x.winRate);

  return {
    seedsPerPair,
    battles,
    matchups,
    standings,
    flagged: standings.filter((s) => s.winRate > R4_WIN_RATE_FLAG).map((s) => s.id),
  };
}

/** Renders the report as a fixed-width text block (for CLI output / logs). */
export function formatRoundRobin(report: RoundRobinReport, templates: TemplateDef[]): string {
  const ids = templates.map((t) => t.id);
  const w = Math.max(...ids.map((id) => id.length)) + 2;
  const pad = (s: string, n = w) => s.padEnd(n);
  const lines: string[] = [];

  lines.push(`Round-robin: ${templates.length} templates, ${report.seedsPerPair} seeds/pair, ${report.battles} battles`);
  lines.push('');
  lines.push(pad('win% vs →') + ids.map((id) => pad(id.slice(0, w - 2))).join(''));
  for (const rowId of ids) {
    const cells = ids.map((colId) => {
      if (rowId === colId) return pad('—');
      const m = report.matchups.find((x) => (x.a === rowId && x.b === colId) || (x.a === colId && x.b === rowId))!;
      const wins = m.a === rowId ? m.aWins : m.bWins;
      const total = m.aWins + m.bWins + m.draws;
      return pad(`${Math.round((100 * wins) / total)}%`);
    });
    lines.push(pad(rowId) + cells.join(''));
  }
  lines.push('');
  lines.push('Standings (budget = Σ part tiers, docs/04 §5):');
  for (const s of report.standings) {
    const flag = report.flagged.includes(s.id) ? '  ⚠ >70% (05 R4 flag)' : '';
    lines.push(`  ${pad(s.id)} ${String(Math.round(s.winRate * 100)).padStart(3)}%  budget ${String(s.budget).padStart(2)}  (${s.wins}W ${s.losses}L ${s.draws}D)${flag}`);
  }
  lines.push('');
  lines.push('Matchup detail (avg fight length, victory types; ⚑ = outside the 35-65% band):');
  for (const m of report.matchups) {
    const reasons = Object.entries(m.reasons).filter(([, n]) => n > 0).map(([r, n]) => `${r}×${n}`).join(' ');
    const total = m.aWins + m.bWins + m.draws;
    const aRate = total > 0 ? m.aWins / total : 0.5;
    const flag = aRate < MATCHUP_BAND_LOW || aRate > MATCHUP_BAND_HIGH ? '  ⚑' : '';
    lines.push(`  ${pad(m.a)} vs ${pad(m.b)} ${m.aWins}-${m.bWins}-${m.draws}  ${m.avgDurationS.toFixed(1)}s  ${reasons}${flag}`);
  }
  return lines.join('\n');
}
