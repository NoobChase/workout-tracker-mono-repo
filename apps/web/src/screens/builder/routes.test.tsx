import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  newId,
  type ApplyPreviewResponse,
  type CycleDetailResponse,
  type ProgramDetailResponse,
  type SaveCycleRequest,
} from "@workout-tracker/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { z } from "zod";
import { createQueryClient, DataProvider } from "../../data/provider.js";
import {
  cycleFixture,
  FakeAuth,
  ids,
  makeHarness,
  USER,
  type Harness,
} from "../../test/fakes.js";
import { CycleEditorScreen, NewProgramScreen } from "./routes.js";
import { newProgram, type CreateState, type EditState } from "./tree.js";

/*
 * The builder's stale guard (design D7, D17) and its drafts (D14), on the
 * screen: what an edit starts from, and what a save sends.
 */

// The header holds Clerk's account control; not under test here.
vi.mock("../../app/app-header.js", () => ({ AppHeader: () => null }));

const F_CACHED = "0".repeat(64);
const F_LOADED = "a".repeat(64);
const F_OTHER_DEVICE = "b".repeat(64);

let harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses) h.layer.close();
  harnesses = [];
});

async function setup(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(options);
  harnesses.push(h);
  return h;
}

const detail: ProgramDetailResponse = {
  program: {
    id: ids.program,
    name: "Push Pull Legs",
    status: "ACTIVE",
    targetCycles: 4,
    currentCycle: 1,
  },
  cycles: [1, 2, 3, 4].map((cycleNumber) => ({
    cycleNumber,
    trained: false,
    fullyTrained: false,
  })),
};

function readOf(fingerprint: string, name: string): CycleDetailResponse {
  return {
    ...cycleFixture(1, [{ id: ids.workout, name }]),
    fingerprint,
  };
}

/** A server for one program: its cycle 1 read, apply preview and save. */
function serve(
  h: Harness,
  { read, preview }: { read: CycleDetailResponse; preview: string },
) {
  const saves: SaveCycleRequest[] = [];
  h.api.program = () => Promise.resolve(detail);
  h.api.cycles.set(`${ids.program}/1`, read);
  h.api.applyPreview = (_: string, cycleNumber: number) =>
    Promise.resolve<ApplyPreviewResponse>({
      cycleNumber,
      source: preview,
      later: [],
    });
  h.api.saveCycle = (
    _: string,
    cycleNumber: number,
    request: SaveCycleRequest,
  ) => {
    saves.push(request);
    return Promise.resolve({ cycleNumber, applied: [] });
  };
  return saves;
}

function renderEditor(h: Harness, queryClient = createQueryClient()) {
  return render(
    <DataProvider layer={h.layer} queryClient={queryClient}>
      <MemoryRouter initialEntries={[`/programs/${ids.program}/cycles/1`]}>
        <Routes>
          <Route
            path="/programs/:id/cycles/:n"
            element={<CycleEditorScreen />}
          />
          <Route path="/programs/:id" element={<p>Program page</p>} />
        </Routes>
      </MemoryRouter>
    </DataProvider>,
  );
}

async function addWorkoutAndSave() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Add workout" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save cycle 1" }));
}

describe("the cycle editor's stale guard (D7, D17)", () => {
  it("sends the cycle read's fingerprint as expected.source", async () => {
    const h = await setup();
    const saves = serve(h, {
      read: readOf(F_LOADED, "Push A"),
      preview: F_LOADED,
    });
    renderEditor(h);

    await addWorkoutAndSave();

    expect(await screen.findByText("Program page")).toBeInTheDocument();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.expected.source).toBe(F_LOADED);
  });

  it("starts from its own fresh read, never a tree another screen cached", async () => {
    const h = await setup();
    const saves = serve(h, {
      read: readOf(F_LOADED, "Push A"),
      preview: F_LOADED,
    });
    const queryClient = createQueryClient();
    // What the program page cached before another device changed the cycle.
    queryClient.setQueryData(
      ["cycle", ids.program, 1],
      readOf(F_CACHED, "Old name"),
    );
    renderEditor(h, queryClient);

    expect(
      await screen.findByRole("textbox", { name: "Name of workout 1" }),
    ).toHaveValue("Push A");
    await addWorkoutAndSave();

    await screen.findByText("Program page");
    expect(saves[0]!.expected.source).toBe(F_LOADED);
  });

  it("another device's save between the cycle read and the preview is refused as stale, nothing sent", async () => {
    const h = await setup();
    // The read had F_LOADED; by the time the preview is read, another
    // device has saved. The preview's source must never stand in for the
    // load fingerprint.
    const saves = serve(h, {
      read: readOf(F_LOADED, "Push A"),
      preview: F_OTHER_DEVICE,
    });
    renderEditor(h);

    await addWorkoutAndSave();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not saved. Cycle 1 changed since you opened it.",
    );
    expect(saves).toEqual([]);
  });
});

describe("drafts wait for their owner (D14)", () => {
  /** A stored draft, as the builder writes it (`builder/draft.ts`). */
  const stored = (tree: CreateState | EditState) => ({ version: 1, tree });
  const named = z.object({ tree: z.object({ name: z.string() }) });

  it("a new program re-reads the draft once the owner is known, instead of starting blank over it", async () => {
    let clerkUser: string | null = null;
    const auth = new FakeAuth();
    const h = await setup({
      signIn: false,
      auth,
      currentUserId: () => clerkUser,
    });
    await h.layer.drafts.put(
      USER,
      null,
      1,
      stored({ ...newProgram(newId), name: "Winter Base" }),
    );

    render(
      <DataProvider layer={h.layer} queryClient={createQueryClient()}>
        <MemoryRouter initialEntries={["/programs/new"]}>
          <Routes>
            <Route path="/programs/new" element={<NewProgramScreen />} />
          </Routes>
        </MemoryRouter>
      </DataProvider>,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();

    // Clerk reports who this is.
    clerkUser = USER;
    act(() => auth.notify());

    expect(await screen.findByLabelText("Name")).toHaveValue("Winter Base");
    expect(screen.getByText("Unsaved changes restored")).toBeVisible();
    // Give the draft writer its beat: the stored draft is still the lifter's.
    await new Promise((r) => setTimeout(r, 300));
    await waitFor(async () =>
      expect(
        (await h.layer.drafts.get(named, USER, null, 1))?.state.tree.name,
      ).toBe("Winter Base"),
    );
  });

  it("the cycle editor restores the owner's draft once they are known", async () => {
    let clerkUser: string | null = null;
    const auth = new FakeAuth();
    const h = await setup({
      signIn: false,
      auth,
      currentUserId: () => clerkUser,
    });
    serve(h, { read: readOf(F_LOADED, "Push A"), preview: F_LOADED });
    const { workouts, cycleId } = newProgram(newId);
    const draft: EditState = {
      mode: "edit",
      programId: ids.program,
      cycleId,
      cycleNumber: 1,
      workouts,
      baseline: F_LOADED,
      programName: "Push Pull Legs",
    };
    draft.workouts[0]!.name = "Push A, heavier";
    await h.layer.drafts.put(USER, ids.program, 1, stored(draft));
    renderEditor(h);
    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");

    clerkUser = USER;
    act(() => auth.notify());

    expect(
      await screen.findByRole("textbox", { name: "Name of workout 1" }),
    ).toHaveValue("Push A, heavier");
    expect(screen.getByText("Unsaved changes restored")).toBeVisible();
  });
});
