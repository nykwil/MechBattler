import { TEMPLATES, analyzeRoundRobin, runRoundRobin } from '@mechbattler/sim';

export interface BalanceWorkerRequest {
  seeds: number;
}

export interface BalanceWorkerResponse {
  report: ReturnType<typeof runRoundRobin>;
  summary: ReturnType<typeof analyzeRoundRobin>;
  durationMs: number;
}

self.onmessage = (event: MessageEvent<BalanceWorkerRequest>) => {
  const started = performance.now();
  const report = runRoundRobin(TEMPLATES, { seedsPerPair: event.data.seeds, baseSeed: 1 });
  self.postMessage({
    report,
    summary: analyzeRoundRobin(report),
    durationMs: Math.round(performance.now() - started),
  } satisfies BalanceWorkerResponse);
};
