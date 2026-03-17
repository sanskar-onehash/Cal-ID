import type { RouterInputs, RouterOutputs } from "@calcom/trpc/react";

export type ContactSortKey = "name" | "email" | "createdAt" | "updatedAt";

export type ContactSortDirection = "asc" | "desc";

export type MeetingStatus = "upcoming" | "completed" | "cancelled";

export interface Contact {
  id: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  avatar: string;
  createdAt: Date;
  updatedAt: Date;
  lastMeeting: Date | null;
}

export type ContactRow = RouterOutputs["viewer"]["calIdContacts"]["list"]["rows"][number];

export type ContactCreateInput = RouterInputs["viewer"]["calIdContacts"]["create"];

export type ContactUpdateInput = RouterInputs["viewer"]["calIdContacts"]["update"];

export type ContactListInput = RouterInputs["viewer"]["calIdContacts"]["list"];

export type ContactMeetingsByContactIdInput =
  RouterInputs["viewer"]["calIdContacts"]["getMeetingsByContactId"];

export interface ContactDraft {
  id?: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
}

export interface ContactsListMeta {
  totalRowCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ContactMeeting {
  id: number;
  contactId: number;
  title: string;
  date: Date;
  duration: number;
  status: MeetingStatus;
  notes?: string;
  meetingLink?: string;
}

export type ContactMeetingRow =
  RouterOutputs["viewer"]["calIdContacts"]["getMeetingsByContactId"]["rows"][number];

export interface ContactShareOption {
  id: string;
  label: string;
  description: string;
}
