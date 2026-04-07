/** Parsed cron fields used for schedule matching. */
export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

/** Parse a single cron field into the set of allowed values. */
export function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      if (!Number.isFinite(step) || step < 1) {
        throw new Error(`Invalid step value "${stepMatch[2]}" in cron field "${field}"`);
      }
      let rangeStart = min;
      let rangeEnd = max;

      if (stepMatch[1] !== "*") {
        const rangeParts = stepMatch[1].split("-");
        rangeStart = parseInt(rangeParts[0], 10);
        if (rangeParts.length === 2) rangeEnd = parseInt(rangeParts[1], 10);
      }

      if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) {
        throw new Error(`Invalid range in cron field "${field}"`);
      }
      if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
        throw new Error(`Range ${rangeStart}-${rangeEnd} out of bounds [${min}-${max}] in cron field "${field}"`);
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) values.add(i);
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error(`Invalid range values in cron field "${field}"`);
      }
      if (start < min || end > max || start > end) {
        throw new Error(`Range ${start}-${end} out of bounds [${min}-${max}] in cron field "${field}"`);
      }
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    const num = parseInt(part, 10);
    if (!Number.isFinite(num) || num < min || num > max) {
      throw new Error(`Value "${part}" out of bounds [${min}-${max}] in cron field "${field}"`);
    }
    values.add(num);
  }

  return values;
}

/** Parse a 5-field cron expression into discrete sets. */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}" (need 5 fields)`);
  }

  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    daysOfMonth: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    daysOfWeek: parseCronField(fields[4], 0, 6),
  };
}

/** Return true when the date matches the parsed cron schedule. */
export function cronMatches(parsed: ParsedCron, date: Date): boolean {
  return (
    parsed.minutes.has(date.getMinutes()) &&
    parsed.hours.has(date.getHours()) &&
    parsed.daysOfMonth.has(date.getDate()) &&
    parsed.months.has(date.getMonth() + 1) &&
    parsed.daysOfWeek.has(date.getDay())
  );
}

/** Return the current time in the provided IANA timezone. */
export function nowInTimezone(tz: string): Date {
  try {
    const str = new Date().toLocaleString("en-US", { timeZone: tz });
    return new Date(str);
  } catch {
    throw new Error(`Invalid timezone "${tz}". Use a valid IANA timezone (e.g., "America/New_York", "UTC").`);
  }
}
