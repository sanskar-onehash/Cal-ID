import { Prisma } from "@prisma/client";
import type short from "short-uuid";
import type { z } from "zod";

import type { routingFormResponseInDbSchema } from "@calcom/app-store/routing-forms/zod";
import dayjs from "@calcom/dayjs";
import { isPrismaObjOrUndefined } from "@calcom/lib/isPrismaObj";
import { withReporting } from "@calcom/lib/sentryWrapper";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import type { CreationSource } from "@calcom/prisma/enums";
import type { CalendarEvent } from "@calcom/types/Calendar";

import type { TgetBookingDataSchema } from "../getBookingDataSchema";
import type { AwaitedBookingData, EventTypeId } from "./getBookingData";
import type { NewBookingEventType } from "./getEventTypesFromDB";
import type { LoadedUsers } from "./loadUsers";
import type { OriginalRescheduledBooking } from "./originalRescheduledBookingUtils";
import type { PaymentAppData, Tracking } from "./types";

type ReqBodyWithEnd = TgetBookingDataSchema & { end: string };

type CreateBookingParams = {
  uid: short.SUUID;
  routingFormResponseId: number | undefined;
  reroutingFormResponses: z.infer<typeof routingFormResponseInDbSchema> | null;
  rescheduledBy: string | undefined;
  reqBody: {
    user: ReqBodyWithEnd["user"];
    metadata: ReqBodyWithEnd["metadata"];
    recurringEventId: ReqBodyWithEnd["recurringEventId"];
  };
  eventType: {
    eventTypeData: NewBookingEventType;
    id: EventTypeId;
    slug: AwaitedBookingData["eventTypeSlug"];
    organizerUser: LoadedUsers[number] & {
      isFixed?: boolean;
      metadata?: Prisma.JsonValue;
    };
    isConfirmedByDefault: boolean;
    paymentAppData: PaymentAppData;
  };
  input: {
    bookerEmail: AwaitedBookingData["email"];
    rescheduleReason: AwaitedBookingData["rescheduleReason"];
    smsReminderNumber: AwaitedBookingData["smsReminderNumber"];
    responses: ReqBodyWithEnd["responses"] | null;
  };
  evt: CalendarEvent;
  originalRescheduledBooking: OriginalRescheduledBooking;
  creationSource?: CreationSource;
  tracking?: Tracking;
};

function updateEventDetails(
  evt: CalendarEvent,
  originalRescheduledBooking: OriginalRescheduledBooking | null
) {
  if (originalRescheduledBooking) {
    evt.description = originalRescheduledBooking?.description || evt.description;
    evt.location = evt.location || originalRescheduledBooking?.location;
  }
}

async function getAssociatedBookingForFormResponse(formResponseId: number) {
  const formResponse = await prisma.app_RoutingForms_FormResponse.findUnique({
    where: {
      id: formResponseId,
    },
  });
  return formResponse?.routedToBookingUid ?? null;
}

// Define the function with underscore prefix
const _createBooking = async ({
  uid,
  reqBody,
  eventType,
  input,
  evt,
  originalRescheduledBooking,
  routingFormResponseId,
  reroutingFormResponses,
  rescheduledBy,
  creationSource,
  tracking,
}: CreateBookingParams & { rescheduledBy: string | undefined }) => {
  updateEventDetails(evt, originalRescheduledBooking);
  const associatedBookingForFormResponse = routingFormResponseId
    ? await getAssociatedBookingForFormResponse(routingFormResponseId)
    : null;

  const bookingAndAssociatedData = buildNewBookingData({
    uid,
    rescheduledBy,
    routingFormResponseId: shouldConnectBookingToFormResponse() ? routingFormResponseId : undefined,
    reroutingFormResponses,
    reqBody,
    eventType,
    input,
    evt,
    originalRescheduledBooking,
    creationSource,
    tracking,
  });

  return await saveBooking(
    bookingAndAssociatedData,
    originalRescheduledBooking,
    eventType.paymentAppData,
    eventType.organizerUser
  );

  function shouldConnectBookingToFormResponse() {
    const isRerouting = !!reroutingFormResponses;

    // During rerouting, we want to connect the new booking to the existing form response for booking being rescheduled(original booking)
    if (isRerouting) {
      return true;
    }
    // If not rerouting and there is already an associated booking for the form response, we don't want to connect the new booking to the form response
    // We allow only the first booking to be connected to the form response
    // Other bookings could happen due to user doing a booking by using browser back button to reach the same booking form with same query params and changing the time
    // Such case isn't what the Routing Form redirected the user to, so we avoid this at the moment.
    if (associatedBookingForFormResponse) {
      return false;
    }
    return true;
  }
};

export const createBooking = withReporting(_createBooking, "createBooking");

