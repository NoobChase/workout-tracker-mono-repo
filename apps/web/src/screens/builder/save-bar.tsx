import {
  programLimits,
  type ApplyPreviewResponse,
  type CycleDetailResponse,
  type SaveCycleRequest,
} from "@workout-tracker/shared";
import { CloudOff } from "lucide-react";
import type { BuilderAction } from "./reducer.js";
import type { CreateState } from "./tree.js";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { NumberField } from "@/ui/number-field";
import { Segmented } from "@/ui/segmented";

/** What a save came to (`BuilderMode.submit`). */
export type SubmitOutcome =
  | { kind: "saved"; title: string; description?: string }
  /** Refused, or couldn't be sent, in these words. */
  | { kind: "problem"; message: string }
  /**
   * The cycle changed since it was loaded (D7): reload (`reread`) and save
   * again. `reason` is the server's words, `null` for the bar's own.
   */
  | {
      kind: "stale";
      reason: string | null;
      reread: () => Promise<CycleDetailResponse>;
    }
  /** Later cycles exist: the lifter chooses which get the edit, then `commit`. */
  | {
      kind: "choose";
      preview: ApplyPreviewResponse;
      commit: (applyTo: SaveCycleRequest["applyTo"]) => Promise<SubmitOutcome>;
    };

/**
 * Where a save stands (operations.md 3.1, 3.7, 3.8; design D7). One value,
 * so the bar can't show a problem and a stale refusal at once, or spin
 * while a choice is waiting.
 */
export type SaveState =
  | { kind: "idle" }
  /** Checking the cycle (the apply preview) or sending the save. */
  | { kind: "busy" }
  /** Sending what was chosen in the apply sheet. */
  | { kind: "applying" }
  | Exclude<SubmitOutcome, { kind: "saved" }>;

export const IDLE: SaveState = { kind: "idle" };

/** A save is under way: the bar's buttons wait for it. */
export function isSaving(save: SaveState): boolean {
  return save.kind === "busy" || save.kind === "applying";
}

/**
 * The sticky save bar (brief `apps-web-src-builder`): the state in Meta,
 * Discard, and the primary save. A stale refusal offers the reload; a
 * problem is said above the buttons.
 */
export function SaveBar({
  save,
  cycleNumber,
  dirty,
  online,
  saveLabel,
  cleanNote,
  needsChanges,
  onSave,
  onReload,
  onDiscard,
}: {
  save: SaveState;
  cycleNumber: number;
  dirty: boolean;
  online: boolean;
  /** "Create program" or "Save cycle n". */
  saveLabel: string;
  /** What the bar says with nothing unsaved. */
  cleanNote: string;
  /** Saving waits for an edit (a stored cycle), or not (a new program). */
  needsChanges: boolean;
  onSave: () => void;
  onReload: () => void;
  onDiscard: () => void;
}) {
  const busy = isSaving(save);
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-10 border-t border-line-2 bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:mx-0 md:px-0">
      {save.kind === "stale" ? (
        <div role="alert" className="flex flex-col items-start gap-2 pb-3">
          <p className="text-[15px]">
            <span className="font-semibold text-danger">Not saved. </span>
            {save.reason ??
              `Cycle ${cycleNumber} changed since you opened it. Reload and try again.`}{" "}
            Your changes are kept on this device.
          </p>
          <Button size="sm" onClick={onReload}>
            Reload cycle {cycleNumber}
          </Button>
        </div>
      ) : null}
      {save.kind === "problem" ? (
        <p role="alert" className="pb-3 text-[15px] text-danger">
          {save.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 basis-full items-center gap-2 text-[13px] text-muted-foreground sm:basis-auto">
          {online ? null : (
            <CloudOff
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4 shrink-0"
            />
          )}
          <span>
            {!online
              ? "Saving needs a connection. Your changes are kept on this device."
              : dirty
                ? "Unsaved changes, kept on this device."
                : cleanNote}
          </span>
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {dirty ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onDiscard}
            >
              Discard changes
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={!online || (needsChanges && !dirty)}
            loading={busy}
            onClick={onSave}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A new program's name and length, above its first cycle. */
export function CreateFields({
  nameId,
  tree,
  dispatch,
}: {
  /** The name field's id, so a save can send focus to it. */
  nameId: string;
  tree: CreateState;
  dispatch: (action: BuilderAction) => void;
}) {
  const fixed = tree.length.kind === "fixed";
  const cycles = tree.length.kind === "fixed" ? tree.length.cycles : 12;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] md:text-[32px]">
        New program
      </h1>
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={tree.name}
          placeholder="Summer Strength"
          autoComplete="off"
          onChange={(e) => dispatch({ type: "set-name", name: e.target.value })}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-sm font-medium text-muted-foreground">
          Length
        </legend>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Length"
            value={fixed ? "fixed" : "open"}
            onValueChange={(v) =>
              dispatch({
                type: "set-length",
                length:
                  v === "open" ? { kind: "open" } : { kind: "fixed", cycles },
              })
            }
            options={[
              { value: "fixed", label: "A number of cycles" },
              { value: "open", label: "Open-ended" },
            ]}
          />
          {fixed ? (
            <span className="flex items-center gap-2">
              <NumberField
                aria-label="Number of cycles"
                value={cycles}
                min={1}
                max={programLimits.targetCycles}
                onValueChange={(v) =>
                  dispatch({
                    type: "set-length",
                    length: { kind: "fixed", cycles: v ?? 1 },
                  })
                }
                className="w-20"
              />
              <span className="text-[15px] text-muted-foreground">cycles</span>
            </span>
          ) : null}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {fixed
            ? "Every cycle is made when you create it, as a copy of cycle 1."
            : "One cycle now; the next is added each time you finish one."}
        </p>
      </fieldset>
    </div>
  );
}
