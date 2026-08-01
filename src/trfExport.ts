/**
 * FIDE TRF (Tournament Report File) export — the fixed-column format federations and TD software
 * (SwissSys, Vega, USCF's own submission tooling, etc.) use to exchange tournament results. Column
 * positions below follow the official spec verbatim (FIDE Handbook C.04 Annex 2, "Format of TRF",
 * Krause 2006 / updated 2014 / approved 2015) — see https://www.fide.com/FIDE/handbook/C04Annex2_TRF16.pdf.
 * Fields this app has no data for (sex, title, federation, FIDE id, birth date, arbiter names, round
 * dates — Round has no date field) are left blank rather than guessed; TRF treats those as optional.
 */
import { knockoutPlacements, standings, tournamentFormat } from './swissEngine';
import type { Round, Tournament } from './swissEngine';

function padLeft(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
}
function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}
function place(arr: string[], startCol1Indexed: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    const idx = startCol1Indexed - 1 + i;
    if (idx >= 0 && idx < arr.length) arr[idx] = value[i];
  }
}
function fmtDateSlash(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}
function fmtPoints(score: number): string {
  return padLeft(score.toFixed(1), 4);
}
/** "012 Tournament Name" etc — code at col 1-3, free text starting col 5. */
function tournamentLine(code: string, text: string): string {
  return text ? `${code} ${text}` : '';
}

function roundFieldsForPlayer(round: Round | undefined, playerId: number): { oppStr: string; color: string; result: string } {
  if (!round) return { oppStr: '0000', color: '-', result: 'Z' };
  const pr = round.pairings.find((p) => p.whiteId === playerId || p.blackId === playerId || p.byeId === playerId);
  if (!pr) return { oppStr: '0000', color: '-', result: 'Z' }; // not in this round (e.g. already eliminated in a knockout)
  if (pr.byeId === playerId) {
    const pts = pr.byePoints ?? 1;
    return { oppStr: '0000', color: '-', result: pts === 0.5 ? 'H' : 'U' };
  }
  const isWhite = pr.whiteId === playerId;
  const oppId = isWhite ? pr.blackId : pr.whiteId;
  const oppStr = oppId != null ? padLeft(String(oppId), 4) : '0000';
  const color = isWhite ? 'w' : 'b';
  let result = ' '; // no result entered yet
  if (pr.result === '1-0') result = isWhite ? '1' : '0';
  else if (pr.result === '0-1') result = isWhite ? '0' : '1';
  else if (pr.result === '1/2-1/2') result = '=';
  return { oppStr, color, result };
}

export function buildTrf(t: Tournament): string {
  const lines: string[] = [];
  const active = t.players.filter((p) => !p.isHouse);
  const fmt = tournamentFormat(t);

  lines.push(tournamentLine('012', t.name || 'Tournament'));
  const startDate = fmtDateSlash(t.createdAt);
  if (startDate) lines.push(tournamentLine('042', startDate));
  const lastRound = t.rounds[t.rounds.length - 1];
  const isComplete = !!lastRound && lastRound.complete && t.rounds.length >= t.totalRounds;
  if (isComplete) lines.push(tournamentLine('052', fmtDateSlash(new Date().toISOString())));
  lines.push(tournamentLine('062', String(active.length)));
  lines.push(tournamentLine('072', String(active.filter((p) => p.rating != null).length)));
  lines.push(tournamentLine('092', fmt === 'round-robin' ? 'Round Robin' : fmt === 'knockout' ? 'Knock-Out' : 'Swiss System'));

  const rankAndScore = new Map<number, { rank: number; score: number }>();
  if (fmt === 'knockout') {
    for (const p of knockoutPlacements(t)) rankAndScore.set(p.player.id, { rank: p.rank, score: p.player.score });
  } else {
    for (const s of standings(t)) rankAndScore.set(s.player.id, { rank: s.rank, score: s.score });
  }

  const ordered = [...active].sort((a, b) => (rankAndScore.get(a.id)?.rank ?? 999999) - (rankAndScore.get(b.id)?.rank ?? 999999));
  const width = 92 + Math.max(0, t.rounds.length - 1) * 10 + 10;
  for (const p of ordered) {
    const arr = new Array(width).fill(' ');
    place(arr, 1, '001');
    place(arr, 5, padLeft(String(p.id), 4));
    place(arr, 15, padRight(p.name, 33));
    if (p.rating != null) place(arr, 49, padLeft(String(p.rating), 4));
    const rs = rankAndScore.get(p.id);
    place(arr, 81, fmtPoints(rs?.score ?? p.score));
    if (rs) place(arr, 86, padLeft(String(rs.rank), 4));
    t.rounds.forEach((round, i) => {
      const base = 92 + i * 10;
      const { oppStr, color, result } = roundFieldsForPlayer(round, p.id);
      place(arr, base, oppStr);
      place(arr, base + 5, color);
      place(arr, base + 7, result);
    });
    lines.push(arr.join('').replace(/ +$/, ''));
  }

  return lines.filter((l) => l.length > 0).join('\r\n') + '\r\n';
}

export function downloadTrf(t: Tournament, filename: string) {
  const text = buildTrf(t);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
