import { newId } from "@workout-tracker/shared";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api.js";
import { AppHeader } from "../../app/app-header.js";
import {
  useCycle,
  useCycleDifferences,
  useOnline,
  useOwnerId,
  useProgram,
  useUnits,
} from "../../data/hooks.js";
import { Notice } from "../notice.js";
import { programErrorText } from "../program-format.js";
import { Builder, type Loaded } from "./builder.js";
import type { StripCycle } from "./cycle-strip.js";
import { useDraft } from "./draft.js";
import { seedFromRead, useCreateMode, useEditMode } from "./modes.js";
import { newProgram, type EditState } from "./tree.js";
import { Button } from "@/ui/button";

/*
 * The builder's two routes (brief `apps-web-src-builder`; design D14, D17):
 * `/programs/new` creates a program from cycle 1 (a DRAFT);
 * `/programs/:id/cycles/:n` edits one cycle. Each seeds the builder once,
 * from this device's draft if there is one, else from a blank program or
 * the cycle's own fresh read.
 *
 * Both wait until someone owns the device's data (`useOwnerId`): starting
 * blank first would write over that person's draft the moment they are
 * known. Keyed by owner, so another account signing in on the page starts
 * again from that account's drafts.
 */

/** A new program's strip: cycle 1 alone. */
const NEW_STRIP: StripCycle[] = [
  { cycleNumber: 1, logged: false, different: false },
];

export function NewProgramScreen() {
  const owner = useOwnerId();
  return (
    <BuilderFrame back={{ to: "/programs", label: "Back to programs" }}>
      {owner ? <NewProgram key={owner} owner={owner} /> : <Loading />}
    </BuilderFrame>
  );
}

function NewProgram({ owner }: { owner: string }) {
  const units = useUnits();
  const draft = useDraft(null, 1);
  const mode = useCreateMode();
  // Minted once: the new program's ids live in its draft from the first edit.
  const [blank] = useState(() => newProgram(newId));
  if (!units || draft.isPending) return <Loading />;
  const stored = draft.data?.mode === "create" ? draft.data : null;
  return (
    <Builder
      initial={
        stored
          ? { tree: stored, restored: true }
          : { tree: blank, restored: false }
      }
      mode={mode}
      owner={owner}
      units={units}
      strip={NEW_STRIP}
    />
  );
}

export function CycleEditorScreen() {
  const { id, n = "" } = useParams();
  const owner = useOwnerId();
  const cycleNumber = /^[1-9][0-9]*$/.test(n) ? Number(n) : NaN;
  if (Number.isNaN(cycleNumber) || !id) {
    return (
      <BuilderFrame back={{ to: "/programs", label: "Back to programs" }}>
        <Notice>There’s no cycle at this address.</Notice>
      </BuilderFrame>
    );
  }
  if (!owner) {
    return (
      <BuilderFrame
        back={{ to: `/programs/${id}`, label: "Back to the program" }}
      >
        <Loading />
      </BuilderFrame>
    );
  }
  return (
    <CycleEditor
      key={`${owner}/${id}/${cycleNumber}`}
      owner={owner}
      programId={id}
      cycleNumber={cycleNumber}
    />
  );
}

function CycleEditor({
  owner,
  programId,
  cycleNumber,
}: {
  owner: string;
  programId: string;
  cycleNumber: number;
}) {
  const online = useOnline();
  const units = useUnits();
  const program = useProgram(programId);
  const detail = program.data;
  // The editor's own read, fetched when it opens: a tree another screen
  // cached is never what an edit starts from (D17).
  const cycle = useCycle(programId, cycleNumber, { fresh: true });
  const [openedAt] = useState(() => Date.now());
  const read =
    cycle.data && cycle.dataUpdatedAt >= openedAt ? cycle.data : undefined;
  const { different } = useCycleDifferences(programId);
  const draft = useDraft(programId, cycleNumber);
  const mode = useEditMode({ programId, cycleNumber, detail });

  // What the builder opens with: the draft, else the fresh read.
  const seed = useMemo((): Loaded<EditState> | Error | null => {
    if (draft.isPending) return null;
    if (draft.data?.mode === "edit") {
      return { tree: draft.data, restored: true };
    }
    if (!read || !detail) return null;
    try {
      return { tree: seedFromRead(read, detail), restored: false };
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, [draft.isPending, draft.data, read, detail]);

  const strip: StripCycle[] = (
    detail?.cycles ?? [{ cycleNumber, trained: false }]
  ).map((c) => ({
    cycleNumber: c.cycleNumber,
    logged: c.trained,
    different: different.has(c.cycleNumber),
  }));
  const back = {
    to: `/programs/${programId}`,
    label: detail ? `Back to ${detail.program.name}` : "Back to the program",
  };

  const error =
    cycle.error ?? program.error ?? (seed instanceof Error ? seed : null);
  let body: ReactNode;
  if (seed && !(seed instanceof Error) && units) {
    body = (
      <Builder
        initial={seed}
        mode={mode}
        owner={owner}
        units={units}
        strip={strip}
      />
    );
  } else if (error instanceof ApiError && error.status === 404) {
    body = <Notice>There’s no cycle {cycleNumber} in this program.</Notice>;
  } else if (!online && draft.data === null) {
    body = (
      <Notice offline>
        This cycle loads with a connection. Changes you make are kept on this
        device until you save.
      </Notice>
    );
  } else if (error) {
    body = (
      <Notice
        action={
          <Button
            onClick={() => {
              void cycle.refetch();
              void program.refetch();
            }}
          >
            Try again
          </Button>
        }
      >
        {`Couldn’t load this cycle. ${programErrorText(error)}`}
      </Notice>
    );
  } else {
    body = <Loading />;
  }

  return <BuilderFrame back={back}>{body}</BuilderFrame>;
}

function BuilderFrame({
  back,
  children,
}: {
  back: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-[1280px] flex-col px-4 pt-4 md:px-9 md:pt-8">
        <div className="max-w-3xl">
          <Button asChild variant="ghost" size="sm" className="-ml-3.5">
            <Link to={back.to}>
              <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
              {back.label}
            </Link>
          </Button>
        </div>
        {children}
      </main>
    </>
  );
}

function Loading() {
  return (
    <p
      role="status"
      className="max-w-3xl pt-6 text-[15px] text-muted-foreground"
    >
      Loading…
    </p>
  );
}
