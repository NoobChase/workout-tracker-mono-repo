import { Check, Clock, CloudOff, RotateCw } from "lucide-react";
import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "./badge.js";

/**
 * Where one set stands. `queued` and `failed` are still in the log: the
 * lifter never waits on the network, the mutation queue does.
 */
export type SetStatus = "planned" | "live" | "logged" | "queued" | "failed";

export type SetKind = "working" | "warmup" | "drop";

/**
 * Why a queued set is waiting: no signal, or its turn behind an earlier set
 * the serial queue has not delivered yet.
 */
export type QueuedReason = "no-signal" | "in-order";

export type SetRowProps = Omit<ComponentProps<"li">, "children"> & {
  /** The set's number within its exercise, 1-based. */
  index: number;
  weight: number;
  reps: number;
  unit: "lb" | "kg";
  kind?: SetKind;
  status: SetStatus;
  /** Only read when `status` is "queued". */
  queuedReason?: QueuedReason;
};

const STATUS_TEXT: Record<SetStatus, string> = {
  planned: "planned",
  live: "now",
  logged: "logged",
  queued: "queued",
  failed: "failed, retrying",
};

/** The statuses a set lands in when the lifter logs it. */
const RULED: ReadonlySet<SetStatus> = new Set(["logged", "queued", "failed"]);

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const RULE_MS = 240;

/**
 * One ruled, numbered line of the log. The live set is the only copper on
 * it. When a set is logged it is ruled into place: the line settles, a copper
 * stroke runs the rule from the index outward, and the index strokes in
 * copper and cools to ink, all inside 240ms and only once. Nothing moves
 * under prefers-reduced-motion, and a row that renders already logged never
 * animates.
 */
export function SetRow({
  index,
  weight,
  reps,
  unit,
  kind = "working",
  status,
  queuedReason = "no-signal",
  className,
  ...props
}: SetRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const ruleRef = useRef<HTMLSpanElement>(null);
  const wetRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(status);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = status;
    const loggedNow =
      (from === "live" || from === "planned") && RULED.has(status);
    if (!loggedNow || prefersReducedMotion()) return;

    // `animate?.`: jsdom (component tests) has no Web Animations API.
    const timing = { duration: RULE_MS, fill: "none" } as const;
    const running = [
      contentRef.current?.animate?.(
        [
          { transform: "translateY(-3px)", easing: EASE_OUT },
          { transform: "translateY(0)" },
        ],
        timing,
      ),
      ruleRef.current?.animate?.(
        [
          { clipPath: "inset(0 100% 0 0)", opacity: 1, easing: EASE_OUT },
          {
            clipPath: "inset(0 0 0 0)",
            opacity: 1,
            offset: 0.65,
            easing: "ease",
          },
          { clipPath: "inset(0 0 0 0)", opacity: 0 },
        ],
        timing,
      ),
      wetRef.current?.animate?.(
        [
          { clipPath: "inset(0 100% 0 0)", opacity: 1, easing: EASE_OUT },
          {
            clipPath: "inset(0 0 0 0)",
            opacity: 1,
            offset: 0.5,
            easing: "ease",
          },
          { clipPath: "inset(0 0 0 0)", opacity: 0 },
        ],
        timing,
      ),
    ];
    return () => running.forEach((animation) => animation?.cancel());
  }, [status]);

  const live = status === "live";
  const settled = RULED.has(status);

  return (
    <li
      data-slot="set-row"
      data-status={status}
      aria-current={live ? "step" : undefined}
      className={cn("relative border-b border-line", className)}
      {...props}
    >
      <div
        ref={contentRef}
        className="grid min-h-13 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2"
      >
        <span className="relative num text-[15px] font-medium">
          <span className="sr-only">Set </span>
          <span
            className={cn(
              live ? "text-copper" : settled ? "text-foreground" : "text-faint",
            )}
          >
            {index}
          </span>
          {/* The wet stroke: a copper copy of the index that draws, then cools. */}
          <span
            ref={wetRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 text-copper opacity-0"
          >
            {index}
          </span>
        </span>

        <span className="flex min-w-0 items-center gap-2.5">
          <SetFigures
            weight={weight}
            reps={reps}
            unit={unit}
            muted={!settled && !live}
          />
          {kind !== "working" ? <Badge variant={kind} /> : null}
        </span>

        <SetStatusText status={status} queuedReason={queuedReason} />
      </div>
      {/* The rule a logged set is drawn along; at rest it is the hairline. */}
      <span
        ref={ruleRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-copper opacity-0"
      />
    </li>
  );
}

/**
 * A set's numbers in the one grammar every set line uses: mono numerals, the
 * unit small after the weight, "×", then reps. Screen readers hear
 * "225 lb for 5 reps".
 */
export function SetFigures({
  weight,
  reps,
  unit,
  muted = false,
  className,
}: {
  weight: number;
  reps: number;
  unit: "lb" | "kg";
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "num text-[15px] whitespace-nowrap",
        muted ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      {weight}
      <span className="ml-1 text-[0.8em] text-muted-foreground">{unit}</span>
      <span aria-hidden="true" className="px-1.5 text-muted-foreground">
        ×
      </span>
      <span className="sr-only"> for </span>
      {reps}
      <span className="sr-only"> reps</span>
    </span>
  );
}

const QUEUED: Record<QueuedReason, { text: string; Icon: typeof Clock }> = {
  "no-signal": { text: "queued, no signal", Icon: CloudOff },
  "in-order": { text: "queued, in order", Icon: Clock },
};

/** A set's state in words (Albert Sans), with its icon. */
export function SetStatusText({
  status,
  queuedReason = "no-signal",
}: {
  status: SetStatus;
  queuedReason?: QueuedReason;
}) {
  if (status === "planned") {
    return <span className="sr-only">{STATUS_TEXT.planned}</span>;
  }
  if (status === "live") {
    return (
      <span className="sc text-[11px] text-copper">{STATUS_TEXT.live}</span>
    );
  }
  const { text, Icon } =
    status === "queued"
      ? QUEUED[queuedReason]
      : {
          text: STATUS_TEXT[status],
          Icon: status === "logged" ? Check : RotateCw,
        };
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[13px] whitespace-nowrap",
        status === "failed" ? "text-danger" : "text-muted-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0"
      />
      {text}
    </span>
  );
}

/** The ordered log a set row lives in. */
export function SetLog({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="set-log"
      className={cn("m-0 list-none border-t border-line p-0", className)}
      {...props}
    />
  );
}

function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
