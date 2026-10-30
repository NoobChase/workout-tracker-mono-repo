import { describe, expect, it } from "vitest";
import { withKeptId } from "./kept-id.js";

describe("withKeptId", () => {
  it("keeps the minted id across failures, and forgets it on success", async () => {
    const kept = new Map<string, string>();
    const sent: string[] = [];
    const lost = (id: string) => {
      sent.push(id);
      return Promise.reject(new Error("the answer was lost"));
    };
    const ok = (id: string) => {
      sent.push(id);
      return Promise.resolve(id);
    };

    await expect(withKeptId(kept, "copy", lost)).rejects.toThrow();
    await expect(withKeptId(kept, "copy", ok)).resolves.toBe(sent[0]);
    expect(sent[1]).toBe(sent[0]);
    expect(kept.has("copy")).toBe(false);

    // Done: the next call is another write.
    await withKeptId(kept, "copy", ok);
    expect(sent[2]).not.toBe(sent[0]);
  });

  it("keeps each key's own id", async () => {
    const kept = new Map<string, string>();
    await expect(
      withKeptId(kept, "a", () => Promise.reject(new Error("lost"))),
    ).rejects.toThrow();
    await expect(
      withKeptId(kept, "b", () => Promise.reject(new Error("lost"))),
    ).rejects.toThrow();
    expect(kept.get("a")).not.toBe(kept.get("b"));
  });

  it("keeps any value it is given, and drops it after a refusal for good", async () => {
    const kept = new Map<string, { body: string }>();
    const refused = new Error("refused");
    const first = { body: "as first sent" };
    await expect(
      withKeptId(kept, "save", () => Promise.reject(new Error("lost")), {
        mint: () => first,
        forgetOn: (e) => e === refused,
      }),
    ).rejects.toThrow();
    // Retried: the kept request goes, not a new one.
    let sent: { body: string } | null = null;
    await expect(
      withKeptId(
        kept,
        "save",
        (value) => {
          sent = value;
          return Promise.reject(refused);
        },
        { mint: () => ({ body: "a new one" }), forgetOn: (e) => e === refused },
      ),
    ).rejects.toBe(refused);
    expect(sent).toBe(first);
    expect(kept.has("save")).toBe(false);
  });
});
