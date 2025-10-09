import type { AppMeta } from "@calcom/types/App";

import _package from "./package.json";

export const metadata = {
  name: "Lark Calendar",
  description: _package.description,
  installed: true,
  type: "lark_calendar",
  title: "Lark Calendar",
  variant: "calendar",
  categories: ["calendar"],
  logo: "icon.svg",
  publisher: "Cal ID",
  slug: "lark-calendar",
  url: "https://cal.id",
  email: "support@cal.id",
  dirName: "larkcalendar",
  isOAuth: true,
} as AppMeta;

export default metadata;
