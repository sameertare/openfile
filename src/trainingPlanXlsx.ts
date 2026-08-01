/**
 * Exports a generated TrainingPlan as a real .xlsx workbook, entirely client-side. Uses SheetJS,
 * vendored from https://cdn.sheetjs.com (see vendor/xlsx-0.20.3.tgz) rather than the `xlsx` npm
 * registry package — that registry listing is stuck on a stale 0.18.5 release with known CVEs
 * (prototype pollution / ReDoS) due to a longstanding npm registry bug; SheetJS's own docs direct
 * users to install the current, patched build from their CDN instead. See
 * https://docs.sheetjs.com/docs/getting-started/installation/nodejs for their own writeup.
 *
 * The "Done" column is written as native boolean cells (not styled checkboxes — the freely
 * available API surface doesn't expose Excel's interactive form-control checkboxes). Both Excel
 * (365/2021+, via Insert > Checkbox on a selected range) and Google Sheets (Insert > Checkbox)
 * turn a boolean column into a clickable checkbox in one step once the file is open, so this is
 * checkbox-*ready* rather than pre-rendered — documented as such in the app UI, not oversold.
 */
import * as XLSX from 'xlsx';
import type { TrainingPlan } from './trainingPlan';
import { tasksByDay } from './trainingPlan';

function planDayDate(startISO: string, day: number): Date {
  const d = new Date(startISO);
  d.setDate(d.getDate() + (day - 1));
  return d;
}

export function downloadTrainingPlanXlsx(
  plan: TrainingPlan,
  done: Record<string, boolean>,
  startDateISO: string,
  playerName: string
) {
  const header = ['Day', 'Date', 'Focus area', 'Priority', 'Task', 'Why (evidence)', 'Resource link(s)', 'Done'];
  const rows: (string | number | boolean)[][] = [header];

  for (const { day, tasks } of tasksByDay(plan)) {
    const dateStr = planDayDate(startDateISO, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    for (const t of tasks) {
      const links = t.links.map((l) => `${l.label}: ${l.url}`).join('  |  ');
      rows.push([day, dateStr, t.area, t.severity, t.title, t.detail ?? '', links, !!done[t.id]]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 45 }, { wch: 50 }, { wch: 60 }, { wch: 7 },
  ];
  // Hyperlink the resource-link cell when a row has exactly one link, so it's clickable directly —
  // rows with multiple links keep the plain "label: url | label: url" text instead (a cell can only
  // carry one hyperlink target).
  let r = 1; // row 0 is the header
  for (const { tasks } of tasksByDay(plan)) {
    for (const t of tasks) {
      if (t.links.length === 1) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 6 });
        const cell = ws[cellRef];
        if (cell) cell.l = { Target: t.links[0].url };
      }
      r++;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Training Plan');

  const safeName = playerName.replace(/[^\w.-]/g, '_').slice(0, 40);
  XLSX.writeFile(wb, `training-plan-${safeName}-${plan.duration}d.xlsx`);
}
