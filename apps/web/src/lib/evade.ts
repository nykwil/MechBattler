/**
 * Crossing speed: the component of a mech's velocity perpendicular to the line of
 * sight from its opponent. This is how hard it is to hit — the prototype added the
 * instrument with the note that it "is the single biggest term in whether you get
 * hit, and it was nowhere on the HUD", which was true of ours too.
 *
 * MechFrame carries position but no velocity, so this differences two consecutive
 * frames over the sim's own tick. Nothing from the combat model is restated here:
 * the inputs are sim output and the arithmetic is geometry.
 */
export function crossingSpeedMps(
  prev: { x: number; y: number },
  now: { x: number; y: number },
  foe: { x: number; y: number },
  tickS: number,
): number {
  if (tickS <= 0) return 0;
  const vx = (now.x - prev.x) / tickS;
  const vy = (now.y - prev.y) / tickS;
  const dx = now.x - foe.x;
  const dy = now.y - foe.y;
  const r = Math.hypot(dx, dy) || 1e-6;
  return Math.abs(vx * (-dy / r) + vy * (dx / r));
}
