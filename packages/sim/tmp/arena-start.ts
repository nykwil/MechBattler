import { Battle, WEAPON_REACH_MULT } from "../src/combat.js";
import { TEMPLATES } from "../src/templates.js";
import { getPart } from "../src/catalog.js";

function build(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error("missing template " + id);
  return structuredClone(t.build);
}

function angDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

function wrapPi(a: number) {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

function absAngDiff(a: number, b: number) {
  return Math.abs(wrapPi(a - b));
}

const matchups = [
  { name: "muleGunline", id: "mule-gunline" },
  { name: "vultureSkirmisher", id: "vulture-skirmisher" },
];
const distances = [160, 100];
const seeds = [1, 7, 21, 31, 42, 77, 20260730];

function summarizeMech(
  label: string,
  self: any,
  enemy: any,
  combatant: { orbitDir: number },
) {
  const dest = self.dest;
  const dx = dest ? dest.x - self.x : null;
  const dy = dest ? dest.y - self.y : null;
  const bearingToEnemy = Math.atan2(enemy.y - self.y, enemy.x - self.x);
  const bearingToDest =
    dest != null ? Math.atan2(dest.y - self.y, dest.x - self.x) : null;
  const face = self.facingRad;
  let bearingVs: string | null = null;
  if (self.faceMode === "bearing" && bearingToDest != null) {
    const dEnemy = absAngDiff(face, bearingToEnemy);
    const dDest = absAngDiff(face, bearingToDest);
    if (dDest < dEnemy - 1e-6) {
      bearingVs =
        "closer_to_DEST dDest=" +
        angDeg(dDest).toFixed(1) +
        " dEnemy=" +
        angDeg(dEnemy).toFixed(1);
    } else if (dEnemy < dDest - 1e-6) {
      bearingVs =
        "closer_to_ENEMY dDest=" +
        angDeg(dDest).toFixed(1) +
        " dEnemy=" +
        angDeg(dEnemy).toFixed(1);
    } else {
      bearingVs = "tied d=" + angDeg(dDest).toFixed(1);
    }
  }
  const guns = (self.weapons ?? []).map((w: any) => {
    const id = w.instanceId ?? w.partId ?? "?";
    return id + ":en=" + w.enabled + "/gate=" + w.gate;
  });
  const awayFromEnemy = absAngDiff(face, bearingToEnemy) > Math.PI / 2;
  const moveDown = dy != null && dy > 1;
  const moveUp = dy != null && dy < -1;
  console.log(
    "  " +
      label +
      ": tile=" +
      self.tile +
      " faceMode=" +
      self.faceMode +
      " intent=" +
      self.moveIntent +
      " face=" +
      angDeg(face).toFixed(1) +
      " deg" +
      " pos=(" +
      self.x.toFixed(1) +
      "," +
      self.y.toFixed(1) +
      ")" +
      " dest=" +
      (dest ? "(" + dest.x.toFixed(1) + "," + dest.y.toFixed(1) + ")" : "null") +
      " dDest=" +
      (dx != null ? "(" + dx.toFixed(1) + "," + dy!.toFixed(1) + ")" : "n/a") +
      " orbitDir=" +
      combatant.orbitDir,
  );
  console.log("         guns=[" + guns.join(", ") + "]");
  let line =
    "         bearEnemy=" +
    angDeg(bearingToEnemy).toFixed(1) +
    " deg";
  if (bearingToDest != null) {
    line += " bearDest=" + angDeg(bearingToDest).toFixed(1) + " deg";
  }
  if (bearingVs) line += " | bearingCheck: " + bearingVs;
  console.log(line);
  console.log(
    "         flags: faceAwayEnemy=" +
      awayFromEnemy +
      " dest+y(down)=" +
      moveDown +
      " dest-y(up)=" +
      moveUp,
  );
  return {
    awayFromEnemy,
    moveDown,
    moveUp,
    faceMode: self.faceMode as string,
    intent: self.moveIntent as string,
    dy,
    dx,
    faceDeg: angDeg(face),
    bearingEnemyDeg: angDeg(bearingToEnemy),
  };
}

console.log("=== Arena start autopilot probe (~5 steps / 0.25s) ===\n");

const playerFlags: {
  matchup: string;
  dist: number;
  seed: number;
  away: boolean;
  down: boolean;
  faceMode: string;
  intent: string;
  dy: number | null;
  faceDeg: number;
  bearingEnemyDeg: number;
  range: number;
}[] = [];

for (const m of matchups) {
  for (const dist of distances) {
    for (const seed of seeds) {
      const battle = new Battle({
        builds: [build(m.id), build(m.id)],
        seed,
        spawnDistanceM: dist,
        timeoutS: 5,
        recordFrames: true,
      });
      for (let i = 0; i < 5; i++) battle.step();
      const fr = battle.latestFrame()!;
      const range = Math.hypot(
        fr.mechs[0].x - fr.mechs[1].x,
        fr.mechs[0].y - fr.mechs[1].y,
      );
      console.log(
        "--- " +
          m.name +
          " @ spawnDistance=" +
          dist +
          " seed=" +
          seed +
          " range=" +
          range.toFixed(1) +
          " ---",
      );
      const f0 = summarizeMech(
        "mech0(player)",
        fr.mechs[0],
        fr.mechs[1],
        battle.combatants[0],
      );
      summarizeMech(
        "mech1(enemy) ",
        fr.mechs[1],
        fr.mechs[0],
        battle.combatants[1],
      );
      playerFlags.push({
        matchup: m.name,
        dist,
        seed,
        away: f0.awayFromEnemy,
        down: f0.moveDown,
        faceMode: f0.faceMode,
        intent: f0.intent,
        dy: f0.dy,
        faceDeg: f0.faceDeg,
        bearingEnemyDeg: f0.bearingEnemyDeg,
        range,
      });
      console.log("");
    }
  }
}

for (const id of ["mule-gunline", "vulture-skirmisher"]) {
  const b = build(id);
  let maxReach = 0;
  const weapons: string[] = [];
  for (const p of b.parts) {
    const def = getPart(p.partId);
    if (def.category !== "weapon" || !def.weapon) continue;
    const reach = def.weapon.falloff.rangeEnd * WEAPON_REACH_MULT;
    maxReach = Math.max(maxReach, reach);
    weapons.push(
      p.partId +
        " rangeEnd=" +
        def.weapon.falloff.rangeEnd +
        " reach=" +
        reach.toFixed(0),
    );
  }
  console.log(
    "template " + id + ": maxReach~" + maxReach.toFixed(0) + " [" + weapons.join("; ") + "]",
  );
}

console.log("\n=== SUMMARY: player (mech 0) facing away / moving +y ===");
console.log("total configs: " + playerFlags.length);
console.log(
  "faceMode=bearing: " + playerFlags.filter((p) => p.faceMode === "bearing").length,
);
console.log(
  "faceAwayEnemy (>90 from enemy): " + playerFlags.filter((p) => p.away).length,
);
console.log(
  "dest dy>+1 (screen-down): " + playerFlags.filter((p) => p.down).length,
);
console.log("\nPer-config player flags:");
for (const p of playerFlags) {
  console.log(
    "  " +
      p.matchup +
      " d=" +
      p.dist +
      " seed=" +
      p.seed +
      " range=" +
      p.range.toFixed(0) +
      ": faceMode=" +
      p.faceMode +
      " intent=" +
      p.intent +
      " face=" +
      p.faceDeg.toFixed(0) +
      " enemyBear=" +
      p.bearingEnemyDeg.toFixed(0) +
      " away=" +
      p.away +
      " +y=" +
      p.down +
      " dy=" +
      (p.dy != null ? p.dy.toFixed(1) : "n/a"),
  );
}

console.log("\n=== Out-of-reach supplemental (spawn 220/250, mule) ===");
for (const dist of [220, 250] as const) {
  for (const seed of [7, 21, 42] as const) {
    const battle = new Battle({
      builds: [build("mule-gunline"), build("mule-gunline")],
      seed,
      spawnDistanceM: dist,
      timeoutS: 2,
    });
    for (let i = 0; i < 5; i++) battle.step();
    const fr = battle.latestFrame()!;
    const m = fr.mechs[0];
    const e = fr.mechs[1];
    const range = Math.hypot(m.x - e.x, m.y - e.y);
    const be = Math.atan2(e.y - m.y, e.x - m.x);
    const bd = m.dest ? Math.atan2(m.dest.y - m.y, m.dest.x - m.x) : null;
    const dE = absAngDiff(m.facingRad, be);
    const dD = bd != null ? absAngDiff(m.facingRad, bd) : null;
    const dy = m.dest ? m.dest.y - m.y : null;
    console.log(
      "  dist=" +
        dist +
        " seed=" +
        seed +
        " range=" +
        range.toFixed(0) +
        " faceMode=" +
        m.faceMode +
        " intent=" +
        m.moveIntent +
        " face=" +
        angDeg(m.facingRad).toFixed(0) +
        " enemy=" +
        angDeg(be).toFixed(0) +
        " destBear=" +
        (bd != null ? angDeg(bd).toFixed(0) : "n/a") +
        " closer=" +
        (dD != null ? (dD < dE ? "DEST" : "ENEMY") : "n/a") +
        " dy=" +
        (dy != null ? dy.toFixed(1) : "n/a") +
        " guns=" +
        m.weapons.map((w: any) => w.enabled + "/" + w.gate).join(","),
    );
  }
}
