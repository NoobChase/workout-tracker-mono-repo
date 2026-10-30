import { ArrowRight, CloudOff, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { AppHeader } from "../app/app-header.js";
import {
  useAuthReady,
  useFinishAndStartNext,
  useHistory,
  useNext,
  useOnline,
  usePrograms,
  useWorkoutActions,
  useWorkoutPreview,
  type NextView,
} from "../data/hooks.js";
import { nameOf } from "../local/loggable.js";
import type { InProgressEntry } from "../local/next-view.js";
import type { NextItem, Successor, Waiting } from "../local/outline.js";
import { errorText } from "./errors.js";
import { HistoryList } from "./history-rows.js";
import { homeMode, type HomeMode } from "./home-mode.js";
import { NewProgramSheet, type NewProgramStep } from "./new-program-sheet.js";
import { Notice, OfflineLine, RetryNotice } from "./notice.js";
import { ServerRead } from "./server-read.js";
import { formatTime, plural, relativeDay } from "./format.js";
import { STATUS_LABEL, progressOf } from "./program-format.js";
import { Progress } from "./program-progress.js";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { EmptyState } from "@/ui/empty-state";
import { toast } from "@/ui/toaster";

/**
 * Home (`/`, brief `apps-web-src-home`, layout "Today first"). The lifter
 * opens the app to train, so home makes that one tap obvious: unfinished
 * workouts first (Continue, or Finish & start next), then the next workout
 * of each active program (Start, or Skip), then their programs and recent
 * workouts. Starting, skipping and finishing are queued writes and work
 * offline; everything about the plan itself lives on the Programs screen.
 */
export function HomeScreen() {
  const next = useNext();
  const programs = usePrograms();
  const online = useOnline();
  const authReady = useAuthReady();
  const [sheet, setSheet] = useState<{ open: boolean; step: NewProgramStep }>({
    open: false,
    step: "choose",
  });
  const openSheet = (step: NewProgramStep) => setSheet({ open: true, step });

  const mode = homeMode({ next, programs, online, authReady });

  return (
    <>
      <AppHeader />
      <main className="mx-auto grid max-w-[1280px] gap-x-16 gap-y-12 px-4 pt-8 pb-16 md:px-9 md:pt-12 md:pb-24 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {mode === "first-run" ? (
          <FirstRun onPickTemplate={() => openSheet("template")} />
        ) : (
          <Today next={next} mode={mode} />
        )}
        <div className="flex min-w-0 flex-col gap-12">
          {mode === "first-run" ? null : (
            <YourPrograms onNewProgram={() => openSheet("choose")} />
          )}
          <Recent />
        </div>
      </main>
      <NewProgramSheet
        open={sheet.open}
        step={sheet.step}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        onStepChange={(step) => setSheet({ open: true, step })}
      />
    </>
  );
}

const pageHeading =
  "text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance md:text-[32px]";

/** The one card action under way: starting, resuming or finishing which. */
type Busy = { kind: "start" | "resume" | "finish"; id: string } | null;

const isBusy = (busy: Busy, kind: NonNullable<Busy>["kind"], id: string) =>
  busy?.kind === kind && busy.id === id;

/**
 * What to train: unfinished workouts first, then one next workout per
 * active program without one, then programs waiting on the server.
 */
