import { beforeEach, vi } from "vitest";
import { mockReset, mockDeep } from "vitest-mock-extended";

import type * as appStore from "@calcom/app-store";

vi.mock("@calcom/app-store", () => appStoreMock);

beforeEach(() => {
  mockReset(appStoreMock);
  appStoreMock.default.jitsivideo.mockResolvedValue({
    lib: {
      VideoApiAdapter: () => ({
        createMeeting: async () => ({
          type: "jitsi_video",
          id: "MOCK_JITSI_ID",
          password: "MOCK_JITSI_PASSWORD",
          url: "https://meet.jit.si/mock-jitsi-room",
        }),
      }),
    },
  } as any);
  appStoreMock.default.dailyvideo.mockResolvedValue({
    lib: {
      VideoApiAdapter: () => ({
        createMeeting: async () => ({
          type: "daily_video",
          id: "MOCK_DAILY_ID",
          password: "MOCK_DAILY_PASSWORD",
          url: "https://daily.co/mock-daily-room",
        }),
      }),
    },
  } as any);
});

const appStoreMock = mockDeep<typeof appStore>({
  fallbackMockImplementation: () => {
    throw new Error(
      "Unimplemented appStoreMock. You seem to have not mocked the app that you are trying to use"
    );
  },
});
export default appStoreMock;
