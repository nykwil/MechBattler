// Win rate of a starting build against generated opponents, per ladder budget.
//
// The cohort loop measures the whole run and takes minutes; this measures the
// one relationship the ramp is actually set by — how a given build fares at a
// given budget — in seconds, so the budget curve can be fitted rather than
// guessed. Mean run length under run-ending defeat is 1/(1-winRate), so the
// per-budget win rate is what decides how far into a run a player ever gets.
//
// Usage: node --import tsx scripts/ladder-calibration.mjs [--template ID] [--seeds N]
import { generateOpponent, runBattle } from '@mechbattler/sim';
import { GAME_CONTENT, getGameplayTemplate } from '../src/content.js';
import { LADDER_SPAWN_DISTANCES_M, nodeBudget } from '../src/nodes.js';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const templateIds = (valueAfter('--template') ?? 'mule-skirmisher').split(',');
const seedCount = Number.parseInt(valueAfter('--seeds') ?? '24', 10);
const runLength = GAME_CONTENT.run.length;

const expectedRunBattles = (winRate) => (winRate >= 1 ? Infinity : 1 / (1 - winRate));

for (const templateId of templateIds) {
  const template = getGameplayTemplate(templateId);
  if (!template) throw new Error(`Unknown template ${templateId}`);
  const rows = [];
  for (let node = 1; node <= runLength; node += 1) {
    const budget = nodeBudget(node);
    let wins = 0;
    let total = 0;
    for (let seed = 0; seed < seedCount; seed += 1) {
      const opponent = generateOpponent({
        budget,
        seed: 91000 + node * 977 + seed * 31,
        fillPartIds: GAME_CONTENT.enemyFillPartIds,
      });
      // Fresh integrity both sides: this isolates the budget curve from the
      // wear a real run carries in, which is a separate pressure to measure.
      //
      // Spawn distance must be swept, not defaulted. runBattle defaults to
      // 160 m, the longest distance the ladder offers, and measuring only
      // there reported every short-range build as unviable and every long
      // one as strong — an artefact of the instrument, not the content.
      const report = runBattle({
        builds: [structuredClone(template.build), opponent.build],
        seed: 5100 + node * 13 + seed,
        spawnDistanceM: LADDER_SPAWN_DISTANCES_M[seed % LADDER_SPAWN_DISTANCES_M.length],
        recordFrames: false,
      });
      if (report.winner === 0) wins += 1;
      total += 1;
    }
    rows.push({ node, budget, winRate: wins / total });
  }
  const overall = rows.reduce((sum, row) => sum + row.winRate, 0) / rows.length;
  console.log(`\n${templateId}  (mean win rate ${overall.toFixed(3)})`);
  console.log('node  budget  winRate  expected run battles at that rate');
  for (const row of rows) {
    const bar = '#'.repeat(Math.round(row.winRate * 30));
    console.log(
      `${String(row.node).padStart(4)}  ${String(row.budget).padStart(6)}  ${row.winRate.toFixed(3).padStart(7)}  `
      + `${expectedRunBattles(row.winRate).toFixed(1).padStart(5)}  ${bar}`,
    );
  }
}
