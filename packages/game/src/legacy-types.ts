/** Input-only compatibility shapes for saves written before game schema v2. */
export interface Profile {
  unlockedChassis: string[];
  unlockedParts: string[];
}

export interface RunRecord {
  kitName: string;
  fightsWon: number;
  cause: string;
  victorious: boolean;
  endedAt: string;
}
