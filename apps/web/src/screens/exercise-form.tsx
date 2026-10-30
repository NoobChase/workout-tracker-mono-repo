import {
  muscleRuleViolation,
  type Equipment,
  type ExerciseListItem,
  type MetricKind,
  type MuscleGroup,
} from "@workout-tracker/shared";
import { useId, useState, type FormEvent } from "react";
import { useExerciseActions, useOnline } from "../data/hooks.js";
import {
  enumWords,
  EQUIPMENT,
  METRIC_WORDS,
  METRICS,
  metricsText,
  MUSCLES,
} from "./catalog.js";
import { programErrorText } from "./program-format.js";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Segmented } from "@/ui/segmented";
import { Select } from "@/ui/select";
import { cn } from "@/lib/utils";

/*
 * Create a custom exercise, or edit the lifter's own (operations.md 2.2,
 * 2.5; spec `exercise-catalog`). Creating asks what is recorded, each
 * metric required or optional; editing never shows metrics as editable,
 * because logged sets were checked against them. Online only.
 */

type MetricChoice = Partial<Record<MetricKind, "required" | "optional">>;

export function ExerciseForm({
  editing,
  onDone,
  onCancel,
  cancelLabel = "Cancel",
  submitLabel,
}: {
  /** The lifter's own exercise to edit; absent to create one. */
  editing?: ExerciseListItem;
  onDone: (exercise: ExerciseListItem) => void;
  onCancel: () => void;
  cancelLabel?: string;
  submitLabel?: string;
}) {
  const { create, edit } = useExerciseActions();
  const mutation = editing ? edit : create;
  const online = useOnline();
  const id = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [metrics, setMetrics] = useState<MetricChoice>({
    REPS: "required",
    WEIGHT: "required",
  });
  const [primary, setPrimary] = useState<MuscleGroup[]>(
    editing?.primaryMuscles ?? [],
  );
  const [secondary, setSecondary] = useState<MuscleGroup[]>(
    editing?.secondaryMuscles ?? [],
  );
  const [equipment, setEquipment] = useState<Equipment | null>(
    editing?.equipment ?? null,
  );
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = METRICS.filter((m) => metrics[m] !== undefined);
  const error =
    problem ??
    (mutation.error ? programErrorText(mutation.error, "exercises") : null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    mutation.reset();
    const trimmed = name.trim();
    if (trimmed === "") return setProblem("Give the exercise a name.");
    if (!editing && chosen.length === 0) {
      return setProblem("Choose at least one thing to record, such as reps.");
    }
    const rule = muscleRuleViolation(primary, secondary);
    if (rule) return setProblem(rule);
    const done = ({ exercise }: { exercise: ExerciseListItem }) =>
      onDone(exercise);
    if (editing) {
      edit.mutate(
        {
          exerciseId: editing.id,
          patch: {
            name: trimmed,
            primaryMuscles: primary,
            secondaryMuscles: secondary,
            equipment,
          },
        },
        { onSuccess: done },
      );
    } else {
      create.mutate(
        {
          name: trimmed,
          primaryMuscles: primary,
          secondaryMuscles: secondary,
          equipment,
          metrics: chosen.map((m) => ({
            metric: m,
            isRequired: metrics[m] === "required",
          })),
        },
        { onSuccess: done },
      );
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            mutation.reset();
          }}
        />
      </div>

      {editing ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            What you record
          </p>
          <p className="text-[15px]">{metricsText(editing)}</p>
          <p className="text-[13px] text-muted-foreground">
            Fixed once created: your logged sets were recorded this way.
          </p>
        </div>
      ) : (
        <fieldset className="flex flex-col">
          <legend className="pb-1 text-sm font-medium text-muted-foreground">
            What you record
          </legend>
          <p className="pb-2 text-[13px] text-muted-foreground">
            Optional ones can be left out of a set, like weight on a dip.
          </p>
          <ul className="border-t border-line">
            {METRICS.map((m) => {
              const on = metrics[m] !== undefined;
              return (
                <li
                  key={m}
                  className="flex min-h-12 items-center justify-between gap-3 border-b border-line"
                >
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-[15px]">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) =>
                        setMetrics((all) => {
                          const next = { ...all };
                          if (v === true) next[m] = "required";
                          else delete next[m];
                          return next;
                        })
                      }
                    />
                    {METRIC_WORDS[m]}
                  </label>
                  {on ? (
                    <Segmented
                      label={`${METRIC_WORDS[m]}: required or optional`}
                      value={metrics[m]!}
                      onValueChange={(v) =>
                        setMetrics((all) => ({ ...all, [m]: v }))
                      }
                      options={[
                        { value: "required", label: "Required" },
                        { value: "optional", label: "Optional" },
                      ]}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <MuscleChips
        legend="Primary muscles"
        value={primary}
        onChange={(v) => {
          setPrimary(v);
          setSecondary((s) => s.filter((m) => !v.includes(m)));
        }}
      />
      <MuscleChips
        legend="Secondary muscles"
        hint={
          primary.length === 0 ? "Choose a primary muscle first." : undefined
        }
        value={secondary}
        disabled={primary}
        locked={primary.length === 0}
        onChange={setSecondary}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-equipment`}>Equipment</Label>
        <Select
          id={`${id}-equipment`}
          value={equipment ?? ""}
          onChange={(e) =>
            setEquipment(
              e.target.value === "" ? null : (e.target.value as Equipment),
            )
          }
          className="sm:max-w-xs"
        >
          <option value="">None</option>
          {EQUIPMENT.map((q) => (
            <option key={q} value={q}>
              {enumWords(q)}
            </option>
          ))}
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {online ? null : (
        <p className="text-sm text-muted-foreground">
          Saving exercises needs a connection.
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!online}
          loading={mutation.isPending}
        >
          {submitLabel ?? (editing ? "Save changes" : "Create exercise")}
        </Button>
      </div>
    </form>
  );
}

function MuscleChips({
  legend,
  hint,
  value,
  onChange,
  disabled = [],
  locked = false,
}: {
  legend: string;
  hint?: string;
  value: MuscleGroup[];
  onChange: (value: MuscleGroup[]) => void;
  /** Muscles taken by the other list (no muscle is both). */
  disabled?: MuscleGroup[];
  locked?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-medium text-muted-foreground">
        {legend}
        {hint ? (
          <span className="block pt-1 text-[13px] font-normal">{hint}</span>
        ) : null}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {MUSCLES.map((m) => {
          const on = value.includes(m);
          const off = locked || disabled.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              disabled={off && !on}
              onClick={() =>
                onChange(on ? value.filter((x) => x !== m) : [...value, m])
              }
              className={cn(
                "h-9 rounded-md border px-3 text-[13px] font-medium",
                "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-line-2 text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-45",
              )}
            >
              {enumWords(m)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
