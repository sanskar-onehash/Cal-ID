/**
 * RFC 5545 Recurrence Pattern Utilities
 *
 * Core utilities for working with iCalendar (RFC 5545) recurrence patterns.
 * These functions handle parsing, generating, and manipulating recurring events.
 *
 * @module recurrenceUtils
 */
import { RRule, rrulestr, RRuleSet } from "rrule";

import type { RecurrencePattern } from "@calcom/types/Calendar";

export type { RecurrencePattern };
// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration options for occurrence generation
 */
export interface GenerateOccurrencesOptions {
  /** Maximum number of occurrences to generate (default: 730) */
  maxOccurrences?: number;
  /** Start date for occurrence generation (overrides pattern DTSTART) */
  dtstart?: Date;
  /** End date limit for occurrence generation */
  until?: Date;
}

// ============================================================================
// DATE PARSING UTILITIES
// ============================================================================

/**
 * Parse RFC 5545 date format to JavaScript Date object
 * Supports multiple formats:
 * - RFC 5545 compact: YYYYMMDDTHHMMSSZ (e.g., "20250101T100000Z")
 * - ISO 8601: YYYY-MM-DDTHH:MM:SSZ (e.g., "2025-01-01T10:00:00Z")
 *
 * @param dateStr - Date string in RFC 5545 or ISO format
 * @returns Parsed Date object or null if invalid
 *
 * @example
 * parseRecurrenceDate("20250101T100000Z") // 2025-01-01 10:00:00 UTC
 * parseRecurrenceDate("2025-01-01T10:00:00Z") // 2025-01-01 10:00:00 UTC
 */
export function parseRecurrenceDate(dateStr: string): Date | null {
  try {
    let normalizedDateStr = dateStr;

    // Format: YYYYMMDDTHHMMSSZ (RFC 5545 compact format)
    if (/^\d{8}T\d{6}Z$/.test(dateStr)) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      const hour = dateStr.substring(9, 11);
      const minute = dateStr.substring(11, 13);
      const second = dateStr.substring(13, 15);
      normalizedDateStr = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    }

    const date = new Date(normalizedDateStr);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch (error) {
    console.error("Error parsing recurrence date:", dateStr, error);
    return null;
  }
}

/**
 * Format a Date object to RFC 5545 compact format
 *
 * @param date - JavaScript Date object
 * @returns Date string in YYYYMMDDTHHMMSSZ format
 *
 * @example
 * formatRecurrenceDate(new Date("2025-01-01T10:00:00Z")) // "20250101T100000Z"
 */
export function formatRecurrenceDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

// ============================================================================
// OCCURRENCE GENERATION
// ============================================================================

/**
 * Generate all recurring dates from an RFC 5545 recurrence pattern
 * Uses RRuleSet to handle RRULE, EXRULE, RDATE, and EXDATE
 *
 * This is the core function for expanding a recurrence pattern into actual date instances.
 * It properly handles:
 * - Main recurrence rules (RRULE)
 * - Exception rules (EXRULE) - patterns of dates to exclude
 * - Specific included dates (RDATE)
 * - Specific excluded dates (EXDATE)
 *
 * @param recurrencePattern - RFC 5545 recurrence pattern object
 * @param startTime - Base start time for the recurrence
 * @param options - Optional configuration for generation
 * @returns Array of Date objects representing all occurrences
 *
 * @example
 * // Generate weekly occurrences with one exclusion
 * const pattern = {
 *   RRULE: "FREQ=WEEKLY;COUNT=5",
 *   EXDATE: "20250108T100000Z"
 * };
 * const dates = generateRecurringDates(pattern, new Date("2025-01-01T10:00:00Z"));
 * // Returns 4 dates (5 occurrences - 1 excluded)
 *
 * @example
 * // Generate with custom max occurrences
 * const dates = generateRecurringDates(
 *   { RRULE: "FREQ=DAILY" },
 *   new Date(),
 *   { maxOccurrences: 30 }
 * );
 * // Returns up to 30 daily occurrences
 */
