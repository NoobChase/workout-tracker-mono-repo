import type { HistoryPageResponse } from "@workout-tracker/shared";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { formatDay, plural } from "./format.js";

/**
 * Finished workouts as ruled lines: date, workout, program and cycle, and
 * the sets that count. History and home's "Recent workouts" both draw these.
 */
export function HistoryList({
  items,
  label,
}: {
  items: HistoryPageResponse["items"];
  label: string;
}) {
  return (
    <ol aria-label={label} className="border-t border-line">
      {items.map((s) => (
        <li key={s.sessionId} className="border-b border-line">
          <Link
            to={`/history/${s.sessionId}`}
            className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 outline-offset-[-2px] sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]"
          >
            <span className="col-span-2 text-sm text-muted-foreground sm:col-span-1">
              {formatDay(s.performedAt)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base font-semibold">
                {s.workoutName}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {s.programName} · Cycle{" "}
                <span className="num">{s.cycleNumber}</span>
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
              <span>
                <span className="num text-foreground">{s.countedSets}</span>{" "}
                {plural(s.countedSets, "set")}
              </span>
              <ChevronRight
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-4 transition-transform duration-150 ease-out [@media(hover:hover)]:group-hover:translate-x-0.5"
              />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
