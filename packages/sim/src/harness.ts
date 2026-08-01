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

export interface BalanceDiagnostic {
  id: string;
  severity: 'critical' | 'warning' | 'note';
  title: string;
  evidence: string;
  recommendation: string;
}

export interface BalanceSummary {
  healthyMatchups: number;
  totalMatchups: number;
  outOfBandMatchups: number;
  dominantTemplates: string[];
  weakestTemplate: TemplateStanding | null;
  strongestTemplate: TemplateStanding | null;
  diagnostics: BalanceDiagnostic[];
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
        reasons: { 'chassis-failure': 0, 'core-kill': 0, 'mission-kill': 0, judges: 0 },
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

/** Converts raw outcomes into the same explainable tuning brief in UI and CI. */
export function analyzeRoundRobin(report: RoundRobinReport): BalanceSummary {
  const outliers = report.matchups.filter((m) => {
    const total = m.aWins + m.bWins + m.draws;
    const aRate = total > 0 ? m.aWins / total : 0.5;
    return aRate < MATCHUP_BAND_LOW || aRate > MATCHUP_BAND_HIGH;
  });
  const strongestTemplate = report.standings[0] ?? null;
  const weakestTemplate = report.standings[report.standings.length - 1] ?? null;
  const diagnostics: BalanceDiagnostic[] = [];

  for (const id of report.flagged) {
    const standing = report.standings.find((s) => s.id === id)!;
    diagnostics.push({
      id: `dominant-${id}`,
      severity: 'critical',
      title: `${id} is globally dominant`,
      evidence: `${Math.round(standing.winRate * 100)}% overall win rate across ${standing.wins + standing.losses + standing.draws} battles; the design ceiling is ${Math.round(R4_WIN_RATE_FLAG * 100)}%.`,
      recommendation: 'Inspect its cheapest repeatable advantage before changing global combat rules; prefer a content or loadout adjustment.',
    });
  }

  if (weakestTemplate && weakestTemplate.winRate < 0.3) {
    diagnostics.push({
      id: `weak-${weakestTemplate.id}`,
      severity: 'warning',
      title: `${weakestTemplate.id} lacks a reliable game plan`,
      evidence: `${Math.round(weakestTemplate.winRate * 100)}% overall win rate on a tier budget of ${weakestTemplate.budget}.`,
      recommendation: 'Read its battle losses for range access, power starvation, or heat collapse; strengthen the archetype kernel rather than adding generic stats.',
    });
  }

  for (const matchup of [...outliers]
    .sort((x, y) => {
      const extremity = (m: MatchupResult) => {
        const total = m.aWins + m.bWins + m.draws;
        return Math.abs((total > 0 ? m.aWins / total : 0.5) - 0.5);
      };
      return extremity(y) - extremity(x);
    })
    .slice(0, 3)) {
    const total = matchup.aWins + matchup.bWins + matchup.draws;
    const aRate = total > 0 ? matchup.aWins / total : 0.5;
    const winner = aRate >= 0.5 ? matchup.a : matchup.b;
    const loser = aRate >= 0.5 ? matchup.b : matchup.a;
    const winRate = Math.max(aRate, 1 - aRate);
    diagnostics.push({
      id: `polarized-${matchup.a}-${matchup.b}`,
      severity: 'warning',
      title: `${winner} hard-counters ${loser}`,
      evidence: `${Math.round(winRate * 100)}% in the matchup; healthy stock matchups target ${Math.round(MATCHUP_BAND_LOW * 100)}–${Math.round(MATCHUP_BAND_HIGH * 100)}%.`,
      recommendation: 'Run fitting-only adaptation next. If no legal refit reaches the band, tune the losing kernel or its access to the fight.',
    });
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      id: 'healthy-roster', severity: 'note', title: 'No roster-level guardrail fired',
      evidence: `All ${report.matchups.length} matchups and ${report.standings.length} standings satisfy the current thresholds.`,
      recommendation: 'Increase the seed count and inspect battle-level telemetry before accepting the tuning pass.',
    });
  }

  return {
    healthyMatchups: report.matchups.length - outliers.length,
    totalMatchups: report.matchups.length,
    outOfBandMatchups: outliers.length,
    dominantTemplates: [...report.flagged],
    weakestTemplate,
    strongestTemplate,
    diagnostics,
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
