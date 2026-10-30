import type { ExerciseListItem } from "@workout-tracker/shared";
import { ArrowLeft, Plus } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { AppHeader } from "../app/app-header.js";
import { useExerciseActions, useExercises, useOnline } from "../data/hooks.js";
import {
  enumWords,
  filterExercises,
  metricsText,
  NO_FILTER,
  type CatalogFilter,
} from "./catalog.js";
import { CatalogFilters, ExerciseRows } from "./exercise-list.js";
import { ExerciseForm } from "./exercise-form.js";
import { Notice, OfflineLine, RetryNotice } from "./notice.js";
import { programErrorText } from "./program-format.js";
import { ServerRead } from "./server-read.js";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Label } from "@/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/sheet";
import { Textarea } from "@/ui/textarea";
import { toast } from "@/ui/toaster";

/*
 * The exercise catalog (`/exercises`; spec `exercise-catalog`, brief
 * `apps-web-src-builder`), reached from Programs and from the picker. The
 * same list and filters as the picker, plus "Show retired". Any exercise
 * takes the lifter's setup and cues; their own can be renamed, have their
 * muscles and equipment changed (never their metrics), and be retired or
 * reactivated. Plan-side: online only.
 */

type Open =
  | { kind: "exercise"; id: string; n: number }
  | { kind: "create"; n: number }
  | null;

