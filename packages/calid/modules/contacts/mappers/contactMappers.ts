import type { Contact, ContactCreateInput, ContactDraft, ContactRow, ContactUpdateInput } from "../types";
import { getContactInitials } from "../utils/contactUtils";

const parseDate = (value: Date | string) => {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
};

export const mapContactRowToContact = (row: ContactRow): Contact => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  notes: row.notes,
  avatar: getContactInitials(row.name),
  createdAt: parseDate(row.createdAt),
  updatedAt: parseDate(row.updatedAt),
  lastMeeting: null,
});

export const mapContactDraftToCreateInput = (draft: ContactDraft): ContactCreateInput => ({
  name: draft.name.trim(),
  email: draft.email.trim(),
  phone: draft.phone.trim(),
  notes: draft.notes.trim(),
});

export const mapContactDraftToUpdateInput = (draft: ContactDraft): ContactUpdateInput => ({
  id: (() => {
    if (draft.id === undefined) {
      throw new Error("Missing contact id for update");
    }

    return draft.id;
  })(),
  name: draft.name.trim(),
  email: draft.email.trim(),
  phone: draft.phone.trim(),
  notes: draft.notes.trim(),
});
