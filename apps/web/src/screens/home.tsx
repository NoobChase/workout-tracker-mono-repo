import type { TemplateSummary } from "@workout-tracker/shared";
import { ArrowRight, CloudOff } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { AppHeader } from "../app/app-header.js";
import {
  useAuthReady,
  useHistory,
  useLocalSessions,
  useNext,
  useOnline,
  useStartProgram,
  useTemplates,
  useWorkoutActions,
  useWorkoutPreview,
  type InProgressEntry,
  type NextView,
} from "../data/hooks.js";
import { errorText, isNotEntitled } from "./errors.js";
import { HistoryList } from "./history-rows.js";
import { Notice } from "./notice.js";
import {
  formatDay,
  formatTime,
  plural,
  repRangeOf,
  targetSets,
  unitLabel,
} from "./format.js";
import { Button } from "@/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/card";
import { SetFigures } from "@/ui/set-row";
import { toast } from "@/ui/toaster";

/**
 * Home (`/`): what's next, one card per active program, each startable
 * offline from the prefetched plan; a resume banner for a workout already
 * under way; with no active program, the templates. History is one link.
 */
export function HomeScreen() {
  const next = useNext();
  const actions = useWorkoutActions();
  const online = useOnline();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(
    key: string,
    doing: "start" | "continue",
    open: () => Promise<string>,
  ) {
    setError(null);
    setBusy(key);
    try {
      void navigate(`/workout/${await open()}`);
    } catch (e) {
      setError(errorText(e, doing));
      setBusy(null);
    }
  }

  const start = (workoutId: string) =>
    run(workoutId, "start", () => actions.start(workoutId));

  const resume = (entry: InProgressEntry) =>
    run(entry.sessionId, "continue", async () => {
      if (!entry.onDevice) {
        if (!online) {
          throw new Error(
            "This workout was started on another device. Continuing it here needs a connection the first time.",
          );
        }
        await actions.adopt(entry);
      }
      return entry.sessionId;
    });

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col gap-10 px-4 pt-8 pb-16 md:px-9 md:pt-12 md:pb-24">
        {error ? (
          <p
            role="alert"
            className="max-w-[60ch] text-[15px] font-medium text-danger"
          >
            {error}
          </p>
        ) : null}

        {next.inProgress.length > 0 ? (
          <section aria-label="In progress" className="flex flex-col gap-3">
            {next.inProgress.map((entry) => (
              <ResumeBanner
                key={entry.sessionId}
                entry={entry}
                busy={busy === entry.sessionId}
                onResume={() => void resume(entry)}
              />
            ))}
          </section>
        ) : null}

        <WhatsNext
          next={next}
          busy={busy}
          onStart={(workoutId) => void start(workoutId)}
        />
      </main>
    </>
  );
}

function ResumeBanner({
  entry,
  busy,
  onResume,
}: {
  entry: InProgressEntry;
  busy: boolean;
  onResume: () => void;
}) {
  const records = useLocalSessions();
  const record = records.get(entry.sessionId);
  const logged =
    record?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? null;
  return (
    <Card className="gap-5 border-line-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">
          In progress{entry.onDevice ? "" : " on another device"}
        </p>
        <h2 className="text-xl leading-tight font-bold tracking-[-0.01em]">
          {entry.workoutName}
        </h2>
        <p className="text-sm text-muted-foreground">
          {/* Two lines, never a separator stranded at a line's edge. */}
          <span className="block">{entry.programName}</span>
          <span className="block">
            Started {formatDay(entry.performedAt)},{" "}
            <span className="num">{formatTime(entry.performedAt)}</span>
            {logged !== null ? (
              <span className="whitespace-nowrap">
                {" "}
                · <span className="num">{logged}</span> {plural(logged, "set")}{" "}
                logged
              </span>
            ) : null}
          </span>
        </p>
      </div>
      <Button
        variant="primary"
        size="log"
        className="w-full sm:w-auto sm:min-w-44"
        loading={busy}
        onClick={onResume}
      >
        Resume {entry.workoutName}
      </Button>
    </Card>
  );
}

