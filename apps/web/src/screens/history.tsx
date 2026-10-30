import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { AppHeader } from "../app/app-header.js";
import {
  useHistory,
  useLocalSessions,
  useLastUser,
  useOnline,
  useSessionDetail,
} from "../data/hooks.js";
import { errorText } from "./errors.js";
import { HistoryList } from "./history-rows.js";
import { Notice, OfflineLine, RetryNotice } from "./notice.js";
import { ServerRead } from "./server-read.js";
import { formatDay, formatTime, plural, unitLabel } from "./format.js";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { SetFigures, SetLog } from "@/ui/set-row";

/*
 * History (`/history`, `/history/:sessionId`): finished workouts as the
 * server has them. Online only (design D8); offline it says so, and a
 * workout finished on this device but not yet synced is named, so it
 * doesn't look lost.
 */

export function HistoryScreen() {
  const history = useHistory();
  const online = useOnline();
  const body = (
    <ServerRead
      query={history}
      offline={
        <Notice offline>
          History loads with a connection, and there’s no signal right now. Your
          finished workouts are safe on the server and will show here when
          you’re back.
        </Notice>
      }
      error={(e, retry) => (
        <RetryNotice retry={retry}>
          Couldn’t load your history. {errorText(e)}
        </RetryNotice>
      )}
      skeleton={<RowsSkeleton />}
    >
      {(data) => {
        const items = data.pages.flatMap((p) => p.items);
        return items.length === 0 ? (
          <EmptyState
            title="No finished workouts yet"
            action={
              <Button asChild variant="primary">
                <Link to="/">See what’s next</Link>
              </Button>
            }
          >
            Finish a workout and it lands here, newest first, with every set you
            logged.
          </EmptyState>
        ) : (
          <HistoryList items={items} label="Finished workouts" />
        );
      }}
    </ServerRead>
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pt-4 pb-16 md:px-9 md:pt-8 md:pb-24">
        <PageTitle back="/" backLabel="Home" title="History">
          Every finished workout, newest first. Counted sets leave out warmups
          and drop sets.
        </PageTitle>
        <div className="flex max-w-3xl flex-col gap-6">
          <UnsyncedFinishes />
          {history.data && !online ? (
            <OfflineLine>
              No signal. This is what loaded earlier; newer workouts show here
              when you’re back.
            </OfflineLine>
          ) : null}
          {body}
          {history.hasNextPage ? (
            <Button
              className="self-start"
              loading={history.isFetchingNextPage}
              disabled={!online}
              onClick={() => void history.fetchNextPage()}
            >
              Show older workouts
            </Button>
          ) : null}
          {history.isFetchNextPageError ? (
            <p role="alert" className="text-sm text-danger">
              Couldn’t load older workouts. {errorText(history.error)}
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}

/** Finished here, not yet delivered: say so, so history doesn't look short. */
function UnsyncedFinishes() {
  const records = useLocalSessions();
  const user = useLastUser();
  const waiting = [...records.values()].filter(
    (r) => r.status === "FINISHED" && r.userId === (user?.userId ?? null),
  );
  if (waiting.length === 0) return null;
  return (
    <OfflineLine>
      {waiting.map((r) => r.context.workout.name).join(", ")}{" "}
      {waiting.length === 1 ? "was" : "were"} finished on this device and will
      appear here once synced.
    </OfflineLine>
  );
}

export function SessionDetailScreen() {
  const { sessionId = "" } = useParams();
  const detail = useSessionDetail(sessionId);
  const data = detail.data;

  const body = (
    <ServerRead
      query={detail}
      offline={
        <Notice offline>
          This workout loads with a connection, and there’s no signal right now.
        </Notice>
      }
      error={(e, retry) => (
        <RetryNotice retry={retry}>{errorText(e)}</RetryNotice>
      )}
      skeleton={<RowsSkeleton />}
    >
      {(shown) => (
        <ol className="flex max-w-3xl flex-col gap-8">
          {[...shown.exercises]
            .sort((a, b) => a.position - b.position)
            .map((e) => (
              <li
                key={`${e.position}-${e.exerciseId}`}
                className="flex flex-col"
              >
                <div className="flex min-h-11 items-center justify-between gap-3 pb-1">
                  <h2 className="text-[17px] font-semibold">{e.name}</h2>
                  {e.skipped ? (
                    <Badge>Skipped</Badge>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">
                      <span className="num">{e.sets.length}</span>{" "}
                      {plural(e.sets.length, "set")}
                    </span>
                  )}
                </div>
                {e.skipped ? (
                  <p className="border-t border-line pt-3 text-sm text-muted-foreground">
                    Nothing logged; the plan is unchanged.
                  </p>
                ) : (
                  <SetLog aria-label={`${e.name} sets`}>
                    {[...e.sets]
                      .sort((a, b) => a.setNumber - b.setNumber)
                      .map((s) => (
                        <li
                          key={s.id}
                          className="grid min-h-13 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 border-b border-line py-2"
                        >
                          <span className="num text-[15px] font-medium">
                            <span className="sr-only">Set </span>
                            {s.setNumber}
                          </span>
                          <span className="flex min-w-0 items-center gap-2.5">
                            <SetFigures
                              weight={s.weight}
                              reps={s.reps}
                              unit={
                                s.weightUnit ? unitLabel(s.weightUnit) : "lb"
                              }
                            />
                            {s.kind === "WARMUP" ? (
                              <Badge variant="warmup" />
                            ) : s.kind === "DROP" ? (
                              <Badge variant="drop" />
                            ) : null}
                          </span>
                        </li>
                      ))}
                  </SetLog>
                )}
              </li>
            ))}
        </ol>
      )}
    </ServerRead>
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col gap-8 px-4 pt-4 pb-16 md:px-9 md:pt-8 md:pb-24">
        <PageTitle
          back="/history"
          backLabel="History"
          title={data?.session.workoutName ?? "Workout"}
        >
          {data ? (
            <>
              {/* Program and cycle on one line, when on the next: no
                  separator is ever left at the edge of a line. */}
              <span className="block">
                {data.session.programName} · Cycle{" "}
                <span className="num">{data.session.cycleNumber}</span>
              </span>
              <span className="block">
                {formatDay(data.session.performedAt)},{" "}
                <span className="num">
                  {formatTime(data.session.performedAt)}
                </span>
              </span>
            </>
          ) : null}
        </PageTitle>
        {body}
      </main>
    </>
  );
}

function PageTitle({
  back,
  backLabel,
  title,
  children,
}: {
  back: string;
  backLabel: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Button asChild variant="ghost" size="icon" className="-ml-2.5">
        <Link to={back} aria-label={backLabel}>
          <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        </Link>
      </Button>
      <div className="flex min-w-0 flex-col gap-1 pt-1">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance md:text-[32px]">
          {title}
        </h1>
        {children ? (
          <p className="max-w-[60ch] text-[15px] text-muted-foreground">
            {children}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div role="status" className="max-w-3xl border-t border-line">
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
