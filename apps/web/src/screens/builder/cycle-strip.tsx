import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import { DifferentMark, LoggedMark } from "./markers.js";
import { cn } from "@/lib/utils";

export interface StripCycle {
  cycleNumber: number;
  /** Any workout in it has a session (D5). */
  logged: boolean;
  /** Its plan differs from cycle 1's (the apply preview, read for cycle 1). */
  different: boolean;
}

/**
 * The cycle strip `1 2 3 … N` (brief `apps-web-src-builder`), scrollable,
 * the cycle being edited marked as the current page. ● logged, ◆ differs
 * from cycle 1. Creating a program shows cycle 1 alone, not as a link.
 */
export function CycleStrip({
  programId,
  cycles,
  current,
}: {
  /** `null` while creating. */
  programId: string | null;
  cycles: StripCycle[];
  current: number;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [current]);

  return (
    <nav
      aria-label="Cycles"
      className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <ol ref={listRef} className="flex w-max gap-1 border-b border-line">
        {cycles.map((c) => {
          const here = c.cycleNumber === current;
          const marks = (
            <span className="flex h-2.5 items-center gap-1 text-muted-foreground">
              {c.logged ? <LoggedMark /> : null}
              {c.different ? <DifferentMark /> : null}
            </span>
          );
          const words = [
            `Cycle ${c.cycleNumber}`,
            c.logged ? "logged" : null,
            c.different ? "different from cycle 1" : null,
          ]
            .filter(Boolean)
            .join(", ");
          const cell = cn(
            "flex h-14 min-w-11 flex-col items-center justify-center gap-1 rounded-t-md px-2.5",
            "num text-[15px] no-underline transition-[background-color,color] duration-150",
            here
              ? "-mb-px border-b-2 border-foreground font-semibold text-foreground"
              : "text-muted-foreground hover:bg-ghost hover:text-foreground",
          );
          return (
            <li key={c.cycleNumber}>
              {programId === null ? (
                <span aria-current="page" aria-label={words} className={cell}>
                  {c.cycleNumber}
                  {marks}
                </span>
              ) : (
                <Link
                  to={`/programs/${programId}/cycles/${c.cycleNumber}`}
                  aria-current={here ? "page" : undefined}
                  aria-label={words}
                  className={cell}
                >
                  {c.cycleNumber}
                  {marks}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
