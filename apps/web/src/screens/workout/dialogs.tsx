import { useState } from "react";
import { useWorkoutActions } from "../../data/hooks.js";
import type { ExerciseView, SetView } from "../../local/session-view.js";
import { errorText } from "../errors.js";
import { plural, unitLabel } from "../format.js";
import { MAX_REPS, MAX_WEIGHT, WEIGHT_STEP } from "./plan.js";
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
import { SetFigures } from "@/ui/set-row";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/sheet";

/*
 * The workout screen's two overlays: correcting or deleting one logged set
 * (a bottom sheet), and finishing, which counts the planned sets left.
 */

/**
 * Correct a set's numbers, or delete it. Its number and stamped unit stay;
 * deleting renumbers the sets after it, which the confirmation says first.
 */
export function EditSetSheet({
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
              step={WEIGHT_STEP[set.weightUnit]}
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

export function FinishDialog({
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
