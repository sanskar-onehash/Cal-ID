import type { TFunction } from "i18next";
import { RRule, rrulestr } from "rrule";

/**
 * Parse an RRULE string and return a human-readable frequency string
 * @param t - Translation function
 * @param rrule - RFC 5545 RRULE string (e.g., "FREQ=WEEKLY;INTERVAL=2;COUNT=10")
 * @returns Formatted frequency string (e.g., "every 2 weeks")
 */
export const getRecurringFreqFromRRule = ({ t, rrule }: { t: TFunction; rrule: string }): string => {
  try {
    const rule = rrulestr(rrule);
    const options = rule.options;

    const frequencyMap: Record<number, string> = {
      [RRule.YEARLY]: "yearly",
      [RRule.MONTHLY]: "monthly",
      [RRule.WEEKLY]: "weekly",
      [RRule.DAILY]: "daily",
      [RRule.HOURLY]: "hourly",
    };

    const frequency = frequencyMap[options.freq];
    const interval = options.interval || 1;

    if (frequency) {
      return t("every_for_freq", {
        freq: `${interval > 1 ? interval : ""} ${t(frequency, {
          count: interval,
        })}`,
      });
    }
  } catch (error) {
    console.error("Error parsing RRULE:", error);
  }
  return "";
};

/**
 * Get display text for recurrence frequency with occurrence count
 * @param t - Translation function
 * @param rrule - RFC 5545 RRULE string
 * @param recurringCount - Total number of occurrences
 * @returns Formatted string (e.g., "every 2 weeks 10 occurrences")
 */
export const getEveryFreqForRRule = ({
  t,
  rrule,
  recurringCount,
}: {
  t: TFunction;
  rrule: string;
  recurringCount: number;
}): string => {
  const freq = getRecurringFreqFromRRule({ t, rrule });
  if (freq) {
    return `${freq} ${recurringCount} ${t("occurrence", {
      count: recurringCount,
    })}`;
  }
  return "";
};

/**
 * Get display text for a complete recurrence pattern
 * Handles RRULE, EXRULE, RDATE, and EXDATE fields
 * @param t - Translation function
 * @param recurrencePattern - RFC 5545 recurrence pattern object
 * @param recurringCount - Total number of occurrences
 * @returns Formatted recurrence description
 */
export const getRecurrencePatternDisplayText = ({
  t,
  recurrencePattern,
  recurringCount,
}: {
  t: TFunction;
  recurrencePattern: {
    RRULE?: string;
    EXRULE?: string | string[];
    RDATE?: string;
    EXDATE?: string;
  };
  recurringCount: number;
}): string => {
  if (recurrencePattern.RRULE) {
    return getEveryFreqForRRule({
      t,
      rrule: recurrencePattern.RRULE,
      recurringCount,
    });
  }

  // Fallback for complex patterns without RRULE
  return `${t("recurring_event", { defaultValue: "Recurring event" })} (${recurringCount} ${t("occurrence", {
    count: recurringCount,
    defaultValue: "occurrences",
  })})`;
};

/**
 * Universal function to get recurring event display text
 * Supports RFC 5545 recurrence patterns
 * @param t - Translation function
 * @param recurrencePattern - RFC 5545 recurrence pattern (from booking metadata)
 * @param recurringCount - Total number of occurrences
 * @param isExternalEvent - Flag for external events with limited pattern info
 * @returns Formatted recurrence description
 */
export const getRecurringDisplayText = ({
  t,
  recurrencePattern,
  recurringCount,
  isExternalEvent = false,
}: {
  t: TFunction;
  recurrencePattern?:
    | {
        RRULE?: string;
        EXRULE?: string | string[];
        RDATE?: string;
        EXDATE?: string;
      }
    | string
    | null;
  recurringCount: number;
  isExternalEvent?: boolean;
}): string => {
  // Handle string RRULE (simple case)
  if (typeof recurrencePattern === "string") {
    return getEveryFreqForRRule({
      t,
      rrule: recurrencePattern,
      recurringCount,
    });
  }

  // Handle object recurrence pattern
  if (recurrencePattern?.RRULE) {
    return getRecurrencePatternDisplayText({
      t,
      recurrencePattern,
      recurringCount,
    });
  }

  // External events or fallback
  if (isExternalEvent || recurringCount > 1) {
    return `${t("recurring_event", { defaultValue: "Recurring event" })} (${recurringCount} ${t(
      "occurrence",
      {
        count: recurringCount,
        defaultValue: "occurrences",
      }
    )})`;
  }

  return "";
};