function WhatsNext({
  next,
  busy,
  onStart,
}: {
  next: NextView;
  busy: string | null;
  onStart: (workoutId: string) => void;
}) {
  const online = useOnline();
  const authReady = useAuthReady();
  const headingId = useId();
  const waitingForAuth =
    next.source === "none" && !next.error && online && !authReady;
  const hasPrograms = next.next.length > 0;
  const anyInProgress = next.inProgress.length > 0;

  const mode =
    next.isLoading || waitingForAuth
      ? "loading"
      : hasPrograms
        ? "programs"
        : next.source === "none" && next.error
          ? "error"
          : next.source === "none" && !online
            ? "offline"
            : "templates";

  let body;
  switch (mode) {
    case "loading":
      body = <CardSkeleton />;
      break;
    case "programs":
      body = (
        <div className="flex flex-col gap-4">
          {next.next.map((n) => {
            const inProgress = next.inProgress.find(
              (s) => s.workoutId === n.workoutId,
            );
            return (
              <NextCard
                key={n.workoutId}
                item={n}
                inProgress={inProgress ?? null}
                primary={!anyInProgress}
                busy={busy === n.workoutId}
                onStart={() => onStart(n.workoutId)}
              />
            );
          })}
        </div>
      );
      break;
    case "error":
      body = (
        <Notice>Couldn’t load your programs. {errorText(next.error)}</Notice>
      );
      break;
    case "offline":
      body = (
        <Notice offline>
          No signal, and this device hasn’t saved your program yet. Open Tanren
          once with a connection and your next workouts will be ready to start
          offline.
        </Notice>
      );
      break;
    case "templates":
      body = <Templates />;
      break;
  }

  const note =
    next.source === "device" ? (
      <p className="flex items-center gap-2 text-[15px] text-muted-foreground">
        <CloudOff
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-4 shrink-0"
        />
        Saved on this device. Starting works without signal.
      </p>
    ) : mode === "templates" && online ? (
      <p className="max-w-[60ch] text-[15px] text-muted-foreground">
        Start from a template and it becomes your program: open-ended, one cycle
        at a time. No weights are set for you; the first time through, you enter
        your own.
      </p>
    ) : null;

  // A program to train: the logger's own split, what's next at left and the
  // record at right, History seated with that record.
  if (mode === "programs" || mode === "loading") {
    return (
      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section aria-labelledby={headingId} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1
              id={headingId}
              className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance md:text-[32px]"
            >
              What’s next
            </h1>
            {note}
          </div>
          {body}
        </section>
        <Recent />
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1
            id={headingId}
            className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance md:text-[32px]"
          >
            {mode === "templates" ? "Choose a program" : "What’s next"}
          </h1>
          <HistoryLink />
        </div>
        {note}
      </div>
      {body}
    </section>
  );
}

function HistoryLink() {
  return (
    <Button asChild variant="ghost" className="-mx-3 px-3">
      <Link to="/history">
        History
        <ArrowRight aria-hidden="true" strokeWidth={1.75} />
      </Link>
    </Button>
  );
}

/**
 * The newest finished workouts beside what's next: the proof, one glance
 * away. A server read, so offline it says it needs a connection.
 */
function Recent() {
  const history = useHistory();
  const online = useOnline();
  const headingId = useId();
  const items = history.data?.pages[0]?.items.slice(0, 4) ?? [];

  let body: ReactNode;
  if (history.data) {
    body =
      items.length > 0 ? (
        <HistoryList items={items} label="Recent workouts" />
      ) : (
        <p className="border-t border-line pt-4 text-[15px] text-muted-foreground">
          Finished workouts land here, newest first.
        </p>
      );
  } else if (!online) {
    body = (
      <p
        role="status"
        className="flex gap-2 border-t border-line pt-4 text-[15px] text-muted-foreground"
      >
        <CloudOff
          aria-hidden="true"
          strokeWidth={1.75}
          className="mt-1 size-4 shrink-0"
        />
        Recent workouts load with a connection.
      </p>
    );
  } else if (history.error) {
    body = (
      <Notice
        action={
          <Button onClick={() => void history.refetch()}>Try again</Button>
        }
      >
        Couldn’t load recent workouts. {errorText(history.error)}
      </Notice>
    );
  } else {
    body = (
      <div role="status" className="border-t border-line">
        <span className="sr-only">Loading</span>
        {[0, 1, 2].map((n) => (
          <div
            key={n}
            aria-hidden="true"
            className="flex h-16 items-center gap-4 border-b border-line"
          >
            <span className="h-3.5 w-20 rounded-sm bg-line" />
            <span className="h-3.5 w-40 rounded-sm bg-line" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col">
      <div className="flex min-h-11 items-center justify-between gap-3 pb-3 lg:mt-1.5">
        <h2 id={headingId} className="text-[17px] leading-snug font-semibold">
          Recent workouts
        </h2>
        <HistoryLink />
      </div>
      {body}
    </section>
  );
}

function NextCard({
  item,
  inProgress,
  primary,
  busy,
  onStart,
}: {
  item: NextView["next"][number];
  inProgress: InProgressEntry | null;
  primary: boolean;
  busy: boolean;
  onStart: () => void;
}) {
  const preview = useWorkoutPreview(item.workoutId).data;
  const exercises = preview
    ? [...preview.exercises].sort((a, b) => a.position - b.position)
    : [];
  return (
    <Card className="gap-5">
      <CardHeader className="gap-1.5">
        <p className="text-sm text-muted-foreground">
          {item.programName} · Cycle{" "}
          <span className="num">{item.cycleNumber}</span>
          {inProgress ? " · in progress" : ""}
        </p>
        <CardTitle className="text-xl leading-tight font-bold tracking-[-0.01em]">
          {item.workoutName}
        </CardTitle>
      </CardHeader>
      {exercises.length > 0 ? (
        <CardContent>
          <ol
            aria-label={`${item.workoutName} exercises`}
            className="border-t border-line"
          >
            {exercises.map((e, i) => {
              const sets = targetSets(e);
              const reps = repRangeOf(e);
              const last = e.lastTime?.sets[0];
              return (
                <li
                  key={e.plannedExerciseId}
                  className="grid min-h-11 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-b border-line py-2.5 last:border-b-0"
                >
                  <span className="num text-sm text-faint">{i + 1}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[15px]">{e.name}</span>
                    {last ? (
                      <span className="text-[13px] text-muted-foreground">
                        Last time{" "}
                        <SetFigures
                          weight={last.weight}
                          reps={last.reps}
                          unit={
                            last.weightUnit ? unitLabel(last.weightUnit) : "lb"
                          }
                          className="text-[13px]"
                        />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[13px] whitespace-nowrap text-muted-foreground">
                    <span className="num">{sets}</span> {plural(sets, "set")}
                    {reps ? (
                      <>
                        {" "}
                        · <span className="num">{reps}</span> reps
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      ) : null}
      {/* One action per session: a workout already under way is resumed
          from its In progress card, so this one only says so. */}
      {inProgress ? null : (
        <CardFooter className="mt-auto border-t-0 pt-0">
          <Button
            variant={primary ? "primary" : "secondary"}
            size="log"
            className="w-full"
            loading={busy}
            onClick={onStart}
          >
            Start {item.workoutName}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function Templates() {
  const templates = useTemplates();
  const startProgram = useStartProgram();
  const online = useOnline();
  const [started, setStarted] = useState<string | null>(null);

  if (!templates.data) {
    if (!online) {
      return (
        <Notice offline>
          You don’t have a program yet, and templates need a connection to load.
          They’ll appear here when you’re back online.
        </Notice>
      );
    }
    if (templates.error) {
      return (
        <Notice
          action={
            <Button onClick={() => void templates.refetch()}>Try again</Button>
          }
        >
          Couldn’t load the templates. {errorText(templates.error)}
        </Notice>
      );
    }
    return <CardSkeleton count={3} />;
  }

  function start(template: TemplateSummary) {
    setStarted(template.slug);
    startProgram.mutate(template.slug, {
      onSuccess: ({ program }) =>
        toast(`${program.name} started`, {
          description: `${template.workouts[0]?.name ?? "Its first workout"} is up first.`,
        }),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {startProgram.error ? (
        <p
          role="alert"
          className="max-w-[60ch] text-[15px] font-medium text-danger"
        >
          {isNotEntitled(startProgram.error)
            ? "Starting a program needs an active subscription. Your history stays readable, and export stays open."
            : `Couldn’t start that program. ${errorText(startProgram.error)}`}
        </p>
      ) : null}
      {!online ? (
        <p className="flex items-center gap-2 text-[15px] text-muted-foreground">
          <CloudOff aria-hidden="true" strokeWidth={1.75} className="size-4" />
          Starting a program needs a connection.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.data.templates.map((t) => (
          <TemplateCard
            key={t.slug}
            template={t}
            disabled={!online || startProgram.isPending}
            busy={startProgram.isPending && started === t.slug}
            onStart={() => start(t)}
          />
        ))}
        <FromScratch />
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  disabled,
  busy,
  onStart,
}: {
  template: TemplateSummary;
  disabled: boolean;
  busy: boolean;
  onStart: () => void;
}) {
  const days = template.workouts.length;
  return (
    <Card className="gap-5">
      <CardHeader className="gap-1.5">
        <CardTitle className="text-xl leading-tight font-bold tracking-[-0.01em]">
          {template.name}
        </CardTitle>
        <CardDescription className="text-[15px]">
          {template.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="sr-only">
          {days} {plural(days, "workout")}:
        </p>
        <dl className="border-t border-line">
          {template.workouts.map((w) => (
            <div
              key={w.name}
              className="border-b border-line py-3 last:border-b-0"
            >
              <dt className="text-[15px] font-semibold">{w.name}</dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">
                {w.exercises.map((e) => e.name).join(", ")}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button
          className="w-full"
          disabled={disabled && !busy}
          loading={busy}
          onClick={onStart}
        >
          Start {template.name}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Announces the builder; writes nothing (program-templates spec). */
function FromScratch() {
  const [asked, setAsked] = useState(false);
  const noteId = useId();
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xl leading-tight font-bold tracking-[-0.01em]">
          Your own program
        </h3>
        <p className="text-[15px] text-muted-foreground">
          Workouts, exercises, sets and rep targets, written by you.
        </p>
      </div>
      {asked ? (
        <p id={noteId} role="status" className="text-[15px] text-foreground">
          The program builder is coming, but it isn’t here yet. Nothing was
          created. For now, start from a template.
        </p>
      ) : null}
      <Button
        className="mt-auto w-full"
        aria-expanded={asked}
        aria-controls={asked ? noteId : undefined}
        onClick={() => setAsked(true)}
      >
        Create from scratch
      </Button>
    </div>
  );
}

/** A card's footprint while it loads: the ruled lines it will fill. */
function CardSkeleton({ count = 1 }: { count?: number }) {
  return (
    <div role="status" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex flex-col gap-5 rounded-xl border border-line bg-card p-4"
        >
          <span className="h-3.5 w-32 rounded-sm bg-line" />
          <span className="h-5 w-24 rounded-sm bg-line" />
          <span className="flex flex-col border-t border-line">
            {[0, 1, 2].map((n) => (
              <span
                key={n}
                className="h-11 border-b border-line last:border-b-0"
              />
            ))}
          </span>
          <span className="h-14 rounded-md border border-line" />
        </div>
      ))}
    </div>
  );
}