export function generateRecurringDates(
  recurrencePattern: RecurrencePattern,
  startTime: Date,
  options: GenerateOccurrencesOptions = {}
): Date[] {
  const { maxOccurrences = 730, dtstart, until } = options;
  const effectiveStartTime = dtstart || startTime;
  const ruleSet = new RRuleSet();

  try {
    // Add main recurrence rule (RRULE)
    if (recurrencePattern.RRULE) {
      let rule = rrulestr(recurrencePattern.RRULE, { dtstart: effectiveStartTime });

      // Ensure finite occurrences - add count limit if neither until nor count specified
      if (!rule.options.until && !rule.options.count) {
        if (until) {
          rule = new RRule({ ...rule.options, until });
        } else {
          rule = new RRule({ ...rule.options, count: maxOccurrences });
        }
      }

      ruleSet.rrule(rule);
    }

    // Add exception rule (EXRULE) - dates matching this pattern are excluded
    if (recurrencePattern.EXRULE) {
      let exRule = rrulestr(recurrencePattern.EXRULE, { dtstart: effectiveStartTime });

      // Ensure finite occurrences for exception rule
      if (!exRule.options.until && !exRule.options.count) {
        if (until) {
          exRule = new RRule({ ...exRule.options, until });
        } else {
          exRule = new RRule({ ...exRule.options, count: maxOccurrences });
        }
      }

      ruleSet.exrule(exRule);
    }

    // Add specific included dates (RDATE)
    if (recurrencePattern.RDATE) {
      recurrencePattern.RDATE.split(",").forEach((dateStr) => {
        const date = parseRecurrenceDate(dateStr.trim());
        if (date) {
          ruleSet.rdate(date);
        }
      });
    }

    // Add specific excluded dates (EXDATE)
    if (recurrencePattern.EXDATE) {
      recurrencePattern.EXDATE.split(",").forEach((dateStr) => {
        const date = parseRecurrenceDate(dateStr.trim());
        if (date) {
          ruleSet.exdate(date);
        }
      });
    }

    // Generate all occurrences
    return ruleSet.all();
  } catch (error) {
    console.error("Error generating recurring dates:", error);
    return [];
  }
}

/**
 * Generate occurrences within a specific date range
 *
 * @param recurrencePattern - RFC 5545 recurrence pattern
 * @param startTime - Base start time
 * @param rangeStart - Start of the date range
 * @param rangeEnd - End of the date range
 * @returns Array of dates within the specified range
 *
 * @example
 * const pattern = { RRULE: "FREQ=WEEKLY;COUNT=52" };
 * const occurrences = generateRecurringDatesInRange(
 *   pattern,
 *   new Date("2025-01-01"),
 *   new Date("2025-01-01"),
 *   new Date("2025-02-01")
 * );
 * // Returns only occurrences in January 2025
 */
export function generateRecurringDatesInRange(
  recurrencePattern: RecurrencePattern,
  startTime: Date,
  rangeStart: Date,
  rangeEnd: Date
): Date[] {
  const allDates = generateRecurringDates(recurrencePattern, startTime);
  return allDates.filter((date) => date >= rangeStart && date <= rangeEnd);
}

// ============================================================================
// OCCURRENCE COMPARISON
// ============================================================================

/**
 * Check if two dates represent the same occurrence
 * Compares dates by exact timestamp (milliseconds)
 *
 * @param date1 - First date to compare
 * @param date2 - Second date to compare
 * @returns true if dates are identical
 *
 * @example
 * const date1 = new Date("2025-01-01T10:00:00Z");
 * const date2 = new Date("2025-01-01T10:00:00Z");
 * isSameOccurrence(date1, date2); // true
 */
export function isSameOccurrence(date1: Date, date2: Date): boolean {
  return date1.getTime() === date2.getTime();
}

/**
 * Find a specific occurrence in an array of dates
 *
 * @param occurrences - Array of occurrence dates
 * @param targetDate - Date to find
 * @returns Matching date or null if not found
 *
 * @example
 * const occurrences = generateRecurringDates(pattern, startDate);
 * const occurrence = findOccurrence(occurrences, new Date("2025-01-08T10:00:00Z"));
 */
export function findOccurrence(occurrences: Date[], targetDate: Date): Date | null {
  return occurrences.find((date) => isSameOccurrence(date, targetDate)) || null;
}

