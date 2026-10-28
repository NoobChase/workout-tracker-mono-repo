// The template data file, checked as content against catalog.ts -- no
// database (specs/program-templates, "Template content is valid against the
// catalog"). Catalog entries are standard by construction: catalog.ts holds
// only exercises with no owner.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../src/catalog";
import { TEMPLATES, findTemplate } from "../src/templates";

const byId = new Map(catalog.map((e) => [e.id, e]));
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("templates.ts", () => {
  it("holds the three starter templates, slugs and names unique", () => {
    assert.deepEqual(
      TEMPLATES.map((t) => t.name),
      ["Push Pull Legs", "Full Body 3-Day", "Upper Lower 4-Day"],
    );
    const slugs = TEMPLATES.map((t) => t.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const slug of slugs) assert.match(slug, SLUG);
    assert.equal(findTemplate("push-pull-legs")?.name, "Push Pull Legs");
    assert.equal(findTemplate("nope"), undefined);
  });

  it("gives each template a one-line description and named, non-empty workouts", () => {
    for (const t of TEMPLATES) {
      assert.ok(t.description.length > 0, t.slug);
      assert.ok(!t.description.includes("\n"), `${t.slug}: one line`);
      // A trailing "(n)" would collide with copy-name suffixing (3.9).
      assert.doesNotMatch(t.name, /\(\d+\)$/, t.slug);
      assert.ok(t.workouts.length > 0, `${t.slug} has no workouts`);
      const names = t.workouts.map((w) => w.name);
      assert.equal(new Set(names).size, names.length, `${t.slug}: names`);
      for (const w of t.workouts) {
        assert.ok(w.name.trim().length > 0, t.slug);
        assert.ok(w.exercises.length > 0, `${t.slug}/${w.name} is empty`);
      }
    }
  });

  it("references only standard, active exercises that require weight and reps", () => {
    for (const t of TEMPLATES) {
      for (const w of t.workouts) {
        for (const e of w.exercises) {
          const where = `${t.slug}/${w.name}/${e.exerciseId}`;
          const entry = byId.get(e.exerciseId);
          assert.ok(entry, `${where}: not in the catalog`);
          assert.notEqual(entry.isActive, false, `${where}: retired`);
          for (const metric of ["WEIGHT", "REPS"] as const) {
            assert.ok(
              entry.metrics.some((m) => m.metric === metric && m.required),
              `${where} (${entry.name}): ${metric} is not a required metric`,
            );
          }
        }
      }
    }
  });

  it("has no placeholders and sensible prescriptions", () => {
    for (const t of TEMPLATES) {
      for (const w of t.workouts) {
        const ids = w.exercises.map((e) => e.exerciseId);
        assert.equal(new Set(ids).size, ids.length, `${t.slug}/${w.name}`);
        for (const e of w.exercises) {
          const where = `${t.slug}/${w.name}/${e.exerciseId}`;
          // Exactly these keys: no placeholder label, no weight.
          assert.deepEqual(
            Object.keys(e).sort(),
            ["exerciseId", "repsMax", "repsMin", "targetSets"],
            where,
          );
          for (const n of [e.targetSets, e.repsMin, e.repsMax]) {
            assert.ok(Number.isInteger(n), where);
          }
          assert.ok(e.targetSets >= 1 && e.targetSets <= 10, where);
          assert.ok(e.repsMin >= 1 && e.repsMin <= e.repsMax, where);
          assert.ok(e.repsMax <= 30, where);
        }
      }
    }
  });
});
