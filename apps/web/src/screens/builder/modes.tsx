import { useQueryClient } from "@tanstack/react-query";
import {
  cycleTree,
  newId,
  programName,
  type CycleDetailResponse,
  type CycleTree,
  type ProgramDetailResponse,
  type SaveCycleRequest,
} from "@workout-tracker/shared";
import { useId, useRef, type ReactNode } from "react";
import { ApiError } from "../../api.js";
import { useCreateProgram, useSaveCycle } from "../../data/hooks.js";
import { withKeptId } from "../../data/kept-id.js";
import { useDataLayer } from "../../data/provider.js";
import { rereadApplyPreview, rereadCycle } from "../../data/queries.js";
import {
  lengthLabel,
  programErrorText,
  STATUS_LABEL,
} from "../program-format.js";
import { cycleRuns } from "./apply-sheet.js";
import type { BuilderAction } from "./reducer.js";
import { CreateFields, type SubmitOutcome } from "./save-bar.js";
import {
  fromCycle,
  newProgram,
  toCycleTree,
  type BuilderState,
  type CreateState,
  type EditState,
} from "./tree.js";

/*
 * What differs between creating a program and editing one of its cycles,
 * as one shape (`BuilderMode`), so the builder itself never asks which it
 * is: the words, what a clean state is, and how a save goes (operations.md
 * 3.1 for a create; 3.7 and 3.8, design D7 and D17, for a cycle's save).
 */

export interface BuilderMode<S extends BuilderState> {
  /** Above the cycle strip: the new program's fields, or its name. */
  heading: (tree: S, dispatch: (action: BuilderAction) => void) => ReactNode;
  /** Under "Cycle n". */
  intro: string;
  saveLabel: string;
  /** What the save bar says with nothing unsaved. */
  cleanNote: string;
  /** Saving waits for an edit. */
  needsChanges: boolean;
  /** Whose draft this is, and where the cycle strip links: null when new. */
  programId: string | null;
  /** The description of Discard's toast. */
  discarded: string;
  /** The state with no unsaved changes, for Discard. */
  fresh: () => Promise<S>;
  /** Saves `tree`, or says why not. */
  submit: (tree: S) => Promise<SubmitOutcome>;
}

/** The cycle as the server will take it, or the first thing wrong with it. */
function validCycle(tree: BuilderState): CycleTree | string {
  const parsed = cycleTree.safeParse(toCycleTree(tree));
  return parsed.success
    ? parsed.data
    : (parsed.error.issues[0]?.message ??
        "Something in the cycle isn’t valid.");
}

/**
 * A cycle's editable state from its read (and the fingerprint read with
 * it, D17): how the editor opens, and what Discard goes back to.
 */
export function seedFromRead(
  read: CycleDetailResponse,
  detail: ProgramDetailResponse | undefined,
): EditState {
  return fromCycle(read, {
    programName: detail?.program.name ?? "",
    mint: newId,
  });
}

const problem = (message: string): SubmitOutcome => ({
  kind: "problem",
  message,
});

/** `/programs/new`: cycle 1 of a new program, created as a DRAFT (D3). */
export function useCreateMode(): BuilderMode<CreateState> {
  const createProgram = useCreateProgram();
  const nameId = useId();
  return {
    heading: (tree, dispatch) => (
      <CreateFields nameId={nameId} tree={tree} dispatch={dispatch} />
    ),
    intro:
      "Build the first cycle. Every other cycle starts as a copy of it, and each can be changed on its own later.",
    saveLabel: "Create program",
    cleanNote: "Nothing is created until you say so.",
    needsChanges: false,
    programId: null,
    discarded: "The new program is back to blank.",
    fresh: () => Promise.resolve(newProgram(newId)),
    submit: async (tree) => {
      const name = programName.safeParse(tree.name);
      if (!name.success) {
        document.getElementById(nameId)?.focus();
        return problem("Give the program a name.");
      }
      const cycle = validCycle(tree);
      if (typeof cycle === "string") return problem(cycle);
      try {
        // Its ids were minted when the builder opened and live in the
        // draft, so a retry after a lost answer is the same program.
        const { program } = await createProgram.mutateAsync({
          programId: tree.programId,
          name: name.data,
          targetCycles: tree.length.kind === "open" ? null : tree.length.cycles,
          cycle,
        });
        return {
          kind: "saved",
          title: `${program.name} created`,
          description: "It’s a draft until you activate it.",
        };
      } catch (e) {
        return problem(programErrorText(e));
      }
    },
  };
}

