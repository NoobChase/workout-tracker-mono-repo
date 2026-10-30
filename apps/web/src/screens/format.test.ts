import { describe, expect, it } from "vitest";
import { relativeDay } from "./format.js";

describe("relativeDay", () => {
  // Local times, so the calendar day is the device's, as on screen.
  const now = new Date(2026, 9, 30, 9, 0);
  const at = (d: number, h: number) =>
    new Date(2026, 9, d, h, 30).toISOString();

  it("today and yesterday by the calendar, not by 24 hours", () => {
    expect(relativeDay(at(30, 0), now)).toBe("today");
    expect(relativeDay(at(29, 23), now)).toBe("yesterday");
    expect(relativeDay(at(29, 0), now)).toBe("yesterday");
  });

  it("anything older is the day, with the year only when it isn't this one", () => {
    expect(relativeDay(at(20, 13), now)).toBe("Tue, Oct 20");
    expect(relativeDay(new Date(2025, 9, 20, 12).toISOString(), now)).toBe(
      "Mon, Oct 20, 2025",
    );
  });
});
