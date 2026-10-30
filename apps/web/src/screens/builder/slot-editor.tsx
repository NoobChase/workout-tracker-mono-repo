import type { WeightUnit } from "@workout-tracker/shared";
import { Minus, Plus } from "lucide-react";
import { useId } from "react";
import type { EffortScale } from "@/lib/effort";
import { unitLabel } from "../format.js";
import {
  MAX_TARGET_SETS,
  type LinePatch,
  type SetLine,
  type Slot,
} from "./tree.js";
import { NumberField } from "@/ui/number-field";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";
import { Textarea } from "@/ui/textarea";
import { cn } from "@/lib/utils";

/*
 * A slot opened in place (brief `apps-web-src-builder`): the target-sets
 * stepper, then one line for every set, or, with "Prescribe each set", one
 * line per set. A line is reps (exact, or a min–max range), a weight in the
 * lifter's unit, and an optional effort target, RIR or RPE by a small
 * switch, never both. No shorthand text entry: every number has its field.
 */

const EFFORT_RANGE: Record<EffortScale, { min: number; max: number }> = {
  RIR: { min: 0, max: 10 },
  RPE: { min: 1, max: 10 },
};

export function SlotEditor({
  slot,
  name,
  unit,
  showNotes,
  onTargetSets,
  onPerSet,
  onLine,
  onNotes,
}: {
  slot: Slot;
  name: string;
  unit: WeightUnit;
  showNotes: boolean;
  onTargetSets: (n: number) => void;
  onPerSet: (perSet: boolean) => void;
  onLine: (line: number | "all", patch: LinePatch) => void;
  onNotes: (notes: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4 pt-1 pb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <SetsStepper
          value={slot.targetSets}
          onChange={onTargetSets}
          label={`Target sets for ${name}`}
        />
        <label
          htmlFor={`${id}-each`}
          className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-muted-foreground"
        >
          <Switch
            id={`${id}-each`}
            checked={slot.perSet}
            onCheckedChange={onPerSet}
          />
          Prescribe each set
        </label>
      </div>
      <ol className="flex flex-col border-t border-line">
        {slot.perSet ? (
          slot.sets.map((line, i) => (
            <LineEditor
              key={line.id}
              label={`Set ${i + 1}`}
              line={line}
              unit={unit}
              onChange={(patch) => onLine(i, patch)}
            />
          ))
        ) : (
          <LineEditor
            label="Every set"
            line={slot.sets[0]!}
            unit={unit}
            onChange={(patch) => onLine("all", patch)}
          />
        )}
      </ol>
      {showNotes ? (
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`${id}-notes`}
            className="text-sm font-medium text-muted-foreground"
          >
            Notes on {name}
          </label>
          <Textarea
            id={`${id}-notes`}
            rows={2}
            value={slot.notes ?? ""}
            placeholder="Pause at the bottom, 2 min rest"
            onChange={(e) =>
              onNotes(e.target.value === "" ? null : e.target.value)
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function SetsStepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const id = useId();
  const button =
    "grid size-11 shrink-0 place-items-center text-foreground transition-[background-color] duration-150 ease-out hover:bg-ghost disabled:text-faint disabled:hover:bg-transparent [&_svg]:size-4 [&_svg]:transition-transform [&_svg]:duration-[160ms] active:[&_svg]:scale-[0.85]";
  return (
    <div className="flex flex-col gap-2">
      <span
        id={id}
        className="text-sm leading-none font-medium text-muted-foreground"
      >
        Target sets
      </span>
      <div
        role="group"
        aria-labelledby={id}
        className="inline-flex h-11 items-stretch overflow-hidden rounded-md border border-input"
      >
        <button
          type="button"
          className={button}
          aria-label="One set fewer"
          disabled={value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden="true" strokeWidth={1.75} />
        </button>
        <NumberField
          aria-label={label}
          value={value}
          min={1}
          max={MAX_TARGET_SETS}
          onValueChange={(n) => (n === null ? undefined : onChange(n))}
          className="w-14 rounded-none border-y-0 border-line px-1 [&_input]:text-center"
        />
        <button
          type="button"
          className={button}
          aria-label="One set more"
          disabled={value >= MAX_TARGET_SETS}
          onClick={() => onChange(value + 1)}
        >
          <Plus aria-hidden="true" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function LineEditor({
  label,
  line,
  unit,
  onChange,
}: {
  label: string;
  line: SetLine;
  unit: WeightUnit;
  onChange: (patch: LinePatch) => void;
}) {
  const id = useId();
  const range = EFFORT_RANGE[line.effortKind];
  const inverted =
    line.repsMin !== null &&
    line.repsMax !== null &&
    line.repsMax < line.repsMin;
  const caption = "text-[13px] leading-none text-muted-foreground";
  return (
    <li
      role="group"
      aria-label={label}
      className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-line py-3"
    >
      <span className="w-full text-[13px] font-semibold text-foreground sm:w-20 sm:self-center sm:pt-5">
        {label}
      </span>
      <div className="flex flex-col gap-1.5">
        <span id={`${id}-reps`} className={caption}>
          Reps, or a range
        </span>
        <span className="flex items-center gap-1.5">
          <NumberField
            aria-label={`${label}: reps`}
            value={line.repsMin}
            max={999}
            onValueChange={(repsMin) => onChange({ repsMin })}
            invalid={inverted}
            className="w-16"
          />
          <span aria-hidden="true" className="text-muted-foreground">
            to
          </span>
          <NumberField
            aria-label={`${label}: up to, for a range`}
            value={line.repsMax}
            max={999}
            placeholder="max"
            onValueChange={(repsMax) => onChange({ repsMax })}
            invalid={inverted}
            className="w-16"
          />
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={caption}>Weight</span>
        <NumberField
          aria-label={`${label}: weight in ${unitLabel(line.weightUnit ?? unit)}`}
          value={line.weight}
          max={99999.99}
          step={0.01}
          decimals={2}
          unit={unitLabel(line.weightUnit ?? unit)}
          onValueChange={(weight) => onChange({ weight })}
          className="w-28"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={caption}>Effort target</span>
        <span className="flex items-center gap-1.5">
          <Segmented
            label={`${label}: effort scale`}
            value={line.effortKind}
            onValueChange={(effortKind) =>
              onChange({
                effortKind,
                // RPE starts at 1: an RIR of 0 has no RPE twin to keep.
                effort:
                  line.effort === null
                    ? null
                    : Math.max(EFFORT_RANGE[effortKind].min, line.effort),
              })
            }
            options={[
              {
                value: "RIR",
                label: "RIR",
                ariaLabel: "Reps in reserve (RIR)",
              },
              {
                value: "RPE",
                label: "RPE",
                ariaLabel: "Rate of perceived exertion (RPE)",
              },
            ]}
          />
          <NumberField
            aria-label={`${label}: ${line.effortKind}, ${range.min} to ${range.max}`}
            value={line.effort}
            min={range.min}
            max={range.max}
            step={0.5}
            decimals={1}
            onValueChange={(effort) => onChange({ effort })}
            className={cn("w-16")}
          />
        </span>
      </div>
      {inverted ? (
        <p role="alert" className="w-full text-sm text-danger">
          The range ends below where it starts.
        </p>
      ) : null}
    </li>
  );
}