/** `/programs/:id/cycles/:n`: one stored cycle, saved over itself (D4, D7). */
export function useEditMode({
  programId,
  cycleNumber,
  detail,
}: {
  programId: string;
  cycleNumber: number;
  /** The program, once read; the draft's name stands in until then. */
  detail: ProgramDetailResponse | undefined;
}): BuilderMode<EditState> {
  const { api } = useDataLayer();
  const queryClient = useQueryClient();
  const saveCycle = useSaveCycle();
  // A save whose answer never arrived, by the state it was made from: saved
  // again unedited, it is resent exactly as sent, so the server finds its
  // effect in place and writes nothing (D7, "already done").
  const unanswered = useRef(new Map<BuilderState, SaveCycleRequest>());
  const reread = () => rereadCycle(queryClient, api, programId, cycleNumber);

  async function send(
    tree: EditState,
    request: SaveCycleRequest,
  ): Promise<SubmitOutcome> {
    try {
      const { applied } = await withKeptId(
        unanswered.current,
        tree,
        (kept) =>
          saveCycle.mutateAsync({ programId, cycleNumber, request: kept }),
        {
          mint: () => request,
          // Refused for good: a later save starts from a fresh preview.
          forgetOn: (e) => e instanceof ApiError,
        },
      );
      return {
        kind: "saved",
        title: `Cycle ${cycleNumber} saved`,
        description:
          applied.length > 0
            ? `Applied to ${applied.length === 1 ? "cycle" : "cycles"} ${cycleRuns(applied)} too.`
            : undefined,
      };
    } catch (e) {
      return e instanceof ApiError && e.status === 409
        ? { kind: "stale", reason: e.reason || null, reread }
        : problem(programErrorText(e));
    }
  }

  return {
    heading: (tree) => (
      <ProgramHeading
        name={detail?.program.name ?? tree.programName}
        meta={
          detail
            ? `${lengthLabel(detail.program)} · ${STATUS_LABEL[detail.program.status]}`
            : ""
        }
      />
    ),
    intro:
      "Changes here are for this cycle. When you save, you choose whether later cycles get them too.",
    saveLabel: `Save cycle ${cycleNumber}`,
    cleanNote: "No changes yet.",
    needsChanges: true,
    programId,
    discarded: `Cycle ${cycleNumber} is back to its saved version.`,
    fresh: async () => seedFromRead(await reread(), detail),
    submit: async (tree) => {
      const cycle = validCycle(tree);
      if (typeof cycle === "string") return problem(cycle);
      const retry = unanswered.current.get(tree);
      if (retry) return send(tree, retry);
      try {
        // The preview is read for the later cycles (the checkboxes and
        // their fingerprints). Its source only spots a change early; the
        // guard sent is still the load fingerprint (`baseline`), checked by
        // the server.
        const preview = await rereadApplyPreview(
          queryClient,
          api,
          programId,
          cycleNumber,
        );
        if (preview.source !== tree.baseline) {
          return { kind: "stale", reason: null, reread };
        }
        const commit = (applyTo: SaveCycleRequest["applyTo"]) =>
          send(tree, { cycle, expected: { source: tree.baseline }, applyTo });
        return preview.later.length === 0
          ? commit([])
          : { kind: "choose", preview, commit };
      } catch (e) {
        return problem(programErrorText(e));
      }
    },
  };
}

export function ProgramHeading({ name, meta }: { name: string; meta: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance md:text-[32px]">
        {name}
      </h1>
      {meta ? (
        <p className="text-[15px] text-muted-foreground">{meta}</p>
      ) : null}
    </div>
  );
}
