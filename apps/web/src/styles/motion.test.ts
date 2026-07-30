import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * docs/14 §9 -- prefers-reduced-motion must cover ALL animation, and hover
 * styles must be gated so a tapped control does not keep a stuck hover state.
 *
 * These are stylesheet-wide invariants rather than component behaviour, so they
 * are asserted against the CSS source. That also makes them resistant to the
 * failure §9 describes: an enumerated list of animations going stale as soon as
 * somebody adds a keyframe.
 */
function stylesheets(): { path: string; css: string }[] {
  // vitest runs with the workspace root as cwd, so paths are relative to apps/web.
  const roots = ['src/styles', 'src/components'];
  return roots.flatMap((dir) => readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ path: `${dir}/${f}`, css: readFileSync(`${dir}/${f}`, 'utf8') })));
}

describe('motion and hover invariants', () => {
  it('finds stylesheets to check', () => {
    expect(stylesheets().length).toBeGreaterThan(5);
  });

  it('disables every animation under prefers-reduced-motion', () => {
    const global = readFileSync('src/styles/global.css', 'utf8');
    const block = global.slice(global.indexOf('@media (prefers-reduced-motion: reduce)'));

    // A blanket selector, so a newly added keyframe is covered by default
    // rather than by remembering to extend a list.
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/);
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it('gates every hover rule behind hover capability', () => {
    const offenders: string[] = [];

    for (const { path, css } of stylesheets()) {
      // Strip @media (hover: hover) blocks, then any remaining :hover is ungated.
      let stripped = '';
      let i = 0;
      while (i < css.length) {
        const start = css.indexOf('@media (hover: hover)', i);
        if (start === -1) { stripped += css.slice(i); break; }
        stripped += css.slice(i, start);
        // Walk to the matching close brace of the media block.
        let depth = 0;
        let j = css.indexOf('{', start);
        for (; j < css.length; j += 1) {
          if (css[j] === '{') depth += 1;
          else if (css[j] === '}') { depth -= 1; if (depth === 0) break; }
        }
        i = j + 1;
      }
      if (stripped.includes(':hover')) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });
});
