// The catalog data file, checked as content -- no database. The schema would
// refuse most of these at seed time anyway; failing here names the entry.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog } from "../src/catalog";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("catalog.ts", () => {
  it("has a sensible number of entries", () => {
    assert.ok(catalog.length >= 60, `only ${catalog.length} exercises`);
  });

  it("gives every entry a unique UUIDv7 id", () => {
    const seen = new Set<string>();
    for (const e of catalog) {
      assert.match(e.id, UUID_V7, e.name);
      assert.ok(!seen.has(e.id), `duplicate id ${e.id} (${e.name})`);
      seen.add(e.id);
    }
  });

  it("gives every entry a unique name, ignoring case", () => {
    const seen = new Set<string>();
    for (const e of catalog) {
      const key = e.name.toLowerCase();
      assert.ok(!seen.has(key), `duplicate name ${e.name}`);
      assert.equal(e.name, e.name.trim(), `untrimmed name "${e.name}"`);
      seen.add(key);
    }
  });

  it("declares metrics: at least one, at least one required, none repeated", () => {
    for (const e of catalog) {
      const kinds = e.metrics.map((m) => m.metric);
      assert.ok(kinds.length > 0, `${e.name} has no metrics`);
      assert.equal(
        new Set(kinds).size,
        kinds.length,
        `${e.name} repeats a metric`,
      );
      assert.ok(
        e.metrics.some((m) => m.required),
        `${e.name} has no required metric, so an empty set would be valid`,
      );
    }
  });

  it("follows the muscle rules the schema enforces", () => {
    for (const e of catalog) {
      assert.ok(
        e.primary.length > 0 || e.secondary.length === 0,
        `${e.name}: secondary muscles without a primary`,
      );
      const overlap = e.primary.filter((m) => e.secondary.includes(m));
      assert.deepEqual(overlap, [], `${e.name}: in both primary and secondary`);
      assert.equal(
        new Set(e.primary).size,
        e.primary.length,
        `${e.name}: repeated primary`,
      );
      assert.equal(
        new Set(e.secondary).size,
        e.secondary.length,
        `${e.name}: repeated secondary`,
      );
    }
  });
});
