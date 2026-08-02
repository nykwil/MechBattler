import { useEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATES, analyzeRoundRobin, runRoundRobin, type RoundRobinReport } from '@mechbattler/sim';
import type { BalanceWorkerResponse } from '../workers/balance.worker.js';
import './BalanceLab.css';

const pct = (value: number) => `${Math.round(value * 100)}%`;

export function BalanceLab() {
  const [seeds, setSeeds] = useState(2);
  const [report, setReport] = useState<RoundRobinReport | null>(() =>
    new URLSearchParams(window.location.search).get('run') === '1'
      ? runRoundRobin(TEMPLATES, { seedsPerPair: 2, baseSeed: 1 })
      : null,
  );
  const [running, setRunning] = useState(false);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const summary = useMemo(() => report ? analyzeRoundRobin(report) : null, [report]);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/balance.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setWorkerReady(true);
    worker.onmessage = (event: MessageEvent<BalanceWorkerResponse>) => {
      setReport(event.data.report);
      setDurationMs(event.data.durationMs);
      setRunning(false);
    };
    worker.onerror = () => {
      setError('The audit worker stopped unexpectedly. Reload and run the cohort again.');
      setRunning(false);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runAudit = () => {
    setRunning(true);
    setReport(null);
    setDurationMs(null);
    setError(null);
    workerRef.current?.postMessage({ seeds });
  };

  const download = () => {
    if (!report || !summary) return;
    const payload = { generatedAt: new Date().toISOString(), report, summary };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mechbattler-balance-audit-${report.seedsPerPair}-seeds.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="balance-lab">
      <section className="lab-hero">
        <div>
          <div className="lab-kicker">CODEX-ASSISTED CONTENT TUNING</div>
          <h1>Balance Lab</h1>
          <p>Turn deterministic battles into an explainable tuning brief. Audit the roster, find dominant content and hard counters, then export evidence for the next pass.</p>
        </div>
        <div className="lab-controls">
          <label>
            Seeds per matchup
            <select value={seeds} onChange={(e) => setSeeds(Number(e.target.value))} disabled={running}>
              <option value={2}>2 · quick demo</option>
              <option value={5}>5 · working pass</option>
              <option value={10}>10 · evidence pass</option>
            </select>
          </label>
          <button type="button" className="lab-run" onClick={runAudit} disabled={running || !workerReady}>
            {running ? `Simulating ${TEMPLATES.length * (TEMPLATES.length - 1) / 2 * seeds} battles…` : 'Run roster audit'}
          </button>
          {report && <button type="button" className="lab-export" onClick={download}>Export JSON evidence</button>}
        </div>
      </section>

      <section className="pass-proof" aria-label="Recorded tuning pass">
        <div className="pass-proof-head">
          <div><span>FINAL DIVERSITY STRESS</span><strong>12 builds · 330 battles</strong></div>
          <small>5 fixed seeds · matched control/perk cohorts · canonical safety rail preserved</small>
        </div>
        <div className="pass-proof-grid">
          <article><span>Dominant perk builds</span><div><strong>0</strong></div></article>
          <article><span>Perks with a matchup niche</span><div><strong>4</strong><small>/ 4</small></div></article>
          <article><span>Chassis with 2+ identities</span><div><strong>4</strong><small>/ 4</small></div></article>
          <article><span>Vulture free cells</span><div><strong>2–4</strong><small>after coherent fits</small></div></article>
        </div>
      </section>

      {!report && !running && (
        <section className="lab-empty">
          <span>01</span>
          <h2>Start with evidence, not a balance hunch.</h2>
          <p>The same seeded combat engine used by the game runs every archetype from both sides of the arena.</p>
        </section>
      )}

      {running && (
        <section className="lab-running" aria-live="polite">
          <div className="lab-pulse" />
          <div><strong>Running deterministic cohort</strong><span>Same content + same seeds = the same verdict.</span></div>
        </section>
      )}

      {error && <section className="lab-error" role="alert">{error}</section>}

      {report && summary && (
        <>
          <section className="lab-metrics">
            <article><span>Battles</span><strong>{report.battles}</strong><small>{report.seedsPerPair} seeds × {report.matchups.length} pairs{durationMs !== null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}</small></article>
            <article><span>Healthy matchups</span><strong>{summary.healthyMatchups}/{summary.totalMatchups}</strong><small>inside the 35–65% guardrail</small></article>
            <article className={report.flagged.length ? 'metric-alert' : ''}><span>Dominant builds</span><strong>{report.flagged.length}</strong><small>above 70% overall</small></article>
            <article><span>Spread</span><strong>{pct((summary.strongestTemplate?.winRate ?? 0) - (summary.weakestTemplate?.winRate ?? 0))}</strong><small>strongest to weakest</small></article>
          </section>

          <div className="lab-grid">
            <section className="lab-card">
              <div className="lab-card-head"><div><span>02</span><h2>Roster standings</h2></div><small>budget = sum of part tiers</small></div>
              <div className="standing-table">
                {report.standings.map((standing, index) => (
                  <div className="standing-row" key={standing.id}>
                    <span className="standing-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{standing.id}</strong><small>{standing.wins}W · {standing.losses}L · budget {standing.budget}</small></div>
                    <div className="standing-bar"><i style={{ width: pct(standing.winRate) }} /></div>
                    <b className={standing.winRate > 0.7 || standing.winRate < 0.3 ? 'outlier' : ''}>{pct(standing.winRate)}</b>
                  </div>
                ))}
              </div>
            </section>

            <section className="lab-card">
              <div className="lab-card-head"><div><span>03</span><h2>Tuning brief</h2></div><small>ranked, explainable findings</small></div>
              <div className="diagnostic-list">
                {summary.diagnostics.map((item) => (
                  <article className={`diagnostic ${item.severity}`} key={item.id}>
                    <div className="diagnostic-severity">{item.severity}</div>
                    <h3>{item.title}</h3>
                    <p>{item.evidence}</p>
                    <small>{item.recommendation}</small>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="lab-card lab-matrix">
            <div className="lab-card-head"><div><span>04</span><h2>Matchup matrix</h2></div><small>row build win rate</small></div>
            <div className="matrix-scroll">
              <table>
                <thead><tr><th>build</th>{TEMPLATES.map((t) => <th key={t.id} title={t.name}>{t.id.replace(/^(vulture|mule|bastion|railgun)-/, '')}</th>)}</tr></thead>
                <tbody>
                  {TEMPLATES.map((row) => (
                    <tr key={row.id}><th>{row.id}</th>{TEMPLATES.map((col) => {
                      if (row.id === col.id) return <td className="matrix-self" key={col.id}>—</td>;
                      const matchup = report.matchups.find((m) => (m.a === row.id && m.b === col.id) || (m.a === col.id && m.b === row.id))!;
                      const wins = matchup.a === row.id ? matchup.aWins : matchup.bWins;
                      const total = matchup.aWins + matchup.bWins + matchup.draws;
                      const rate = total ? wins / total : 0.5;
                      return <td key={col.id} className={rate < 0.35 || rate > 0.65 ? 'matrix-outlier' : 'matrix-healthy'}>{pct(rate)}</td>;
                    })}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
