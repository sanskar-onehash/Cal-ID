import { rrulestr } from "rrule";

import type { CalendarEvent } from "@calcom/types/Calendar";

export default function normalisedRecurrence(calEvent: CalendarEvent): CalendarEvent {
  if (calEvent.metadata?.recurrencePattern?.RRULE) {
    const rule = rrulestr(calEvent.metadata.recurrencePattern.RRULE);
    const { freq, interval, count } = rule.options;

    if (count == null) {
      throw new Error("RecurringEvent.count is required but missing in RRULE");
    }

    return {
      ...calEvent,
      recurringEvent: {
        freq,
        interval,
        count,
      },
    };
  }
  return calEvent;
}
