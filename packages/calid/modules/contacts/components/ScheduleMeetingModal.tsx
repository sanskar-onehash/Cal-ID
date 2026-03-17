"use client";

import { cn } from "@calid/features/lib/cn";
import { Button } from "@calid/features/ui/components/button";
import { Calendar } from "@calid/features/ui/components/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@calid/features/ui/components/dialog";
import { Input } from "@calid/features/ui/components/input/input";
import { Label } from "@calid/features/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@calid/features/ui/components/popover";
import { triggerToast } from "@calid/features/ui/components/toast";
import { useMutation } from "@tanstack/react-query";
import { addMinutes, format, isBefore, parseISO, startOfDay } from "date-fns";
import { ArrowLeft, ArrowRight, CalendarIcon, Check, Clock, Loader2, Users, Video } from "lucide-react";
import { useMemo, useState } from "react";

import { isAttendeeInputRequired } from "@calcom/app-store/locations";
import { SystemField } from "@calcom/features/bookings/lib/SystemField";
import { createBooking } from "@calcom/features/bookings/lib/create-booking";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";

import type { Contact } from "../types";
import { MeetingStepIndicator } from "./MeetingStepIndicator";

interface ScheduleMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
}

export const ScheduleMeetingModal = ({ open, onOpenChange, contact }: ScheduleMeetingModalProps) => {
  const { i18n } = useLocale();
  const utils = trpc.useUtils();

  const [step, setStep] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlotTime, setSelectedSlotTime] = useState<string | null>(null);
  const [additionalGuests, setAdditionalGuests] = useState("");
  const [bookingErrorMessage, setBookingErrorMessage] = useState<string | null>(null);

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

  const selectedDateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsInput = selectedDate
    ? {
        eventTypeId: selectedEventId ?? 0,
        startTime: startOfDay(selectedDate).toISOString(),
        endTime: addMinutes(startOfDay(selectedDate), 24 * 60 - 1).toISOString(),
        timeZone: userTimeZone,
      }
    : {
        eventTypeId: selectedEventId ?? 0,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        timeZone: userTimeZone,
      };

  const slotsQuery = trpc.viewer.slots.getSchedule.useQuery(slotsInput, {
    enabled: open && selectedEventId !== null && Boolean(selectedDate),
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

  const selectedEventInfo = useMemo(
    () => eventTypesQuery.data?.find((eventType) => eventType.id === selectedEventId) ?? null,
    [eventTypesQuery.data, selectedEventId]
  );

  const selectedEventDetail = selectedEventQuery.data?.eventType;

  const unsupportedReason = useMemo(() => {
    if (!selectedEventDetail || !contact) {
      return null;
    }

    if (selectedEventDetail.price > 0) {
      return "Paid event types are not supported in Contacts scheduling yet.";
    }

    const supportedRequiredFieldNames = new Set([
      SystemField.Enum.name,
      SystemField.Enum.email,
      SystemField.Enum.guests,
      SystemField.Enum.notes,
      SystemField.Enum.location,
      SystemField.Enum.attendeePhoneNumber,
    ]);

    const unsupportedRequiredField = selectedEventDetail.bookingFields.find(
      (field) => field.required && !field.hidden && !supportedRequiredFieldNames.has(field.name)
    );

    if (unsupportedRequiredField) {
      return "This event type has required booking fields that are not supported in Contacts scheduling yet.";
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

    const attendeePhoneField = selectedEventDetail.bookingFields.find(
      (field) => field.name === SystemField.Enum.attendeePhoneNumber && field.required && !field.hidden
    );
    if (attendeePhoneField && !contact.phone.trim()) {
      return "This event type requires attendee phone, but this contact has no phone number.";
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
      setStep(1);
      setSelectedEventId(null);
      setSelectedDate(undefined);
      setSelectedSlotTime(null);
      setAdditionalGuests("");
      setBookingErrorMessage(null);
      createBookingMutation.reset();
    }

    onOpenChange(nextOpen);
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
      return;
    }

    const selectedStart = parseISO(selectedSlotTime);
    if (Number.isNaN(selectedStart.getTime())) {
      setBookingErrorMessage("The selected time slot is invalid. Please choose another slot.");
      return;
    }

    const duration = selectedEventDetail?.length ?? selectedEventInfo.length;
    const responses: Record<string, unknown> = {
      name: contact.name,
      email: contact.email,
      ...(guestEmails.length > 0 ? { guests: guestEmails } : {}),
    };

    if (contact.phone.trim()) {
      responses[SystemField.Enum.attendeePhoneNumber] = contact.phone.trim();
    }

    const locationField = selectedEventDetail?.bookingFields.find(
      (field) => field.name === SystemField.Enum.location && !field.hidden
    );
    const primaryLocation = selectedEventDetail?.locations.at(0);
    if (locationField && primaryLocation) {
      const attendeeInputType = isAttendeeInputRequired(primaryLocation.type);
      responses[SystemField.Enum.location] = {
        value: primaryLocation.type,
        optionValue: attendeeInputType === "phone" ? contact.phone.trim() : "",
      };
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
          "HH:mm"
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

        <MeetingStepIndicator step={step} />

        {step === 1 ? (
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
                      setSelectedSlotTime(null);
                      setBookingErrorMessage(null);
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
                onClick={() => setStep(2)}>
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
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

            {selectedDate ? (
              <div className="space-y-1.5">
                <Label>Select Time</Label>
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
                        {format(parseISO(slot.time), "HH:mm")}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-between pt-2">
              <Button color="secondary" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button disabled={!selectedDate || !selectedSlotTime} onClick={() => setStep(3)}>
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
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
            <div className="flex justify-between pt-2">
              <Button color="secondary" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button onClick={() => setStep(4)}>
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
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
                    {selectedSlotTime ? format(parseISO(selectedSlotTime), "HH:mm") : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium">
                    {selectedEventDetail?.length ?? selectedEventInfo?.length ?? 0} min
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
              <Button color="secondary" onClick={() => setStep(3)}>
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
