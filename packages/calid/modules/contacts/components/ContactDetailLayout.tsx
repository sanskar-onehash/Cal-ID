import { CalendarDays, Clock } from "lucide-react";

import type { Contact, ContactMeeting } from "../types";
import { ContactNotesCard } from "./ContactNotesCard";
import { ContactProfileCard } from "./ContactProfileCard";
import { MeetingsSection } from "./MeetingsSection";

interface ContactDetailLayoutProps {
  contact: Contact;
  isMobile: boolean;
  upcomingMeetings: ContactMeeting[];
  pastMeetings: ContactMeeting[];
  meetingsLoading: boolean;
  meetingsErrorMessage: string | null;
  notes: string;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => Promise<void> | void;
  notesHasChanges: boolean;
  notesSaveErrorMessage: string | null;
  isSavingNotes: boolean;
  onEditContact: () => void;
  onShareAvailability: () => void;
  onScheduleMeeting: () => void;
  onDeleteContact: () => Promise<void> | void;
  isDeletingContact: boolean;
  deleteErrorMessage: string | null;
}

export const ContactDetailLayout = ({
  contact,
  isMobile,
  upcomingMeetings,
  pastMeetings,
  meetingsLoading,
  meetingsErrorMessage,
  notes,
  onNotesChange,
  onSaveNotes,
  notesHasChanges,
  notesSaveErrorMessage,
  isSavingNotes,
  onEditContact,
  onShareAvailability,
  onScheduleMeeting,
  onDeleteContact,
  isDeletingContact,
  deleteErrorMessage,
}: ContactDetailLayoutProps) => {
  return (
    <div className={`grid gap-6 ${isMobile ? "grid-cols-1" : "grid-cols-3"}`}>
      <div className="space-y-6">
        <ContactProfileCard
          contact={contact}
          onEdit={onEditContact}
          onShare={onShareAvailability}
          onSchedule={onScheduleMeeting}
          onDelete={onDeleteContact}
          isDeleting={isDeletingContact}
          deleteErrorMessage={deleteErrorMessage}
        />

        <ContactNotesCard
          notes={notes}
          onNotesChange={onNotesChange}
          hasChanges={notesHasChanges}
          onSave={onSaveNotes}
          isSaving={isSavingNotes}
          saveErrorMessage={notesSaveErrorMessage}
        />
      </div>

      <div className={isMobile ? "space-y-6" : "col-span-2 grid gap-6 overflow-hidden"}>
        <MeetingsSection
          title={
            <>
              <CalendarDays className="h-4 w-4" /> Upcoming Meetings
            </>
          }
          meetings={upcomingMeetings}
          emptyLabel="No upcoming meetings found for this contact"
          countBadge
          isLoading={meetingsLoading}
          errorMessage={meetingsErrorMessage}
          className={isMobile ? undefined : "min-h-0 overflow-hidden"}
        />

        <MeetingsSection
          title={
            <>
              <Clock className="h-4 w-4" /> Meeting History
            </>
          }
          meetings={pastMeetings}
          emptyLabel="No meeting history found for this contact"
          isLoading={meetingsLoading}
          errorMessage={meetingsErrorMessage}
          className={isMobile ? undefined : "min-h-0 overflow-hidden"}
        />
      </div>
    </div>
  );
};
