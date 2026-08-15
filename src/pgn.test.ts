import { describe, it, expect } from 'vitest';
import {
  sanitizePgnText,
  splitPgn,
  tryParseGame,
  parseGame,
  gameLink,
  isBotOrComputerGame,
  gameId,
  timeClassOf,
} from './pgn';

const SIMPLE_PGN = `[Event "Rated Blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "2026.01.01"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[TimeControl "300+0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
`;

const PGN_WITH_EVAL_CLK = `[Event "Rated Blitz game"]
[Site "https://lichess.org/xyz9876"]
[Date "2026.01.02"]
[White "Alice"]
[Black "Bob"]
[Result "0-1"]
[TimeControl "180+2"]

1. e4 { [%eval 0.17] [%clk 0:03:00] } e5 { [%eval 0.19] [%clk 0:02:58] } 2. Qh5 { [%eval 0.1] } Nc6 0-1
`;

function twoGamePgn(): string {
  return SIMPLE_PGN + '\n' + PGN_WITH_EVAL_CLK;
}

describe('sanitizePgnText', () => {
  it('strips a leading BOM', () => {
    const withBom = '﻿' + SIMPLE_PGN;
    expect(sanitizePgnText(withBom).startsWith('[Event')).toBe(true);
  });

  it('replaces non-breaking spaces and other unicode whitespace with plain spaces', () => {
    const text = '1. e4 e5';
    expect(sanitizePgnText(text)).toBe('1. e4 e5');
  });

  it('normalizes curly quotes to straight quotes', () => {
    const text = '[White “Alice”]';
    expect(sanitizePgnText(text)).toBe('[White "Alice"]');
  });

  it('strips stray control characters but keeps tabs/newlines/CR', () => {
    const text = 'a\x00b\tc\nd\re';
    expect(sanitizePgnText(text)).toBe('ab\tc\nd\re');
  });
});

describe('splitPgn', () => {
  it('splits a multi-game file on [Event lines', () => {
    const chunks = splitPgn(twoGamePgn());
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('Alice');
    expect(chunks[1]).toContain('0-1');
  });

  it('returns an empty array for blank input', () => {
    expect(splitPgn('')).toEqual([]);
    expect(splitPgn('   \n  ')).toEqual([]);
  });

  it('drops chunks with no header-shaped content', () => {
    expect(splitPgn('just some random text with no headers')).toEqual([]);
  });
});