function Today({
  next,
  mode,
}: {
  next: NextView;
  mode: Exclude<HomeMode, "first-run">;
}) {
  const actions = useWorkoutActions();
  const finishAndStart = useFinishAndStartNext();
  const navigate = useNavigate();
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  async function run(key: NonNullable<Busy>, work: () => Promise<void>) {
    setError(null);
    setBusy(key);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  }

  const start = (item: NextItem) =>
    run({ kind: "start", id: item.workoutId }, async () => {
      try {
        void navigate(`/workout/${await actions.start(item.workoutId)}`);
      } catch (e) {
        setError(errorText(e, "start"));
      }
    });

  const resume = (entry: InProgressEntry) =>
    run({ kind: "resume", id: entry.sessionId }, async () => {
      try {
        await actions.ensureOnDevice(entry);
        void navigate(`/workout/${entry.sessionId}`);
      } catch (e) {
        setError(errorText(e, "continue"));
      }
    });

  const finishThenNext = (entry: InProgressEntry) =>
    run({ kind: "finish", id: entry.sessionId }, async () => {
      try {
        const result = await finishAndStart(
          entry,
          next.successorOf(entry.workoutId),
        );
        if (result.kind === "started") {
          void navigate(`/workout/${result.sessionId}`);
          return;
        }
        if (result.startError) {
          setError(
            `${entry.workoutName} is finished. ${successorName(result.after)} couldn’t start: ${errorText(result.startError)}`,
          );
          return;
        }
        toast(`${entry.workoutName} finished`, {
          description: afterFinishText(result.after),
        });
      } catch (e) {
        setError(errorText(e, "continue"));
      }
    });

  const skip = async (item: NextItem, after: Successor) => {
    setError(null);
    try {
      await actions.skip(item.workoutId);
      toast(`Skipped ${item.workoutName}`, {
        description: movesUpText(after),
      });
    } catch (e) {
      setError(errorText(e, "start"));
    }
  };

  // A program with an unfinished workout shows only its Continue card.
  const started = new Set(next.inProgress.map((s) => s.workoutId));
  const nextCards = next.next.filter((n) => !started.has(n.workoutId));
  const firstIsContinue = next.inProgress.length > 0;

  let body: ReactNode;
  if (mode === "loading") {
    body = <CardSkeleton />;
  } else if (mode === "train") {
    body = (
      <div className="flex flex-col gap-4">
        {next.inProgress.map((entry, i) => (
          <ContinueCard
            key={entry.sessionId}
            entry={entry}
            primary={i === 0}
            busy={busy}
            onContinue={() => void resume(entry)}
            onFinishAndNext={() => void finishThenNext(entry)}
          />
        ))}
        {nextCards.map((item, i) => (
          <NextCard
            key={item.workoutId}
            item={item}
            primary={!firstIsContinue && i === 0}
            busy={isBusy(busy, "start", item.workoutId)}
            disabled={busy !== null}
            after={next.successorOf(item.workoutId)}
            onStart={() => void start(item)}
            onSkip={(after) => skip(item, after)}
          />
        ))}
        {next.waiting.map((w) => (
          <WaitingNote key={w.programId} waiting={w} />
        ))}
      </div>
    );
  } else if (mode === "idle") {
    body = (
      <Notice
        offline={false}
        action={
          <Button asChild>
            <Link to="/programs">Open Programs</Link>
          </Button>
        }
      >
        No program is active. Activate a draft on Programs, or start a new one.
      </Notice>
    );
  } else if (mode === "error") {
    body = (
      <Notice>Couldn’t load your programs. {errorText(next.error)}</Notice>
    );
  } else {
    body = (
      <Notice offline>
        No signal, and this device hasn’t saved your program yet. Open Tanren
        once with a connection and your next workouts will be ready to start
        offline.
      </Notice>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h1 id={headingId} className={pageHeading}>
          What’s next
        </h1>
        {next.source === "device" ? (
          <p className="flex items-center gap-2 text-[15px] text-muted-foreground">
            <CloudOff
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4 shrink-0"
            />
            Saved on this device. Starting and skipping work without signal.
          </p>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="max-w-[60ch] text-[15px] font-medium text-danger"
        >
          {error}
        </p>
      ) : null}
      {body}
    </section>
  );
}

function successorName(after: Successor): string {
  return after.kind === "workout" ? after.item.workoutName : "The next workout";
}

/** "Pull A moves up next." for the skip confirmation and its toast. */
function movesUpText(after: Successor): string {
  switch (after.kind) {
    case "workout":
      return `${after.item.workoutName} moves up next.`;
    case "new-cycle":
      return after.workoutName
        ? `Cycle ${after.cycleNumber} starts next, with ${after.workoutName}.`
        : `Cycle ${after.cycleNumber} starts next.`;
    case "complete":
      return `That finishes ${after.programName}.`;
    case "unknown":
      return "The next workout shows once this syncs.";
  }
}

function afterFinishText(after: Successor): string {
  switch (after.kind) {
    case "complete":
      return `That was the last workout of ${after.programName}. It’s finished.`;
    case "new-cycle":
      return `Cycle ${after.cycleNumber} begins once this syncs.`;
    default:
      return "The next workout shows once this syncs.";
  }
}

/** "today, 6:40 PM", "yesterday, 6:40 PM", else the day. */
function startedWhen(iso: string, now = new Date()): ReactNode {
  return (
    <>
      {relativeDay(iso, now)}, <span className="num">{formatTime(iso)}</span>
    </>
  );
}

const cardMeta = "text-sm text-muted-foreground";
const cardTitle = "text-xl leading-tight font-bold tracking-[-0.01em]";

function ContinueCard({
  entry,
  primary,
  busy,
  onContinue,
  onFinishAndNext,
}: {
  entry: InProgressEntry;
  primary: boolean;
  busy: Busy;
  onContinue: () => void;
  onFinishAndNext: () => void;
}) {
  const resuming = isBusy(busy, "resume", entry.sessionId);
  const finishing = isBusy(busy, "finish", entry.sessionId);
  const progress = entry.progress;
  return (
    <Card className="gap-5 border-line-2">
      <div className="flex flex-col gap-1.5">
        <p className={cardMeta}>
          {entry.programName}
          {entry.cycleNumber !== null ? (
            <>
              {" · "}Cycle <span className="num">{entry.cycleNumber}</span>
            </>
          ) : null}
        </p>
        <h2 className={cardTitle}>{entry.workoutName}</h2>
        <p className={cardMeta}>
          Started {startedWhen(entry.performedAt)}
          {entry.onDevice ? null : " on another device"}
          {progress && progress.planned > 0 ? (
            <span className="whitespace-nowrap">
              {" · "}
              <span className="num">{progress.logged}</span> of{" "}
              <span className="num">{progress.planned}</span>{" "}
              {plural(progress.planned, "exercise")} logged
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={primary ? "primary" : "secondary"}
          size="log"
          className="min-w-0 flex-1 basis-40"
          loading={resuming}
          disabled={busy !== null && !resuming}
          onClick={onContinue}
        >
          Continue {entry.workoutName}
        </Button>
        <Button
          variant="secondary"
          size="log"
          className="min-w-0 flex-1 basis-40"
          loading={finishing}
          disabled={busy !== null && !finishing}
          onClick={onFinishAndNext}
        >
          Finish & start next
        </Button>
      </div>
    </Card>
  );
}

function NextCard({
  item,
  primary,
  busy,
  disabled,
  after,
  onStart,
  onSkip,
}: {
  item: NextItem;
  primary: boolean;
  busy: boolean;
  disabled: boolean;
  after: Successor;
  onStart: () => void;
  onSkip: (after: Successor) => Promise<void>;
}) {
  const preview = useWorkoutPreview(item.workoutId).data;
  const exercises = preview
    ? [...preview.exercises].sort((a, b) => a.position - b.position)
    : [];
  const names = exercises.map(nameOf);
  const [confirming, setConfirming] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const promptId = useId();
  const wasConfirming = useRef(false);

  // Focus follows the swap: to the confirm button, and back to Skip.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) skipRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <Card className="gap-5">
      <div className="flex flex-col gap-1.5">
        <p className={cardMeta}>
          {item.programName} · Cycle{" "}
          <span className="num">{item.cycleNumber}</span>
        </p>
        <h2 className={cardTitle}>{item.workoutName}</h2>
        {names.length > 0 ? (
          <p className="truncate text-[15px] text-muted-foreground">
            <span className="num">{names.length}</span>{" "}
            {plural(names.length, "exercise")}
            {" · "}
            {names.join(", ")}
          </p>
        ) : null}
      </div>
      {confirming ? (
        <div
          role="group"
          aria-labelledby={promptId}
          className="flex animate-[tanren-fade-in_160ms_var(--ease-out)] flex-col gap-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirming(false);
          }}
        >
          <p id={promptId} className="text-[15px]">
            <span className="font-semibold">Skip {item.workoutName}?</span>{" "}
            <span className="text-muted-foreground">{movesUpText(after)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              size="log"
              className="min-w-0 flex-1 basis-40"
              loading={skipping}
              onClick={() => {
                setSkipping(true);
                void onSkip(after).finally(() => {
                  setSkipping(false);
                  setConfirming(false);
                });
              }}
            >
              Skip {item.workoutName}
            </Button>
            <Button
              variant="ghost"
              size="log"
              className="min-w-0 flex-1 basis-24"
              disabled={skipping}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant={primary ? "primary" : "secondary"}
            size="log"
            className="min-w-0 flex-1"
            loading={busy}
            disabled={disabled && !busy}
            onClick={onStart}
          >
            Start {item.workoutName}
          </Button>
          <Button
            ref={skipRef}
            variant="ghost"
            size="log"
            className="px-5"
            disabled={disabled}
            aria-label={`Skip ${item.workoutName}`}
            onClick={() => setConfirming(true)}
          >
            Skip
          </Button>
        </div>
      )}
    </Card>
  );
}

/** A program whose next workout the server has yet to say. */
function WaitingNote({ waiting }: { waiting: Waiting }) {
  let text: ReactNode;
  if (waiting.kind === "new-cycle") {
    text = (
      <>
        Cycle <span className="num">{waiting.cycleNumber}</span> begins
        {waiting.workoutName ? ` with ${waiting.workoutName}` : ""} once your
        last workout syncs.
      </>
    );
  } else if (waiting.kind === "complete") {
    text = "That was its last workout. It moves to Finished once it syncs.";
  } else {
    text = "Its next workout shows once your last one syncs.";
  }
  return (
    <div className="flex flex-col gap-1 border-y border-line py-4">
      <p className="text-[15px] font-semibold">{waiting.programName}</p>
      <p className="text-[15px] text-muted-foreground">{text}</p>
    </div>
  );
}

/** No programs at all: the two ways to begin, in place of what's next. */
function FirstRun({ onPickTemplate }: { onPickTemplate: () => void }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-6"
    >
      <h1 id={headingId} className={pageHeading}>
        Start your first program
      </h1>
      <EmptyState
        title="Your workouts will line up here"
        action={
          <>
            <Button variant="primary" onClick={onPickTemplate}>
              Pick a template
            </Button>
            <Button asChild>
              <Link to="/programs/new">Create from scratch</Link>
            </Button>
          </>
        }
      >
        A template is ready to train today. From scratch, you write the
        workouts, exercises and sets yourself.
      </EmptyState>
    </section>
  );
}

