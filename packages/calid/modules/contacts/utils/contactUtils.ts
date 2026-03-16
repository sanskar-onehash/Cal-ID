import type { Contact } from "../types";

export const getContactInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const createAvailabilityShareLink = (contact: Contact) => {
  const slug = contact.name.trim().toLowerCase().replace(/\s+/g, "-");

  if (typeof window === "undefined") {
    return `https://cal.id/${slug}`;
  }

  return `${window.location.origin}/${slug}`;
};
