import type { AppMeta } from "@calcom/types/App";

import _package from "./package.json";

export const metadata = {
  name: "Huddle01",
  description: _package.description,
  installed: true,
  type: "huddle01_video",
  variant: "conferencing",
  categories: ["video", "conferencing"],
  logo: "icon.svg",
  publisher: "Cal ID",
  url: "https://cal.id",
  category: "conferencing",
  slug: "huddle01",
  title: "Huddle01",
  isGlobal: false,
  email: "support@cal.id",
  appData: {
    location: {
      linkType: "dynamic",
      type: "integrations:huddle01_video",
      label: "Huddle01 Video",
    },
  },
  dirName: "huddle01video",
  concurrentMeetings: true,
  isOAuth: false,
} as AppMeta;

export default metadata;