function SectionHeading({
  id,
  children,
  link,
}: {
  id: string;
  children: ReactNode;
  link: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 pb-3 lg:mt-1.5">
      <h2 id={id} className="text-[17px] leading-snug font-semibold">
        {children}
      </h2>
      {link}
    </div>
  );
}

function ArrowLink({
  to,
  label,
  children,
}: {
  to: string;
  label?: string;
  children: string;
}) {
  return (
    <Button asChild variant="ghost" className="-mx-3 px-3">
      <Link to={to} aria-label={label}>
        {children}
        <ArrowRight aria-hidden="true" strokeWidth={1.75} />
      </Link>
    </Button>
  );
}

/** Active programs and drafts, at most four, with the way to all of them. */
function YourPrograms({ onNewProgram }: { onNewProgram: () => void }) {
  const programs = usePrograms();
  const headingId = useId();
  const body = (
    <ServerRead
      query={programs}
      offline={
        <OfflineLine className="border-t border-line pt-4">
          Your programs load with a connection.
        </OfflineLine>
      }
      error={(e, retry) => (
        <RetryNotice retry={retry}>
          Couldn’t load your programs. {errorText(e)}
        </RetryNotice>
      )}
      skeleton={<RowsSkeleton />}
    >
      {({ programs: all }) => {
        const shown = all
          .filter((p) => p.status === "ACTIVE" || p.status === "DRAFT")
          .sort((a, b) =>
            a.status === b.status ? 0 : a.status === "ACTIVE" ? -1 : 1,
          )
          .slice(0, 4);
        return shown.length > 0 ? (
          <ul aria-labelledby={headingId} className="border-t border-line">
            {shown.map((p) => (
              <li key={p.id} className="border-b border-line">
                <Link
                  to={`/programs/${p.id}`}
                  className="-mx-2 flex min-h-14 items-center justify-between gap-4 rounded-md px-2 py-2 no-underline transition-[background-color] duration-150 hover:bg-ghost"
                >
                  <span className="min-w-0 truncate text-[15px] font-semibold">
                    {p.name}
                  </span>
                  <span className="shrink-0 text-[13px] text-muted-foreground">
                    {STATUS_LABEL[p.status]}
                    {" · "}
                    {p.status === "DRAFT" ? (
                      "not started"
                    ) : (
                      <Progress progress={progressOf(p)} />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line pt-4 text-[15px] text-muted-foreground">
            Nothing active or in draft. Finished and archived programs are on
            Programs.
          </p>
        );
      }}
    </ServerRead>
  );

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col">
      <SectionHeading
        id={headingId}
        link={
          <ArrowLink to="/programs" label="All programs">
            All
          </ArrowLink>
        }
      >
        Your programs
      </SectionHeading>
      {body}
      <div className="pt-3">
        <Button variant="ghost" className="-mx-3 px-3" onClick={onNewProgram}>
          <Plus aria-hidden="true" strokeWidth={1.75} />
          New program
        </Button>
      </div>
    </section>
  );
}

/**
 * The newest finished workouts: the proof, one glance away. A server read,
 * so offline it says it needs a connection.
 */
function Recent() {
  const history = useHistory();
  const headingId = useId();
  const body = (
    <ServerRead
      query={history}
      offline={
        <OfflineLine className="border-t border-line pt-4">
          Recent workouts load with a connection.
        </OfflineLine>
      }
      error={(e, retry) => (
        <RetryNotice retry={retry}>
          Couldn’t load recent workouts. {errorText(e)}
        </RetryNotice>
      )}
      skeleton={<RowsSkeleton />}
    >
      {(data) => {
        const items = data.pages[0]?.items.slice(0, 4) ?? [];
        return items.length > 0 ? (
          <HistoryList items={items} label="Recent workouts" />
        ) : (
          <p className="border-t border-line pt-4 text-[15px] text-muted-foreground">
            Finished workouts land here, newest first.
          </p>
        );
      }}
    </ServerRead>
  );

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col">
      <SectionHeading
        id={headingId}
        link={<ArrowLink to="/history">History</ArrowLink>}
      >
        Recent workouts
      </SectionHeading>
      {body}
    </section>
  );
}

function RowsSkeleton() {
  return (
    <div role="status" className="border-t border-line">
      <span className="sr-only">Loading</span>
      {[0, 1, 2].map((n) => (
        <div
          key={n}
          aria-hidden="true"
          className="flex h-14 items-center gap-4 border-b border-line"
        >
          <span className="h-3.5 w-20 rounded-sm bg-line" />
          <span className="h-3.5 w-40 rounded-sm bg-line" />
        </div>
      ))}
    </div>
  );
}

/** A card's footprint while it loads. */
function CardSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div
        aria-hidden="true"
        className="flex flex-col gap-5 rounded-xl border border-line bg-card p-4"
      >
        <span className="h-3.5 w-32 rounded-sm bg-line" />
        <span className="h-5 w-24 rounded-sm bg-line" />
        <span className="h-3.5 w-56 rounded-sm bg-line" />
        <span className="h-14 rounded-md border border-line" />
      </div>
    </div>
  );
}