async function saveBooking(
  bookingAndAssociatedData: ReturnType<typeof buildNewBookingData>,
  originalRescheduledBooking: OriginalRescheduledBooking,
  paymentAppData: PaymentAppData,
  organizerUser: CreateBookingParams["eventType"]["organizerUser"]
) {
  const {
    newBookingData,
    reroutingFormResponseUpdateData,
    originalBookingUpdateDataForCancellation,
    singleOccurrenceUpdateData,
  } = bookingAndAssociatedData;

  //  Handle single occurrence reschedule for pattern-based recurring bookings
  if (singleOccurrenceUpdateData) {
    return prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: singleOccurrenceUpdateData.where,
        data: singleOccurrenceUpdateData.data,
        include: {
          user: {
            select: { email: true, name: true, timeZone: true, username: true },
          },
          attendees: true,
          payment: true,
          references: true,
        },
      });

      if (reroutingFormResponseUpdateData) {
        await tx.app_RoutingForms_FormResponse.update(reroutingFormResponseUpdateData);
      }

      return booking;
    });
  }

  const createBookingObj = {
    include: {
      user: {
        select: { email: true, name: true, timeZone: true, username: true },
      },
      attendees: true,
      payment: true,
      references: true,
    },
    data: newBookingData,
  };

  if (originalRescheduledBooking?.paid && originalRescheduledBooking?.payment) {
    const bookingPayment = originalRescheduledBooking.payment.find((payment) => payment.success);
    if (bookingPayment) {
      createBookingObj.data.payment = { connect: { id: bookingPayment.id } };
    }
  }

  if (typeof paymentAppData.price === "number" && paymentAppData.price > 0) {
    await prisma.credential.findFirstOrThrow({
      where: {
        appId: paymentAppData.appId,
        ...(paymentAppData.credentialId ? { id: paymentAppData.credentialId } : { userId: organizerUser.id }),
      },
      select: { id: true },
    });
  }

  /**
   * Reschedule(Cancellation + Creation) with an update of reroutingFormResponse should be atomic
   */
  return prisma.$transaction(async (tx) => {
    if (originalBookingUpdateDataForCancellation) {
      await tx.booking.update(originalBookingUpdateDataForCancellation);
    }

    const booking = await tx.booking.create(createBookingObj);
    if (reroutingFormResponseUpdateData) {
      await tx.app_RoutingForms_FormResponse.update(reroutingFormResponseUpdateData);
    }

    return booking;
  });
}

function getEventTypeRel(eventTypeId: EventTypeId) {
  return eventTypeId ? { connect: { id: eventTypeId } } : {};
}

function getAttendeesData(evt: Pick<CalendarEvent, "attendees" | "team">) {
  //if attendee is team member, it should fetch their locale not booker's locale
  //perhaps make email fetch request to see if his locale is stored, else
  const teamMembers = evt?.team?.members ?? [];

  return evt.attendees.concat(teamMembers).map((attendee) => ({
    name: attendee.name,
    email: attendee.email,
    timeZone: attendee.timeZone,
    locale: attendee.language.locale,
    phoneNumber: attendee.phoneNumber,
  }));
}

