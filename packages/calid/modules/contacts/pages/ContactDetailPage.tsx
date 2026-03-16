"use client";

import { Button } from "@calid/features/ui/components/button";
import { triggerToast } from "@calid/features/ui/components/toast";
import { ArrowLeft, CalendarDays, Clock, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import useMediaQuery from "@calcom/lib/hooks/useMediaQuery";
import { trpc } from "@calcom/trpc/react";

import { AddEditContactModal } from "../components/AddEditContactModal";
import { ContactNotesCard } from "../components/ContactNotesCard";
import { ContactProfileCard } from "../components/ContactProfileCard";
import { MeetingsSection } from "../components/MeetingsSection";
import { ScheduleMeetingModal } from "../components/ScheduleMeetingModal";
import { ShareAvailabilityModal } from "../components/ShareAvailabilityModal";
import { mapContactDraftToUpdateInput, mapContactRowToContact } from "../mappers/contactMappers";
import { mockMeetings } from "../mock-data/contactsMockData";
import type { ContactDraft } from "../types";

interface ContactDetailPageProps {
  contactId: string;
}

const ContactDetailPage = ({ contactId }: ContactDetailPageProps) => {
  const router = useRouter();
  const utils = trpc.useUtils();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const numericContactId = Number(contactId);
  const hasValidContactId = Number.isInteger(numericContactId) && numericContactId > 0;

  const contactQuery = trpc.viewer.calIdContacts.getById.useQuery(
    { id: numericContactId },
    {
      enabled: hasValidContactId,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const contact = useMemo(
    () => (contactQuery.data ? mapContactRowToContact(contactQuery.data) : null),
    [contactQuery.data]
  );

  const meetings = useMemo(
    () =>
      mockMeetings
        .filter((meeting) => meeting.contactId === numericContactId)
        .sort((first, second) => second.date.getTime() - first.date.getTime()),
    [numericContactId]
  );

  const upcomingMeetings = meetings.filter((meeting) => meeting.status === "upcoming");
  const pastMeetings = meetings.filter((meeting) => meeting.status !== "upcoming");

  const [notes, setNotes] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editErrorMessage, setEditErrorMessage] = useState<string | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [notesErrorMessage, setNotesErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setNotes(contact?.notes ?? "");
  }, [contact?.id, contact?.notes]);

  const updateContactMutation = trpc.viewer.calIdContacts.update.useMutation({
    async onSuccess(updatedContact) {
      await Promise.all([
        utils.viewer.calIdContacts.list.invalidate(),
        utils.viewer.calIdContacts.getById.invalidate({ id: updatedContact.id }),
      ]);
    },
  });

  const deleteContactMutation = trpc.viewer.calIdContacts.delete.useMutation({
    async onSuccess() {
      await utils.viewer.calIdContacts.list.invalidate();
      triggerToast("Contact deleted", "success");
      router.push("/contacts");
    },
  });

  if (!hasValidContactId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h3 className="mb-1 text-lg font-semibold">Invalid contact</h3>
        <p className="text-muted-foreground mb-4 text-sm">The contact ID is invalid.</p>
        <Button color="secondary" onClick={() => router.push("/contacts")}>
          <ArrowLeft className="h-4 w-4" /> Back to Contacts
        </Button>
      </div>
    );
  }

  if (contactQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (contactQuery.error?.data?.code === "NOT_FOUND") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h3 className="mb-1 text-lg font-semibold">Contact not found</h3>
        <p className="text-muted-foreground mb-4 text-sm">This contact may have been removed.</p>
        <Button color="secondary" onClick={() => router.push("/contacts")}>
          <ArrowLeft className="h-4 w-4" /> Back to Contacts
        </Button>
      </div>
    );
  }

  if (contactQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h3 className="mb-1 text-lg font-semibold">Failed to load contact</h3>
        <p className="text-muted-foreground mb-4 text-sm">
          {contactQuery.error.message || "Please try again in a moment."}
        </p>
        <Button color="secondary" onClick={() => contactQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!contact) {
    return null;
  }

  const handleDelete = async () => {
    setDeleteErrorMessage(null);

    try {
      await deleteContactMutation.mutateAsync({ id: contact.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete contact";
      setDeleteErrorMessage(message);
      triggerToast(message, "error");
    }
  };

  const handleSaveContact = async (draft: ContactDraft) => {
    setEditErrorMessage(null);

    try {
      await updateContactMutation.mutateAsync(mapContactDraftToUpdateInput(draft));
      triggerToast("Contact updated", "success");
      setEditOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update contact";
      setEditErrorMessage(message);
      triggerToast(message, "error");
    }
  };

  const handleSaveNotes = async () => {
    setNotesErrorMessage(null);

    try {
      await updateContactMutation.mutateAsync({
        id: contact.id,
        notes,
      });
      triggerToast("Notes saved", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save notes";
      setNotesErrorMessage(message);
      triggerToast(message, "error");
    }
  };

  return (
    <div className="space-y-6">
      <Button
        color="minimal"
        size="sm"
        onClick={() => router.push("/contacts")}
        className="text-muted-foreground -ml-2">
        <ArrowLeft className="h-4 w-4" /> Contacts
      </Button>

      <div className={`grid gap-6 ${isMobile ? "grid-cols-1" : "grid-cols-3"}`}>
        <div className="space-y-6">
          <ContactProfileCard
            contact={contact}
            onEdit={() => setEditOpen(true)}
            onShare={() => setShareOpen(true)}
            onSchedule={() => setScheduleOpen(true)}
            onDelete={handleDelete}
            isDeleting={deleteContactMutation.isPending}
            deleteErrorMessage={deleteErrorMessage}
          />

          <ContactNotesCard
            notes={notes}
            onNotesChange={(value) => {
              setNotes(value);
              setNotesErrorMessage(null);
            }}
            hasChanges={notes !== contact.notes}
            onSave={handleSaveNotes}
            isSaving={updateContactMutation.isPending}
            saveErrorMessage={notesErrorMessage}
          />
        </div>

        <div className={`space-y-6 ${isMobile ? "" : "col-span-2"}`}>
          <MeetingsSection
            title={
              <>
                <CalendarDays className="h-4 w-4" /> Upcoming Meetings
              </>
            }
            meetings={upcomingMeetings}
            emptyLabel="No upcoming meetings"
            countBadge
          />

          <MeetingsSection
            title={
              <>
                <Clock className="h-4 w-4" /> Meeting History
              </>
            }
            meetings={pastMeetings}
            emptyLabel="No past meetings"
          />
        </div>
      </div>

      <AddEditContactModal
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditErrorMessage(null);
          }
        }}
        contact={contact}
        onSave={handleSaveContact}
        isSubmitting={updateContactMutation.isPending}
        errorMessage={editErrorMessage}
      />
      <ShareAvailabilityModal open={shareOpen} onOpenChange={setShareOpen} contact={contact} />
      <ScheduleMeetingModal open={scheduleOpen} onOpenChange={setScheduleOpen} contact={contact} />
    </div>
  );
};

export default ContactDetailPage;
