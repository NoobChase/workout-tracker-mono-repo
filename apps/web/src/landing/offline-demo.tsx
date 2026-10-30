import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  SetLog,
  SetRow,
  type QueuedReason,
  type SetStatus,
} from "@/ui/set-row";
import { SyncStatus, type SyncState } from "@/ui/sync-status";

type Row = SetStatus | `queued:${QueuedReason}`;

interface Frame {
  /** How long the frame holds before the next one. */
  ms: number;
  rows: readonly [Row, Row, Row, Row];
  sync: SyncState;
  /** Sets waiting, as the sync line counts them. */
  pending?: number;
}

/**
 * One slow loop of a workout that loses its signal: two sets logged online,
 * the signal drops, two more rule in as waiting, the signal returns and they
 * sync in the order they were logged. Exported for the tests.
 */
export const FRAMES: readonly Frame[] = [
  { ms: 1_800, rows: ["logged", "live", "planned", "planned"], sync: "synced" },
  { ms: 1_600, rows: ["logged", "logged", "live", "planned"], sync: "synced" },
  {
    ms: 1_600,
    rows: ["logged", "logged", "live", "planned"],
    sync: "offline",
  },
  {
    ms: 1_800,
    rows: ["logged", "logged", "queued:no-signal", "live"],
    sync: "offline",
    pending: 1,
  },
  {
    ms: 2_000,
    rows: ["logged", "logged", "queued:no-signal", "queued:no-signal"],
    sync: "offline",
    pending: 2,
  },
  {
    ms: 1_000,
    rows: ["logged", "logged", "queued:in-order", "queued:in-order"],
    sync: "syncing",
    pending: 2,
  },
  {
    ms: 1_000,
    rows: ["logged", "logged", "logged", "queued:in-order"],
    sync: "syncing",
    pending: 1,
  },
  { ms: 3_000, rows: ["logged", "logged", "logged", "logged"], sync: "synced" },
];

/** Reduced motion: one still frame, a waiting set syncing behind a synced one. */
export const STILL_FRAME = 6;

function prefersStill(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function rowProps(row: Row): {
  status: SetStatus;
  queuedReason?: QueuedReason;
} {
  if (row.startsWith("queued:")) {
    return {
      status: "queued",
      queuedReason: row.slice("queued:".length) as QueuedReason,
    };
  }
  return { status: row as SetStatus };
}

/**
 * "Repeat the work", shown rather than claimed: the logger's own set rows
 * and sync line, running the loop above. It runs only while on screen and
 * the tab is visible, has a pause control (it would otherwise move for more
 * than five seconds, WCAG 2.2.2), and holds one still frame under reduced
 * motion. Screen readers get one sentence instead of a live region that
 * would announce every frame.
 */
export function OfflineDemo() {
  const [still] = useState(prefersStill);
  const [frame, setFrame] = useState(still ? STILL_FRAME : 0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== "function") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setOnScreen(entry?.isIntersecting ?? false),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const running = !still && !paused && onScreen && tabVisible;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      if (frame === FRAMES.length - 1) {
        setFrame(0);
        setCycle((c) => c + 1);
      } else {
        setFrame(frame + 1);
      }
    }, FRAMES[frame]!.ms);
    return () => clearTimeout(timer);
  }, [running, frame]);

  const { rows, sync, pending } = FRAMES[frame]!;

  return (
    <figure ref={ref} className="m-0 flex flex-col gap-2">
      <div
        aria-hidden="true"
        data-frame={frame}
        className="rounded-xl border border-line bg-card px-4 pt-3.5 pb-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-3">
          <span className="text-[15px] font-semibold">Back Squat</span>
          <SyncStatus state={sync} pending={pending} />
        </div>
        <SetLog key={cycle} className={cycle > 0 ? "lp-fade-in" : undefined}>
          {rows.map((row, i) => (
            <SetRow
              key={i}
              index={i + 1}
              weight={225}
              reps={5}
              unit="lb"
              className="last:border-b-0"
              {...rowProps(row)}
            />
          ))}
        </SetLog>
      </div>
      <figcaption className="flex min-h-8 items-center justify-between gap-3 text-[13px] text-faint">
        <span>
          Demo: the signal drops mid-workout
          <span className="sr-only">
            . Two sets of Back Squat are logged and synced. The signal drops;
            the next two sets are logged anyway and wait on the device. When the
            signal returns they sync, in the order they were logged.
          </span>
        </span>
        {still ? null : (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="-mr-2.5 inline-flex h-8 items-center gap-[7px] rounded-sm px-2.5 text-[13px] font-medium text-muted-foreground transition-[color,transform] duration-[160ms] ease-out hover:text-foreground active:scale-[0.96]"
          >
            {paused ? (
              <Play
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5"
              />
            ) : (
              <Pause
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5"
              />
            )}
            {paused ? "Play demo" : "Pause demo"}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
