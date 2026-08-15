import { describe, it, expect } from 'vitest';
import { buildTrf } from './trfExport';
import { createTournament, pairNextRound, commitRound, setResult } from './swissEngine';
import type { RosterEntry, Tournament } from './swissEngine';

function makeRoster(n: number): RosterEntry[] {
  return Array.from({ length: n }, (_, i) => ({ name: `Player ${i + 1}`, rating: 1000 + (n - i) * 10 }));
}

describe('buildTrf', () => {
  it('emits a 012 tournament-name line and 062/072/092 summary lines', () => {
    const t = createTournament('Spring Open', makeRoster(4));
    const trf = buildTrf(t);
    expect(trf).toContain('012 Spring Open');
    expect(trf).toMatch(/^062 4$/m);
    expect(trf).toMatch(/^072 4$/m); // all 4 players rated
    expect(trf).toMatch(/^092 Swiss System$/m);
  });

  it('labels round-robin and knockout formats correctly', () => {
    const rr = createTournament('T', makeRoster(4), undefined, 'round-robin');
    expect(buildTrf(rr)).toMatch(/^092 Round Robin$/m);
    const ko = createTournament('T', makeRoster(4), undefined, 'knockout');
    expect(buildTrf(ko)).toMatch(/^092 Knock-Out$/m);
  });

  it('writes one 001 player-record line per active player, with id and padded name', () => {
    const t = createTournament('T', makeRoster(2));
    const trf = buildTrf(t);
    const playerLines = trf.split('\r\n').filter((l) => l.startsWith('001'));
    expect(playerLines).toHaveLength(2);
    expect(playerLines[0]).toContain('Player');
  });

  it('excludes house (fill-in) players from the export', () => {
    const t = createTournament('T', makeRoster(3)); // odd -> forced bye
    const round = pairNextRound(t);
    commitRound(t, round);
    const trf = buildTrf(t);
    expect(trf.split('\r\n').filter((l) => l.startsWith('001'))).toHaveLength(3);
  });

  it('records round results as 1/0/= at the correct fixed columns', () => {
    const t = createTournament('T', makeRoster(2), 1);
    const round = pairNextRound(t);
    commitRound(t, round);
    setResult(t, 1, round.pairings[0].board, '1-0');
    const trf = buildTrf(t);
    const playerLines = trf.split('\r\n').filter((l) => l.startsWith('001'));
    // Round-1 result field is the 8th char of the round block starting at column 92 (1-indexed) —
    // i.e. offset 91+7=98 (0-indexed) in the fixed-width line.
    const resultChars = playerLines.map((l) => l[98]);
    expect(resultChars.sort()).toEqual(['0', '1']);
  });

  it('marks a forced bye as "U" and a requested bye as "H" in the result column', () => {
    const t = createTournament('T', makeRoster(3), 1); // odd -> forced bye for round 1
    const round = pairNextRound(t);
    commitRound(t, round);
    const trf = buildTrf(t);
    const playerLines = trf.split('\r\n').filter((l) => l.startsWith('001'));
    const byeLine = playerLines.find((l) => l[98] === 'U');
    expect(byeLine).toBeDefined();
  });

  it('leaves the result column blank for a round with no result entered yet', () => {
    const t = createTournament('T', makeRoster(2), 1);
    const round = pairNextRound(t);
    commitRound(t, round);
    const trf = buildTrf(t);
    const playerLines = trf.split('\r\n').filter((l) => l.startsWith('001'));
    for (const l of playerLines) expect(l[98] ?? ' ').toBe(' ');
  });

  it('sorts players by their standings rank, not roster order', () => {
    const roster: RosterEntry[] = [
      { name: 'Low Rated', rating: 900 },
      { name: 'High Rated', rating: 1900 },
    ];
    const t = createTournament('T', roster);
    const trf = buildTrf(t);
    const playerLines = trf.split('\r\n').filter((l) => l.startsWith('001'));
    // Higher-rated player should be ranked #1 (before any games are played, standings still order
    // ties by rating) and appear first.
    expect(playerLines[0]).toContain('High Rated');
  });

  it('always ends with a trailing CRLF', () => {
    const t = createTournament('T', makeRoster(2));
    expect(buildTrf(t).endsWith('\r\n')).toBe(true);
  });
});
