import { getRecurrenceObjFromString } from "@calid/features/modules/teams/lib/recurrenceUtil";

import handleNewBooking from "@calcom/features/bookings/lib/handleNewBooking";
import type { BookingResponse } from "@calcom/features/bookings/types";
import { SchedulingType } from "@calcom/prisma/client";
import type { AppsStatus } from "@calcom/types/Calendar";

export type PlatformParams = {
  platformClientId?: string;
  platformCancelUrl?: string;
  platformBookingUrl?: string;
  platformRescheduleUrl?: string;
  platformBookingLocation?: string;
  areCalendarEventsEnabled?: boolean;
};

export type BookingHandlerInput = {
  bookingData: Record<string, any>[];
  userId?: number;
  // These used to come from headers but now we're passing them as params
  hostname?: string;
  forcedSlug?: string;
  noEmail?: boolean;
} & PlatformParams;

export const handleNewRecurringBooking = async (input: BookingHandlerInput): Promise<BookingResponse[]> => {
  const data = input.bookingData;
  const createdBookings: BookingResponse[] = [];

  const allRecurringDates: { start: string | undefined; end: string | undefined }[] = data.map((booking) => {
    return { start: booking.start, end: booking.end };
  });

  const appsStatus: AppsStatus[] | undefined = undefined;
  const numSlotsToCheckForAvailability = 1;
  let thirdPartyRecurringEventId = null;

  // The first booking contains the pattern and metadata
  const firstBooking = data[0];

  // ============================================================================
  // Parse and validate recurrence pattern
  // ============================================================================
  const parsedRecurrencePattern = getRecurrenceObjFromString(firstBooking.metadata?.recurrencePattern);

  if (!parsedRecurrencePattern || Object.keys(parsedRecurrencePattern).length === 0) {
    throw new Error(
      "Invalid or missing recurrence pattern. Pattern-based recurring bookings require a valid RFC 5545 recurrence pattern in metadata."
    );
  }

  const isRoundRobin = firstBooking.schedulingType === SchedulingType.ROUND_ROBIN;
  let luckyUsers;

  // Metadata for booking handler
  const handleBookingMeta = {
    userId: input.userId,
    platformClientId: input.platformClientId,
    platformRescheduleUrl: input.platformRescheduleUrl,
    platformCancelUrl: input.platformCancelUrl,
    platformBookingUrl: input.platformBookingUrl,
    platformBookingLocation: input.platformBookingLocation,
    areCalendarEventsEnabled: input.areCalendarEventsEnabled,
  };

  // ============================================================================
  // Build booking request with recurrence pattern
  // ============================================================================
  const bookingReq = {
    ...firstBooking,
    metadata: {
      ...(firstBooking.metadata ?? {}),
      recurrencePattern: parsedRecurrencePattern,
    },
    appsStatus,
    allRecurringDates,
    isFirstRecurringSlot: true,
    thirdPartyRecurringEventId,
    numSlotsToCheckForAvailability,
    currentRecurringIndex: 0,
    noEmail: input.noEmail ?? false,
    luckyUsers,
  };

  // ============================================================================
  // Round Robin: Dry run to determine lucky user
  // ============================================================================
  // For round robin events, we need to determine which team member gets assigned
  // to the recurring series before creating the actual booking
  if (isRoundRobin) {
    const dryRunResult = await handleNewBooking({
      bookingData: { ...bookingReq, _isDryRun: true },
      hostname: input.hostname || "",
      forcedSlug: input.forcedSlug as string | undefined,
      ...handleBookingMeta,
    });

    luckyUsers = dryRunResult.luckyUsers;
    bookingReq.luckyUsers = luckyUsers;
  }

  // ============================================================================
  // Create the single booking with recurrence pattern
  // ============================================================================
  const finalBooking = await handleNewBooking({
    bookingData: bookingReq,
    hostname: input.hostname || "",
    forcedSlug: input.forcedSlug as string | undefined,
    ...handleBookingMeta,
  });

  createdBookings.push(finalBooking);

  // ============================================================================
  // Extract third-party recurring event ID (e.g., Google Calendar recurring ID)
  // ============================================================================
  if (!thirdPartyRecurringEventId && finalBooking.references && finalBooking.references.length > 0) {
    for (const reference of finalBooking.references) {
      if (reference.thirdPartyRecurringEventId) {
        thirdPartyRecurringEventId = reference.thirdPartyRecurringEventId;
        break;
      }
    }
  }

  // ============================================================================
  // Return immediately with single booking record
  // ============================================================================
  // IMPORTANT: Unlike the old approach which created N booking records,
  // we return immediately with just ONE booking record that contains the
  // recurrence pattern in its metadata.
  //
  // The pattern defines all occurrences:
  // - RRULE: Base recurrence rule
  // - EXDATE: Cancelled instances
  // - RDATE: Additional/rescheduled instances
  return createdBookings;
};
