// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Board } from './board';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
});

describe('Board: initial render', () => {
  it('adds the board-wrap class to the root and renders 64 squares', () => {
    new Board(root);
    expect(root.classList.contains('board-wrap')).toBe(true);
    expect(root.querySelectorAll('.sq').length).toBe(64);
  });

  it('places a piece image on every occupied starting square', () => {
    new Board(root);
    // 16 pieces per side = 32 pieces total on the starting position.
    expect(root.querySelectorAll('.sq img.pc').length).toBe(32);
  });

  it('orders squares a8..h1 (white orientation) by default — a8 is the first square', () => {
    new Board(root);
    const first = root.querySelector('.sq')!;
    expect(first.getAttribute('data-sq')).toBe('a8');
  });
});

describe('Board: orientation', () => {
  it('flips square order when flipped to black orientation', () => {
    const board = new Board(root);
    board.flip();
    expect(board.getOrientation()).toBe('b');
    const first = root.querySelector('.sq')!;
    expect(first.getAttribute('data-sq')).toBe('h1');
  });

  it('setOrientation sets orientation directly', () => {
    const board = new Board(root);
    board.setOrientation('b');
    expect(board.getOrientation()).toBe('b');
  });
});

describe('Board: position updates', () => {
  it('re-renders pieces when setFen is called', () => {
    const board = new Board(root);
    board.setFen('8/8/8/4k3/8/4K3/4P3/8 w - - 0 1'); // 3 pieces
    expect(root.querySelectorAll('.sq img.pc').length).toBe(3);
  });

  it('marks the selected square with the "sel" class', () => {
    const board = new Board(root);
    board.setSelected('e2');
    const sq = root.querySelector('[data-sq="e2"]')!;
    expect(sq.classList.contains('sel')).toBe(true);
    expect(board.getSelected()).toBe('e2');
  });

  it('marks highlighted squares with the "hl" class', () => {
    const board = new Board(root);
    board.setHighlights(['e4', 'e5']);
    expect(root.querySelector('[data-sq="e4"]')!.classList.contains('hl')).toBe(true);
    expect(root.querySelector('[data-sq="e5"]')!.classList.contains('hl')).toBe(true);
    expect(root.querySelector('[data-sq="d4"]')!.classList.contains('hl')).toBe(false);
  });

  it('marks both squares of the last move with the "last" class', () => {
    const board = new Board(root);
    board.setLastMove(['e2', 'e4']);
    expect(root.querySelector('[data-sq="e2"]')!.classList.contains('last')).toBe(true);
    expect(root.querySelector('[data-sq="e4"]')!.classList.contains('last')).toBe(true);
  });
});

describe('Board: click handling', () => {
  it('invokes onSquareClick with the clicked square', () => {
    const board = new Board(root);
    const clicked: string[] = [];
    board.onSquareClick = (sq) => clicked.push(sq);
    (root.querySelector('[data-sq="e4"]') as HTMLElement).click();
    expect(clicked).toEqual(['e4']);
  });

  it('re-wires click handlers after every re-render (setFen)', () => {
    const board = new Board(root);
    const clicked: string[] = [];
    board.onSquareClick = (sq) => clicked.push(sq);
    board.setFen(START_FEN); // triggers a re-render, replacing the DOM nodes
    (root.querySelector('[data-sq="d4"]') as HTMLElement).click();
    expect(clicked).toEqual(['d4']);
  });
});

describe('Board: arrows', () => {
  it('renders no arrow svg when no arrows are set', () => {
    new Board(root);
    expect(root.querySelector('svg.board-arrows')).toBeNull();
  });

  it('renders an arrow svg with one line per arrow when arrows are set', () => {
    const board = new Board(root);
    board.setArrow(['e2', 'e4']);
    const svg = root.querySelector('svg.board-arrows');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll('line').length).toBe(1);
  });

  it('setArrows renders multiple ranked arrows', () => {
    const board = new Board(root);
    board.setArrows([
      { from: 'e2', to: 'e4', rank: 1 },
      { from: 'd2', to: 'd4', rank: 2 },
    ]);
    const svg = root.querySelector('svg.board-arrows')!;
    expect(svg.querySelectorAll('line').length).toBe(2);
  });

  it('clears arrows when setArrow(null) is called', () => {
    const board = new Board(root);
    board.setArrow(['e2', 'e4']);
    board.setArrow(null);
    expect(root.querySelector('svg.board-arrows')).toBeNull();
  });
});

describe('Board: flashIllegal', () => {
  it('adds and later removes the "illegal" class on the target square', async () => {
    vi.useFakeTimers();
    const board = new Board(root);
    board.flashIllegal('e4');
    const sq = root.querySelector('[data-sq="e4"]')!;
    expect(sq.classList.contains('illegal')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(sq.classList.contains('illegal')).toBe(false);
    vi.useRealTimers();
  });

  it('does nothing for a square not present on the board (defensive)', () => {
    const board = new Board(root);
    expect(() => board.flashIllegal('z9')).not.toThrow();
  });
});
