import prismock from "../../../../../tests/libs/__mocks__/prisma";

import { dispatcher, JobName } from "@calid/job-dispatcher";
import { QueueName } from "@calid/queue";
import { describe, expect, beforeEach, vi } from "vitest";

import dayjs from "@calcom/dayjs";
import { test } from "@calcom/web/test/fixtures/fixtures";

import { handleWebhookScheduledTriggers } from "../handleWebhookScheduledTriggers";

describe("Cron job handler", () => {
  beforeEach(async () => {
    await prismock.webhookScheduledTriggers.deleteMany();
    vi.spyOn(dispatcher, "dispatch").mockResolvedValue(undefined as never);
  });
  test(`should delete old webhook scheduled triggers`, async () => {
    const now = dayjs();
    await prismock.webhookScheduledTriggers.createMany({
      data: [
        {
          id: 1,
          subscriberUrl: "https://example.com",
          startAfter: now.subtract(2, "day").toDate(),
          payload: "",
        },
        {
          id: 1,
          subscriberUrl: "https://example.com",
          startAfter: now.subtract(1, "day").subtract(1, "hour").toDate(),
          payload: "",
        },
        {
          id: 2,
          subscriberUrl: "https://example.com",
          startAfter: now.add(1, "day").toDate(),
          payload: "",
        },
      ],
    });

    await handleWebhookScheduledTriggers(prismock);

    const scheduledTriggers = await prismock.webhookScheduledTriggers.findMany();
    expect(scheduledTriggers.length).toBe(1);
    expect(scheduledTriggers[0].startAfter).toStrictEqual(now.add(1, "day").toDate());
  });
  test(`should trigger if current date is after startAfter`, async () => {
    const now = dayjs();
    const payload = `{"triggerEvent":"MEETING_ENDED"}`;
    await prismock.webhookScheduledTriggers.createMany({
      data: [
        {
          id: 1,
          subscriberUrl: "https://example.com",
          startAfter: now.add(5, "minute").toDate(),
          payload,
        },
        {
          id: 2,
          subscriberUrl: "https://example.com/test",
          startAfter: now.subtract(5, "minute").toDate(),
          payload,
        },
      ],
    });
    const result = await handleWebhookScheduledTriggers(prismock);

    expect(result).toEqual({ scheduledJobs: 2, failedJobs: 0 });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: QueueName.SCHEDULED,
        name: JobName.WEBHOOK_SCHEDULED_TRIGGER,
        data: { id: 1 },
      })
    );
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: QueueName.SCHEDULED,
        name: JobName.WEBHOOK_SCHEDULED_TRIGGER,
        data: { id: 2 },
      })
    );

    const triggers = await prismock.webhookScheduledTriggers.findMany({ orderBy: { id: "asc" } });
    expect(triggers.map((t) => ({ id: t.id, scheduled: t.scheduled }))).toEqual([
      { id: 1, scheduled: true },
      { id: 2, scheduled: true },
    ]);
  });
});
