import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button.js";
import { NumberStepper } from "@/ui/number-stepper.js";
import { SetLog, SetRow, type SetStatus } from "@/ui/set-row.js";
import { SyncStatus, type SyncState } from "@/ui/sync-status.js";
import { toast } from "@/ui/toaster.js";

/*
 * The kit's working live set. Everything here is local demo state: nothing is
 * written anywhere, so there is no mutation queue to go through. But it keeps
 * the queue's rules, so the kit never shows an order the app could not: sends
 * are serial, oldest first, and a set logged while an earlier one is still
 * waiting joins the queue behind it. "Signal" and "Sync attempts" stand in
 * for the queue's two outside facts, so every row state can be reached.
 */

type DemoSet = { n: number; weight: number; reps: number; status: SetStatus };

const PLAN = {
  exercise: "Back Squat",
  weight: 225,
  reps: 5,
  sets: 5,
  unit: "lb",
} as const;
/** First send of a queued set once there is signal. */
const SEND_MS = 900;
/** Retries back off from here, doubling, up to the cap. */
const RETRY_MS = 1400;
const RETRY_CAP_MS = 8000;

function freshSets(): DemoSet[] {
  return Array.from({ length: PLAN.sets }, (_, i) => ({
    n: i + 1,
    weight: PLAN.weight,
    reps: PLAN.reps,
    status: i < 2 ? "logged" : i === 2 ? "live" : "planned",
  }));
}

function plural(n: number) {
  return `${n} ${n === 1 ? "set" : "sets"}`;
}

