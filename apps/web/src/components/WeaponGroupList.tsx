import { getPart, normaliseWeaponGroups, MAX_WEAPON_GROUPS, type Build } from '@mechbattler/sim';
import './PowerPriorityList.css';

/** Assign each gun to G1-G3 or none (MW spec §2). Groups are what the live console's chips fire. */
export function WeaponGroupList({ build, onSet }: { build: Build; onSet: (instanceId: string, group: number | null) => void }) {
  const groups = normaliseWeaponGroups(build);
  const guns = build.parts.filter((p) => getPart(p.partId).category === 'weapon');
  const groupOf = (id: string) => groups.findIndex((g) => g.includes(id));
  return (
    <div>
      <div className="section-head"><span className="eyebrow">Weapon groups</span></div>
      {guns.length === 0 ? (
        <div className="priority-empty">No weapons placed yet.</div>
      ) : guns.map((p) => {
        const current = groupOf(p.instanceId);
        return (
          <div className="priority-row" key={p.instanceId}>
            <span className="priority-name">{getPart(p.partId).name}</span>
            <div className="group-btns" role="group" aria-label={`Group for ${getPart(p.partId).name}`}>
              {Array.from({ length: MAX_WEAPON_GROUPS }, (_, g) => (
                <button key={g} type="button" aria-pressed={current === g} onClick={() => onSet(p.instanceId, g)}>{`G${g + 1}`}</button>
              ))}
              <button type="button" aria-pressed={current < 0} onClick={() => onSet(p.instanceId, null)} aria-label="No group">–</button>
            </div>
          </div>
        );
      })}
      <p className="stat-sub" style={{ marginTop: 8 }}>
        In a fight, each group has a chip: hold to load and wait, fire to release together. Ungrouped guns fire on Alpha and under the autopilot.
      </p>
    </div>
  );
}
