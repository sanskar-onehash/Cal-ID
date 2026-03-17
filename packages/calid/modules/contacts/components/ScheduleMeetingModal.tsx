"use client";

import { cn } from "@calid/features/lib/cn";
import { Button } from "@calid/features/ui/components/button";
import { Calendar } from "@calid/features/ui/components/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@calid/features/ui/components/dialog";
import { Input } from "@calid/features/ui/components/input/input";
import { Label } from "@calid/features/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@calid/features/ui/components/popover";
import { triggerToast } from "@calid/features/ui/components/toast";
import { ToggleGroup } from "@calid/features/ui/components/toggle-group";
import { useMutation } from "@tanstack/react-query";
import { addMinutes, format, isBefore, parseISO, startOfDay } from "date-fns";
import { ArrowLeft, ArrowRight, CalendarIcon, Check, Clock, Loader2, Users, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { isAttendeeInputRequired } from "@calcom/app-store/locations";
import { BookingFields } from "@calcom/features/bookings/Booker/components/BookEventForm/BookingFields";
import { useTimePreferences } from "@calcom/features/bookings/lib";
import { SystemField } from "@calcom/features/bookings/lib/SystemField";
import { createBooking } from "@calcom/features/bookings/lib/create-booking";
import getBookingResponsesSchema from "@calcom/features/bookings/lib/getBookingResponsesSchema";
import { getPaymentAppData } from "@calcom/lib/getPaymentAppData";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { TimeFormat } from "@calcom/lib/timeFormat";
import { trpc } from "@calcom/trpc/react";

import type { Contact } from "../types";
import { MeetingStepIndicator } from "./MeetingStepIndicator";

interface ScheduleMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
}

type BookingFieldsFormValues = {
  responses: Record<string, unknown>;
};

const DEFAULT_STEPS = ["Event Type", "Date & Time", "Guests", "Confirm"];
const STEPS_WITH_BOOKING_FIELDS = ["Event Type", "Date & Time", "Booking Fields", "Guests", "Confirm"];

const HANDLED_BOOKING_FIELD_NAMES = new Set([
  SystemField.Enum.name,
  SystemField.Enum.email,
  SystemField.Enum.guests,
  SystemField.Enum.location,
]);

const getIssueFieldName = (message?: string) => {
  if (!message) {
    return null;
  }

  const match = message.match(/^\{([^}]+)\}/);
  return match?.[1] ?? null;
};

const isFieldVisibleInBookingView = (views?: { id: string }[]) => {
  if (!views || views.length === 0) {
    return true;
  }

  return views.some((view) => view.id === "booking");
};

const normalizeBookingResponses = (responses: Record<string, unknown>) => {
  return Object.entries(responses).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (typeof value === "string") {
      acc[key] = value.trim();
      return acc;
    }

    if (Array.isArray(value)) {
      acc[key] = value.map((item) => (typeof item === "string" ? item.trim() : item));
      return acc;
    }

    if (value && typeof value === "object") {
      const normalizedObject = Object.entries(value as Record<string, unknown>).reduce<
        Record<string, unknown>
      >((objectAcc, [objectKey, objectValue]) => {
        objectAcc[objectKey] = typeof objectValue === "string" ? objectValue.trim() : objectValue;
        return objectAcc;
      }, {});

      acc[key] = normalizedObject;
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});
};