export function LiveSetDemo() {
  const [sets, setSets] = useState(freshSets);
  const [weight, setWeight] = useState<number>(PLAN.weight);
  const [reps, setReps] = useState<number>(PLAN.reps);
  const [online, setOnline] = useState(true);
  const [failing, setFailing] = useState(false);

  // Failed sends of the set at the head of the queue, for the backoff.
  const [attempts, setAttempts] = useState(0);
  // Sets delivered since the queue was last empty, for the "synced" toast.
  const delivered = useRef(0);

  const liveAt = sets.findIndex((s) => s.status === "live");
  const live = liveAt >= 0 ? sets[liveAt] : undefined;
  const queued = sets.filter((s) => s.status === "queued").length;
  const failed = sets.filter((s) => s.status === "failed").length;
  // The oldest set still waiting: the only one the queue may send.
  const head = sets.find((s) => s.status === "queued" || s.status === "failed");
  const headN = head?.n;
  const headStatus = head?.status;

  const mark = (n: number, status: SetStatus) =>
    setSets((all) => all.map((s) => (s.n === n ? { ...s, status } : s)));

  // The demo queue: with signal, send the head, and only the head.
  useEffect(() => {
    if (!online || headN === undefined) return;
    const delay =
      headStatus === "failed"
        ? Math.min(RETRY_MS * 2 ** Math.max(attempts - 1, 0), RETRY_CAP_MS)
        : SEND_MS;
    const timer = setTimeout(() => {
      if (failing) {
        mark(headN, "failed");
        setAttempts((n) => n + 1);
        return;
      }
      mark(headN, "logged");
      setAttempts(0);
      delivered.current += 1;
    }, delay);
    return () => clearTimeout(timer);
  }, [online, failing, headN, headStatus, attempts]);

  // The queue has drained: say how much went out.
  useEffect(() => {
    if (headN !== undefined || delivered.current === 0) return;
    toast(`${plural(delivered.current)} synced`, {
      description: "Saved to your log, in the order you lifted them.",
    });
    delivered.current = 0;
  }, [headN]);

  const logSet = () => {
    if (liveAt < 0) return;
    // Sent at once only when nothing is ahead of it; otherwise it waits.
    const landed: SetStatus =
      !online || head !== undefined ? "queued" : failing ? "failed" : "logged";
    if (landed === "failed") setAttempts(1);
    setSets((all) =>
      all.map((s, i) =>
        i === liveAt
          ? { ...s, weight, reps, status: landed }
          : i === liveAt + 1
            ? { ...s, status: "live" }
            : s,
      ),
    );
    const next = sets[liveAt + 1];
    if (next) {
      setWeight(next.weight);
      setReps(next.reps);
    }
  };

  const goOffline = () => {
    if (!online) return;
    setOnline(false);
    setAttempts(0);
    // With no signal there is nothing to retry: failed sets wait like the rest.
    setSets((all) =>
      all.map((s) => (s.status === "failed" ? { ...s, status: "queued" } : s)),
    );
    toast("No signal", {
      description: "Sets you log will queue in order and sync later.",
    });
  };

  const reset = () => {
    setSets(freshSets());
    setWeight(PLAN.weight);
    setReps(PLAN.reps);
    setOnline(true);
    setFailing(false);
    setAttempts(0);
    delivered.current = 0;
  };

  const sync: { state: SyncState; pending: number } = !online
    ? { state: "offline", pending: queued }
    : failed > 0
      ? { state: "retrying", pending: failed }
      : queued > 0
        ? { state: "syncing", pending: queued }
        : { state: "synced", pending: 0 };

  const shownWeight = live ? weight : (sets.at(-1)?.weight ?? PLAN.weight);
  const shownReps = live ? reps : (sets.at(-1)?.reps ?? PLAN.reps);
  const changed =
    live !== undefined && (weight !== live.weight || reps !== live.reps);

  return (
    <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-labelledby="live-exercise" className="flex flex-col">
        <div className="flex items-baseline justify-between gap-4 border-b border-line-2 pb-3">
          <h1
            id="live-exercise"
            className="text-[28px] leading-tight font-bold tracking-[-0.02em]"
          >
            {PLAN.exercise}
          </h1>
          <p className="num text-[15px] whitespace-nowrap text-muted-foreground">
            Set{" "}
            <b className="font-medium text-copper">
              {live ? live.n : PLAN.sets}
            </b>{" "}
            / {PLAN.sets}
          </p>
        </div>

        <div className="pt-5 pb-6">
          <p
            aria-hidden="true"
            className="num text-[min(64px,15vw)] leading-none font-medium tracking-[-0.03em]"
          >
            {shownWeight}
            <span className="ml-1 text-[0.3em] tracking-normal text-muted-foreground">
              {PLAN.unit}
            </span>
            <span className="px-[0.18em] text-muted-foreground">×</span>
            {shownReps}
          </p>
          <p className="sr-only">
            {live ? "This set" : "Last set"}: {shownWeight} {PLAN.unit} for{" "}
            {shownReps} reps.
          </p>
          <p className="mt-3 text-sm text-faint">
            <span className="num">
              Plan {PLAN.weight} × {PLAN.reps}
            </span>
            {changed ? " · changed for this session only" : null}
            {" · demo data"}
          </p>
        </div>

        {live ? (
          <div className="flex flex-col gap-4">
            <NumberStepper
              label="Weight"
              unit={PLAN.unit}
              decimal
              step={5}
              max={2000}
              value={weight}
              onValueChange={setWeight}
            />
            <NumberStepper
              label="Reps"
              unit="reps"
              step={1}
              max={100}
              value={reps}
              onValueChange={setReps}
            />
            <Button
              variant="primary"
              size="log"
              className="mt-2 w-full"
              onClick={logSet}
            >
              Log set
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 border-t border-line pt-5">
            <p className="text-[17px] font-semibold">
              All {PLAN.sets} sets logged.
            </p>
            <p className="text-[15px] text-muted-foreground">
              Next up would be the second exercise. In the kit, start the demo
              over.
            </p>
            <Button size="log" className="w-full" onClick={reset}>
              Start the demo over
            </Button>
          </div>
        )}
      </section>

      <section
        aria-labelledby="log-title"
        data-send-attempts={attempts}
        className="flex flex-col"
      >
        <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-3 pb-3">
          <h2 id="log-title" className="sc text-muted-foreground">
            Today’s log
          </h2>
          <SyncStatus state={sync.state} pending={sync.pending} />
        </div>
        <SetLog aria-label={`${PLAN.exercise} sets`}>
          {sets.map((s) => (
            <SetRow
              key={s.n}
              index={s.n}
              weight={s.weight}
              reps={s.reps}
              unit={PLAN.unit}
              status={s.status}
              queuedReason={online ? "in-order" : "no-signal"}
            />
          ))}
        </SetLog>

        <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-end">
          <Segmented
            label="Signal"
            options={[
              {
                label: "Online",
                active: online,
                onSelect: () => setOnline(true),
              },
              { label: "Offline", active: !online, onSelect: goOffline },
            ]}
          />
          <Segmented
            label="Sync attempts"
            options={[
              {
                label: "Succeed",
                active: !failing,
                onSelect: () => {
                  setFailing(false);
                  // A healthy network is worth trying again soon.
                  setAttempts(0);
                },
              },
              {
                label: "Fail",
                active: failing,
                onSelect: () => setFailing(true),
              },
            ]}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-[50px] sm:ml-auto"
            onClick={reset}
          >
            Reset demo
          </Button>
        </div>
        <p className="mt-4 max-w-[60ch] text-sm text-muted-foreground">
          Offline, a logged set is queued and the lifter moves on. When the
          signal returns the queue sends one set at a time, oldest first; a
          failing send is retried with backoff, and the sets behind it wait.
        </p>
      </section>
    </div>
  );
}

function Segmented({
  label,
  options,
}: {
  label: string;
  options: { label: string; active: boolean; onSelect: () => void }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span
        aria-hidden="true"
        className="text-sm leading-none font-medium text-muted-foreground"
      >
        {label}
      </span>
      <div className="flex rounded-md border border-line-2 p-0.5">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={option.active}
            onClick={option.onSelect}
            className={cn(
              "h-11 min-w-20 rounded-[6px] px-3.5 text-sm font-medium transition-[background-color,color] duration-150 ease-out",
              option.active
                ? "bg-ghost text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
