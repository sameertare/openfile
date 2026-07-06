// Groups PGN player-name strings that likely refer to the same person, so a report doesn't
// silently drop games just because one tournament's roster wrote "Tare, Eevie" while another
// wrote "Eevie" or "Eevie Tare".

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Canonical key for an exact name match: word order and "Last, First" vs "First Last" comma
 *  placement don't matter, only the set of words. */
export function nameKey(name: string): string {
  return tokens(name).sort().join(' ');
}

export interface NameGroup {
  keys: Set<string>; // every normalized nameKey() folded into this group
  count: number; // total game-appearances across all folded names
  display: string; // best label to show the user
}

/** Groups raw name -> appearance-count pairs into per-player clusters. Names that normalize to
 *  the same key merge automatically (handles case/whitespace/"Last, First" ordering). A shorter
 *  name (e.g. just a first name or nickname) additionally merges into a longer one when it's a
 *  strict subset of that longer name's words AND the relationship is unambiguous — i.e. no other
 *  distinct longer name in the file could equally be "the full form" of the short one. */
export function groupPlayerNames(namesWithCounts: Map<string, number>): NameGroup[] {
  const byKey = new Map<string, { keys: Set<string>; count: number; tokenSet: Set<string>; variants: Map<string, number> }>();
  for (const [raw, count] of namesWithCounts) {
    const key = nameKey(raw);
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { keys: new Set([key]), count: 0, tokenSet: new Set(tokens(raw)), variants: new Map() };
      byKey.set(key, entry);
    }
    entry.count += count;
    entry.variants.set(raw, (entry.variants.get(raw) ?? 0) + count);
  }
  const groups = [...byKey.values()];

  const pickDisplay = (variants: Map<string, number>): string => {
    return [...variants.entries()].sort((a, b) => {
      const wordDiff = tokens(b[0]).length - tokens(a[0]).length; // prefer fuller names
      if (wordDiff) return wordDiff;
      if (b[1] !== a[1]) return b[1] - a[1]; // then more frequent
      return a[0].includes(',') ? 1 : -1; // then no trailing-comma formatting
    })[0][0];
  };

  const merged = new Set<(typeof groups)[number]>();
  for (const g of groups) {
    if (merged.has(g)) continue;
    const supersets = groups.filter(
      (o) =>
        o !== g &&
        !merged.has(o) &&
        g.tokenSet.size < o.tokenSet.size &&
        [...g.tokenSet].every((t) => o.tokenSet.has(t))
    );
    if (supersets.length === 1) {
      const target = supersets[0];
      for (const k of g.keys) target.keys.add(k);
      target.count += g.count;
      for (const [raw, n] of g.variants) target.variants.set(raw, (target.variants.get(raw) ?? 0) + n);
      merged.add(g);
    }
  }

  return groups
    .filter((g) => !merged.has(g))
    .map((g) => ({ keys: g.keys, count: g.count, display: pickDisplay(g.variants) }));
}

/** Some lichess study chapters (typically ones added without a full PGN import) carry no
 *  [White]/[Black] tags at all — only a chapter title like "Black vs Suhaan Kesavan in Feb G60",
 *  where the color before "vs" is the study owner's. Extracts that color when the pattern is
 *  present, so those games can still be attributed to the owner instead of silently dropped. */
export function inferOwnerColorFromTitle(text: string | undefined): 'w' | 'b' | null {
  if (!text) return null;
  const m = text.match(/\b(white|black)\s+vs\b/i);
  if (!m) return null;
  return m[1].toLowerCase() === 'white' ? 'w' : 'b';
}
