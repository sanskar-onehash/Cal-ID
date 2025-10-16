import type { RecurrencePattern } from "@calid/features/modules/teams/lib/recurrenceUtil";
import { generateRecurringDates } from "@calid/features/modules/teams/lib/recurrenceUtil";
import type { Prisma } from "@prisma/client";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { HttpError } from "@calcom/lib/http-error";
import { BookingRepository } from "@calcom/lib/server/repository/booking";
import { prisma } from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";

/**
 * Check if two dates represent the same occurrence
 * Compares dates by exact timestamp (milliseconds)
 *
 * @param date1 - First date to compare
 * @param date2 - Second date to compare
 * @returns true if dates are identical
 */
function isSameOccurrence(date1: Date, date2: Date): boolean {
  return date1.getTime() === date2.getTime();
}

// ============================================================================
// MAIN FUNCTION: GET ORIGINAL RESCHEDULED BOOKING WITH RECURRENCE SUPPORT
// ============================================================================

/**
 * Get the original booking being rescheduled, with support for recurring bookings
 *
 * For recurring bookings:
 * - If originalOccurrenceDate is provided, finds the specific occurrence
 * - Generates all occurrences from the recurrence pattern
 * - Returns the matching occurrence with correct start/end times
 *
 * For non-recurring bookings:
 * - Returns the original booking as-is
 *
 * @param uid - Unique identifier of the booking being rescheduled
 * @param seatsEventType - Whether this is a seats-based event type
 * @param originalOccurrenceDate - For recurring bookings, the specific occurrence date to reschedule
 * @returns Original booking with correct times for the specific occurrence
 * @throws HttpError if booking not found or cannot be rescheduled
 */
export async function getOriginalRescheduledBooking(
  uid: string,
  seatsEventType?: boolean,
  originalOccurrenceDate?: Date
) {
  const bookingRepo = new BookingRepository(prisma);
  const originalBooking = await bookingRepo.findOriginalRescheduledBooking(uid, seatsEventType);

  if (!originalBooking) {
    throw new HttpError({ statusCode: 404, message: "Could not find original booking" });
  }

  // Validate booking status
  if (originalBooking.status === BookingStatus.CANCELLED && !originalBooking.rescheduled) {
    throw new HttpError({ statusCode: 400, message: ErrorCode.CancelledBookingsCannotBeRescheduled });
  }

  // Check if this is a recurring booking with a recurrence pattern
  const recurrence = (originalBooking?.metadata as any)?.recurrencePattern as RecurrencePattern | undefined;

  // Handle recurring booking with specific occurrence date
  if (recurrence?.RRULE && originalOccurrenceDate) {
    const targetOccurrenceDate =
      originalOccurrenceDate instanceof Date ? originalOccurrenceDate : new Date(originalOccurrenceDate);

    // Generate all occurrences from the recurrence pattern
    const allRecurringDates = generateRecurringDates(recurrence, originalBooking.startTime);

    console.log(
      "Generated recurring dates:",
      allRecurringDates.map((d) => d.toISOString())
    );

    // Find the specific occurrence that matches the requested date
    const matchingOccurrence = allRecurringDates.find((occurrenceDate) =>
      isSameOccurrence(occurrenceDate, targetOccurrenceDate)
    );

    if (!matchingOccurrence) {
      throw new HttpError({
        statusCode: 404,
        message: "Could not find the requested occurrence in the recurring booking series",
      });
    }

    console.log("Found matching occurrence:", matchingOccurrence.toISOString());

    // Calculate the duration of the original booking
    const originalDuration = originalBooking.endTime.getTime() - originalBooking.startTime.getTime();

    // Create a new end time based on the occurrence start time and original duration
    const occurrenceEndTime = new Date(matchingOccurrence.getTime() + originalDuration);

    // Return booking with the specific occurrence's times
    return {
      ...originalBooking,
      startTime: matchingOccurrence,
      endTime: occurrenceEndTime,
    };
  }

  // Return original booking for non-recurring bookings or when no specific occurrence requested
  console.log("Returning original booking (non-recurring or no specific occurrence)");
  return originalBooking;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type BookingType = Prisma.PromiseReturnType<typeof getOriginalRescheduledBooking> | null;

export type OriginalRescheduledBooking = Awaited<ReturnType<typeof getOriginalRescheduledBooking>> | null;
