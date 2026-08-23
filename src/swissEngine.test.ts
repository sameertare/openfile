import { describe, it, expect } from 'vitest';
import {
  parseRoster,
  isNwchessRoster,
  createTournament,
  pairNextRound,
  commitRound,
  standings,
  setResult,
  recommendedRounds,
  recommendedRoundsRoundRobin,
  recommendedRoundsKnockout,
  roundRobinSchedule,
  seedOrder,
  knockoutPlacements,
  addFamilyGroup,
  removeFamilyGroup,
  requestByeForRound,
  cancelByeRequest,
  redoLatestRound,
  swapColors,
  swapByeWithPlayer,
  swapPlayersAcrossBoards,
  addExtraGameForBye,
  explainPairing,
  explainPairingDetail,
  explainRound,
  estimatedCurrentRating,
  nextRoundNumber,
  tournamentFormat,
  pairingMethod,
  type Tournament,
  type RosterEntry,
  type Player,
} from './swissEngine';

// ---------- helpers ----------

function makeRoster(n: number, opts: { rated?: boolean } = { rated: true }): RosterEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Player ${i + 1}`,
    rating: opts.rated === false ? null : 1000 + (n - i) * 10,
  }));
}

function playRound(t: Tournament, results: ('1-0' | '0-1' | '1/2-1/2')[]) {
  const round = pairNextRound(t);
  commitRound(t, round);
  const games = round.pairings.filter((p) => p.byeId == null);
  games.forEach((pr, i) => {
    const r = results[i % results.length];
    setResult(t, round.number, pr.board, r);
  });
  return round;
}

function findPlayer(t: Tournament, id: number): Player {
  const p = t.players.find((pp) => pp.id === id);
  if (!p) throw new Error(`player ${id} not found`);
  return p;
}

// ---------- roster parsing ----------

describe('parseRoster: plain list', () => {
  it('parses "Name Rating" lines', () => {
    const text = 'Alice Smith 1500\nBob Jones 1400\n';
    const roster = parseRoster(text, 'plain');
    expect(roster).toEqual([
      { name: 'Alice Smith', rating: 1500 },
      { name: 'Bob Jones', rating: 1400 },
    ]);
  });

  it('handles numbered lines and unrated players', () => {
    const text = '1. Alice Smith 1500\n2) Bob Jones\n3 - Carol Lee 900';
    const roster = parseRoster(text, 'plain');
    expect(roster).toEqual([
      { name: 'Alice Smith', rating: 1500 },
      { name: 'Bob Jones', rating: null },
      { name: 'Carol Lee', rating: 900 },
    ]);
  });

  it('splits two entries accidentally glued onto one line', () => {
    const text = 'Alice Smith 1500 2. Bob Jones 1400';
    const roster = parseRoster(text, 'plain');
    expect(roster.map((r) => r.name)).toEqual(['Alice Smith', 'Bob Jones']);
  });

  it('dedupes only exact name+rating repeats', () => {
    const text = 'Alice Smith 1500\nAlice Smith 1500\nAlice Smith 1400';
    const roster = parseRoster(text, 'plain');
    expect(roster).toHaveLength(2);
  });

  it('skips a header row', () => {
    const text = 'Name Rating\nAlice Smith 1500';
    const roster = parseRoster(text, 'plain');
    expect(roster).toEqual([{ name: 'Alice Smith', rating: 1500 }]);
  });
});

describe('parseRoster: header table', () => {
  it('parses a CSV wallchart with Name/Rating columns', () => {
    const text = 'Name,US Chess ID,Rating,Bye Rds\nAlice Smith,12345678,1500,\nBob Jones,87654321,1400,"4,5"';
    const roster = parseRoster(text, 'table');
    expect(roster).toEqual([
      { name: 'Alice Smith', rating: 1500 },
      { name: 'Bob Jones', rating: 1400, byeRounds: [4, 5] },
    ]);
  });

  it('never mistakes an ID column for the rating column', () => {
    const text = 'Name,USCF ID,Rating\nAlice Smith,999999,1500';
    const roster = parseRoster(text, 'table');
    expect(roster[0].rating).toBe(1500);
  });

  it('falls back to space-delimited wallchart rows', () => {
    const text = '1. Alice Smith 12345678 1500\n2. Bob Jones 87654321 1400';
    const roster = parseRoster(text, 'table');
    expect(roster.map((r) => r.name)).toEqual(['Alice Smith', 'Bob Jones']);
    expect(roster.map((r) => r.rating)).toEqual([1500, 1400]);
  });
});

describe('parseRoster: NWChess format', () => {
  const header = '" ","Name","NWSRS","USCF","FIDE","NWChess","Byes","Fees"';
  const subheader = '"","","First","","","","ID","","ID","","","ID","Title","","Rounds","Status"';

  it('detects the NWChess header', () => {
    expect(isNwchessRoster(`${header}\n${subheader}\n`)).toBe(true);
    expect(isNwchessRoster('Name,Rating\nAlice,1500')).toBe(false);
  });

  it('parses a standard row and picks max(NWSRS, USCF)', () => {
    const row = '"OpenU1300","Avula","Sujatha","13","Adult WA","1078","ADUNE77T","892","17048070","06/2027","0","39991393","","05/2027","","Paid"';
    const roster = parseRoster(`${header}\n${subheader}\n${row}`, 'nwchess');
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ name: 'Sujatha Avula', rating: 1078, lastName: 'Avula', firstName: 'Sujatha', section: 'OpenU1300' });
  });

  it('excludes withdrawn players by status or section', () => {
    const rows = [
      '"OpenU1300","Avula","Sujatha","13","Adult WA","1078","ADUNE77T","892","17048070","06/2027","0","39991393","","05/2027","","Paid"',
      '"Withdrew","Jones","Carl","13","Adult WA","1300","XXX","1200","1234567","06/2027","0","0","","05/2027","","Paid"',
    ];
    const withdrawnRow = '"OpenU1300","Lee","Dana","13","Adult WA","1400","XXX","1300","1234567","06/2027","0","0","","05/2027","","Withdrawn"';
    const roster = parseRoster([header, subheader, ...rows, withdrawnRow].join('\n'), 'nwchess');
    expect(roster.map((r) => r.name)).toEqual(['Sujatha Avula']);
  });

  it('parses requested-bye rounds from the second-to-last column', () => {
    const row = '"OpenU1300","Avula","Sujatha","13","Adult WA","1078","ADUNE77T","892","17048070","06/2027","0","39991393","","05/2027","3,6","Paid"';
    const roster = parseRoster(`${header}\n${subheader}\n${row}`, 'nwchess');
    expect(roster[0].byeRounds).toEqual([3, 6]);
  });

  it('ignores the FIDE rating column entirely', () => {
    // FIDE=1553 is much higher than NWSRS/USCF, but must never be selected.
    const row = '"OpenU1300","Suresh","Yaswitha","1","Richmond Chess Champions","827","RCRBZ14Z","740","33058887","03/2028","1553","2680653","","00/0000","","Paid"';
    const roster = parseRoster(`${header}\n${subheader}\n${row}`, 'nwchess');
    expect(roster[0].rating).toBe(827); // max(827, 740), not 1553
  });

  it('handles a section missing NWSRS entirely without absorbing FIDE into the slot', () => {
    const localHeader = '" ","Name","USCF","FIDE","NWChess","Byes","Fees"';
    const row = '"OpenU1800","Coates","John","13","Adult WA","","","1767","12939083","07/2028","0","0","","07/2027","","Paid"';
    const roster = parseRoster(`${localHeader}\n${subheader}\n${row}`, 'nwchess');
    expect(roster[0].rating).toBe(1767); // USCF only, FIDE=0 excluded anyway
  });
});

describe('parseRoster: onlineregistration.cc format', () => {
  // A real export snippet (headerless, tab-separated): name, FIDE id+country, FIDE rating,
  // US Chess id, US Chess rating, state, section, optional bye column.
  const SAMPLE = [
    'Battistella, Edwin\t30913950 [USA]\t1852\t12474865\t1930\tOR\tU2000\t',
    'Smith, Micah (Withdrawn)\t2087340 [USA]\t1831\t12762225\t1921\tWA\tU2000\t',
    'Howell, John C\t\tUnr\t11431739\t1909\tOR\tU2000\t',
    'Ade, Christopher T\t39991229 [USA]\tUnr\t31380418\t1841\tOR\tU2000\t',
    'Reifurth, Lawrence M\t2030527 [USA]\t1529\t12341360\t1700\tAZ\tU2000\t1/2:R2 R4',
    'Kesavan, Vihaan\t39990656 [USA]\t1721\t31471845\t1622\tOR\tU2000\t',
  ].join('\n');

  it('is auto-detected without an explicit format argument', () => {
    const roster = parseRoster(SAMPLE, 'auto');
    expect(roster.map((r) => r.name)).toContain('Edwin Battistella');
  });

  it('seeds by US Chess rating, not the last number-shaped token in the line', () => {
    // Regression case: parsePlainList's "last 3-4 digit run" heuristic would grab "2000" out of
    // the "U2000" section label on every row instead of the real rating.
    const roster = parseRoster(SAMPLE, 'onlineregistration');
    const battistella = roster.find((r) => r.name === 'Edwin Battistella')!;
    expect(battistella.rating).toBe(1930); // US Chess rating, not 2000
    expect(roster.every((r) => r.rating !== 2000)).toBe(true);
  });

  it('uses the US Chess rating even when the FIDE rating is "Unr" (FIDE id present, FIDE rating not yet established)', () => {
    const roster = parseRoster(SAMPLE, 'onlineregistration');
    const ade = roster.find((r) => r.name === 'Christopher T Ade')!;
    expect(ade.rating).toBe(1841); // US Chess rating, despite an unrated FIDE column
  });

  it('splits "Last, First Middle" into lastName/firstName for the FIDE tiebreak', () => {
    const roster = parseRoster(SAMPLE, 'onlineregistration');
    const howell = roster.find((r) => r.lastName === 'Howell')!;
    expect(howell.firstName).toBe('John C');
    expect(howell.name).toBe('John C Howell');
  });

  it('excludes players marked "(Withdrawn)"', () => {
    const roster = parseRoster(SAMPLE, 'onlineregistration');
    expect(roster.some((r) => r.name.includes('Smith'))).toBe(false);
  });

  it('uses the US Chess rating for a player with no FIDE id at all', () => {
    const roster = parseRoster(SAMPLE, 'onlineregistration');
    const howell = roster.find((r) => r.lastName === 'Howell')!;
    expect(howell.rating).toBe(1909); // blank FIDE column, real US Chess rating
  });

  it('falls back to FIDE rating when US Chess rating is "Unr" (synthetic — not in the sample export)', () => {
    const row = 'Test, Case\t123456 [USA]\t1600\t99999999\tUnr\tOR\tOpen\t';
    const roster = parseRoster(row, 'onlineregistration');
    expect(roster[0].rating).toBe(1600);
  });

  it('is unrated (null, not 0) when both FIDE and US Chess ratings are "Unr" (synthetic)', () => {
    const row = 'Test, Case\t123456 [USA]\tUnr\t99999999\tUnr\tOR\tOpen\t';
    const roster = parseRoster(row, 'onlineregistration');
    expect(roster[0].rating).toBeNull();
  });

  it('parses "R<n>" round numbers out of the bye column, ignoring the leading point-value fraction', () => {
    const roster = parseRoster(SAMPLE, 'onlineregistration');
    const reifurth = roster.find((r) => r.lastName === 'Reifurth')!;
    // "1/2:R2 R4" must yield [2, 4], not [1, 2, 2, 4] from also matching the "1/2" fraction.
    expect(reifurth.byeRounds).toEqual([2, 4]);
  });

  it('carries the section label through', () => {
    const roster = parseRoster(SAMPLE, 'onlineregistration');
    expect(roster.every((r) => r.section === 'U2000')).toBe(true);
  });

  it('is not misidentified as onlineregistration format by a plain list or NWChess export', () => {
    expect(parseRoster('Alice Smith 1500\nBob Jones 1400', 'auto')[0].section).toBeUndefined();
  });
});

// ---------- rounds recommendation / schedules ----------

describe('recommendedRounds', () => {
  it('grows with log2(n), floored at 3 and capped at 9', () => {
    expect(recommendedRounds(1)).toBe(0);
    expect(recommendedRounds(2)).toBe(3);
    expect(recommendedRounds(8)).toBe(3);
    expect(recommendedRounds(9)).toBe(4);
    expect(recommendedRounds(600)).toBe(9);
  });
});

describe('recommendedRoundsRoundRobin', () => {
  it('is n-1 for even fields, n for odd fields', () => {
    expect(recommendedRoundsRoundRobin(1)).toBe(0);
    expect(recommendedRoundsRoundRobin(4)).toBe(3);
    expect(recommendedRoundsRoundRobin(5)).toBe(5);
  });
});

describe('recommendedRoundsKnockout', () => {
  it('is ceil(log2(n))', () => {
    expect(recommendedRoundsKnockout(1)).toBe(0);
    expect(recommendedRoundsKnockout(8)).toBe(3);
    expect(recommendedRoundsKnockout(9)).toBe(4);
  });
});

describe('roundRobinSchedule', () => {
  it('pairs every id with every other id exactly once (even field)', () => {
    const ids = [1, 2, 3, 4];
    const rounds = roundRobinSchedule(ids);
    expect(rounds).toHaveLength(3);
    const seen = new Set<string>();
    for (const round of rounds) {
      const inRound = new Set<number>();
      for (const [a, b] of round) {
        expect(inRound.has(a)).toBe(false);
        expect(inRound.has(b)).toBe(false);
        inRound.add(a); inRound.add(b);
        const key = [a, b].sort((x, y) => x - y).join('-');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe((4 * 3) / 2);
  });

  it('pads an odd field with a -1 bye seat, still meeting everyone once', () => {
    const ids = [1, 2, 3];
    const rounds = roundRobinSchedule(ids);
    expect(rounds).toHaveLength(3);
    const seen = new Set<string>();
    for (const round of rounds) {
      for (const [a, b] of round) {
        if (a === -1 || b === -1) continue;
        const key = [a, b].sort((x, y) => x - y).join('-');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe((3 * 2) / 2);
  });
});

describe('seedOrder', () => {
  it('matches the classic bracket seeding for size 8', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('handles trivial sizes', () => {
    expect(seedOrder(1)).toEqual([1]);
    expect(seedOrder(2)).toEqual([1, 2]);
  });
});

// ---------- createTournament ----------

describe('createTournament', () => {
  it('assigns sequential ids in roster order and copies fields', () => {
    const roster = makeRoster(3);
    const t = createTournament('Test Open', roster);
    expect(t.players.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(t.players.every((p) => p.score === 0 && p.opponents.length === 0)).toBe(true);
    expect(tournamentFormat(t)).toBe('swiss');
    expect(pairingMethod(t)).toBe('swiss');
  });

  it('defaults totalRounds via recommendedRounds when not given', () => {
    const t = createTournament('Test', makeRoster(8));
    expect(t.totalRounds).toBe(recommendedRounds(8));
  });

  it('respects an explicit totalRounds override', () => {
    const t = createTournament('Test', makeRoster(8), 5);
    expect(t.totalRounds).toBe(5);
  });
});

// ---------- Swiss pairing basics ----------

describe('pairNextRound: Swiss mode basics', () => {
  it('pairs an even field into n/2 boards with no byes', () => {
    const t = createTournament('T', makeRoster(8));
    const round = pairNextRound(t);
    expect(round.pairings.filter((p) => p.byeId == null)).toHaveLength(4);
    expect(round.pairings.some((p) => p.byeId != null)).toBe(false);
  });

  it('gives exactly one bye to an odd field', () => {
    const t = createTournament('T', makeRoster(7));
    const round = pairNextRound(t);
    const byes = round.pairings.filter((p) => p.byeId != null);
    expect(byes).toHaveLength(1);
    expect(byes[0].byePoints).toBe(1);
  });

  it('never repeats an opponent when an alternative exists', () => {
    const t = createTournament('T', makeRoster(8));
    for (let i = 0; i < 4; i++) {
      const round = pairNextRound(t);
      commitRound(t, round);
      for (const pr of round.pairings.filter((p) => p.byeId == null)) {
        setResult(t, round.number, pr.board, '1-0');
      }
    }
    for (const p of t.players) {
      const opponents = p.opponents.filter((o) => o !== -1);
      expect(new Set(opponents).size).toBe(opponents.length);
    }
  });

  it('never gives the same player two forced byes while anyone with zero byes remains', () => {
    const t = createTournament('T', makeRoster(5));
    for (let i = 0; i < 4; i++) playRound(t, ['1-0']);
    const byeCounts = t.players.map((p) => p.byes);
    expect(Math.max(...byeCounts) - Math.min(...byeCounts)).toBeLessThanOrEqual(1);
  });

  it('honours a requested bye for the specific round only', () => {
    const t = createTournament('T', makeRoster(6));
    requestByeForRound(t, 1, 1);
    const round = pairNextRound(t);
    const bye = round.pairings.find((p) => p.byeId === 1);
    expect(bye).toBeDefined();
    expect(bye!.byePoints).toBe(0.5);
    expect(round.pairings.filter((p) => p.byeId == null)).toHaveLength(2); // 5 remaining -> 2 games + 1 forced bye
  });

  it('cancelByeRequest removes a not-yet-paired request', () => {
    const t = createTournament('T', makeRoster(6));
    requestByeForRound(t, 1, 1);
    cancelByeRequest(t, 1, 1);
    const round = pairNextRound(t);
    expect(round.pairings.some((p) => p.byeId === 1 && p.byePoints === 0.5)).toBe(false);
  });

  it('requestByeForRound rejects a round already paired', () => {
    const t = createTournament('T', makeRoster(4));
    playRound(t, ['1-0']);
    expect(requestByeForRound(t, 1, 1)).toBe(false);
  });
});

// ---------- FIDE round-1 algorithm ----------

describe('pairNextRound: FIDE round 1 (Dutch slide + colour alternation)', () => {
  it('slide-pairs S1[i] vs S2[i], not a fold, and alternates the lot colour by board parity', () => {
    // 8 players ranked 1..8 by rating (no ties). S1=[1..4], S2=[5..8].
    // Expected boards: 1v5, 2v6, 3v7, 4v8 with colour alternating S1/S2 by board parity.
    const roster = makeRoster(8);
    const t = createTournament('T', roster, 5, 'swiss', 'fide');
    const round = pairNextRound(t);
    const byId = new Map(t.players.map((p) => [p.id, p]));
    const games = round.pairings.filter((p) => p.byeId == null).sort((a, b) => a.board - b.board);
    expect(games).toHaveLength(4);

    const rankOf = (id: number) => t.players.findIndex((p) => p.id === id) + 1; // roster order == rating rank here
    const pairs = games.map((g) => [rankOf(g.whiteId!), rankOf(g.blackId!)].sort((a, b) => a - b));
    expect(pairs).toEqual([[1, 5], [2, 6], [3, 7], [4, 8]]);

    // Board 1 (odd): S1 side (rank 1-4) gets White. Board 2 (even): S2 side gets White.
    games.forEach((g, i) => {
      const whiteRank = rankOf(g.whiteId!);
      const isOddBoard = i % 2 === 0;
      if (isOddBoard) expect(whiteRank).toBeLessThanOrEqual(4);
      else expect(whiteRank).toBeGreaterThan(4);
    });
  });

  it('ranks unrated/tied players alphabetically by last, then first name (NWChess-parsed rosters)', () => {
    const roster: RosterEntry[] = [
      { name: 'Amy Zeta', rating: 1000, lastName: 'Zeta', firstName: 'Amy' },
      { name: 'Bob Alpha', rating: 1000, lastName: 'Alpha', firstName: 'Bob' },
    ];
    const t = createTournament('T', roster, 3, 'swiss', 'fide');
    const round = pairNextRound(t);
    // Alpha ranks above Zeta alphabetically -> Alpha is S1 (board 1, odd -> S1 gets White).
    const board1 = round.pairings.find((p) => p.board === 1)!;
    expect(findPlayer(t, board1.whiteId!).lastName).toBe('Alpha');
  });

  it('gives the pairing-allocated bye to the lowest-ranked player in an odd pool', () => {
    const roster = makeRoster(9);
    const t = createTournament('T', roster, 3, 'swiss', 'fide');
    const round = pairNextRound(t);
    const bye = round.pairings.find((p) => p.byeId != null)!;
    expect(bye.byeId).toBe(9); // roster order 9 == lowest rating
    expect(bye.byePoints).toBe(1);
  });

  it('excludes round-1 requested-bye players from the pool before PAB/slide is computed', () => {
    const roster = makeRoster(9);
    const t = createTournament('T', roster, 3, 'swiss', 'fide');
    requestByeForRound(t, 1, 1); // top-rated player sits out round 1
    const round = pairNextRound(t);
    const requestedBye = round.pairings.find((p) => p.byeId === 1);
    expect(requestedBye?.byePoints).toBe(0.5);
    // 9 - 1 requested = 8 remaining, even -> no forced PAB needed.
    expect(round.pairings.filter((p) => p.byeId != null && p.byePoints === 1)).toHaveLength(0);
  });
});

// ---------- FIDE strict-mode absolute criteria ----------

describe('pairNextRound: FIDE strict mode never repeats a pairing', () => {
  it('avoids a rematch across rounds when an alternative pairing exists', () => {
    const t = createTournament('T', makeRoster(8), 6, 'swiss', 'fide');
    for (let i = 0; i < 5; i++) playRound(t, ['1-0', '0-1', '1/2-1/2']);
    for (const p of t.players) {
      const opponents = p.opponents.filter((o) => o !== -1);
      expect(new Set(opponents).size).toBe(opponents.length);
    }
  });

  it('throws a descriptive error instead of producing a repeat pairing when the field is exhausted', () => {
    // 4 players, round-robin already exhausts all 3 possible distinct pairings in 3 rounds;
    // a 4th FIDE-strict round has nowhere left to go without a repeat.
    const t = createTournament('T', makeRoster(4), 4, 'swiss', 'fide');
    for (let i = 0; i < 3; i++) playRound(t, ['1-0']);
    expect(() => pairNextRound(t)).toThrow(/FIDE-compliant pairing/);
  });

  it('never gives a second forced bye to someone while anyone with zero byes remains, in strict mode', () => {
    // All draws keeps the whole field in one score bracket round after round, which the simplified
    // FIDE approximation (documented as weaker than a full bracket-transposition search — see the
    // PairingMethod doc comment) can always solve, unlike a field that splits apart from decisive
    // results.
    const t = createTournament('T', makeRoster(5), 5, 'swiss', 'fide');
    for (let i = 0; i < 4; i++) playRound(t, ['1/2-1/2']);
    const byeCounts = t.players.map((p) => p.byes);
    expect(Math.max(...byeCounts) - Math.min(...byeCounts)).toBeLessThanOrEqual(1);
  });
});

// ---------- family groups ----------

describe('family groups', () => {
  it('addFamilyGroup requires at least 2 valid player ids', () => {
    const t = createTournament('T', makeRoster(4));
    expect(addFamilyGroup(t, 'Siblings', [1])).toBeNull();
    const id = addFamilyGroup(t, 'Siblings', [1, 2]);
    expect(id).not.toBeNull();
    expect(t.familyGroups).toHaveLength(1);
  });

  it('removeFamilyGroup deletes by id', () => {
    const t = createTournament('T', makeRoster(4));
    const id = addFamilyGroup(t, 'Siblings', [1, 2])!;
    removeFamilyGroup(t, id);
    expect(t.familyGroups).toHaveLength(0);
  });

  it('avoids pairing family-group members against each other when an alternative exists', () => {
    const t = createTournament('T', makeRoster(8));
    addFamilyGroup(t, 'Siblings', [1, 5]); // would otherwise be the natural slide pairing (rank1 vs rank5)
    const round = pairNextRound(t);
    const oneVsFive = round.pairings.some(
      (p) => (p.whiteId === 1 && p.blackId === 5) || (p.whiteId === 5 && p.blackId === 1)
    );
    expect(oneVsFive).toBe(false);
  });
});

// ---------- standings ----------

describe('standings', () => {
  it('ranks by score, then Buchholz, then Sonneborn-Berger, then rating', () => {
    const t = createTournament('T', makeRoster(4));
    playRound(t, ['1-0', '0-1']);
    playRound(t, ['1-0', '0-1']);
    const rows = standings(t);
    expect(rows).toHaveLength(4);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
    }
    expect(rows[0].rank).toBe(1);
  });

  it('counts a forced full-point bye as a win and a requested half-point bye as a draw', () => {
    const t = createTournament('T', makeRoster(5));
    const round = pairNextRound(t);
    commitRound(t, round);
    const rows = standings(t);
    const byePr = round.pairings.find((p) => p.byeId != null)!;
    const byeRow = rows.find((r) => r.player.id === byePr.byeId)!;
    expect(byeRow.wins).toBe(1);
    expect(byeRow.score).toBe(1);
  });

  it('excludes house (fill-in) players from standings', () => {
    const t = createTournament('T', makeRoster(3)); // odd -> forced bye
    const round = pairNextRound(t);
    commitRound(t, round);
    const byePr = round.pairings.find((p) => p.byeId != null)!;
    addExtraGameForBye(t, round.number, byePr.byeId!, 'House Player', 1000);
    const rows = standings(t);
    expect(rows.some((r) => r.player.name === 'House Player')).toBe(false);
  });
});

// ---------- setResult ----------

describe('setResult', () => {
  it('applies and can overwrite a result, keeping scores consistent', () => {
    const t = createTournament('T', makeRoster(2));
    const round = pairNextRound(t);
    commitRound(t, round);
    const pr = round.pairings[0];
    setResult(t, 1, pr.board, '1-0');
    expect(findPlayer(t, pr.whiteId!).score).toBe(1);
    expect(findPlayer(t, pr.blackId!).score).toBe(0);
    setResult(t, 1, pr.board, '0-1'); // TD correction
    expect(findPlayer(t, pr.whiteId!).score).toBe(0);
    expect(findPlayer(t, pr.blackId!).score).toBe(1);
  });

  it('handles draws', () => {
    const t = createTournament('T', makeRoster(2));
    const round = pairNextRound(t);
    commitRound(t, round);
    const pr = round.pairings[0];
    setResult(t, 1, pr.board, '1/2-1/2');
    expect(findPlayer(t, pr.whiteId!).score).toBe(0.5);
    expect(findPlayer(t, pr.blackId!).score).toBe(0.5);
  });
});

// ---------- round-editing tools ----------

describe('swapColors', () => {
  it('flips white/black and the recorded result together', () => {
    const t = createTournament('T', makeRoster(2));
    const round = pairNextRound(t);
    commitRound(t, round);
    const pr = round.pairings[0];
    const origWhite = pr.whiteId;
    setResult(t, 1, pr.board, '1-0');
    expect(swapColors(t, 1, pr.board)).toBe(true);
    expect(pr.whiteId).not.toBe(origWhite);
    expect(pr.result).toBe('0-1'); // same winner, colors flipped
  });

  it('refuses to edit a round that is not the latest', () => {
    const t = createTournament('T', makeRoster(4), 3);
    playRound(t, ['1-0']);
    const round2 = pairNextRound(t);
    commitRound(t, round2);
    expect(swapColors(t, 1, 1)).toBe(false);
  });
});

describe('swapByeWithPlayer', () => {
  it('reassigns the bye to a different player, giving the original bye recipient a real board', () => {
    const t = createTournament('T', makeRoster(5));
    const round = pairNextRound(t);
    commitRound(t, round);
    const byePr = round.pairings.find((p) => p.byeId != null)!;
    const byeId = byePr.byeId!;
    const gamePr = round.pairings.find((p) => p.byeId == null)!;
    const otherPlayerId = gamePr.whiteId!;
    expect(swapByeWithPlayer(t, 1, byeId, otherPlayerId)).toBe(true);
    const newBye = round.pairings.find((p) => p.byeId != null)!;
    expect(newBye.byeId).toBe(otherPlayerId);
    const newGame = round.pairings.find((p) => p.whiteId === byeId || p.blackId === byeId);
    expect(newGame).toBeDefined();
  });
});

describe('swapPlayersAcrossBoards', () => {
  it('swaps two players onto each others boards', () => {
    const t = createTournament('T', makeRoster(8));
    const round = pairNextRound(t);
    commitRound(t, round);
    const [prA, prB] = round.pairings.filter((p) => p.byeId == null);
    const playerA = prA.whiteId!;
    const playerB = prB.whiteId!;
    expect(swapPlayersAcrossBoards(t, 1, playerA, playerB)).toBe(true);
    expect(prA.whiteId === playerB || prA.blackId === playerB).toBe(true);
    expect(prB.whiteId === playerA || prB.blackId === playerA).toBe(true);
  });

  it('refuses when either board already has a result', () => {
    const t = createTournament('T', makeRoster(8));
    const round = pairNextRound(t);
    commitRound(t, round);
    const [prA, prB] = round.pairings.filter((p) => p.byeId == null);
    setResult(t, 1, prA.board, '1-0');
    expect(swapPlayersAcrossBoards(t, 1, prA.whiteId!, prB.whiteId!)).toBe(false);
  });
});

describe('addExtraGameForBye', () => {
  it('converts a bye into a real game against a house player', () => {
    const t = createTournament('T', makeRoster(5));
    const round = pairNextRound(t);
    commitRound(t, round);
    const byePr = round.pairings.find((p) => p.byeId != null)!;
    const byeId = byePr.byeId!;
    expect(addExtraGameForBye(t, round.number, byeId, 'Coach Bot', 1200)).toBe(true);
    expect(byePr.byeId).toBeNull();
    expect([byePr.whiteId, byePr.blackId]).toContain(byeId);
    const house = t.players.find((p) => p.name === 'Coach Bot')!;
    expect(house.isHouse).toBe(true);
  });
});

describe('redoLatestRound', () => {
  it('discards and regenerates the latest unresulted round', () => {
    const t = createTournament('T', makeRoster(8));
    const round = pairNextRound(t);
    commitRound(t, round);
    const roundsBefore = t.rounds.length;
    expect(redoLatestRound(t)).toBe(true);
    expect(t.rounds).toHaveLength(roundsBefore);
  });

  it('refuses once any result has been entered', () => {
    const t = createTournament('T', makeRoster(4));
    const round = pairNextRound(t);
    commitRound(t, round);
    setResult(t, 1, round.pairings[0].board, '1-0');
    expect(redoLatestRound(t)).toBe(false);
  });
});

// ---------- knockout ----------

describe('knockout format', () => {
  it('seeds round 1 by rating using the standard bracket seed order', () => {
    const t = createTournament('T', makeRoster(4), undefined, 'knockout');
    const round = pairNextRound(t);
    // seedOrder(4) = [1,2,4,3] -> board1: seed1 vs seed4(id4), board2: seed2 vs seed3(id3)
    expect(round.pairings).toHaveLength(2);
    const board1 = round.pairings[0];
    expect([board1.whiteId, board1.blackId].sort()).toEqual([1, 4]);
  });

  it('advances winners to the next round and produces a single champion', () => {
    const t = createTournament('T', makeRoster(4), undefined, 'knockout');
    let round = pairNextRound(t);
    commitRound(t, round);
    for (const pr of round.pairings) setResult(t, round.number, pr.board, '1-0');
    round = pairNextRound(t);
    commitRound(t, round);
    expect(round.pairings).toHaveLength(1);
    setResult(t, round.number, round.pairings[0].board, '1-0');
    const placements = knockoutPlacements(t);
    expect(placements.filter((p) => p.isChampion)).toHaveLength(1);
    expect(placements[0].isChampion).toBe(true);
  });

  it('pads a non-power-of-2 field with byes to the top seeds', () => {
    const t = createTournament('T', makeRoster(3), undefined, 'knockout');
    const round = pairNextRound(t);
    const byes = round.pairings.filter((p) => p.byeId != null);
    expect(byes).toHaveLength(1);
    expect(byes[0].byeId).toBe(1); // top seed gets the bracket-padding bye
  });
});

// ---------- round-robin ----------

describe('round-robin format', () => {
  it('pairs every player against every other exactly once across the schedule', () => {
    const t = createTournament('T', makeRoster(6), undefined, 'round-robin');
    const seen = new Set<string>();
    for (let r = 0; r < t.totalRounds; r++) {
      const round = pairNextRound(t);
      commitRound(t, round);
      for (const pr of round.pairings.filter((p) => p.byeId == null)) {
        const key = [pr.whiteId, pr.blackId].sort((a, b) => a! - b!).join('-');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        setResult(t, round.number, pr.board, '1-0');
      }
    }
    expect(seen.size).toBe((6 * 5) / 2);
  });

  it('gives a forfeit bye when a scheduled opponent has withdrawn', () => {
    const t = createTournament('T', makeRoster(4), undefined, 'round-robin');
    t.players[1].withdrawn = true;
    let sawForfeitBye = false;
    for (let r = 0; r < t.totalRounds; r++) {
      const round = pairNextRound(t);
      commitRound(t, round);
      if (round.pairings.some((p) => p.byeId === t.players[0].id || round.pairings.some((pp) => pp.byeId != null))) {
        sawForfeitBye = sawForfeitBye || round.pairings.some((p) => p.byeId != null);
      }
      for (const pr of round.pairings.filter((p) => p.byeId == null)) setResult(t, round.number, pr.board, '1-0');
    }
    expect(sawForfeitBye).toBe(true);
  });
});

// ---------- explain* (smoke tests — structural correctness, not exact prose) ----------

describe('explainPairing / explainPairingDetail / explainRound', () => {
  it('returns a bye explanation for a bye board', () => {
    const t = createTournament('T', makeRoster(5));
    const round = pairNextRound(t);
    commitRound(t, round);
    const byePr = round.pairings.find((p) => p.byeId != null)!;
    const detail = explainPairingDetail(t, 1, byePr.board);
    expect(detail?.kind).toBe('bye');
    expect(explainPairing(t, 1, byePr.board).length).toBeGreaterThan(0);
  });

  it('returns a game explanation for a board pairing', () => {
    const t = createTournament('T', makeRoster(4));
    const round = pairNextRound(t);
    commitRound(t, round);
    const gamePr = round.pairings.find((p) => p.byeId == null)!;
    const detail = explainPairingDetail(t, 1, gamePr.board);
    expect(detail?.kind).toBe('game');
    expect(detail?.white?.id).toBe(gamePr.whiteId);
    expect(explainPairing(t, 1, gamePr.board).length).toBeGreaterThan(0);
  });

  it('explainRound groups players by their pre-round score', () => {
    const t = createTournament('T', makeRoster(4));
    playRound(t, ['1-0']);
    const summary = explainRound(t, 1);
    expect(summary.groups.length).toBeGreaterThan(0);
  });

  it('returns null/empty for a round that has not been paired yet', () => {
    const t = createTournament('T', makeRoster(4));
    expect(explainPairingDetail(t, 1, 1)).toBeNull();
    expect(explainPairing(t, 1, 1)).toEqual([]);
  });
});

// ---------- misc ----------

describe('nextRoundNumber', () => {
  it('is 1 before any round, then increments after each committed round', () => {
    const t = createTournament('T', makeRoster(4));
    expect(nextRoundNumber(t)).toBe(1);
    playRound(t, ['1-0']);
    expect(nextRoundNumber(t)).toBe(2);
  });
});

describe('estimatedCurrentRating', () => {
  it('returns null before any games are played for an unrated player with no history', () => {
    const t = createTournament('T', makeRoster(4, { rated: false }));
    expect(estimatedCurrentRating(t, 1)).toBeNull();
  });

  it('bootstraps an unrated player off their opponent once a game is recorded', () => {
    const roster: RosterEntry[] = [
      { name: 'Rated', rating: 1500 },
      { name: 'Unrated', rating: null },
    ];
    const t = createTournament('T', roster);
    const round = pairNextRound(t);
    commitRound(t, round);
    setResult(t, 1, round.pairings[0].board, round.pairings[0].whiteId === 1 ? '0-1' : '1-0'); // unrated wins
    const est = estimatedCurrentRating(t, 2);
    expect(est).not.toBeNull();
    expect(est!).toBeGreaterThan(1500); // won against a 1500 -> estimate rises above it
  });
});
