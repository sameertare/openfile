/** Read-only HTML renderers shared between the Swiss Pairings editor (swiss.ts) and the big-screen
 *  wall display (wallchartDisplay.ts) — pure functions over a Tournament, no DOM/event wiring, so
 *  they're safe to import from a page that doesn't have swiss.ts's editable-round markup at all. */
import { knockoutPlacements, standings } from './swissEngine';
import type { Tournament } from './swissEngine';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Final-standings view for a knockout event — there's no running score to rank by, so this ranks
 *  by how far each player got (round eliminated in, later = better), with the standard tied-rank
 *  convention for players who went out in the same round. */
export function knockoutPlacementsTableHtml(t: Tournament): string {
  const rows = knockoutPlacements(t);
  return `<table><thead><tr>
      <th class="num">#</th><th>Player</th><th class="num">Rating</th><th>Result</th>
    </tr></thead><tbody>
    ${rows.map((r) => {
      const label = r.isChampion
        ? '🏆 Champion'
        : r.eliminatedRound == null
          ? 'Still in it'
          : r.eliminatedRound === t.totalRounds
            ? 'Runner-up'
            : r.eliminatedRound === t.totalRounds - 1
              ? 'Semifinal'
              : `Round ${r.eliminatedRound}`;
      return `<tr>
        <td class="num">${r.rank}</td>
        <td>${esc(r.player.name)}${r.player.withdrawn ? ' <span class="hint">(wd)</span>' : ''}</td>
        <td class="num">${r.player.rating ?? '—'}</td>
        <td class="${r.isChampion ? 'pos' : ''}"><b>${label}</b></td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

export function standingsTableHtml(t: Tournament): string {
  const rows = standings(t);
  return `<table><thead><tr>
      <th class="num">#</th><th>Player</th><th class="num">Rating</th><th class="num">Score</th>
      <th class="num">W</th><th class="num">D</th><th class="num">L</th>
      <th class="num">Buchholz</th><th class="num">S-B</th><th class="num">Colors</th>
    </tr></thead><tbody>
    ${rows.map((r) => `<tr>
        <td class="num">${r.rank}</td>
        <td>${esc(r.player.name)}${r.player.withdrawn ? ' <span class="hint">(wd)</span>' : ''}</td>
        <td class="num">${r.player.rating ?? '—'}</td>
        <td class="num"><b>${r.score}</b></td>
        <td class="num pos">${r.wins}</td><td class="num mid">${r.draws}</td><td class="num neg">${r.losses}</td>
        <td class="num">${r.buchholz}</td><td class="num">${r.sonnebornBerger}</td>
        <td class="num">${r.colorBalance > 0 ? '+' : ''}${r.colorBalance}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

/**
 * A crosstable: one row per player (in current standings order), one column per round, each cell
 * showing who they played and the outcome — the single most-requested view at an in-person
 * tournament for spotting repeat opponents or checking a specific player's path at a glance.
 */
export function wallChartHtml(t: Tournament): string {
  const rows = standings(t);
  const rankById = new Map(rows.map((r) => [r.player.id, r.rank]));
  const header = t.rounds.map((r) => `<th class="num">R${r.number}</th>`).join('');
  const body = rows
    .map((r) => {
      const cells = t.rounds
        .map((round) => {
          const pr = round.pairings.find(
            (p) => p.whiteId === r.player.id || p.blackId === r.player.id || p.byeId === r.player.id
          );
          if (!pr) return `<td class="num hint">—</td>`;
          if (pr.byeId != null) {
            const pts = pr.byePoints ?? 1;
            return `<td class="num mid">bye ${pts === 0.5 ? '½' : '1'}</td>`;
          }
          const isWhite = pr.whiteId === r.player.id;
          const oppId = isWhite ? pr.blackId! : pr.whiteId!;
          const oppRank = rankById.get(oppId) ?? '?';
          const color = isWhite ? 'w' : 'b';
          let sym = '';
          let cls = 'hint';
          if (pr.result === '1-0') { sym = isWhite ? '+' : '−'; cls = isWhite ? 'pos' : 'neg'; }
          else if (pr.result === '0-1') { sym = isWhite ? '−' : '+'; cls = isWhite ? 'neg' : 'pos'; }
          else if (pr.result === '1/2-1/2') { sym = '='; cls = 'mid'; }
          return `<td class="num ${cls}">${oppRank}${color}${sym}</td>`;
        })
        .join('');
      return `<tr><td class="num">${r.rank}</td><td>${esc(r.player.name)}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="games-table-wrap wallchart-wrap"><table class="wallchart-table"><thead><tr>
      <th class="num">#</th><th>Player</th>${header}
    </tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Read-only current-round pairings table for the wall display — no result-entry controls, no
 *  advanced/correction tooling, just what's happening on each board right now. */
export function currentRoundPairingsHtml(t: Tournament): string {
  const round = t.rounds[t.rounds.length - 1];
  if (!round) return '<p class="hint">No round paired yet.</p>';
  const rows = round.pairings
    .map((pr) => {
      if (pr.byeId != null) {
        const name = t.players.find((p) => p.id === pr.byeId)?.name ?? '—';
        const pts = pr.byePoints ?? 1;
        return `<tr><td class="num">${pr.board}</td><td colspan="2"><b>${esc(name)}</b></td><td class="mid">${pts === 0.5 ? 'BYE (+½)' : 'BYE (+1)'}</td></tr>`;
      }
      const white = t.players.find((p) => p.id === pr.whiteId)?.name ?? '—';
      const black = t.players.find((p) => p.id === pr.blackId)?.name ?? '—';
      const resultStr = pr.result === '1-0' ? '1–0' : pr.result === '0-1' ? '0–1' : pr.result === '1/2-1/2' ? '½–½' : '…';
      return `<tr><td class="num">${pr.board}</td><td>♔ ${esc(white)}</td><td>♚ ${esc(black)}</td><td class="num"><b>${resultStr}</b></td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th class="num">Bd</th><th>White</th><th>Black</th><th class="num">Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}
