import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { nameOf } from "../../local/loggable.js";
import type { ExerciseView } from "../../local/session-view.js";
import { PlaceholderMark } from "../builder/markers.js";
import { plural, targetSets } from "../format.js";
import { Button } from "@/ui/button";

/** A slot's name on the workout screen; a placeholder as ∘ “label”. */
export function SlotTitle({ planned }: { planned: ExerciseView["planned"] }) {
  if (planned.exerciseId !== null) return <>{planned.name}</>;
  return (
    <>
      <PlaceholderMark className="text-muted-foreground" />
      <span className="sr-only">Placeholder:</span>
      <span className="min-w-0 truncate">“{nameOf(planned)}”</span>
    </>
  );
}

/**
 * The logger stopgap (step 4a D12): a slot the logger can't log yet, in its
 * place, with its target sets, the note that logging it arrives soon, and
 * Skip. It takes no sets, so finishing never waits on it.
 */
export function StopgapExercise({
  exercise,
  next,
  inProgress,
  onNext,
  onFinish,
}: {
  exercise: ExerciseView;
  next: ExerciseView | null;
  inProgress: boolean;
  onNext: () => void;
  onFinish: () => void;
}) {
  const headingId = useId();
  const { planned } = exercise;
  const target = targetSets(planned);
  const placeholder = planned.exerciseId === null;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col lg:sticky lg:top-8 lg:self-start"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-line-2 pb-3">
        <h2
          id={headingId}
          className="flex min-w-0 items-center gap-2.5 text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance"
        >
          <SlotTitle planned={planned} />
        </h2>
        <p className="text-[15px] whitespace-nowrap text-muted-foreground">
          <span className="num">{target}</span> {plural(target, "set")}
        </p>
      </div>
      <div className="flex flex-col gap-2 pt-5 pb-6">
        <p className="text-[17px] leading-snug font-semibold">
          Logging this arrives soon
        </p>
        <p className="max-w-[48ch] text-[15px] text-muted-foreground">
          {placeholder
            ? "It’s a placeholder in your plan: do what it says, then skip on. Nothing is recorded for it yet."
            : "Tanren logs weight and reps for now; times, distances and the rest come next. Do your sets, then skip on."}
        </p>
      </div>
      {inProgress ? (
        next ? (
          <Button size="log" className="w-full" onClick={onNext}>
            Skip to {nameOf(next.planned)}
            <ArrowRight aria-hidden="true" strokeWidth={1.75} />
          </Button>
        ) : (
          <Button size="log" className="w-full" onClick={onFinish}>
            Skip and finish
          </Button>
        )
      ) : null}
    </section>
  );
}
