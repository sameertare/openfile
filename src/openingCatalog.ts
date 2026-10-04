/**
 * The curated opening list the trainer offers. Each entry is a root position (the moves that define
 * the opening) plus the side that "owns" it — lines are then derived from every lichess variation
 * that starts with that root (see openingBook.ts), so this stays a short list of names/roots rather
 * than hand-authored move trees.
 */
export type Side = 'w' | 'b';

export interface CatalogOpening {
  id: string;
  name: string;
  side: Side;
  /** Space-separated SAN from move 1 that defines the opening. */
  root: string;
  /** Sharp, trap-heavy gambits get a "traps" tag in the picker. */
  traps?: boolean;
}

const w = (id: string, name: string, root: string, traps = false): CatalogOpening => ({ id, name, side: 'w', root, traps });
const b = (id: string, name: string, root: string, traps = false): CatalogOpening => ({ id, name, side: 'b', root, traps });

export const CATALOG: CatalogOpening[] = [
  // 1.e4 e5
  w('italian', 'Italian Game', 'e4 e5 Nf3 Nc6 Bc4'),
  w('evans', 'Evans Gambit', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4', true),
  b('two-knights', 'Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6'),
  w('fried-liver', 'Fried Liver Attack', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7', true),
  b('traxler', 'Traxler Counterattack', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 Bc5', true),
  w('ruy-lopez', 'Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5'),
  w('scotch', 'Scotch Game', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4'),
  w('scotch-gambit', 'Scotch Gambit', 'e4 e5 Nf3 Nc6 d4 exd4 Bc4'),
  w('four-knights', 'Four Knights Game', 'e4 e5 Nf3 Nc6 Nc3 Nf6'),
  w('ponziani', 'Ponziani Opening', 'e4 e5 Nf3 Nc6 c3'),
  b('petrov', 'Petrov Defense', 'e4 e5 Nf3 Nf6'),
  b('stafford', 'Stafford Gambit', 'e4 e5 Nf3 Nf6 Nxe5 Nc6', true),
  b('philidor', 'Philidor Defense', 'e4 e5 Nf3 d6'),
  b('latvian', 'Latvian Gambit', 'e4 e5 Nf3 f5', true),
  w('bishops', "Bishop's Opening", 'e4 e5 Bc4'),
  w('vienna', 'Vienna Game', 'e4 e5 Nc3'),
  w('kings-gambit', "King's Gambit", 'e4 e5 f4', true),
  w('center-game', 'Center Game', 'e4 e5 d4 exd4 Qxd4'),
  w('danish', 'Danish Gambit', 'e4 e5 d4 exd4 c3', true),
  // 1.e4 vs Sicilian / others
  b('najdorf', 'Sicilian Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'),
  b('dragon', 'Sicilian Dragon', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'),
  b('acc-dragon', 'Sicilian Accelerated Dragon', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6'),
  b('sveshnikov', 'Sicilian Sveshnikov', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5'),
  b('taimanov', 'Sicilian Taimanov', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6'),
  w('rossolimo', 'Sicilian Rossolimo', 'e4 c5 Nf3 Nc6 Bb5'),
  w('closed-sicilian', 'Closed Sicilian', 'e4 c5 Nc3'),
  w('alapin', 'Sicilian Alapin (2.c3)', 'e4 c5 c3'),
  w('smith-morra', 'Smith-Morra Gambit', 'e4 c5 d4 cxd4 c3', true),
  b('french', 'French Defense', 'e4 e6'),
  b('caro-kann', 'Caro-Kann', 'e4 c6'),
  b('scandinavian', 'Scandinavian', 'e4 d5'),
  b('modern-scandi', 'Modern Scandinavian (2...Nf6)', 'e4 d5 exd5 Nf6'),
  b('pirc', 'Pirc Defense', 'e4 d6 d4 Nf6 Nc3 g6'),
  b('modern-defense', 'Modern Defense (Robatsch)', 'e4 g6'),
  b('alekhine', 'Alekhine Defense', 'e4 Nf6'),
  b('nimzowitsch', 'Nimzowitsch Defense', 'e4 Nc6'),
  // 1.d4 d5
  b('qgd', "Queen's Gambit Declined", 'd4 d5 c4 e6'),
  b('tarrasch', 'Tarrasch Defense', 'd4 d5 c4 e6 Nc3 c5'),
  b('qga', "Queen's Gambit Accepted", 'd4 d5 c4 dxc4'),
  b('slav', 'Slav Defense', 'd4 d5 c4 c6'),
  b('semi-slav', 'Semi-Slav', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6'),
  b('chigorin', 'Chigorin Defense', 'd4 d5 c4 Nc6'),
  b('albin', 'Albin Countergambit', 'd4 d5 c4 e5', true),
  w('bdg', 'Blackmar-Diemer Gambit', 'd4 d5 e4', true),
  b('englund', 'Englund Gambit', 'd4 e5', true),
  w('london', 'London System', 'd4 d5 Bf4'),
  w('colle', 'Colle System', 'd4 d5 Nf3 Nf6 e3'),
  // Indian defenses
  b('kid', "King's Indian Defense", 'd4 Nf6 c4 g6 Nc3 Bg7'),
  b('nimzo', 'Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4'),
  b('qid', "Queen's Indian Defense", 'd4 Nf6 c4 e6 Nf3 b6'),
  b('bogo', 'Bogo-Indian Defense', 'd4 Nf6 c4 e6 Nf3 Bb4+'),
  b('grunfeld', 'Grünfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5'),
  b('benoni', 'Modern Benoni', 'd4 Nf6 c4 c5 d5 e6'),
  b('benko', 'Benko Gambit', 'd4 Nf6 c4 c5 d5 b5', true),
  b('old-indian', 'Old Indian Defense', 'd4 Nf6 c4 d6'),
  b('budapest', 'Budapest Gambit', 'd4 Nf6 c4 e5', true),
  w('catalan', 'Catalan', 'd4 Nf6 c4 e6 g3'),
  w('torre', 'Torre Attack', 'd4 Nf6 Nf3 e6 Bg5'),
  w('trompowsky', 'Trompowsky Attack', 'd4 Nf6 Bg5'),
  b('dutch', 'Dutch Defense', 'd4 f5'),
  b('stonewall', 'Stonewall Dutch', 'd4 f5 g3 Nf6 Bg2 e6 Nf3 d5'),
  // Flank openings
  w('english-reversed-sicilian', 'English: Reversed Sicilian', 'c4 e5'),
  w('english-four-knights', 'English: Four Knights', 'c4 e5 Nc3 Nf6 Nf3 Nc6'),
  w('english-symmetrical', 'English: Symmetrical', 'c4 c5'),
  w('english-hedgehog', 'English: Hedgehog', 'c4 c5 Nf3 Nf6 Nc3 e6 g3 b6'),
  w('english-vs-nf6', 'English: vs ...Nf6 and ...e6', 'c4 Nf6'),
  w('reti', 'Réti Opening', 'Nf3 d5 c4'),
  w('kia', "King's Indian Attack", 'Nf3 d5 g3'),
  w('bird', "Bird's Opening", 'f4'),
  w('larsen', "Larsen's Opening (1.b3)", 'b3'),
];

export function catalogById(id: string): CatalogOpening | undefined {
  return CATALOG.find((o) => o.id === id);
}