export function ExercisesScreen() {
  const exercises = useExercises();
  const online = useOnline();
  const [filter, setFilter] = useState<CatalogFilter>(NO_FILTER);
  const [open, setOpen] = useState<Open>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const all = exercises.data?.exercises;
  const shown = useMemo(
    () => (all ? filterExercises(all, filter) : []),
    [all, filter],
  );
  const show = (next: Exclude<Open, null>) => {
    setOpen(next);
    setSheetOpen(true);
  };
  const selected =
    open?.kind === "exercise" ? all?.find((e) => e.id === open.id) : undefined;

  const body = (
    <ServerRead
      query={exercises}
      offline={
        <Notice offline>The exercise list loads with a connection.</Notice>
      }
      error={(e, retry) => (
        <RetryNotice retry={retry}>
          Couldn’t load the exercises. {programErrorText(e, "exercises")}
        </RetryNotice>
      )}
      skeleton={
        <p role="status" className="text-[15px] text-muted-foreground">
          Loading exercises…
        </p>
      }
    >
      {() => (
        <>
          <p className="flex items-baseline gap-2 pb-2 text-[15px] font-semibold">
            {filter.showRetired ? "Exercises, retired included" : "Exercises"}
            <span className="num text-[13px] font-normal text-muted-foreground">
              {shown.length}
            </span>
          </p>
          {shown.length > 0 ? (
            <ExerciseRows
              exercises={shown}
              label="Exercises"
              onSelect={(e) =>
                show({ kind: "exercise", id: e.id, n: Date.now() })
              }
              actionLabel={(e) => e.name}
            />
          ) : (
            <p className="border-t border-line pt-4 text-[15px] text-muted-foreground">
              Nothing matches these filters.
            </p>
          )}
        </>
      )}
    </ServerRead>
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pt-6 pb-16 md:px-9 md:pt-10 md:pb-24">
        <div className="flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="-ml-3">
              <Link to="/programs" aria-label="Back to programs">
                <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
              </Link>
            </Button>
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] md:text-[32px]">
              Exercises
            </h1>
          </div>
          <Button
            variant="primary"
            disabled={!online}
            onClick={() => show({ kind: "create", n: Date.now() })}
          >
            <Plus aria-hidden="true" strokeWidth={1.75} />
            Create custom exercise
          </Button>
        </div>
        {!online && all ? (
          <OfflineLine className="max-w-3xl">
            No signal. Changing exercises needs a connection.
          </OfflineLine>
        ) : null}
        <div className="flex max-w-3xl flex-col gap-6">
          <CatalogFilters filter={filter} onChange={setFilter} retiredToggle />
          <div>{body}</div>
        </div>
      </main>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          // Opening an exercise reads it first: no field takes focus (and
          // no phone keyboard rises) until the lifter chooses one.
          onOpenAutoFocus={(e) => {
            if (open?.kind !== "exercise") return;
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          {open?.kind === "create" ? (
            <>
              <SheetHeader>
                <SheetTitle>Create custom exercise</SheetTitle>
                <SheetDescription>
                  It joins your list and every picker.
                </SheetDescription>
              </SheetHeader>
              <ExerciseForm
                key={open.n}
                onCancel={() => setSheetOpen(false)}
                onDone={(e) => {
                  toast(`${e.name} created`);
                  setSheetOpen(false);
                }}
              />
            </>
          ) : selected ? (
            <ExerciseDetail
              key={`${selected.id}-${open?.n}`}
              exercise={selected}
              onClose={() => setSheetOpen(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ExerciseDetail({
  exercise,
  onClose,
}: {
  exercise: ExerciseListItem;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { retire, reactivate } = useExerciseActions();
  const online = useOnline();
  const status = exercise.isActive ? retire : reactivate;

  if (editing) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Edit {exercise.name}</SheetTitle>
          <SheetDescription>
            The new name shows everywhere it’s used, history included.
          </SheetDescription>
        </SheetHeader>
        <ExerciseForm
          editing={exercise}
          onCancel={() => setEditing(false)}
          onDone={(e) => {
            toast(`${e.name} saved`);
            setEditing(false);
          }}
        />
      </>
    );
  }

  const muscles = (list: typeof exercise.primaryMuscles) =>
    list.length ? list.map(enumWords).join(", ") : "None";

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {exercise.name}
          {exercise.isCustom ? <Badge>Yours</Badge> : null}
          {!exercise.isActive ? <Badge>Retired</Badge> : null}
        </SheetTitle>
        <SheetDescription>
          {exercise.isCustom
            ? exercise.isActive
              ? "Your own exercise."
              : "Retired: hidden from pickers, still in your plans and history."
            : "A standard exercise. Your setup and cues are yours alone."}
        </SheetDescription>
      </SheetHeader>
      <dl className="border-t border-line text-[15px]">
        {[
          ["Records", metricsText(exercise)],
          ["Primary", muscles(exercise.primaryMuscles)],
          ["Secondary", muscles(exercise.secondaryMuscles)],
          [
            "Equipment",
            exercise.equipment ? enumWords(exercise.equipment) : "None",
          ],
        ].map(([term, value]) => (
          <div
            key={term}
            className="flex min-h-11 items-center justify-between gap-4 border-b border-line"
          >
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <NotesForm exercise={exercise} />
      {exercise.isCustom ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row">
          <Button className="sm:flex-1" onClick={() => setEditing(true)}>
            Edit name, muscles or equipment
          </Button>
          <Button
            variant={exercise.isActive ? "destructive" : "secondary"}
            className="sm:flex-1"
            disabled={!online}
            loading={status.isPending}
            onClick={() =>
              status.mutate(exercise.id, {
                onSuccess: ({ exercise: e }) => {
                  toast(
                    e.isActive
                      ? `${e.name} is back in your pickers`
                      : `${e.name} retired`,
                    {
                      description: e.isActive
                        ? undefined
                        : "Hidden from pickers. Plans and history keep it.",
                    },
                  );
                  onClose();
                },
              })
            }
          >
            {exercise.isActive ? "Retire" : "Reactivate"}
          </Button>
        </div>
      ) : null}
      {status.error ? (
        <p role="alert" className="text-sm text-danger">
          {programErrorText(status.error, "exercises")}
        </p>
      ) : null}
    </>
  );
}

/** Setup (rack heights) and cues, on any exercise (operations.md 2.3). */
function NotesForm({ exercise }: { exercise: ExerciseListItem }) {
  const { notes } = useExerciseActions();
  const online = useOnline();
  const id = useId();
  const [setup, setSetup] = useState(exercise.setup ?? "");
  const [cues, setCues] = useState(exercise.cues ?? "");
  const changed =
    setup !== (exercise.setup ?? "") || cues !== (exercise.cues ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    notes.mutate(
      { exerciseId: exercise.id, setup, cues },
      { onSuccess: () => toast(`Notes saved on ${exercise.name}`) },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-setup`}>Your setup</Label>
        <Textarea
          id={`${id}-setup`}
          rows={2}
          placeholder="Pins at 4, bench at notch 3"
          value={setup}
          onChange={(e) => setSetup(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-cues`}>Your cues</Label>
        <Textarea
          id={`${id}-cues`}
          rows={2}
          placeholder="Brace, then break at the hips"
          value={cues}
          onChange={(e) => setCues(e.target.value)}
        />
      </div>
      {notes.error ? (
        <p role="alert" className="text-sm text-danger">
          {programErrorText(notes.error, "exercises")}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!online || !changed}
          loading={notes.isPending}
        >
          Save notes
        </Button>
      </div>
    </form>
  );
}
