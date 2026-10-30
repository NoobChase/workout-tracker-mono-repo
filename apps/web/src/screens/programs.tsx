import type { ProgramStatus, ProgramSummary } from "@workout-tracker/shared";
import { ChevronDown, Ellipsis, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { AppHeader } from "../app/app-header.js";
import {
  useOnline,
  useProgramActions,
  usePrograms,
  type ProgramList,
} from "../data/hooks.js";
import { NewProgramSheet, type NewProgramStep } from "./new-program-sheet.js";
import { CopyDialog, RenameDialog } from "./program-dialogs.js";
import {
  lengthLabel,
  programActionToast,
  programErrorText,
  progressOf,
  type ProgramAction,
} from "./program-format.js";
import { Notice, OfflineLine, RetryNotice } from "./notice.js";
import { ServerRead } from "./server-read.js";
import { Progress } from "./program-progress.js";
import { Button } from "@/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/ui/empty-state";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/ui/menu";
import { toast } from "@/ui/toaster";

/*
 * Programs (`/programs`, brief `apps-web-src-home`): every program the user
 * owns, grouped by status, with its length and progress (spec
 * `program-lifecycle`). Managing programs is plan-side work (operations.md
 * 0.3): every action here needs a connection, and offline the screen says
 * so and keeps what it last loaded readable.
 */

const GROUPS: { status: ProgramStatus; heading: string }[] = [
  { status: "ACTIVE", heading: "Active" },
  { status: "DRAFT", heading: "Drafts" },
  { status: "COMPLETED", heading: "Finished" },
];

export function ProgramsScreen() {
  const programs = usePrograms();
  const online = useOnline();
  const [sheet, setSheet] = useState<{ open: boolean; step: NewProgramStep }>({
    open: false,
    step: "choose",
  });
  const [renaming, setRenaming] = useState<ProgramSummary | null>(null);
  const [copying, setCopying] = useState<ProgramSummary | null>(null);
  const list = programs.data?.programs ?? [];

  const body = (
    <ServerRead
      query={programs}
      offline={
        <Notice offline>
          Your programs load with a connection. What’s next on home still works
          without one.
        </Notice>
      }
      error={(e, retry) => (
        <RetryNotice retry={retry}>
          Couldn’t load your programs. {programErrorText(e)}
        </RetryNotice>
      )}
      skeleton={<ListSkeleton />}
    >
      {({ programs: all }) =>
        all.length === 0 ? (
          <EmptyState
            title="No programs yet"
            action={
              <Button
                variant="primary"
                onClick={() => setSheet({ open: true, step: "choose" })}
              >
                New program
              </Button>
            }
          >
            Start from a template, write your own, or bring one in later. Each
            lands here with its progress.
          </EmptyState>
        ) : (
          <Groups
            programs={all}
            online={online}
            onRename={setRenaming}
            onCopy={setCopying}
          />
        )
      }
    </ServerRead>
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col gap-8 px-4 pt-8 pb-16 md:px-9 md:pt-12 md:pb-24">
        <div className="flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] md:text-[32px]">
            Programs
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost">
              <Link to="/exercises">Exercises</Link>
            </Button>
            <Button
              variant="primary"
              onClick={() => setSheet({ open: true, step: "choose" })}
            >
              <Plus aria-hidden="true" strokeWidth={1.75} />
              New program
            </Button>
          </div>
        </div>
        {!online && programs.data ? (
          <OfflineLine className="max-w-3xl">
            No signal. This is the list as you last saw it; changing a program
            needs a connection.
          </OfflineLine>
        ) : null}
        <div className="max-w-3xl">{body}</div>
      </main>
      <NewProgramSheet
        open={sheet.open}
        step={sheet.step}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        onStepChange={(step) => setSheet({ open: true, step })}
      />
      <RenameDialog
        program={renaming}
        onOpenChange={(open) => (open ? null : setRenaming(null))}
      />
      <CopyDialog
        program={copying}
        programs={list}
        onOpenChange={(open) => (open ? null : setCopying(null))}
      />
    </>
  );
}

function Groups({
  programs,
  online,
  onRename,
  onCopy,
}: {
  programs: ProgramList;
  online: boolean;
  onRename: (program: ProgramSummary) => void;
  onCopy: (program: ProgramSummary) => void;
}) {
  const actions = useProgramActions();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const archivedId = useId();
  const archived = programs.filter((p) => p.status === "ARCHIVED");

  function run(action: ProgramAction, program: ProgramSummary) {
    setError(null);
    setBusy({ action, id: program.id });
    actions[action].mutate(program.id, {
      onSuccess: ({ program: now }) => {
        const { title, description } = programActionToast(action, now);
        toast(title, { description });
      },
      onError: (e) =>
        setError(`Couldn’t change ${program.name}. ${programErrorText(e)}`),
      onSettled: () => setBusy(null),
    });
  }

  const row = (p: ProgramSummary) => (
    <ProgramRow
      key={p.id}
      program={p}
      online={online}
      busy={busy}
      onActivate={() => run("activate", p)}
      onArchive={() => run("archive", p)}
      onExtend={() => run("extend", p)}
      onEdit={() => void navigate(`/programs/${p.id}/cycles/1`)}
      onRename={() => onRename(p)}
      onCopy={() => onCopy(p)}
    />
  );

  return (
    <div className="flex flex-col gap-10">
      {error ? (
        <p role="alert" className="text-[15px] font-medium text-danger">
          {error}
        </p>
      ) : null}
      {GROUPS.map(({ status, heading }) => {
        const members = programs.filter((p) => p.status === status);
        if (members.length === 0) return null;
        return (
          <Group key={status} heading={heading} count={members.length}>
            {members.map(row)}
          </Group>
        );
      })}
      {archived.length > 0 ? (
        <section aria-label="Archived" className="flex flex-col">
          <h2>
            <button
              type="button"
              aria-expanded={showArchived}
              aria-controls={archivedId}
              onClick={() => setShowArchived((v) => !v)}
              className="-mx-2 flex min-h-11 items-center gap-2 rounded-md px-2 text-[17px] leading-snug font-semibold transition-[background-color] duration-150 hover:bg-ghost"
            >
              Archived
              <span className="num text-[15px] font-normal text-muted-foreground">
                {archived.length}
              </span>
              <ChevronDown
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-4 text-muted-foreground transition-transform duration-200 ease-out data-[open=true]:rotate-180"
                data-open={showArchived}
              />
            </button>
          </h2>
          {showArchived ? (
            <ul id={archivedId} className="mt-2 border-t border-line">
              {archived.map(row)}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** The one program action under way, and on which program. */
type Busy = { action: ProgramAction; id: string } | null;

function Group({
  heading,
  count,
  children,
}: {
  heading: string;
  count: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2
        id={id}
        className="flex items-baseline gap-2 text-[17px] leading-snug font-semibold"
      >
        {heading}
        <span className="num text-[15px] font-normal text-muted-foreground">
          {count}
        </span>
      </h2>
      <ul className="border-t border-line">{children}</ul>
    </section>
  );
}

function ProgramRow({
  program,
  online,
  busy,
  onActivate,
  onArchive,
  onExtend,
  onEdit,
  onRename,
  onCopy,
}: {
  program: ProgramSummary;
  online: boolean;
  busy: Busy;
  onActivate: () => void;
  onArchive: () => void;
  onExtend: () => void;
  onEdit: () => void;
  onRename: () => void;
  onCopy: () => void;
}) {
  const { id, name, status, targetCycles } = program;
  const progress = progressOf(program);
  const anyBusy = busy !== null;
  const canExtend = status === "COMPLETED" && targetCycles !== null;

  const inline: ReactNode[] = [];
  if (status === "DRAFT") {
    inline.push(
      <Button
        key="activate"
        size="sm"
        disabled={!online || anyBusy}
        loading={busy?.action === "activate" && busy.id === id}
        onClick={onActivate}
        aria-label={`Activate ${name}`}
      >
        Activate
      </Button>,
      <Button
        key="edit"
        size="sm"
        variant="ghost"
        onClick={onEdit}
        aria-label={`Edit ${name}`}
      >
        Edit
      </Button>,
    );
  }
  if (canExtend) {
    inline.push(
      <Button
        key="extend"
        size="sm"
        disabled={!online || anyBusy}
        loading={busy?.action === "extend" && busy.id === id}
        onClick={onExtend}
        aria-label={`Run another cycle of ${name}`}
      >
        Run another cycle
      </Button>,
    );
  }

  return (
    // The whole row opens the program: the link's ::after covers the row,
    // and the inline buttons and the menu sit above it.
    <li className="relative flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          to={`/programs/${id}`}
          className={cn(
            "self-start truncate text-[17px] leading-snug font-semibold no-underline decoration-line-2 underline-offset-4 hover:underline",
            "after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring",
          )}
        >
          {name}
        </Link>
        <p className="text-[13px] text-muted-foreground">
          {lengthLabel(program)}
          {" · "}
          <Progress progress={progress} />
        </p>
      </div>
      {inline.length > 0 ? (
        <div className="relative z-10 order-last flex w-full gap-2 sm:order-none sm:w-auto">
          {inline}
        </div>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`More for ${name}`}
            className="relative z-10 data-[state=open]:bg-ghost data-[state=open]:text-foreground"
          >
            <Ellipsis aria-hidden="true" strokeWidth={1.75} />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem disabled={!online} onSelect={onRename}>
            Rename…
          </MenuItem>
          <MenuItem disabled={!online} onSelect={onCopy}>
            Copy…
          </MenuItem>
          {status === "ARCHIVED" ? (
            <MenuItem disabled={!online || anyBusy} onSelect={onActivate}>
              Activate
            </MenuItem>
          ) : (
            <MenuItem disabled={!online || anyBusy} onSelect={onArchive}>
              Archive
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div role="status" className="border-t border-line">
      <span className="sr-only">Loading your programs</span>
      {[0, 1, 2].map((n) => (
        <div
          key={n}
          aria-hidden="true"
          className="flex h-16 flex-col justify-center gap-2 border-b border-line"
        >
          <span className="h-4 w-44 rounded-sm bg-line" />
          <span className="h-3 w-28 rounded-sm bg-line" />
        </div>
      ))}
    </div>
  );
}
