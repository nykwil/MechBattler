/** Placeholder — the real module lands with the search. */
export interface Genome {
  chassisId: string;
  parts: { partId: string; count: number; modifiers?: string[] }[];
  armourPlates: number;
}
