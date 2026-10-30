import type { ProgramSummary } from "@workout-tracker/shared";
import { ArrowLeft, Check, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../api.js";
import { AppHeader } from "../app/app-header.js";
import {
  useCycleDifferences,
  useCycles,
  useOnline,
  usePrograms,
  useProgram,
  useProgramActions,
} from "../data/hooks.js";
import { DifferentMark } from "./builder/markers.js";
import { Notice, OfflineLine, RetryNotice } from "./notice.js";
import { CopyDialog, RenameDialog } from "./program-dialogs.js";
import {
  lengthLabel,
  programActionToast,
  programErrorText,
  progressOf,
  STATUS_LABEL,
  type ProgramAction,
} from "./program-format.js";
import { ServerRead } from "./server-read.js";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toaster";

/*
 * One program (`/programs/:id`, brief `apps-web-src-builder`): its name,
 * status and length with the actions that fit its status, then every cycle
 * as a row, "Cycle n · k workouts", marked logged ✓, current, the same as
 * cycle 1 or ◆ different, each with Edit › into the builder. Plan-side, so
 * the actions need a connection.
 */

export function ProgramDetailScreen() {
  const { id } = useParams();
  const detail = useProgram(id);
  const online = useOnline();
  const programs = usePrograms();
  const [renaming, setRenaming] = useState<ProgramSummary | null>(null);
  const [copying, setCopying] = useState<ProgramSummary | null>(null);

  const body: ReactNode =
    !detail.data &&
    detail.error instanceof ApiError &&
    detail.error.status === 404 ? (
      <Notice>This program isn’t in your account.</Notice>
    ) : (
      <ServerRead
        query={detail}
        offline={<Notice offline>This program loads with a connection.</Notice>}
        error={(e, retry) => (
          <RetryNotice retry={retry}>
            Couldn’t load this program. {programErrorText(e)}
          </RetryNotice>
        )}
        skeleton={
          <p role="status" className="pt-6 text-[15px] text-muted-foreground">
            Loading…
          </p>
        }
      >
        {(data) => (
          <Program
            detail={data}
            online={online}
            onRename={() => setRenaming(data.program)}
            onCopy={() => setCopying(data.program)}
          />
        )}
      </ServerRead>
    );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col px-4 pt-4 pb-16 md:px-9 md:pt-8 md:pb-24">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3.5">
            <Link to="/programs">
              <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
              Programs
            </Link>
          </Button>
        </div>
        <div className="max-w-3xl">{body}</div>
      </main>
      <RenameDialog
        program={renaming}
        onOpenChange={(open) => (open ? null : setRenaming(null))}
      />
      <CopyDialog
        program={copying}
        programs={programs.data?.programs ?? []}
        onOpenChange={(open) => (open ? null : setCopying(null))}
      />
    </>
  );
}

