import { Ban, Check, Clock, CloudOff, Pencil, RotateCw } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type RefObject,
} from "react";
import type { EffortTarget as Effort } from "@/lib/effort";
import { cn } from "@/lib/utils";
import { Badge } from "./badge.js";

/**
 * Where one set stands. `queued` and `failed` are still in the log: the
 * lifter never waits on the network, the mutation queue does. `rejected`
 * means the server refused it for good; the queue stops there until the
 * lifter acts, and the row carries the server's reason.
 */
export type SetStatus =
  "planned" | "live" | "logged" | "queued" | "failed" | "rejected";

export type SetKind = "working" | "warmup" | "drop";

/**
 * Why a queued set is waiting: no signal, or its turn behind an earlier set
 * the serial queue has not delivered yet.
 */
export type QueuedReason = "no-signal" | "in-order";

export type SetRowProps = Omit<ComponentProps<"li">, "children"> & {
  /** The set's number within its exercise, 1-based. */
  index: number;
  /** `null`: no weight entered yet (a live or planned set only). */
  weight: number | null;
  reps: number | null;
  unit: "lb" | "kg";
  kind?: SetKind;
  status: SetStatus;
  /** Only read when `status` is "queued". */
  queuedReason?: QueuedReason;
  /** Only read when `status` is "rejected": the server's words. */
  reason?: string;
  /**
   * Makes the whole line a button (to edit the set): a 52px target, with a
   * pencil at the end so it reads as editable.
   */
  onPress?: () => void;
  /** The plan's effort target for this set, beside the figures. */
  target?: Effort | null;
};

const STATUS_TEXT: Record<SetStatus, string> = {
  planned: "planned",
  live: "now",
  logged: "logged",
  queued: "queued",
  failed: "failed, retrying",
  rejected: "rejected",
};

/** The statuses a set lands in when the lifter logs it. */
const RULED: ReadonlySet<SetStatus> = new Set([
  "logged",
  "queued",
  "failed",
  "rejected",
]);

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
  reason,
  onPress,
  target,
  className,
  ...props
}: SetRowProps) {
  const contentRef = useRef<HTMLElement>(null);
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
  const rejected = status === "rejected" && reason;

  const cells = (
    <>
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
        {target ? <EffortTarget target={target} /> : null}
        {kind !== "working" ? <Badge variant={kind} /> : null}
      </span>

      <SetStatusText status={status} queuedReason={queuedReason} />

      {onPress ? (
        <span
          data-slot="set-row-edit"
          className="grid size-5 place-items-center text-muted-foreground transition-colors duration-150 ease-out"
        >
          <Pencil aria-hidden="true" strokeWidth={1.75} className="size-4" />
        </span>
      ) : null}

      {rejected ? (
        <span className="col-start-2 col-end-[-1] pb-1 text-[13px] leading-snug text-danger">
          {reason}
        </span>
      ) : null}
    </>
  );

  const grid = cn(
    "grid min-h-13 items-center gap-x-3 py-2",
    onPress
      ? "grid-cols-[2.5rem_minmax(0,1fr)_auto_1.25rem]"
      : "grid-cols-[2.5rem_minmax(0,1fr)_auto]",
    rejected && "gap-y-1",
  );

  return (
    <li
      data-slot="set-row"
      data-status={status}
      aria-current={live ? "step" : undefined}
      className={cn("relative border-b border-line", className)}
      {...props}
    >
      {onPress ? (
        <button
          ref={contentRef as RefObject<HTMLButtonElement>}
          type="button"
          onClick={onPress}
          aria-label={pressLabel({
            index,
            weight,
            reps,
            unit,
            status,
            queuedReason,
            reason,
          })}
          className={cn(
            grid,
            "w-full text-left outline-offset-[-2px]",
            "transition-transform duration-[160ms] ease-out active:scale-[0.985]",
            "[@media(hover:hover)]:hover:[&_[data-slot=set-row-edit]]:text-foreground",
          )}
        >
          {cells}
        </button>
      ) : (
        <div ref={contentRef as RefObject<HTMLDivElement>} className={grid}>
          {cells}
        </div>
      )}
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
 * A prescribed effort target in words beside a set's figures: "· RIR 2".
 * Words in Albert Sans, the number in mono; muted, never copper.
 */
export function EffortTarget({ target }: { target: Effort }) {
  return (
    <span className="text-[13px] whitespace-nowrap text-muted-foreground">
      <span aria-hidden="true">· </span>
      <span className="sr-only">, target </span>
      {target.scale} <span className="num">{target.value}</span>
    </span>
  );
}

/** "Set 2, 225 lb for 5 reps, logged. Edit": what a pressable row is called. */
function pressLabel({
  index,
  weight,
  reps,
  unit,
  status,
  queuedReason,
  reason,
}: Pick<
  SetRowProps,
  "index" | "weight" | "reps" | "unit" | "status" | "queuedReason" | "reason"
>) {
  const state =
    status === "queued"
      ? QUEUED[queuedReason ?? "no-signal"].text
      : STATUS_TEXT[status];
  return [
    `Set ${index}, ${weight ?? "no weight"} ${unit} for ${reps ?? "no"} reps, ${state}`,
    status === "rejected" && reason ? `: ${reason}` : "",
    ". Edit",
  ].join("");
}

/**
 * A set's numbers in the one grammar every set line uses: mono numerals, the
 * unit small after the weight, "×", then reps. Screen readers hear
 * "225 lb for 5 reps". A plan's line passes its rep range as written
 * ("5–8"), or no reps at all when it prescribes a weight alone.
 */
export function SetFigures({
  weight,
  reps,
  unit,
  muted = false,
  className,
}: {
  /** `null` shows a blank: nothing entered yet. */
  weight: number | null;
  /**
   * A count, a range as written ("5–8"), `null` for a blank (nothing
   * entered yet), or absent when the line has no reps part.
   */
  reps?: number | string | null;
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
      <Figure value={weight} missing="no weight yet" />
      {/* Heard (and copied) as "225 lb", not "225lb". */}
      <span className="sr-only"> </span>
      <span className="ml-1 text-[0.8em] text-muted-foreground">{unit}</span>
      {reps === undefined ? null : (
        <>
          <span aria-hidden="true" className="px-1.5 text-muted-foreground">
            ×
          </span>
          <span className="sr-only"> for </span>
          <Figure value={reps} missing="no reps yet" />
          <span className="sr-only"> reps</span>
        </>
      )}
    </span>
  );
}

function Figure({
  value,
  missing,
}: {
  value: number | string | null;
  missing: string;
}) {
  if (value !== null) return <>{value}</>;
  return (
    <>
      <BlankFigure />
      <span className="sr-only">{missing}</span>
    </>
  );
}

/**
 * A number not entered yet, drawn as the ledger's blank to fill: a short
 * ruled line on the baseline. Not a dash, which reads as a minus. Scales
 * with the text around it; hidden from assistive tech (callers say it).
 */
export function BlankFigure({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-[0.7em] w-[1.8ch] border-b-[0.08em] border-edge align-baseline",
        className,
      )}
    />
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
          Icon:
            status === "logged"
              ? Check
              : status === "rejected"
                ? Ban
                : RotateCw,
        };
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[13px] whitespace-nowrap",
        status === "failed" || status === "rejected"
          ? "text-danger"
          : "text-muted-foreground",
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
