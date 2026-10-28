import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { AppHeader } from "../app/app-header.js";
import {
  useOnline,
  useSessionDetail,
  useSessionRecord,
  useWorkoutActions,
} from "../data/hooks.js";
import type {
  ExerciseView,
  SessionView,
  SetView,
} from "../local/session-view.js";
import type { RowSyncState } from "../local/sync-state.js";
import { errorText } from "./errors.js";
import {
  formatDay,
  plural,
  repRangeOf,
  targetSets,
  unitLabel,
} from "./format.js";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { NumberStepper } from "@/ui/number-stepper";
import {
  BlankFigure,
  SetFigures,
  SetLog,
  SetRow,
  type QueuedReason,
  type SetStatus,
} from "@/ui/set-row";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/sheet";
import { toast } from "@/ui/toaster";

/*
 * The workout (`/workout/:sessionId`). Renders only the local session record,
 * so it is identical online and offline; every write goes through
 * `useWorkoutActions` and the mutation queue. The plan is never touched: the
 * steppers change only what this session logs.
 *
 * Which exercise is current lives in the URL (`?ex=`), so skipping (which
 * writes nothing) survives a reload, and `?set=` opens a set from the sync
 * band ("Show set").
 */

type Values = { weight: number | null; reps: number | null };

const STEP = { LB: 5, KG: 2.5 } as const;
const MAX_WEIGHT = { LB: 2000, KG: 1000 } as const;
const MAX_REPS = 100;

const ROW_STATUS: Record<
  RowSyncState,
  { status: SetStatus; queuedReason?: QueuedReason }
> = {
  logged: { status: "logged" },
  "queued-no-signal": { status: "queued", queuedReason: "no-signal" },
  "queued-in-order": { status: "queued", queuedReason: "in-order" },
  "failed-retrying": { status: "failed" },
  rejected: { status: "rejected" },
};

export function WorkoutScreen() {
  const { sessionId = "" } = useParams();
  const view = useSessionRecord(sessionId);
  return (
    <>
      <AppHeader />
      {view ? <Workout view={view} /> : <NotOnDevice sessionId={sessionId} />}
    </>
  );
}

/**
 * The seed for the next set. Weight: the last set logged that the server
 * hasn't refused (a rejected number is never offered again), else last
 * time's same set, else its first, else blank. Reps: never below the plan's
 * floor for this set: the higher of last time's same set and the floor;
 * with no floor, last time's same set, else the last good set, else the
 * plan's ceiling.
 */
export function seed(exercise: ExerciseView): Values {
  const good = exercise.sets.filter((s) => s.sync.state !== "rejected").at(-1);
  const n = exercise.sets.length + 1;
  const last = exercise.planned.lastTime?.sets;
  const sameSet = last?.find((s) => s.setNumber === n);
  const plan =
    exercise.planned.plannedSets.find((s) => s.setNumber === n) ??
    exercise.planned.plannedSets[0];
  return {
    weight: good?.weight ?? sameSet?.weight ?? last?.[0]?.weight ?? null,
    reps:
      plan?.repsMin != null
        ? Math.max(sameSet?.reps ?? 0, plan.repsMin)
        : (sameSet?.reps ?? good?.reps ?? plan?.repsMax ?? null),
  };
}

/** Where to pick up: the exercise in progress, else the one after the last touched. */
function defaultCurrent(exercises: ExerciseView[]): number {
  let lastTouched = -1;
  exercises.forEach((e, i) => {
    if (e.sets.length > 0) lastTouched = i;
  });
  if (lastTouched < 0) return 0;
  const touched = exercises[lastTouched]!;
  if (touched.sets.length < targetSets(touched.planned)) return lastTouched;
  return Math.min(lastTouched + 1, exercises.length - 1);
}

