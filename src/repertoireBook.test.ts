import { describe, it, expect } from 'vitest';
import { REPERTOIRES, buildRepertoireTree, collectQuizPoints, nodeAtPath } from './repertoireBook';

describe('repertoireBook', () => {
  it('every bundled repertoire builds without an illegal-move error', () => {
    for (const def of REPERTOIRES) {
      expect(() => buildRepertoireTree(def)).not.toThrow();
    }
  });

  it('merges transposing lines into a single shared node', () => {
    const def = REPERTOIRES.find((r) => r.id === 'scotch-white')!;
    const tree = buildRepertoireTree(def);
    // 4...Nf6 and 4...Bc5 both start "1.e4 e5 2.Nf3 Nc6 3.d4 exd4" — that prefix should be one path,
    // not duplicated once per line that shares it.
    const afterExd4 = nodeAtPath(tree, ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4']);
    expect(afterExd4).not.toBeNull();
    expect(afterExd4!.children.size).toBeGreaterThanOrEqual(2); // Nxd4 and Bc4 both branch from here
  });

  it('collectQuizPoints only returns positions where it is the repertoire color to move', () => {
    for (const def of REPERTOIRES) {
      const tree = buildRepertoireTree(def);
      const quiz = collectQuizPoints(tree, def.color);
      expect(quiz.length).toBeGreaterThan(0);
      for (const q of quiz) {
        expect(q.fen.split(' ')[1]).toBe(def.color);
      }
    }
  });

  it('every quiz point has at least one recommended move', () => {
    for (const def of REPERTOIRES) {
      const tree = buildRepertoireTree(def);
      const quiz = collectQuizPoints(tree, def.color);
      for (const q of quiz) {
        const node = nodeAtPath(tree, q.path);
        expect(node).not.toBeNull();
        expect(node!.children.size).toBeGreaterThan(0);
      }
    }
  });

  it('the Haxo Gambit line is present in the White Scotch repertoire', () => {
    const def = REPERTOIRES.find((r) => r.id === 'scotch-white')!;
    const tree = buildRepertoireTree(def);
    const node = nodeAtPath(tree, ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'e5', 'd5', 'exf6', 'dxc4', 'fxg7', 'Rg8', 'Bh6']);
    expect(node).not.toBeNull();
  });

  it('nodeAtPath returns null for a path not in the tree', () => {
    const def = REPERTOIRES[0];
    const tree = buildRepertoireTree(def);
    expect(nodeAtPath(tree, ['e4', 'e5', 'Qh5'])).toBeNull();
  });
});