// ============================================================================
// EXDATE MANIPULATION
// ============================================================================

/**
 * Add a date to the EXDATE list
 *
 * @param currentExdate - Current EXDATE string (comma-separated dates)
 * @param dateToAdd - Date to add to exclusion list
 * @returns Updated EXDATE string
 *
 * @example
 * const updated = addToExdate(
 *   "20250108T100000Z",
 *   new Date("2025-01-15T10:00:00Z")
 * );
 * // Returns: "20250108T100000Z,20250115T100000Z"
 */
export function addToExdate(currentExdate: string | undefined, dateToAdd: Date): string {
  const formattedDate = formatRecurrenceDate(dateToAdd);

  if (!currentExdate) {
    return formattedDate;
  }

  const existingDates = currentExdate.split(",").map((d) => d.trim());

  // Avoid duplicates
  if (existingDates.includes(formattedDate)) {
    return currentExdate;
  }

  return [...existingDates, formattedDate].join(",");
}

// ============================================================================
// RDATE MANIPULATION
// ============================================================================

/**
 * Add a date to the RDATE list
 *
 * @param currentRdate - Current RDATE string (comma-separated dates)
 * @param dateToAdd - Date to add to inclusion list
 * @returns Updated RDATE string
 *
 * @example
 * const updated = addToRdate(
 *   "20250108T100000Z",
 *   new Date("2025-01-15T10:00:00Z")
 * );
 * // Returns: "20250108T100000Z,20250115T100000Z"
 */
export function addToRdate(currentRdate: string | undefined, dateToAdd: Date): string {
  const formattedDate = formatRecurrenceDate(dateToAdd);

  if (!currentRdate) {
    return formattedDate;
  }

  const existingDates = currentRdate.split(",").map((d) => d.trim());

  // Avoid duplicates
  if (existingDates.includes(formattedDate)) {
    return currentRdate;
  }

  return [...existingDates, formattedDate].join(",");
}

/**
 * Remove a date from the EXDATE list
 *
 * @param currentExdate - Current EXDATE string
 * @param dateToRemove - Date to remove from exclusion list
 * @returns Updated EXDATE string (empty string if no dates remain)
 *
 * @example
 * const updated = removeFromExdate(
 *   "20250108T100000Z,20250115T100000Z",
 *   new Date("2025-01-08T10:00:00Z")
 * );
 * // Returns: "20250115T100000Z"
 */
export function removeFromExdate(currentExdate: string | undefined, dateToRemove: Date): string {
  if (!currentExdate) {
    return "";
  }

  const formattedDateToRemove = formatRecurrenceDate(dateToRemove);
  const existingDates = currentExdate.split(",").map((d) => d.trim());
  const filtered = existingDates.filter((date) => date !== formattedDateToRemove);

  return filtered.join(",");
}

/**
 * Check if a date is in the EXDATE list
 *
 * @param exdate - EXDATE string to check
 * @param date - Date to look for
 * @returns true if date is excluded
 *
 * @example
 * const isExcluded = isDateInExdate(
 *   "20250108T100000Z,20250115T100000Z",
 *   new Date("2025-01-08T10:00:00Z")
 * );
 * // Returns: true
 */
export function isDateInExdate(exdate: string | undefined, date: Date): boolean {
  if (!exdate) {
    return false;
  }

  const formattedDate = formatRecurrenceDate(date);
  const existingDates = exdate.split(",").map((d) => d.trim());
  return existingDates.includes(formattedDate);
}

// ============================================================================
// RRULE VALIDATION
// ============================================================================

/**
 * Validate an RRULE string
 *
 * @param rrule - RRULE string to validate
 * @returns Object with valid flag and optional error message
 *
 * @example
 * const result = validateRRule("FREQ=WEEKLY;COUNT=10");
 * // Returns: { valid: true }
 *
 * const result2 = validateRRule("INVALID");
 * // Returns: { valid: false, error: "..." }
 */
export function validateRRule(rrule: string): { valid: boolean; error?: string } {
  try {
    rrulestr(rrule);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid RRULE format",
    };
  }
}