function Workout({ view }: { view: SessionView }) {
  const navigate = useNavigate();
  const actions = useWorkoutActions();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const [values, setValues] = useState<Record<string, Values>>({});
  // Each opening remounts the sheet (fresh values); closing keeps it
  // mounted so it can leave on its own curve.
  const [editing, setEditing] = useState<{ id: string; n: number } | null>(
    null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const openEditor = (id: string) => {
    setEditing((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
    setEditOpen(true);
  };
  const [finishing, setFinishing] = useState(false);

  const { exercises } = view;
  const inProgress = view.status === "IN_PROGRESS";
  const focusSet = params.get("set");
  const byParam = exercises.findIndex(
    (e) => e.planned.plannedExerciseId === params.get("ex"),
  );
  const bySet = focusSet
    ? exercises.findIndex((e) => e.sets.some((s) => s.id === focusSet))
    : -1;
  const currentIndex =
    byParam >= 0 ? byParam : bySet >= 0 ? bySet : defaultCurrent(exercises);
  const current = exercises[currentIndex];

  const goTo = (index: number) => {
    const target = exercises[index];
    if (!target) return;
    setParams({ ex: target.planned.plannedExerciseId }, { replace: true });
  };

  // Where to pick up is decided once, on arrival, then pinned in the URL:
  // reaching the target must not move the screen on by itself (extra sets
  // are allowed; moving on is the lifter's call).
  const pinned = current?.planned.plannedExerciseId;
  useEffect(() => {
    if (byParam >= 0 || !pinned) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("ex", pinned);
        return next;
      },
      { replace: true },
    );
  }, [byParam, pinned, setParams]);

  // "Show set": bring the rejected (or any named) set into view and focus it.
  useEffect(() => {
    if (!focusSet) return;
    const row = document.getElementById(`set-${focusSet}`);
    row?.scrollIntoView({ block: "center" });
    row?.querySelector("button")?.focus({ preventScroll: true });
  }, [focusSet]);

  const editingSet = editing
    ? exercises
        .flatMap((e) => e.sets.map((s) => ({ set: s, exercise: e })))
        .find((x) => x.set.id === editing.id)
    : undefined;

  const planned = exercises.reduce((n, e) => n + targetSets(e.planned), 0);
  const logged = exercises.reduce((n, e) => n + e.sets.length, 0);
  const left = exercises.reduce(
    (n, e) => n + Math.max(0, targetSets(e.planned) - e.sets.length),
    0,
  );

  async function finish() {
    await actions.finish(view.sessionId);
    toast(`${view.workout.name} finished`, {
      description:
        `${logged} ${plural(logged, "set")} logged.` +
        (online ? "" : " It syncs when there’s signal."),
    });
    void navigate("/");
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 pt-4 pb-16 md:px-9 md:pt-8 md:pb-24">
      <div className="flex items-center gap-3 pb-6 md:pb-10">
        <Button asChild variant="ghost" size="icon" className="-ml-2.5">
          <Link to="/" aria-label="Home">
            <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
          </Link>
        </Button>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-xl leading-tight font-bold tracking-[-0.01em]">
            {view.workout.name}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {view.workout.programName} · Cycle{" "}
            <span className="num">{view.workout.cycleNumber}</span>
          </p>
        </div>
        {inProgress ? (
          <Button onClick={() => setFinishing(true)}>Finish</Button>
        ) : null}
      </div>

      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {current ? (
          <LiveExercise
            key={current.planned.plannedExerciseId}
            sessionId={view.sessionId}
            exercise={current}
            next={exercises[currentIndex + 1] ?? null}
            inProgress={inProgress}
            values={values[current.planned.plannedExerciseId] ?? seed(current)}
            onValues={(v) =>
              setValues((all) => ({
                ...all,
                [current.planned.plannedExerciseId]: v,
              }))
            }
            onLogged={() =>
              // The next set seeds afresh: last time's same set, the plan.
              setValues((all) => {
                const rest = { ...all };
                delete rest[current.planned.plannedExerciseId];
                return rest;
              })
            }
            onNext={() => goTo(currentIndex + 1)}
            onFinish={() => setFinishing(true)}
          />
        ) : (
          <p className="text-[15px] text-muted-foreground">
            This workout has no exercises.
          </p>
        )}

        <section aria-labelledby="log-title" className="flex flex-col">
          <div className="flex min-h-11 items-center justify-between gap-3 pb-3">
            <h2
              id="log-title"
              className="text-[17px] leading-snug font-semibold"
            >
              Today’s log
            </h2>
            <p className="text-[13px] text-muted-foreground">
              <span className="num">{logged}</span> of{" "}
              <span className="num">{planned}</span> planned{" "}
              {plural(planned, "set")}
            </p>
          </div>
          <ol className="flex flex-col">
            {exercises.map((exercise, i) => (
              <ExerciseLog
                key={exercise.planned.plannedExerciseId}
                exercise={exercise}
                current={i === currentIndex}
                passed={i < currentIndex}
                inProgress={inProgress}
                live={
                  values[exercise.planned.plannedExerciseId] ?? seed(exercise)
                }
                focusSet={focusSet}
                onSelect={() => goTo(i)}
                onEdit={openEditor}
              />
            ))}
          </ol>
          {!inProgress ? (
            <p className="mt-8 border-t border-line pt-5 text-[15px] text-muted-foreground">
              Finished. It moves to history once it has synced.
            </p>
          ) : null}
        </section>
      </div>

      {editing ? (
        <EditSetSheet
          key={editing.n}
          sessionId={view.sessionId}
          target={editingSet ?? null}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      ) : null}

      <FinishDialog
        open={finishing}
        onOpenChange={setFinishing}
        workoutName={view.workout.name}
        logged={logged}
        planned={planned}
        left={left}
        online={online}
        onFinish={finish}
      />
    </main>
  );
}

function LiveExercise({
  sessionId,
  exercise,
  next,
  inProgress,
  values,
  onValues,
  onLogged,
  onNext,
  onFinish,
}: {
  sessionId: string;
  exercise: ExerciseView;
  next: ExerciseView | null;
  inProgress: boolean;
  values: Values;
  onValues: (values: Values) => void;
  onLogged: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  const actions = useWorkoutActions();
  const headingId = useId();
  const missingId = useId();
  const weightId = useId();
  const [missing, setMissing] = useState<"weight" | "reps" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logging = useRef(false);

  const { planned } = exercise;
  const unit = unitLabel(exercise.unit);
  const target = targetSets(planned);
  const n = exercise.sets.length + 1;
  const reps = repRangeOf(planned, n);
  const last = planned.lastTime;

  async function logSet() {
    if (logging.current) return;
    if (values.weight === null || values.reps === null) {
      const which = values.weight === null ? "weight" : "reps";
      setMissing(which);
      if (which === "weight") document.getElementById(weightId)?.focus();
      return;
    }
    setError(null);
    logging.current = true;
    try {
      await actions.logSet(sessionId, {
        plannedExerciseId: planned.plannedExerciseId,
        reps: values.reps,
        weight: values.weight,
      });
      onLogged();
    } catch (e) {
      setError(errorText(e, "continue"));
    } finally {
      logging.current = false;
    }
  }

  const change = (v: Values) => {
    setMissing(null);
    onValues(v);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col lg:sticky lg:top-8 lg:self-start"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-line-2 pb-3">
        <h2
          id={headingId}
          className="min-w-0 text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance"
        >
          {planned.name}
        </h2>
        {inProgress ? (
          <p className="num text-[15px] whitespace-nowrap text-muted-foreground">
            Set <b className="font-medium text-copper">{n}</b>
            {target > 0 && n <= target ? (
              <> / {target}</>
            ) : target > 0 ? (
              <span className="font-sans"> · extra</span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="pt-5 pb-6">
        {inProgress ? (
          <>
            <p
              aria-hidden="true"
              className="num text-[min(64px,15vw)] leading-none font-medium tracking-[-0.03em]"
            >
              {values.weight ?? <BlankFigure />}
              <span className="ml-1 text-[0.3em] tracking-normal text-muted-foreground">
                {unit}
              </span>
              <span className="px-[0.18em] text-muted-foreground">×</span>
              {values.reps ?? <BlankFigure />}
            </p>
            <p className="sr-only">
              Set {n}:{" "}
              {values.weight === null
                ? "no weight entered"
                : `${values.weight} ${unit}`}{" "}
              for {values.reps ?? "no"} reps.
            </p>
          </>
        ) : null}
        <dl className="mt-4 flex flex-col gap-1.5 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="text-foreground">
              <span className="num">{target}</span> {plural(target, "set")}
              {reps ? (
                <>
                  {" "}
                  · <span className="num">{reps}</span> reps
                </>
              ) : null}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">
              {last ? `Last time, ${formatDay(last.performedAt)}` : "Last time"}
            </dt>
            <dd className="text-foreground">
              {last && last.sets.length > 0 ? (
                <LastTime sets={last.sets} fallbackUnit={unit} />
              ) : (
                <span className="text-muted-foreground">
                  First time; no numbers yet
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {inProgress ? (
        <div className="flex flex-col gap-4">
          <NumberStepper
            id={weightId}
            label="Weight"
            unit={unit}
            decimal
            step={STEP[exercise.unit]}
            max={MAX_WEIGHT[exercise.unit]}
            value={values.weight}
            onValueChange={(weight) => change({ ...values, weight })}
            invalid={missing === "weight"}
            describedBy={missing === "weight" ? missingId : undefined}
          />
          <NumberStepper
            label="Reps"
            unit="reps"
            step={1}
            max={MAX_REPS}
            value={values.reps}
            onValueChange={(r) => change({ ...values, reps: r })}
            invalid={missing === "reps"}
            describedBy={missing === "reps" ? missingId : undefined}
          />
          {missing ? (
            <p id={missingId} role="alert" className="text-sm text-danger">
              {missing === "weight"
                ? `Enter the weight first. There’s no earlier ${planned.name} to start from.`
                : "Enter the reps first."}
            </p>
          ) : null}
          <Button
            variant="primary"
            size="log"
            className="mt-2 w-full"
            onClick={() => void logSet()}
          >
            Log set
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {next ? (
            <Button size="md" className="w-full" onClick={onNext}>
              {exercise.sets.length === 0 ? "Skip to" : "Next:"}{" "}
              {next.planned.name}
              <ArrowRight aria-hidden="true" strokeWidth={1.75} />
            </Button>
          ) : (
            <Button size="md" className="w-full" onClick={onFinish}>
              Finish workout
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function LastTime({
  sets,
  fallbackUnit,
}: {
  sets: NonNullable<ExerciseView["planned"]["lastTime"]>["sets"];
  fallbackUnit: "lb" | "kg";
}) {
  return (
    <span className="flex flex-wrap gap-x-1">
      {sets.map((s, i) => (
        <span key={s.setNumber}>
          <SetFigures
            weight={s.weight}
            reps={s.reps}
            unit={s.weightUnit ? unitLabel(s.weightUnit) : fallbackUnit}
            className="text-sm"
          />
          {i < sets.length - 1 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              ,
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

function ExerciseLog({
  exercise,
  current,
  passed,
  inProgress,
  live,
  focusSet,
  onSelect,
  onEdit,
}: {
  exercise: ExerciseView;
  current: boolean;
  passed: boolean;
  inProgress: boolean;
  live: Values;
  focusSet: string | null;
  onSelect: () => void;
  onEdit: (setId: string) => void;
}) {
  const { planned, sets } = exercise;
  const target = targetSets(planned);
  const unit = unitLabel(exercise.unit);
  const nextNumber = sets.length + 1;
  const showLive = current && inProgress;
  const plannedAfter = showLive
    ? Array.from(
        { length: Math.max(0, target - nextNumber) },
        (_, i) => nextNumber + 1 + i,
      )
    : [];
  const state =
    sets.length > 0
      ? `${sets.length} of ${target} ${plural(target, "set")}`
      : passed || !inProgress
        ? "skipped"
        : `${target} ${plural(target, "set")} planned`;

  return (
    <li className="flex flex-col">
      <h3>
        <button
          type="button"
          onClick={onSelect}
          disabled={!inProgress}
          aria-current={current ? "step" : undefined}
          // A ruled row of the ledger like the sets under it, seated on its
          // hairline with air above, so an exercise with nothing logged
          // reads as a heading, not a missing row.
          className="flex min-h-15 w-full items-end justify-between gap-3 border-b border-line pt-5 pb-2.5 text-left outline-offset-[-2px] disabled:cursor-default"
        >
          <span
            className={
              current
                ? "text-[15px] font-semibold text-foreground"
                : "text-[15px] font-semibold text-muted-foreground"
            }
          >
            {planned.name}
          </span>
          <span className="text-[13px] whitespace-nowrap text-muted-foreground">
            {state}
          </span>
        </button>
      </h3>
      {sets.length > 0 || showLive ? (
        <SetLog aria-label={`${planned.name} sets`} className="border-t-0">
          {sets.map((set) => (
            <LoggedRow
              key={`n-${set.setNumber}`}
              set={set}
              highlighted={set.id === focusSet}
              onEdit={inProgress ? () => onEdit(set.id) : undefined}
            />
          ))}
          {showLive ? (
            <SetRow
              key={`n-${nextNumber}`}
              index={nextNumber}
              weight={live.weight}
              reps={live.reps}
              unit={unit}
              status="live"
            />
          ) : null}
          {plannedAfter.map((n) => (
            <SetRow
              key={`n-${n}`}
              index={n}
              weight={live.weight}
              reps={live.reps}
              unit={unit}
              status="planned"
            />
          ))}
        </SetLog>
      ) : null}
    </li>
  );
}

function LoggedRow({
  set,
  highlighted,
  onEdit,
}: {
  set: SetView;
  highlighted: boolean;
  onEdit?: () => void;
}) {
  return (
    <SetRow
      id={`set-${set.id}`}
      data-focused={highlighted || undefined}
      index={set.setNumber}
      weight={set.weight}
      reps={set.reps}
      unit={unitLabel(set.weightUnit)}
      reason={set.sync.reason}
      onPress={onEdit}
      className="scroll-mt-24"
      {...ROW_STATUS[set.sync.state]}
    />
  );
}

/**
 * Correct a set's numbers, or delete it. Its number and stamped unit stay;
 * deleting renumbers the sets after it, which the confirmation says first.
 */
function EditSetSheet({
  sessionId,
  target,
  open,
  onClose,
}: {
  sessionId: string;
  target: { set: SetView; exercise: ExerciseView } | null;
  open: boolean;
  onClose: () => void;
}) {
  const actions = useWorkoutActions();
  // The set as it was when the sheet opened: a delete removes it from the
  // record while the sheet is still leaving.
  const [snapshot] = useState(target);
  const [weight, setWeight] = useState(target?.set.weight ?? 0);
  const [reps, setReps] = useState(target?.set.reps ?? 0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!snapshot) return null;
  const { set, exercise } = snapshot;
  const unit = unitLabel(set.weightUnit);
  const after = exercise.sets.filter((s) => s.setNumber > set.setNumber);

  async function run(op: () => Promise<void>) {
    setError(null);
    try {
      await op();
      onClose();
    } catch (e) {
      setError(errorText(e, "continue"));
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            Set {set.setNumber} of {exercise.planned.name}
          </SheetTitle>
          <SheetDescription>
            For this workout only. The plan stays the plan.
          </SheetDescription>
        </SheetHeader>
        {confirming ? (
          <div className="flex flex-col gap-4">
            <p className="text-[15px] text-foreground">
              Delete set <span className="num">{set.setNumber}</span>,{" "}
              <SetFigures weight={set.weight} reps={set.reps} unit={unit} />?{" "}
              {after.length > 0 ? (
                <span className="text-muted-foreground">
                  {after.length === 1 ? "Set " : "Sets "}
                  <span className="num">
                    {after.map((s) => s.setNumber).join(", ")}
                  </span>{" "}
                  {after.length === 1 ? "becomes " : "become "}
                  <span className="num">
                    {after.map((s) => s.setNumber - 1).join(", ")}
                  </span>
                  .
                </span>
              ) : exercise.sets.length === 1 ? (
                <span className="text-muted-foreground">
                  It’s the only one, so {exercise.planned.name} will read as
                  skipped.
                </span>
              ) : null}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                variant="destructive"
                size="log"
                className="w-full sm:flex-1"
                onClick={() =>
                  void run(() => actions.deleteSet(sessionId, set.id))
                }
              >
                Delete set {set.setNumber}
              </Button>
              <Button
                size="log"
                className="w-full sm:flex-1"
                onClick={() => setConfirming(false)}
              >
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <NumberStepper
              label="Weight"
              unit={unit}
              decimal
              step={STEP[set.weightUnit]}
              max={MAX_WEIGHT[set.weightUnit]}
              value={weight}
              onValueChange={setWeight}
            />
            <NumberStepper
              label="Reps"
              unit="reps"
              step={1}
              max={MAX_REPS}
              value={reps}
              onValueChange={setReps}
            />
            <Button
              variant="primary"
              size="log"
              className="mt-2 w-full"
              onClick={() =>
                void run(() =>
                  actions.editSet(sessionId, set.id, { weight, reps }),
                )
              }
            >
              Save set {set.setNumber}
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => setConfirming(true)}
            >
              Delete set {set.setNumber}
            </Button>
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function FinishDialog({
  open,
  onOpenChange,
  workoutName,
  logged,
  planned,
  left,
  online,
  onFinish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutName: string;
  logged: number;
  planned: number;
  left: number;
  online: boolean;
  onFinish: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const short = left > 0;

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      await onFinish();
    } catch (e) {
      setError(errorText(e, "continue"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {short
              ? `Finish with ${left} ${plural(left, "set")} left?`
              : `Finish ${workoutName}?`}
          </DialogTitle>
          <DialogDescription>
            {logged === 0
              ? "Nothing is logged yet. Finishing records the workout as done, with no sets."
              : short
                ? `${logged} of ${planned} planned sets are logged. The sets you didn’t do stay unlogged, and your program doesn’t change.`
                : "Every planned set is logged."}
            {online
              ? ""
              : " No signal: the finish waits in line behind your sets and syncs when you’re back."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button>Keep training</Button>
          </DialogClose>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void finish()}
          >
            Finish workout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * No record on this device: started elsewhere (offer to continue it here,
 * online), already finished and synced (point to history), or unknown.
 */
function NotOnDevice({ sessionId }: { sessionId: string }) {
  const online = useOnline();
  const detail = useSessionDetail(sessionId);
  const actions = useWorkoutActions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = detail.data?.session;

  async function adopt() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await actions.adopt({ sessionId, workoutId: session.workoutId });
    } catch (e) {
      setError(errorText(e, "continue"));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col items-start gap-5 px-4 pt-10 pb-16 md:px-9">
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">
        {session?.status === "COMPLETED"
          ? `${session.workoutName} is finished`
          : session?.status === "IN_PROGRESS"
            ? `${session.workoutName} is under way elsewhere`
            : "This workout isn’t on this device"}
      </h1>
      <p className="max-w-[60ch] text-[15px] text-muted-foreground">
        {session?.status === "COMPLETED"
          ? "Its sets are in your history."
          : session?.status === "IN_PROGRESS"
            ? "It was started on another device. Continue it here and the sets already logged come with it."
            : online
              ? detail.isPending
                ? "Looking for it…"
                : "It may have been finished and synced, or it belongs to another account."
              : "There’s no signal, so it can’t be looked up right now."}
      </p>
      {error ? (
        <p role="alert" className="text-[15px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {session?.status === "IN_PROGRESS" ? (
          <Button
            variant="primary"
            size="log"
            loading={busy}
            onClick={() => void adopt()}
          >
            Continue it here
          </Button>
        ) : null}
        {session?.status === "COMPLETED" ? (
          <Button asChild variant="primary">
            <Link to={`/history/${sessionId}`}>Open in history</Link>
          </Button>
        ) : null}
        <Button asChild>
          <Link to="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