export const ScheduleMeetingModal = ({ open, onOpenChange, contact }: ScheduleMeetingModalProps) => {
  const { i18n, t } = useLocale();
  const utils = trpc.useUtils();
  const timeFormat = useTimePreferences((state) => state.timeFormat);
  const setTimeFormat = useTimePreferences((state) => state.setTimeFormat);

  const [step, setStep] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedSlotTime, setSelectedSlotTime] = useState<string | null>(null);
  const [additionalGuests, setAdditionalGuests] = useState("");
  const [bookingErrorMessage, setBookingErrorMessage] = useState<string | null>(null);

  const bookingFieldsForm = useForm<BookingFieldsFormValues>({
    defaultValues: {
      responses: {},
    },
  });

  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const eventTypesQuery = trpc.viewer.eventTypes.list.useQuery(undefined, {
    enabled: open,
    refetchOnWindowFocus: false,
  });

  const selectedEventQuery = trpc.viewer.eventTypes.get.useQuery(
    {
      id: selectedEventId ?? 0,
    },
    {
      enabled: open && selectedEventId !== null,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const selectedEventInfo = useMemo(
    () => eventTypesQuery.data?.find((eventType) => eventType.id === selectedEventId) ?? null,
    [eventTypesQuery.data, selectedEventId]
  );

  const selectedEventDetail = selectedEventQuery.data?.eventType;

  const bookingFieldsStepSource = useMemo(() => {
    if (!selectedEventDetail) {
      return [];
    }

    return selectedEventDetail.bookingFields.filter((field) => {
      if (field.hidden) {
        return false;
      }

      if (field.name === SystemField.Enum.rescheduleReason) {
        return false;
      }

      if (!isFieldVisibleInBookingView(field.views)) {
        return false;
      }

      return !HANDLED_BOOKING_FIELD_NAMES.has(field.name);
    });
  }, [selectedEventDetail]);

  const bookingFieldsStepFields = useMemo(
    () => bookingFieldsStepSource.map((field) => ({ ...field, views: undefined })),
    [bookingFieldsStepSource]
  );

  const hasExtendedBookingFields = bookingFieldsStepSource.length > 0;

  const steps = hasExtendedBookingFields ? STEPS_WITH_BOOKING_FIELDS : DEFAULT_STEPS;
  const EVENT_TYPE_STEP = 1;
  const DATE_TIME_STEP = 2;
  const BOOKING_FIELDS_STEP = 3;
  const GUESTS_STEP = hasExtendedBookingFields ? 4 : 3;
  const CONFIRM_STEP = hasExtendedBookingFields ? 5 : 4;
  const BACK_FROM_GUESTS_STEP = hasExtendedBookingFields ? BOOKING_FIELDS_STEP : DATE_TIME_STEP;

  const defaultBookingFieldResponses = useMemo(() => {
    return bookingFieldsStepSource.reduce<Record<string, unknown>>((defaults, field) => {
      if (field.name === SystemField.Enum.attendeePhoneNumber && contact?.phone?.trim()) {
        defaults[field.name] = contact.phone.trim();
      }
      return defaults;
    }, {});
  }, [bookingFieldsStepSource, contact?.phone]);

  useEffect(() => {
    bookingFieldsForm.reset({
      responses: defaultBookingFieldResponses,
    });
  }, [bookingFieldsForm, defaultBookingFieldResponses]);

  const selectedDateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;

  const durationOptions = useMemo(() => {
    const fallbackDuration = selectedEventDetail?.length ?? selectedEventInfo?.length ?? null;
    const multipleDuration = selectedEventDetail?.metadata?.multipleDuration;

    const validMultipleDurations = Array.isArray(multipleDuration)
      ? multipleDuration.filter((duration): duration is number => Number.isFinite(duration) && duration > 0)
      : [];

    const uniqueDurations = Array.from(
      new Set([...(fallbackDuration ? [fallbackDuration] : []), ...validMultipleDurations])
    ).sort((first, second) => first - second);

    return uniqueDurations;
  }, [
    selectedEventDetail?.length,
    selectedEventDetail?.metadata?.multipleDuration,
    selectedEventInfo?.length,
  ]);

  useEffect(() => {
    if (durationOptions.length === 0) {
      setSelectedDuration(null);
      return;
    }

    if (!selectedDuration || !durationOptions.includes(selectedDuration)) {
      setSelectedDuration(durationOptions[0]);
      setSelectedSlotTime(null);
    }
  }, [durationOptions, selectedDuration]);

  const slotsInput = selectedDate
    ? {
        eventTypeId: selectedEventId ?? 0,
        startTime: startOfDay(selectedDate).toISOString(),
        endTime: addMinutes(startOfDay(selectedDate), 24 * 60 - 1).toISOString(),
        timeZone: userTimeZone,
        ...(selectedDuration ? { duration: `${selectedDuration}` } : {}),
      }
    : {
        eventTypeId: selectedEventId ?? 0,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        timeZone: userTimeZone,
        ...(selectedDuration ? { duration: `${selectedDuration}` } : {}),
      };

  const slotsQuery = trpc.viewer.slots.getSchedule.useQuery(slotsInput, {
    enabled: open && selectedEventId !== null && Boolean(selectedDate) && Boolean(selectedDuration),
    refetchOnWindowFocus: false,
  });

  const availableSlots = useMemo(() => {
    if (!selectedDateKey) {
      return [];
    }

    const slotsForDay = slotsQuery.data?.slots[selectedDateKey] ?? [];

    return slotsForDay
      .filter((slot) => !slot.away)
      .slice()
      .sort((first, second) => first.time.localeCompare(second.time));
  }, [selectedDateKey, slotsQuery.data?.slots]);

  const unsupportedReason = useMemo(() => {
    if (!selectedEventDetail || !contact) {
      return null;
    }

    const paymentAppData = getPaymentAppData(selectedEventDetail);
    const isPaidEventType =
      selectedEventDetail.price > 0 && !Number.isNaN(paymentAppData.price) && paymentAppData.price > 0;

    if (isPaidEventType) {
      return "Paid event types are not supported in Contacts scheduling yet.";
    }

    const locationField = selectedEventDetail.bookingFields.find(
      (field) => field.name === SystemField.Enum.location && field.required && !field.hidden
    );
    if (locationField) {
      const primaryLocation = selectedEventDetail.locations.at(0);

      if (!primaryLocation) {
        return "This event type requires a location, but no location is configured.";
      }

      const attendeeInputType = isAttendeeInputRequired(primaryLocation.type);

      if (attendeeInputType === "phone" && !contact.phone.trim()) {
        return "This event type requires attendee phone, but this contact has no phone number.";
      }

      if (attendeeInputType && attendeeInputType !== "phone") {
        return "This event type requires attendee-provided location details that are not supported in Contacts scheduling yet.";
      }
    }

    return null;
  }, [contact, selectedEventDetail]);

  const createBookingMutation = useMutation({
    mutationFn: createBooking,
    async onSuccess() {
      if (!contact) {
        return;
      }

      await Promise.all([
        utils.viewer.calIdContacts.list.invalidate(),
        utils.viewer.calIdContacts.getById.invalidate({ id: contact.id }),
        utils.viewer.calIdContacts.getMeetingsByContactId.invalidate({ contactId: contact.id }),
      ]);
    },
  });

  const resetAndClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep(EVENT_TYPE_STEP);
      setSelectedEventId(null);
      setSelectedDate(undefined);
      setSelectedDuration(null);
      setSelectedSlotTime(null);
      setAdditionalGuests("");
      setBookingErrorMessage(null);
      bookingFieldsForm.reset({ responses: {} });
      createBookingMutation.reset();
    }

    onOpenChange(nextOpen);
  };

  const validateBookingFields = async (responses: Record<string, unknown>) => {
    if (bookingFieldsStepSource.length === 0) {
      bookingFieldsForm.clearErrors("responses");
      return true;
    }
    if (!contact) {
      return false;
    }

    const normalizedResponses = normalizeBookingResponses(responses);

    const schema = getBookingResponsesSchema({
      bookingFields: bookingFieldsStepSource,
      view: "booking",
    });

    const responsesForValidation: Record<string, unknown> = {
      name: contact.name,
      email: contact.email,
      ...normalizedResponses,
    };

    const validation = await schema.safeParseAsync(responsesForValidation);
    bookingFieldsForm.clearErrors("responses");

    if (!validation.success) {
      const bookingFieldStepNames = new Set(bookingFieldsStepSource.map((field) => field.name));
      const relevantIssue =
        validation.error.issues.find((issue) => {
          const issueFieldName = getIssueFieldName(issue.message);
          return Boolean(issueFieldName && bookingFieldStepNames.has(issueFieldName));
        }) ?? null;

      if (!relevantIssue) {
        return true;
      }

      const issueMessage = relevantIssue.message ?? "error_required_field";
      bookingFieldsForm.setError("responses", {
        type: "manual",
        message: issueMessage,
      });
      return false;
    }

    return true;
  };

  const handleBookingFieldsNext = async () => {
    setBookingErrorMessage(null);
    const responses = normalizeBookingResponses(bookingFieldsForm.getValues("responses") ?? {});
    const isValid = await validateBookingFields(responses);
    if (!isValid) {
      setBookingErrorMessage("Please complete the required booking fields before continuing.");
      return;
    }

    setStep(GUESTS_STEP);
  };

  const handleConfirm = async () => {
    if (!contact || !selectedEventInfo || !selectedSlotTime) {
      return;
    }

    if (unsupportedReason) {
      setBookingErrorMessage(unsupportedReason);
      return;
    }

    setBookingErrorMessage(null);

    const guestEmails = additionalGuests
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
    const invalidGuestEmails = guestEmails.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

    if (invalidGuestEmails.length > 0) {
      setBookingErrorMessage("One or more additional guest emails are invalid.");
      setStep(GUESTS_STEP);
      return;
    }

    const selectedStart = parseISO(selectedSlotTime);
    if (Number.isNaN(selectedStart.getTime())) {
      setBookingErrorMessage("The selected time slot is invalid. Please choose another slot.");
      setStep(DATE_TIME_STEP);
      return;
    }

    const duration = selectedDuration ?? selectedEventDetail?.length ?? selectedEventInfo.length;
    const bookingFieldResponses = normalizeBookingResponses(bookingFieldsForm.getValues("responses") ?? {});

    let responses: Record<string, unknown> = {
      ...bookingFieldResponses,
      name: contact.name,
      email: contact.email,
      ...(guestEmails.length > 0 ? { guests: guestEmails } : {}),
    };

    const hasAttendeePhoneField = selectedEventDetail?.bookingFields.some(
      (field) => field.name === SystemField.Enum.attendeePhoneNumber
    );
    const attendeePhoneValue =
      typeof responses[SystemField.Enum.attendeePhoneNumber] === "string"
        ? responses[SystemField.Enum.attendeePhoneNumber]
        : "";
    if (hasAttendeePhoneField && !attendeePhoneValue && contact.phone.trim()) {
      responses[SystemField.Enum.attendeePhoneNumber] = contact.phone.trim();
    }

    const locationField = selectedEventDetail?.bookingFields.find(
      (field) => field.name === SystemField.Enum.location && !field.hidden
    );
    const primaryLocation = selectedEventDetail?.locations.at(0);
    if (locationField && primaryLocation) {
      const attendeeInputType = isAttendeeInputRequired(primaryLocation.type);
      const attendeePhoneValueForLocation =
        typeof responses[SystemField.Enum.attendeePhoneNumber] === "string"
          ? responses[SystemField.Enum.attendeePhoneNumber]
          : contact.phone.trim();
      responses[SystemField.Enum.location] = {
        value: primaryLocation.type,
        optionValue: attendeeInputType === "phone" ? attendeePhoneValueForLocation : "",
      };
    }

    if (selectedEventDetail) {
      const fullSchema = getBookingResponsesSchema({
        bookingFields: selectedEventDetail.bookingFields,
        view: "booking",
      });
      const parsedResponses = await fullSchema.safeParseAsync(normalizeBookingResponses(responses));

      if (!parsedResponses.success) {
        const issueMessage = parsedResponses.error.issues[0]?.message ?? "error_required_field";
        const issueFieldName = getIssueFieldName(issueMessage);
        if (issueFieldName && bookingFieldsStepSource.some((field) => field.name === issueFieldName)) {
          bookingFieldsForm.setError("responses", {
            type: "manual",
            message: issueMessage,
          });
          setStep(BOOKING_FIELDS_STEP);
        }

        setBookingErrorMessage("Please complete the required booking fields before confirming.");
        return;
      }

      responses = parsedResponses.data;
    }

    const username = selectedEventDetail?.users.at(0)?.username || undefined;

    try {
      await createBookingMutation.mutateAsync({
        eventTypeId: selectedEventInfo.id,
        eventTypeSlug: selectedEventInfo.slug,
        user: username ?? undefined,
        start: selectedStart.toISOString(),
        end: addMinutes(selectedStart, duration).toISOString(),
        timeZone: userTimeZone,
        language: i18n.language || "en",
        metadata: {},
        responses,
      });

      triggerToast(
        `Meeting with ${contact.name} confirmed for ${format(selectedStart, "PPP")} at ${format(
          selectedStart,
          timeFormat
        )}.`,
        "success"
      );

      resetAndClose(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not schedule meeting";
      setBookingErrorMessage(message);
      triggerToast(message, "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent size="md" enableOverflow className="max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Video className="h-4 w-4" />
            Schedule Meeting {contact ? `with ${contact.name}` : ""}
          </DialogTitle>
        </DialogHeader>

        <MeetingStepIndicator step={step} steps={steps} />

        {step === EVENT_TYPE_STEP ? (
          <div className="space-y-2 pt-2">
            <Label>Select Event Type</Label>
            {eventTypesQuery.isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading event types...
              </div>
            ) : null}
            {eventTypesQuery.isError ? (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <p>{eventTypesQuery.error.message || "Failed to load event types."}</p>
                <Button color="secondary" size="sm" onClick={() => eventTypesQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : null}
            {!eventTypesQuery.isLoading &&
            !eventTypesQuery.isError &&
            (eventTypesQuery.data?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground rounded-lg border px-3 py-2 text-sm">
                No event types available for scheduling.
              </p>
            ) : null}
            {!eventTypesQuery.isLoading && !eventTypesQuery.isError ? (
              <div className="space-y-2">
                {(eventTypesQuery.data ?? []).map((eventType) => (
                  <button
                    key={eventType.id}
                    onClick={() => {
                      setSelectedEventId(eventType.id);
                      setSelectedDate(undefined);
                      setSelectedDuration(null);
                      setSelectedSlotTime(null);
                      setAdditionalGuests("");
                      setBookingErrorMessage(null);
                      bookingFieldsForm.reset({ responses: {} });
                    }}
                    className={cn(
                      "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                      selectedEventId === eventType.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    )}>
                    <div className="text-sm font-medium">{eventType.title}</div>
                    <div className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Clock className="h-3 w-3" /> {eventType.length} min
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedEventId !== null && selectedEventQuery.isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking event type access...
              </div>
            ) : null}
            {selectedEventQuery.isError ? (
              <p className="text-xs text-red-600">
                {selectedEventQuery.error.message ||
                  "You do not have permission to schedule this event type."}
              </p>
            ) : null}
            {unsupportedReason ? <p className="text-xs text-red-600">{unsupportedReason}</p> : null}
            <div className="flex justify-end pt-2">
              <Button
                disabled={
                  selectedEventId === null ||
                  selectedEventQuery.isLoading ||
                  selectedEventQuery.isError ||
                  Boolean(unsupportedReason)
                }
                onClick={() => {
                  setBookingErrorMessage(null);
                  setStep(DATE_TIME_STEP);
                }}>
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === DATE_TIME_STEP ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Select Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    color="secondary"
                    className={cn(
                      "w-full justify-start text-left",
                      !selectedDate && "text-muted-foreground"
                    )}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="bg-default w-auto border p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(value) => {
                      setSelectedDate(value);
                      setSelectedSlotTime(null);
                    }}
                    disabled={(date) => isBefore(date, startOfDay(new Date()))}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {selectedDate && (
              <div className="space-y-1.5 pt-2">
                <Label>Duration</Label>
                {selectedEventQuery.isLoading ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading duration options...
                  </div>
                ) : null}
                {selectedEventQuery.isError ? (
                  <p className="text-xs text-red-600">
                    {selectedEventQuery.error.message || "Could not load duration options."}
                  </p>
                ) : null}
                {!selectedEventQuery.isLoading &&
                !selectedEventQuery.isError &&
                durationOptions.length > 0 ? (
                  <ToggleGroup
                    value={selectedDuration ? `${selectedDuration}` : ""}
                    onValueChange={(value) => {
                      const nextDuration = Number(value);
                      if (!value || Number.isNaN(nextDuration) || nextDuration === selectedDuration) {
                        return;
                      }
                      setSelectedDuration(nextDuration);
                      setSelectedSlotTime(null);
                    }}
                    options={durationOptions.map((duration) => ({
                      value: `${duration}`,
                      label: `${duration} min`,
                    }))}
                  />
                ) : null}
                {!selectedEventQuery.isLoading &&
                !selectedEventQuery.isError &&
                durationOptions.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No duration options available.</p>
                ) : null}
              </div>
            )}

            {selectedDate ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Select Time</Label>
                  <ToggleGroup
                    value={timeFormat}
                    onValueChange={(value) => {
                      if (value && value !== timeFormat) {
                        setTimeFormat(value as TimeFormat.TWELVE_HOUR | TimeFormat.TWENTY_FOUR_HOUR);
                      }
                    }}
                    options={[
                      { value: TimeFormat.TWELVE_HOUR, label: t("12_hour_short") || "12h" },
                      { value: TimeFormat.TWENTY_FOUR_HOUR, label: t("24_hour_short") || "24h" },
                    ]}
                  />
                </div>
                {slotsQuery.isLoading ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading available slots...
                  </div>
                ) : null}
                {slotsQuery.isError ? (
                  <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <p>{slotsQuery.error.message || "Failed to load time slots."}</p>
                    <Button color="secondary" size="sm" onClick={() => slotsQuery.refetch()}>
                      Retry
                    </Button>
                  </div>
                ) : null}
                {!slotsQuery.isLoading && !slotsQuery.isError && availableSlots.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border px-3 py-2 text-xs">
                    No available slots for this date.
                  </p>
                ) : null}
                {!slotsQuery.isLoading && !slotsQuery.isError && availableSlots.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot.time}
                        onClick={() => setSelectedSlotTime(slot.time)}
                        className={cn(
                          "rounded-md border px-3 py-2 text-xs transition-colors",
                          selectedSlotTime === slot.time
                            ? "border-primary bg-primary/5 text-primary font-medium"
                            : "border-border hover:bg-muted/50"
                        )}>
                        {format(parseISO(slot.time), timeFormat)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-between pt-2">
              <Button
                color="secondary"
                onClick={() => {
                  setBookingErrorMessage(null);
                  setStep(EVENT_TYPE_STEP);
                }}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button
                disabled={!selectedDate || !selectedDuration || !selectedSlotTime}
                onClick={() => {
                  setBookingErrorMessage(null);
                  setStep(hasExtendedBookingFields ? BOOKING_FIELDS_STEP : GUESTS_STEP);
                }}>
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {hasExtendedBookingFields && step === BOOKING_FIELDS_STEP ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Booking Fields</Label>
              <p className="text-muted-foreground text-xs">
                Fill in the event-specific booking details before continuing.
              </p>
            </div>

            {selectedEventQuery.isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading booking fields...
              </div>
            ) : null}

            {selectedEventQuery.isError ? (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <p>{selectedEventQuery.error.message || "Could not load booking fields."}</p>
                <Button color="secondary" size="sm" onClick={() => selectedEventQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : null}

            {!selectedEventQuery.isLoading && !selectedEventQuery.isError ? (
              <div className="max-h-[42vh] overflow-y-auto pr-1">
                <FormProvider {...bookingFieldsForm}>
                  <BookingFields
                    isDynamicGroupBooking={false}
                    fields={bookingFieldsStepFields}
                    locations={selectedEventDetail?.locations ?? []}
                    bookingData={null}
                  />
                </FormProvider>
              </div>
            ) : null}

            {bookingErrorMessage ? <p className="text-xs text-red-600">{bookingErrorMessage}</p> : null}

            <div className="flex justify-between pt-2">
              <Button
                color="secondary"
                onClick={() => {
                  setBookingErrorMessage(null);
                  setStep(DATE_TIME_STEP);
                }}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button
                disabled={selectedEventQuery.isLoading || selectedEventQuery.isError}
                onClick={handleBookingFieldsNext}>
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === GUESTS_STEP ? (
          <div className="space-y-4 pt-2">
            <div className="bg-muted/50 border-border rounded-lg border p-3">
              <div className="text-sm font-medium">{contact?.name}</div>
              <div className="text-muted-foreground text-xs">{contact?.email}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> Additional Guests
              </Label>
              <Input
                value={additionalGuests}
                onChange={(event) => setAdditionalGuests(event.target.value)}
                placeholder="guest1@email.com, guest2@email.com"
              />
              <p className="text-muted-foreground text-xs">Separate multiple emails with commas</p>
            </div>
            {bookingErrorMessage ? <p className="text-xs text-red-600">{bookingErrorMessage}</p> : null}
            <div className="flex justify-between pt-2">
              <Button
                color="secondary"
                onClick={() => {
                  setBookingErrorMessage(null);
                  setStep(BACK_FROM_GUESTS_STEP);
                }}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button
                onClick={() => {
                  setBookingErrorMessage(null);
                  setStep(CONFIRM_STEP);
                }}>
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === CONFIRM_STEP ? (
          <div className="space-y-4 pt-2">
            <div className="border-border space-y-3 rounded-lg border p-4">
              <h4 className="text-sm font-semibold">Booking Summary</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Event</span>
                  <span className="font-medium">{selectedEventInfo?.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">{selectedDate ? format(selectedDate, "PPP") : ""}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time</span>
                  <span className="font-medium">
                    {selectedSlotTime ? format(parseISO(selectedSlotTime), timeFormat) : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium">
                    {selectedDuration ?? selectedEventDetail?.length ?? 0} min
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contact</span>
                  <span className="font-medium">{contact?.name}</span>
                </div>
                {additionalGuests ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Guests</span>
                    <span className="text-right text-xs font-medium">{additionalGuests}</span>
                  </div>
                ) : null}
              </div>
            </div>
            {bookingErrorMessage ? <p className="text-xs text-red-600">{bookingErrorMessage}</p> : null}
            <div className="flex justify-between">
              <Button
                color="secondary"
                onClick={() => {
                  setBookingErrorMessage(null);
                  setStep(GUESTS_STEP);
                }}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button
                loading={createBookingMutation.isPending}
                disabled={createBookingMutation.isPending || Boolean(unsupportedReason)}
                onClick={handleConfirm}>
                <Check className="mr-1 h-3.5 w-3.5" /> Confirm Booking
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