/**
 * Validate a complete recurrence pattern
 *
 * @param pattern - Recurrence pattern to validate
 * @returns Object with valid flag and optional error message
 *
 * @example
 * const result = validateRecurrencePattern({
 *   RRULE: "FREQ=WEEKLY;COUNT=10",
 *   EXDATE: "20250108T100000Z"
 * });
 * // Returns: { valid: true }
 */
export function validateRecurrencePattern(pattern: RecurrencePattern): { valid: boolean; error?: string } {
  if (pattern.RRULE) {
    const rruleValidation = validateRRule(pattern.RRULE);
    if (!rruleValidation.valid) {
      return rruleValidation;
    }
  }

  if (pattern.EXRULE) {
    const exruleValidation = validateRRule(pattern.EXRULE);
    if (!exruleValidation.valid) {
      return { valid: false, error: `Invalid EXRULE: ${exruleValidation.error}` };
    }
  }

  // Validate date strings in EXDATE and RDATE
  if (pattern.EXDATE) {
    const dates = pattern.EXDATE.split(",");
    for (const dateStr of dates) {
      if (!parseRecurrenceDate(dateStr.trim())) {
        return { valid: false, error: `Invalid EXDATE date: ${dateStr}` };
      }
    }
  }

  if (pattern.RDATE) {
    const dates = pattern.RDATE.split(",");
    for (const dateStr of dates) {
      if (!parseRecurrenceDate(dateStr.trim())) {
        return { valid: false, error: `Invalid RDATE date: ${dateStr}` };
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the count of occurrences from a recurrence pattern
 *
 * @param pattern - Recurrence pattern
 * @param startTime - Start time for generation
 * @returns Total number of occurrences
 *
 * @example
 * const count = getOccurrenceCount(
 *   { RRULE: "FREQ=WEEKLY;COUNT=10", EXDATE: "20250108T100000Z" },
 *   new Date("2025-01-01")
 * );
 * // Returns: 9 (10 - 1 excluded)
 */
export function getOccurrenceCount(pattern: RecurrencePattern, startTime: Date): number {
  const occurrences = generateRecurringDates(pattern, startTime);
  return occurrences.length;
}

/**
 * Check if a recurrence pattern has any occurrences
 *
 * @param pattern - Recurrence pattern
 * @param startTime - Start time for generation
 * @returns true if pattern generates at least one occurrence
 */
export function hasOccurrences(pattern: RecurrencePattern, startTime: Date): boolean {
  return getOccurrenceCount(pattern, startTime) > 0;
}

// ============================================================================
// RFC 5545: Parse recurrence pattern from string or object format
// ============================================================================

/**
 * Parse recurrence pattern from various formats
 * Handles both string format (RRULE:...\nEXDATE:...) and object format
 *
 * @param details - Recurrence pattern in string or object format
 * @returns Parsed recurrence pattern object
 *
 * @example
 * // String format
 * getRecurrenceObjFromString("RRULE:FREQ=WEEKLY;COUNT=10\nEXDATE:20250108T100000Z")
 * // Returns: { RRULE: "FREQ=WEEKLY;COUNT=10", EXDATE: "20250108T100000Z" }
 *
 * // Object format (already parsed)
 * getRecurrenceObjFromString({ RRULE: "FREQ=WEEKLY;COUNT=10" })
 * // Returns: { RRULE: "FREQ=WEEKLY;COUNT=10" }
 */
export function getRecurrenceObjFromString(
  details: string | { RRULE?: string; RDATE?: string; EXDATE?: string; EXRULE?: string } | undefined
): {
  RRULE?: string;
  RDATE?: string;
  EXDATE?: string;
  EXRULE?: string;
} {
  if (!details) return {};

  // If already an object, return as-is
  if (typeof details === "object") return details;

  // Parse string format (e.g., "RRULE:FREQ=WEEKLY;COUNT=10\nEXDATE:20250108T100000Z")
  const lines = details.split(/\r?\n|,/);
  const output: Record<string, string> = {};

  for (const line of lines) {
    const [key, val] = line.split(":");
    if (key && val && ["RRULE", "RDATE", "EXDATE", "EXRULE"].includes(key)) {
      output[key] = val;
    }
  }

  return output;
}
