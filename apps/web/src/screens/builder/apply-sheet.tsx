import type {
  ApplyPreviewResponse,
  SaveCycleRequest,
} from "@workout-tracker/shared";
import { Lock } from "lucide-react";
import { useState } from "react";
import { DifferentMark } from "./markers.js";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/sheet";

/*
 * The apply check (operations.md 3.8; design D7; brief
 * `apps-web-src-builder`), opened by saving a cycle that has later cycles.
 * Every later cycle is a checkbox: the ones that matched this cycle before
 * the edit are checked; one that differs is unchecked and annotated "looks
 * intentionally different" (the lifter may check it anyway); logged cycles
 * are listed as unchangeable. The guard informs; the lifter decides.
 */

/** "6–8, 10, 12": cycle numbers as runs. */
export function cycleRuns(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(
      j === i
        ? String(sorted[i])
        : j === i + 1
          ? `${sorted[i]}, ${sorted[j]}`
          : `${sorted[i]}–${sorted[j]}`,
    );
    i = j + 1;
  }
  return runs.join(", ");
}

export function ApplySheet({
  open,
  onOpenChange,
  preview,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: ApplyPreviewResponse;
  busy: boolean;
  /** The chosen later cycles, each with the fingerprint the lifter saw. */
  onSave: (applyTo: SaveCycleRequest["applyTo"]) => void;
}) {
  const n = preview.cycleNumber;
  const open_ = preview.later.filter((c) => !c.trained);
  const logged = preview.later
    .filter((c) => c.trained)
    .map((c) => c.cycleNumber);
  const [chosen, setChosen] = useState<Set<number>>(
    () => new Set(open_.filter((c) => c.matches).map((c) => c.cycleNumber)),
  );
  const k = chosen.size;
  const toggle = (cycle: number, on: boolean) =>
    setChosen((s) => {
      const next = new Set(s);
      if (on) next.add(cycle);
      else next.delete(cycle);
      return next;
    });
  const targets = () =>
    open_
      .filter((c) => chosen.has(c.cycleNumber))
      .map((c) => ({ cycleNumber: c.cycleNumber, fingerprint: c.fingerprint }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Apply to later cycles?</SheetTitle>
          <SheetDescription>
            Saving changes to cycle {n}. The same edit can go to the cycles
            after it; checked ones become identical to cycle {n}, and nothing
            else changes. This is the only time to choose.
          </SheetDescription>
        </SheetHeader>
        {open_.length > 0 ? (
          <fieldset>
            <legend className="pb-2 text-sm font-medium text-muted-foreground">
              Apply to
            </legend>
            <ul className="border-t border-line">
              {open_.map((c) => (
                <li key={c.cycleNumber} className="border-b border-line">
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
                    <Checkbox
                      checked={chosen.has(c.cycleNumber)}
                      onCheckedChange={(v) => toggle(c.cycleNumber, v === true)}
                    />
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                      <span className="text-[15px] font-semibold">
                        Cycle <span className="num">{c.cycleNumber}</span>
                      </span>
                      {c.matches ? null : (
                        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                          <DifferentMark />
                          looks intentionally different (its own workouts or
                          sets)
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
        {logged.length > 0 ? (
          <p className="flex gap-2 text-[15px] text-muted-foreground">
            <Lock
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-1 size-4 shrink-0"
            />
            <span>
              {logged.length === 1 ? "Cycle" : "Cycles"}{" "}
              <span className="num">{cycleRuns(logged)}</span>{" "}
              {logged.length === 1 ? "is" : "are"} already logged and cannot be
              changed.
            </span>
          </p>
        ) : null}
        {/* Pinned, so a long list of cycles never hides the choice. */}
        <div className="sticky -bottom-6 -mx-5 -mb-6 flex flex-col gap-2 border-t border-line bg-background px-5 pt-3 pb-6 sm:flex-row-reverse">
          <Button
            variant="primary"
            // The label names the runs, so a long one may wrap; the
            // button grows instead of clipping it.
            className="h-auto min-h-12 py-2.5 text-balance whitespace-normal sm:flex-1"
            disabled={k === 0 || busy}
            loading={busy}
            onClick={() => onSave(targets())}
          >
            {k === 0 ? (
              "Save and apply"
            ) : (
              <span>
                Save and apply to {k === 1 ? "cycle" : "cycles"}{" "}
                <span className="num">{cycleRuns([...chosen])}</span>
              </span>
            )}
          </Button>
          <Button
            className="sm:flex-1"
            disabled={busy}
            onClick={() => onSave([])}
          >
            Save to cycle {n} only
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
