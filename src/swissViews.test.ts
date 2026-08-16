import { describe, it, expect } from 'vitest';
import { knockoutPlacementsTableHtml, standingsTableHtml, wallChartHtml, currentRoundPairingsHtml } from './swissViews';
import { createTournament, pairNextRound, commitRound, setResult } from './swissEngine';
import type { RosterEntry } from './swissEngine';

function makeRoster(n: number): RosterEntry[] {
  return Array.from({ length: n }, (_, i) => ({ name: `Player ${i + 1}`, rating: 1000 + (n - i) * 10 }));
}

describe('standingsTableHtml', () => {
  it('renders one row per active player with name and score', () => {
    const t = createTournament('T', makeRoster(4));
    const round = pairNextRound(t);
    commitRound(t, round);
    for (const pr of round.pairings) setResult(t, 1, pr.board, '1-0');
    const html = standingsTableHtml(t);
    for (const p of t.players) expect(html).toContain(p.name);
    // One header <tr> plus one <tr> per player.
    expect((html.match(/<tr>/g) ?? []).length).toBe(5);
  });

  it('escapes HTML-significant characters in player names', () => {
    const t = createTournament('T', [{ name: '<script>alert(1)</script>', rating: 1000 }, { name: 'Bob', rating: 900 }]);
    const html = standingsTableHtml(t);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks a withdrawn player with a "(wd)" hint', () => {
    const t = createTournament('T', makeRoster(4));
    t.players[0].withdrawn = true;
    const html = standingsTableHtml(t);
    expect(html).toContain('(wd)');
  });
});

describe('wallChartHtml', () => {
  it('renders one column header per played round', () => {
    const t = createTournament('T', makeRoster(4));
    const round = pairNextRound(t);
    commitRound(t, round);
    const html = wallChartHtml(t);
    expect(html).toContain('R1');
  });

  it('shows a bye cell for the player who received the round bye', () => {
    const t = createTournament('T', makeRoster(3)); // odd -> forced bye
    const round = pairNextRound(t);
    commitRound(t, round);
    const html = wallChartHtml(t);
    expect(html).toMatch(/bye 1/);
  });

  it('shows the opponent\'s standings rank and colour in each game cell', () => {
    const t = createTournament('T', makeRoster(4));
    const round = pairNextRound(t);
    commitRound(t, round);
    const html = wallChartHtml(t);
    expect(html).toMatch(/\d[wb]/);
  });
});

describe('currentRoundPairingsHtml', () => {
  it('renders "No round paired yet" before any round exists', () => {
    const t = createTournament('T', makeRoster(4));
    expect(currentRoundPairingsHtml(t)).toContain('No round paired yet');
  });

  it('lists white/black names per board and "…" for an unentered result', () => {
    const t = createTournament('T', makeRoster(4));
    const round = pairNextRound(t);
    commitRound(t, round);
    const html = currentRoundPairingsHtml(t);
    for (const p of t.players) expect(html).toContain(p.name);
    expect(html).toContain('…');
  });

  it('shows a final result once entered', () => {
    const t = createTournament('T', makeRoster(2));
    const round = pairNextRound(t);
    commitRound(t, round);
    setResult(t, 1, round.pairings[0].board, '1-0');
    const html = currentRoundPairingsHtml(t);
    expect(html).toContain('1–0');
  });

  it('shows a bye row with the correct point value', () => {
    const t = createTournament('T', makeRoster(3));
    const round = pairNextRound(t);
    commitRound(t, round);
    const html = currentRoundPairingsHtml(t);
    expect(html).toContain('BYE (+1)');
  });
});

describe('knockoutPlacementsTableHtml', () => {
  it('labels the eventual champion and shows every player\'s placement', () => {
    const t = createTournament('T', makeRoster(4), undefined, 'knockout');
    let round = pairNextRound(t);
    commitRound(t, round);
    for (const pr of round.pairings) setResult(t, round.number, pr.board, '1-0');
    round = pairNextRound(t);
    commitRound(t, round);
    setResult(t, round.number, round.pairings[0].board, '1-0');
    const html = knockoutPlacementsTableHtml(t);
    expect(html).toContain('🏆 Champion');
    for (const p of t.players) expect(html).toContain(p.name);
  });
});
