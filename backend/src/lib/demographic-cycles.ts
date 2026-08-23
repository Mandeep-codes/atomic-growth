// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY DEMOGRAPHIC CYCLES
//
// Demographics are re-submitted every week, and geo payout qualification is
// re-evaluated per cycle. A cycle is identified by the MONDAY of its week, in
// UTC, formatted YYYY-MM-DD to match the `cycle_start` DATE column.
//
// UTC deliberately, not server-local time: the boundary decides which week a
// clipper's report — and therefore their bonus rate — belongs to. A local-time
// boundary would shift under a server timezone change or DST, silently moving
// submissions between cycles and repricing money. Matches the SQL backfill in
// migration 0056, which uses WEEKDAY() (0 = Monday).
// ─────────────────────────────────────────────────────────────────────────────

/** The Monday (UTC) of the week containing `when`, as YYYY-MM-DD. */
export function cycleStartFor(when: Date = new Date()): string {
  const date = new Date(
    Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate())
  );
  // getUTCDay(): 0 = Sunday. Shift so Monday is 0, matching MySQL's WEEKDAY().
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

/** The cycle currently open for submissions. */
export const currentCycleStart = () => cycleStartFor();
