/**
 * Worker-thread entry: screen batches of genomes and post the scores back.
 *
 * Nothing here decides anything. The main thread owns the archive and the
 * search; a worker only turns genomes into scores, which is where all the time
 * goes -- a battle is ~212 ms and a screen is three of them, against ~22 ms for
 * everything else a candidate costs.
 *
 * The worker is LONG-LIVED and handles many batches. Spawning one per
 * generation was the first attempt and it was far slower than doing the work
 * serially: under `tsx` a fresh worker recompiles the sim's whole module graph
 * before it can run a single battle, and a generation is only a second or two
 * of actual work.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { screenBatch, type Genome, type Lock } from './breeding.js';

const { lock } = workerData as { lock: Lock };

parentPort?.on('message', (task: { id: number; genomes: Genome[]; rank: number }) => {
  parentPort!.postMessage({ id: task.id, scores: screenBatch(task.genomes, lock, task.rank) });
});
