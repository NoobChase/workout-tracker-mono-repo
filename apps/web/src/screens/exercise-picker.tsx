import type { ExerciseListItem } from "@workout-tracker/shared";
import { ArrowLeft, Plus, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useDrafts, useExercises, useOnline } from "../data/hooks.js";
import {
  filterExercises,
  NO_FILTER,
  readRecent,
  rememberRecent,
  type CatalogFilter,
} from "./catalog.js";
import { CatalogFilters, ExerciseRows } from "./exercise-list.js";
import { ExerciseForm } from "./exercise-form.js";
import { programErrorText } from "./program-format.js";
import type { SlotChoice } from "./builder/tree.js";
import { Button } from "@/ui/button";
import { overlayDescription, overlayTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { cn } from "@/lib/utils";

/*
 * The exercise picker (brief `apps-web-src-builder`): a side panel on a
 * laptop, a full-screen sheet on a phone. Search, muscle and equipment
 * filters, recently used, the whole list (standard and the lifter's own,
 * retired ones never), and two ways out of the list: create a custom
 * exercise, or add a free-text placeholder instead.
 */

type View = "list" | "create" | "placeholder";

export function ExercisePicker({
  open,
  onOpenChange,
  title,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Add to Push" or "Replace Bench Press". */
  title: string;
  onPick: (choice: SlotChoice, name: string) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-scrim",
            "data-[state=open]:animate-[tanren-fade-in_300ms_var(--ease-drawer)]",
            "data-[state=closed]:animate-[tanren-fade-out_200ms_ease-out]",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "data-[state=open]:animate-[tanren-sheet-in_300ms_var(--ease-drawer)]",
            "data-[state=closed]:animate-[tanren-sheet-out_200ms_ease-out]",
            // Laptop: a panel along the right edge, the builder still in view.
            "md:left-auto md:w-[30rem] md:border-l md:border-line-2 md:shadow-[-16px_0_40px_-16px_var(--shadow)]",
            "md:data-[state=open]:animate-[tanren-panel-in_300ms_var(--ease-drawer)]",
            "md:data-[state=closed]:animate-[tanren-panel-out_200ms_ease-out]",
          )}
        >
          {open ? (
            <PickerBody
              title={title}
              onPick={(choice, name) => {
                onPick(choice, name);
                onOpenChange(false);
              }}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PickerBody({
  title,
  onPick,
}: {
  title: string;
  onPick: (choice: SlotChoice, name: string) => void;
}) {
  const exercises = useExercises();
  const { userId } = useDrafts();
  const online = useOnline();
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<CatalogFilter>(NO_FILTER);
  const all = exercises.data?.exercises;
  const shown = useMemo(
    () => (all ? filterExercises(all, filter) : []),
    [all, filter],
  );
  const recent = useMemo(() => {
    if (!all) return [];
    const byId = new Map(all.map((e) => [e.id, e]));
    return readRecent(userId).flatMap((id) => {
      const e = byId.get(id);
      return e && e.isActive ? [e] : [];
    });
  }, [all, userId]);
  const filtering =
    filter.query.trim() !== "" ||
    filter.muscle !== null ||
    filter.equipment !== null;

  const pick = (e: ExerciseListItem) => {
    rememberRecent(userId, e.id);
    onPick({ exerciseId: e.id }, e.name);
  };

  return (
    <>
      <div className="flex min-h-16 items-center gap-2 border-b border-line px-4">
        {view !== "list" ? (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2.5"
            aria-label="Back to the list"
            onClick={() => setView("list")}
          >
            <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
          </Button>
        ) : null}
        <DialogPrimitive.Title className={cn(overlayTitle, "mr-auto truncate")}>
          {view === "create"
            ? "Create custom exercise"
            : view === "placeholder"
              ? "Add a placeholder"
              : title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon" className="-mr-2.5">
            <X aria-hidden="true" strokeWidth={1.75} />
            <span className="sr-only">Close</span>
          </Button>
        </DialogPrimitive.Close>
      </div>

      {view === "create" ? (
        <div className="flex-1 overflow-y-auto px-4 pt-5 pb-8">
          <ExerciseForm
            cancelLabel="Back"
            submitLabel="Create and add"
            onCancel={() => setView("list")}
            onDone={pick}
          />
        </div>
      ) : view === "placeholder" ? (
        <PlaceholderForm
          onAdd={(label) => onPick({ placeholderLabel: label }, label)}
          onBack={() => setView("list")}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 border-b border-line px-4 py-4">
            <CatalogFilters filter={filter} onChange={setFilter} autoFocus />
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {all === undefined ? (
              <p
                role="status"
                className="pt-5 text-[15px] text-muted-foreground"
              >
                {exercises.error
                  ? `Couldn’t load the exercises. ${programErrorText(exercises.error, "exercises")}`
                  : online
                    ? "Loading exercises…"
                    : "The exercise list loads with a connection."}
              </p>
            ) : (
              <>
                {!filtering && recent.length > 0 ? (
                  <section aria-labelledby="picker-recent" className="pt-5">
                    <h3
                      id="picker-recent"
                      className="pb-2 text-[15px] font-semibold"
                    >
                      Recently used
                    </h3>
                    <ExerciseRows
                      exercises={recent}
                      label="Recently used"
                      onSelect={pick}
                      actionLabel={(e) => `Add ${e.name}`}
                    />
                  </section>
                ) : null}
                <section aria-labelledby="picker-all" className="pt-5">
                  <h3
                    id="picker-all"
                    className="flex items-baseline gap-2 pb-2 text-[15px] font-semibold"
                  >
                    {filtering ? "Matches" : "All exercises"}
                    <span className="num text-[13px] font-normal text-muted-foreground">
                      {shown.length}
                    </span>
                  </h3>
                  {shown.length > 0 ? (
                    <ExerciseRows
                      exercises={shown}
                      label="Exercises"
                      onSelect={pick}
                      actionLabel={(e) => `Add ${e.name}`}
                    />
                  ) : (
                    <p className="border-t border-line pt-4 text-[15px] text-muted-foreground">
                      Nothing matches. Create it as your own exercise, or add a
                      placeholder for now.
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-line px-4 pt-3 pb-4 sm:flex-row">
            <Button className="sm:flex-1" onClick={() => setView("create")}>
              <Plus aria-hidden="true" strokeWidth={1.75} />
              Create custom exercise
            </Button>
            <Button
              variant="ghost"
              className="sm:flex-1"
              onClick={() => setView("placeholder")}
            >
              Add a placeholder instead
            </Button>
          </div>
          <p className="px-4 pb-4 text-[13px] text-muted-foreground">
            <Link to="/exercises" className="underline">
              Manage your exercises
            </Link>{" "}
            (your unsaved changes here are kept).
          </p>
        </>
      )}
    </>
  );
}

/** A free-text slot, filled at the gym (operations.md 3.5). */
function PlaceholderForm({
  onAdd,
  onBack,
}: {
  onAdd: (label: string) => void;
  onBack: () => void;
}) {
  const id = useId();
  const [label, setLabel] = useState("");
  const [error, setError] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed === "") return setError(true);
    onAdd(trimmed);
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pt-5 pb-8"
    >
      <p className={overlayDescription}>
        A slot you fill on the day, such as “something for the core” or
        “conditioning finisher”. It keeps its place and its sets in the plan.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Label</Label>
        <Input
          id={id}
          value={label}
          autoFocus
          autoComplete="off"
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(false);
          }}
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-danger">
            Write what goes here.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" variant="primary">
          Add placeholder
        </Button>
      </div>
    </form>
  );
}
