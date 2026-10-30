import type {
  Equipment,
  ExerciseListItem,
  MuscleGroup,
} from "@workout-tracker/shared";
import { Search } from "lucide-react";
import { useId, type ReactNode } from "react";
import {
  enumWords,
  EQUIPMENT,
  exerciseMeta,
  MUSCLES,
  type CatalogFilter,
} from "./catalog.js";
import { Badge } from "@/ui/badge";
import { Input } from "@/ui/input";
import { Select } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { cn } from "@/lib/utils";

/*
 * The catalog's list and filters, one implementation for the exercise
 * picker and the catalog screen (brief: "the same list and filters").
 */

export function CatalogFilters({
  filter,
  onChange,
  retiredToggle = false,
  autoFocus = false,
}: {
  filter: CatalogFilter;
  onChange: (filter: CatalogFilter) => void;
  /** The catalog screen's "Show retired". */
  retiredToggle?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3" role="search">
      <div className="relative">
        <Search
          aria-hidden="true"
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search exercises"
          placeholder="Search exercises"
          autoComplete="off"
          // Opening the picker lands in the search; a phone keyboard rises.
          autoFocus={autoFocus}
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          className="pl-10"
        />
      </div>
      {/* A phone splits the row between the two selects and puts the switch
          on its own line below, so neither select truncates its words. */}
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <Select
          aria-label="Muscle"
          value={filter.muscle ?? ""}
          onChange={(e) =>
            onChange({
              ...filter,
              muscle:
                e.target.value === "" ? null : (e.target.value as MuscleGroup),
            })
          }
          className="min-w-0 sm:flex-none"
        >
          <option value="">Any muscle</option>
          {MUSCLES.map((m) => (
            <option key={m} value={m}>
              {enumWords(m)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Equipment"
          value={filter.equipment ?? ""}
          onChange={(e) =>
            onChange({
              ...filter,
              equipment:
                e.target.value === "" ? null : (e.target.value as Equipment),
            })
          }
          className="min-w-0 sm:flex-none"
        >
          <option value="">Any equipment</option>
          {EQUIPMENT.map((q) => (
            <option key={q} value={q}>
              {enumWords(q)}
            </option>
          ))}
        </Select>
        {retiredToggle ? (
          <label
            htmlFor={`${id}-retired`}
            className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2.5 px-1 text-sm font-medium text-muted-foreground"
          >
            <Switch
              id={`${id}-retired`}
              checked={filter.showRetired}
              onCheckedChange={(showRetired) =>
                onChange({ ...filter, showRetired })
              }
            />
            Show retired
          </label>
        ) : null}
      </div>
    </div>
  );
}

/** One exercise as a ruled, pressable line: name, then muscles and equipment. */
export function ExerciseRows({
  exercises,
  label,
  onSelect,
  actionLabel,
  trailing,
}: {
  exercises: readonly ExerciseListItem[];
  /** The list's accessible name. */
  label: string;
  onSelect: (exercise: ExerciseListItem) => void;
  /** "Add Back Squat": what pressing a row does, for assistive tech. */
  actionLabel: (exercise: ExerciseListItem) => string;
  trailing?: (exercise: ExerciseListItem) => ReactNode;
}) {
  return (
    <ul aria-label={label} className="border-t border-line">
      {exercises.map((e) => (
        <li key={e.id} className="border-b border-line">
          <button
            type="button"
            onClick={() => onSelect(e)}
            aria-label={actionLabel(e)}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left",
              "transition-[background-color] duration-150 ease-out hover:bg-ghost/60",
              "outline-offset-[-2px]",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "truncate text-[15px] font-semibold",
                  !e.isActive && "text-muted-foreground",
                )}
              >
                {e.name}
              </span>
              <span className="truncate text-[13px] text-muted-foreground">
                {exerciseMeta(e) || "No muscles or equipment noted"}
              </span>
            </span>
            {!e.isActive ? <Badge>Retired</Badge> : null}
            {e.isCustom ? <Badge>Yours</Badge> : null}
            {trailing?.(e)}
          </button>
        </li>
      ))}
    </ul>
  );
}