function buildNewBookingData(params: CreateBookingParams) {
  const {
    uid,
    evt,
    reqBody,
    eventType,
    input,
    originalRescheduledBooking,
    routingFormResponseId,
    reroutingFormResponses,
    rescheduledBy,
    creationSource,
    tracking,
  } = params;

  //  Check if this is a single occurrence reschedule for pattern-based recurring booking
  const isSingleOccurrenceReschedule = originalRescheduledBooking && reqBody.metadata?.originalOccurrenceDate;

  if (isSingleOccurrenceReschedule) {
    //  For single occurrence reschedule, update the existing booking's metadata
    // This adds the old date to EXDATE and new date to RDATE
    return {
      newBookingData: null as any, // Not creating a new booking
      reroutingFormResponseUpdateData: getReroutingFormResponseUpdateData({
        reroutingFormResponses,
        routingFormResponseId,
      }),
      originalBookingUpdateDataForCancellation: null, // Don't cancel the master booking
      singleOccurrenceUpdateData: {
        where: { id: originalRescheduledBooking.id },
        data: {
          // Keep original startTime/endTime (master booking times)
          // The pattern in metadata determines actual occurrence times

          // Update metadata while preserving recurrence pattern
          metadata: {
            ...(typeof originalRescheduledBooking.metadata === "object" &&
              originalRescheduledBooking.metadata),
            // Filter out originalOccurrenceDate - it's only for processing
            ...Object.fromEntries(
              Object.entries(reqBody.metadata || {}).filter(([key]) => key !== "originalOccurrenceDate")
            ),
          },

          // Update other booking details
          location: evt.location,
          title: evt.title,
          description: evt.additionalNotes || originalRescheduledBooking.description,
          cancellationReason: input.rescheduleReason,
          fromReschedule: originalRescheduledBooking.uid,
          rescheduled: true,

          // Optional updates
          ...(evt.customInputs !== undefined && {
            customInputs: isPrismaObjOrUndefined(evt.customInputs),
          }),

          ...(input.responses !== null &&
            input.responses !== undefined && {
              responses: input.responses === null ? Prisma.JsonNull : input.responses,
            }),

          ...(input.smsReminderNumber !== undefined && {
            smsReminderNumber: input.smsReminderNumber,
          }),

          ...(rescheduledBy && { rescheduledBy: rescheduledBy }),

          // Keep status or update based on confirmation setting
          status: eventType.isConfirmedByDefault
            ? BookingStatus.ACCEPTED
            : originalRescheduledBooking.status === BookingStatus.ACCEPTED
            ? BookingStatus.ACCEPTED
            : BookingStatus.PENDING,
        } satisfies Prisma.BookingUpdateInput,
      },
    };
  }

  // ⭐ Standard booking creation (non-recurring or master recurring booking)
  const attendeesData = getAttendeesData(evt);
  const eventTypeRel = getEventTypeRel(eventType.id);
  const reroutingFormResponseUpdateData = getReroutingFormResponseUpdateData({
    reroutingFormResponses,
    routingFormResponseId,
  });

  const newBookingData: Prisma.BookingCreateInput = {
    uid,
    userPrimaryEmail: evt.organizer.email,
    responses: input.responses === null || evt.seatsPerTimeSlot ? Prisma.JsonNull : input.responses,
    title: evt.title,
    startTime: dayjs.utc(evt.startTime).toDate(),
    endTime: dayjs.utc(evt.endTime).toDate(),
    description: evt.seatsPerTimeSlot ? null : evt.additionalNotes,
    customInputs: isPrismaObjOrUndefined(evt.customInputs),
    status: eventType.isConfirmedByDefault ? BookingStatus.ACCEPTED : BookingStatus.PENDING,
    oneTimePassword: evt.oneTimePassword,
    location: evt.location,
    eventType: eventTypeRel,
    smsReminderNumber: input.smsReminderNumber,

    // Metadata includes recurrence pattern for pattern-based recurring bookings
    metadata: reqBody.metadata,

    attendees: {
      createMany: {
        data: attendeesData,
      },
    },
    dynamicEventSlugRef: !eventType.id ? eventType.slug : null,
    dynamicGroupSlugRef: !eventType.id ? (reqBody.user as string).toLowerCase() : null,
    iCalUID: evt.iCalUID ?? "",
    user: {
      connect: {
        id: eventType.organizerUser.id,
      },
    },
    destinationCalendar:
      evt.destinationCalendar && evt.destinationCalendar.length > 0
        ? {
            connect: { id: evt.destinationCalendar[0].id },
          }
        : undefined,

    routedFromRoutingFormReponse: routingFormResponseId
      ? { connect: { id: routingFormResponseId } }
      : undefined,
    creationSource,
    tracking: tracking ? { create: tracking } : undefined,
  };

  //  REMOVED: No more recurringEventId support
  // if (reqBody.recurringEventId) {
  //   newBookingData.recurringEventId = reqBody.recurringEventId;
  // }
  //  Pattern-based recurring bookings use metadata.recurrencePattern instead

  let originalBookingUpdateDataForCancellation: Prisma.BookingUpdateArgs | undefined = undefined;

  if (originalRescheduledBooking) {
    // Merge metadata from original booking
    newBookingData.metadata = {
      ...(typeof originalRescheduledBooking.metadata === "object" && originalRescheduledBooking.metadata),
      ...reqBody.metadata,
    };

    newBookingData.paid = originalRescheduledBooking.paid;
    newBookingData.fromReschedule = originalRescheduledBooking.uid;

    if (originalRescheduledBooking.uid) {
      newBookingData.cancellationReason = input.rescheduleReason;
    }

    // Reschedule logic with booking with seats
    if (
      newBookingData.attendees?.createMany?.data &&
      eventType?.eventTypeData?.seatsPerTimeSlot &&
      input.bookerEmail
    ) {
      newBookingData.attendees.createMany.data = attendeesData.filter(
        (attendee) => attendee.email === input.bookerEmail
      );
    }

    //  REMOVED: No more recurringEventId inheritance
    // if (originalRescheduledBooking.recurringEventId) {
    //   newBookingData.recurringEventId = originalRescheduledBooking.recurringEventId;
    // }

    // Cancel original booking when rescheduling entire booking (not single occurrence)
    if (!evt.seatsPerTimeSlot && originalRescheduledBooking?.uid) {
      originalBookingUpdateDataForCancellation = {
        where: {
          id: originalRescheduledBooking.id,
        },
        data: {
          rescheduled: true,
          status: BookingStatus.CANCELLED,
          rescheduledBy: rescheduledBy,
        },
      };
    }
  }

  return {
    newBookingData,
    reroutingFormResponseUpdateData,
    originalBookingUpdateDataForCancellation,
    singleOccurrenceUpdateData: null,
  };

  function getReroutingFormResponseUpdateData({
    reroutingFormResponses,
    routingFormResponseId,
  }: {
    reroutingFormResponses: z.infer<typeof routingFormResponseInDbSchema> | null;
    routingFormResponseId: number | undefined | null;
  }) {
    if (!routingFormResponseId) {
      return null;
    }

    if (!reroutingFormResponses) {
      return null;
    }

    return {
      where: { id: routingFormResponseId },
      data: {
        response: reroutingFormResponses,
      },
    };
  }
}

export type Booking = Prisma.PromiseReturnType<typeof createBooking>;
