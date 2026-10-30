import { expect, test } from "@playwright/test";
import { FakeApi } from "./support/fake-api/router.js";
import { signIn } from "./support/session.js";
import { live, logSet, rows } from "./support/workout.js";

/*
 * Task 9.3: the logger stopgap (design D12; spec `workout-sessions`, "Slots
 * the logger cannot log yet are shown, not dropped") and the effort target
 * beside the prescription (spec `program-builder`, "RIR target").
 */

test("a placeholder and Plank show in place, take no sets, and the workout still finishes; the RIR target shows", async ({
  page,
}) => {
  const api = new FakeApi();
  api.addProgram({
    name: "Strength",
    workouts: [
      [
        "Squat Day",
        [
          {
            exercise: "Back Squat",
            sets: 3,
            prescribed: [
              {
                targetRepsMin: 5,
                targetRepsMax: 5,
                targetWeight: 225,
                weightUnit: "LB",
                targetRir: 3,
              },
              {
                targetRepsMin: 5,
                targetRepsMax: 5,
                targetWeight: 225,
                weightUnit: "LB",
                targetRir: 2,
              },
              {
                targetRepsMin: 5,
                targetRepsMax: 5,
                targetWeight: 225,
                weightUnit: "LB",
                targetRir: 2,
              },
            ],
          },
          { label: "conditioning finisher", sets: 2 },
          { exercise: "Plank", sets: 3 },
        ],
      ],
    ],
  });
  await api.install(page);
  await signIn(page);
  await page.getByRole("button", { name: "Start Squat Day" }).click();
  await expect(page).toHaveURL(/\/workout\//);

  // The effort target beside the prescription: set 1 is RIR 3.
  const squat = live(page, "Back Squat");
  await expect(squat).toContainText(
    /Set\s*1\s*225\s*lb\s*×?\s*(for\s*)?5(\s*reps)?\s*·?\s*(,\s*target\s*)?RIR\s*3/,
  );
  await logSet(page, "Back Squat", { weight: 225, reps: 5 });
  await expect(squat).toContainText(/RIR\s*2/);
  // The planned rows in the log carry it too.
  await expect(rows(page, "Back Squat").nth(1)).toContainText("RIR 2");

  // Every slot is listed in position order, the two stopgaps included.
  const log = page.getByRole("region", { name: "Today’s log" });
  await expect(log.getByRole("heading", { level: 3 })).toHaveText([
    /Back Squat/,
    /Placeholder:\s*“conditioning finisher”\s*logging arrives soon/,
    /Plank\s*logging arrives soon/,
  ]);
  // Only the squat's sets count as planned.
  await expect(log).toContainText("1 of 3 planned sets");

  // The placeholder: label, target sets, the note, Skip; no set entry.
  await squat.getByRole("button", { name: /Skip to|Next:/ }).click();
  const finisher = page.getByRole("region", {
    name: "Placeholder: “conditioning finisher”",
  });
  await expect(finisher).toContainText("2 sets");
  await expect(finisher).toContainText("Logging this arrives soon");
  await expect(finisher.getByRole("spinbutton")).toHaveCount(0);
  await expect(finisher.getByRole("button", { name: "Log set" })).toHaveCount(
    0,
  );
  await finisher.getByRole("button", { name: "Skip to Plank" }).click();

  // Plank (duration only): the same, and it ends the workout.
  const plank = live(page, "Plank");
  await expect(plank).toContainText("3 sets");
  await expect(plank).toContainText("Logging this arrives soon");
  await expect(plank.getByRole("spinbutton")).toHaveCount(0);
  await plank.getByRole("button", { name: "Skip and finish" }).click();

  // Finishing around them: the session is COMPLETED, with squat sets only.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Finish with 2 sets left?");
  await dialog.getByRole("button", { name: "Finish workout" }).click();
  await expect(page).toHaveURL(/\/$/);
  const sessionId = api.sessionOf(api.workout("Squat Day").id)!.id;
  await expect
    .poll(() => api.sessions.get(sessionId)!.status)
    .toBe("COMPLETED");
  expect(api.setsOf(sessionId)).toEqual({
    "Back Squat": [[1, 225, "LB", 5]],
  });
  expect(api.writes.filter((w) => w.startsWith("PUT /api/sets/"))).toHaveLength(
    1,
  );
});
