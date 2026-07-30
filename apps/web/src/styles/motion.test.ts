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
      // Strip hover-capability blocks, then any remaining :hover is ungated.
      // Matched by pattern rather than exact text: the stylesheet ported from the
      // prototype writes it as `@media (hover:hover)`, without the space.
      let stripped = '';
      let i = 0;
      while (i < css.length) {
        const rest = css.slice(i);
        const rel = rest.search(/@media\s*\(\s*hover\s*:\s*hover\s*\)/);
        if (rel === -1) { stripped += rest; break; }
        const start = i + rel;
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

/**
 * The ported prototype stylesheets are the source of truth for the shell's look.
 *
 * A first version of this suite tried to assert they contained no token-based
 * font sizes, on the theory that any would mean a sweep had rewritten them. That
 * premise was wrong: the prototypes already use --text-* throughout, which is
 * precisely why their token layer matched ours on import.
 */
describe('ported stylesheet integrity', () => {
  it('scopes the battle sheet so it cannot overwrite the builder shell', () => {
    // Both prototypes define .app, .topbar and .btn with different rules; loading
    // them flat would make import order decide which one wins.
    const battle = readFileSync('src/styles/battle.css', 'utf8');
    expect(battle).toMatch(/\.battle-app\s*\{/);

    const shell = readFileSync('src/styles/shell.css', 'utf8');
    for (const sel of ['.app', '.topbar']) {
      // The builder sheet owns these unscoped; the battle sheet must not.
      expect(shell).toContain(`${sel}{`);
      const outside = battle.slice(0, battle.indexOf('.battle-app {'));
      expect(outside).not.toContain(`${sel}{`);
    }
  });
});

/**
 * Every class the markup applies must be styled somewhere.
 *
 * Three bugs shipped past the suite because nothing checked this: a `.tbtn`
 * topbar button styled only inside `.battle-app`, a `.ro-unit` span that never
 * existed, and worst of all `.sheet.open` where the prototype reveals with
 * `.sheet.on` -- which left every bottom sheet translated 101% off the screen.
 */
describe('class coverage', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(p);
      return e.isFile() ? [p] : [];
    });
  }

  it('styles every class name used in markup', () => {
    const files = walk('src');
    const css = files.filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(f, 'utf8')).join('\n');
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

    // Fragments of template literals, and utility prefixes completed at runtime.
    const partial = /-$/;
    const missing = new Set<string>();

    for (const f of files.filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const raw = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
        for (const tok of raw.split(/\s+/)) {
          if (!tok || partial.test(tok) || defined.has(tok)) continue;
          missing.add(tok);
        }
      }
    }

    expect([...missing].sort()).toEqual([]);
  });
});