describe('tryParseGame', () => {
  it('parses a simple game into headers and moves', () => {
    const { game, error } = tryParseGame(SIMPLE_PGN);
    expect(error).toBeUndefined();
    expect(game).not.toBeNull();
    expect(game!.headers.White).toBe('Alice');
    expect(game!.headers.Black).toBe('Bob');
    expect(game!.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
  });

  it('reads eval and clock annotations off the correct move', () => {
    const { game } = tryParseGame(PGN_WITH_EVAL_CLK);
    expect(game).not.toBeNull();
    const e4 = game!.moves[0];
    expect(e4.evalCp).toBe(17);
    expect(e4.clockSec).toBe(180);
  });

  it('merges adjacent eval/clock comment blocks that some exporters split into two', () => {
    const split = `[Event "E"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 { [%eval 0.2] } { [%clk 0:03:00] } e5 *`;
    const { game, error } = tryParseGame(split);
    expect(error).toBeUndefined();
    expect(game!.moves[0].evalCp).toBe(20);
    expect(game!.moves[0].clockSec).toBe(180);
  });

  it('converts a mate eval to a large signed centipawn value', () => {
    const withMate = `[Event "E"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 { [%eval #3] } e5 1-0`;
    const { game } = tryParseGame(withMate);
    expect(game!.moves[0].evalCp).toBe(10000 - 3);
  });

  it('reports a descriptive error for unparseable PGN', () => {
    const { game, error } = tryParseGame('this is not a pgn at all');
    expect(game).toBeNull();
    expect(error?.reason).toBeTruthy();
  });

  it('reports an error for a game with headers but no moves', () => {
    const noMoves = `[Event "E"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n*`;
    const { game, error } = tryParseGame(noMoves);
    expect(game).toBeNull();
    expect(error?.reason).toMatch(/No moves/);
  });
});

describe('parseGame', () => {
  it('is tryParseGame without the diagnostic wrapper', () => {
    expect(parseGame(SIMPLE_PGN)?.headers.White).toBe('Alice');
    expect(parseGame('not a pgn')).toBeNull();
  });
});

describe('gameLink', () => {
  it('prefers Link, falling back to Site, when it looks like a URL', () => {
    expect(gameLink({ Site: 'https://lichess.org/abcd1234' })).toBe('https://lichess.org/abcd1234');
    expect(gameLink({ Link: 'https://chess.com/game/1', Site: 'https://lichess.org/x' })).toBe('https://chess.com/game/1');
  });

  it('returns null when Site is a non-URL label', () => {
    expect(gameLink({ Site: 'Chess.com' })).toBeNull();
  });
});

describe('isBotOrComputerGame', () => {
  it('detects chess.com "Vs. Computer" games', () => {
    expect(isBotOrComputerGame({ Event: 'Vs. Computer' })).toBe(true);
  });
  it('detects lichess AI opponents by name', () => {
    expect(isBotOrComputerGame({ White: 'lichess AI level 5', Black: 'Human' })).toBe(true);
    expect(isBotOrComputerGame({ Black: 'lichess AI level 3', White: 'Human' })).toBe(true);
  });
  it('detects BOT-titled accounts', () => {
    expect(isBotOrComputerGame({ WhiteTitle: 'BOT' })).toBe(true);
    expect(isBotOrComputerGame({ BlackTitle: 'bot' })).toBe(true);
  });
  it('returns false for an ordinary human-vs-human game', () => {
    expect(isBotOrComputerGame({ Event: 'Rated Blitz', White: 'Alice', Black: 'Bob' })).toBe(false);
  });
});

describe('gameId', () => {
  it('uses the game URL when available', () => {
    const g = parseGame(SIMPLE_PGN)!;
    expect(gameId(g)).toBe('https://lichess.org/abcd1234');
  });

  it('falls back to a stable content hash when there is no URL', () => {
    const noLink = SIMPLE_PGN.replace('[Site "https://lichess.org/abcd1234"]', '[Site "Chess.com"]');
    const g = parseGame(noLink)!;
    const id = gameId(g);
    expect(id.startsWith('hash:')).toBe(true);
    // deterministic: parsing the same content twice gives the same id
    expect(gameId(parseGame(noLink)!)).toBe(id);
  });

  it('gives different games different hash ids', () => {
    const a = parseGame(SIMPLE_PGN.replace('[Site "https://lichess.org/abcd1234"]', '[Site "Chess.com"]'))!;
    const b = parseGame(PGN_WITH_EVAL_CLK.replace('[Site "https://lichess.org/xyz9876"]', '[Site "Chess.com"]'))!;
    expect(gameId(a)).not.toBe(gameId(b));
  });
});

describe('timeClassOf', () => {
  it('classifies by estimated game length (base + 40*increment)', () => {
    expect(timeClassOf('60+0')).toBe('Bullet');
    expect(timeClassOf('180+0')).toBe('Blitz');
    expect(timeClassOf('180+2')).toBe('Blitz'); // 180 + 80 = 260, still under 480
    expect(timeClassOf('600+0')).toBe('Rapid');
    expect(timeClassOf('5400+0')).toBe('Classical');
  });
  it('classifies a "/"-containing time control as Daily', () => {
    expect(timeClassOf('1/86400')).toBe('Daily');
  });
  it('returns Unknown for missing or unparseable input', () => {
    expect(timeClassOf(undefined)).toBe('Unknown');
    expect(timeClassOf('-')).toBe('Unknown');
    expect(timeClassOf('?')).toBe('Unknown');
    expect(timeClassOf('garbage')).toBe('Unknown');
  });
});