function Program({
  detail,
  online,
  onRename,
  onCopy,
}: {
  detail: NonNullable<ReturnType<typeof useProgram>["data"]>;
  online: boolean;
  onRename: () => void;
  onCopy: () => void;
}) {
  const { program, cycles } = detail;
  const actions = useProgramActions();
  const [error, setError] = useState<string | null>(null);
  const progress = progressOf(program);
  const { known, different } = useCycleDifferences(program.id);
  // Workout counts: cycle 1's, and each cycle that differs from it. A cycle
  // with every workout logged has nothing left to edit ("View"): the detail
  // says so (`fullyTrained`).
  const toRead = [...new Set([1, ...different])];
  const trees = useCycles(program.id, toRead);
  const counts = new Map<number, number>();
  const allLogged = new Set<number>(
    cycles.filter((c) => c.fullyTrained).map((c) => c.cycleNumber),
  );
  toRead.forEach((n, i) => {
    const tree = trees[i]?.data;
    if (tree) counts.set(n, tree.cycle.workouts.length);
  });
  const countOf = (n: number) =>
    counts.get(n) ?? (known && !different.has(n) ? counts.get(1) : undefined);

  const run = (action: ProgramAction) => {
    setError(null);
    actions[action].mutate(program.id, {
      onSuccess: ({ program: now }) => {
        const { title, description } = programActionToast(action, now);
        toast(title, { description });
      },
      onError: (e) =>
        setError(`Couldn’t change ${program.name}. ${programErrorText(e)}`),
    });
  };
  const busy =
    actions.activate.isPending ||
    actions.archive.isPending ||
    actions.extend.isPending;
  const canActivate =
    program.status === "DRAFT" || program.status === "ARCHIVED";
  const canExtend =
    program.status === "COMPLETED" && program.targetCycles !== null;

  return (
    <div className="flex flex-col gap-8 pt-3">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance md:text-[32px]">
            {program.name}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
            <Badge>{STATUS_LABEL[program.status]}</Badge>
            {lengthLabel(program)} · {progress.text}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canActivate ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!online || busy}
              loading={actions.activate.isPending}
              onClick={() => run("activate")}
            >
              Activate
            </Button>
          ) : null}
          {canExtend ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!online || busy}
              loading={actions.extend.isPending}
              onClick={() => run("extend")}
            >
              Run another cycle
            </Button>
          ) : null}
          {program.status !== "ARCHIVED" ? (
            <Button
              size="sm"
              disabled={!online || busy}
              loading={actions.archive.isPending}
              onClick={() => run("archive")}
            >
              Archive
            </Button>
          ) : null}
          <Button size="sm" disabled={!online} onClick={onRename}>
            Rename
          </Button>
          <Button size="sm" disabled={!online} onClick={onCopy}>
            Copy
          </Button>
        </div>
        {!online ? (
          <OfflineLine>
            No signal. Changing a program needs a connection.
          </OfflineLine>
        ) : null}
        {error ? (
          <p role="alert" className="text-[15px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="cycles-title" className="flex flex-col">
        <h2
          id="cycles-title"
          className="flex items-baseline gap-2 pb-2 text-[17px] leading-snug font-semibold"
        >
          Cycles
          <span className="num text-[15px] font-normal text-muted-foreground">
            {cycles.length}
          </span>
        </h2>
        <ul aria-label="Cycles" className="border-t border-line">
          {cycles.map((c) => {
            const k = countOf(c.cycleNumber);
            const current = program.currentCycle === c.cycleNumber;
            const differs = different.has(c.cycleNumber);
            const verb = allLogged.has(c.cycleNumber) ? "View" : "Edit";
            return (
              <li
                key={c.cycleNumber}
                className="flex min-h-14 items-center gap-3 border-b border-line py-2"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-[15px] font-semibold">
                    Cycle <span className="num">{c.cycleNumber}</span>
                    {k !== undefined ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · <span className="num">{k}</span>{" "}
                        {k === 1 ? "workout" : "workouts"}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground">
                    {current ? (
                      <span className="font-medium text-foreground">
                        Current
                      </span>
                    ) : null}
                    {c.trained ? (
                      <span className="flex items-center gap-1">
                        <Check
                          aria-hidden="true"
                          strokeWidth={2}
                          className="size-3.5"
                        />
                        Logged
                      </span>
                    ) : null}
                    {c.cycleNumber === 1 ? null : differs ? (
                      <span className="flex items-center gap-1.5">
                        <DifferentMark />
                        Different from cycle 1
                      </span>
                    ) : known ? (
                      <span>Same as cycle 1</span>
                    ) : null}
                  </span>
                </div>
                <Button asChild variant="ghost" size="sm" className="-mr-2">
                  <Link
                    to={`/programs/${program.id}/cycles/${c.cycleNumber}`}
                    aria-label={`${verb} cycle ${c.cycleNumber}`}
                  >
                    {verb}
                    <ChevronRight aria-hidden="true" strokeWidth={1.75} />
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
