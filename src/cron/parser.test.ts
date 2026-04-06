import { describe, it, expect } from "vitest";
import { parseCron, parseCronField, cronMatches, nowInTimezone } from "./parser.js";

describe("parseCronField", () => {
  it("parses wildcard *", () => {
    const result = parseCronField("*", 0, 59);
    expect(result.size).toBe(60);
    expect(result.has(0)).toBe(true);
    expect(result.has(59)).toBe(true);
  });

  it("parses single value", () => {
    const result = parseCronField("5", 0, 59);
    expect(result.size).toBe(1);
    expect(result.has(5)).toBe(true);
  });

  it("parses range", () => {
    const result = parseCronField("1-5", 0, 6);
    expect(result.size).toBe(5);
    expect(result.has(0)).toBe(false);
    expect(result.has(1)).toBe(true);
    expect(result.has(5)).toBe(true);
    expect(result.has(6)).toBe(false);
  });

  it("parses list", () => {
    const result = parseCronField("1,3,5", 0, 6);
    expect(result.size).toBe(3);
    expect(result.has(1)).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(result.has(5)).toBe(true);
    expect(result.has(2)).toBe(false);
  });

  it("parses step with wildcard", () => {
    const result = parseCronField("*/15", 0, 59);
    expect(result.has(0)).toBe(true);
    expect(result.has(15)).toBe(true);
    expect(result.has(30)).toBe(true);
    expect(result.has(45)).toBe(true);
    expect(result.has(14)).toBe(false);
  });

  it("parses range with step", () => {
    const result = parseCronField("0-30/10", 0, 59);
    expect(result.has(0)).toBe(true);
    expect(result.has(10)).toBe(true);
    expect(result.has(20)).toBe(true);
    expect(result.has(30)).toBe(true);
    expect(result.has(40)).toBe(false);
  });
});

describe("parseCron", () => {
  it("parses standard 5-field expression", () => {
    const result = parseCron("0 9 * * 1-5");
    expect(result.minutes.has(0)).toBe(true);
    expect(result.hours.has(9)).toBe(true);
    expect(result.daysOfMonth.size).toBe(31);
    expect(result.months.size).toBe(12);
    expect(result.daysOfWeek.size).toBe(5);
    expect(result.daysOfWeek.has(0)).toBe(false); // Sunday
    expect(result.daysOfWeek.has(6)).toBe(false); // Saturday
  });

  it("throws on invalid expression", () => {
    expect(() => parseCron("0 9 *")).toThrow("need 5 fields");
  });

  it("parses every-30-minutes expression", () => {
    const result = parseCron("*/30 * * * *");
    expect(result.minutes.has(0)).toBe(true);
    expect(result.minutes.has(30)).toBe(true);
    expect(result.minutes.has(15)).toBe(false);
  });
});

describe("cronMatches", () => {
  it("matches a weekday 9am schedule", () => {
    const parsed = parseCron("0 9 * * 1-5");
    // Monday at 9:00
    const monday9am = new Date(2026, 3, 6, 9, 0, 0); // April 6, 2026 is Monday
    expect(cronMatches(parsed, monday9am)).toBe(true);

    // Monday at 10:00
    const monday10am = new Date(2026, 3, 6, 10, 0, 0);
    expect(cronMatches(parsed, monday10am)).toBe(false);

    // Sunday at 9:00
    const sunday9am = new Date(2026, 3, 5, 9, 0, 0); // April 5 is Sunday
    expect(cronMatches(parsed, sunday9am)).toBe(false);
  });

  it("matches every-hour schedule", () => {
    const parsed = parseCron("0 * * * *");
    const topOfHour = new Date(2026, 0, 1, 14, 0, 0);
    expect(cronMatches(parsed, topOfHour)).toBe(true);

    const midHour = new Date(2026, 0, 1, 14, 30, 0);
    expect(cronMatches(parsed, midHour)).toBe(false);
  });
});

describe("nowInTimezone", () => {
  it("returns a Date object for a valid timezone", () => {
    const result = nowInTimezone("America/Chicago");
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThan(0);
  });

  it("returns a Date object for UTC", () => {
    const result = nowInTimezone("UTC");
    expect(result).toBeInstanceOf(Date);
  });
});
