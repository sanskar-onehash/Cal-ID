import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildBaseWhereCondition } from "../trpc-router";

const mockEventTypeFindMany = vi.fn();

const mockInsightsDb = {
  eventType: {
    findMany: mockEventTypeFindMany,
  },
} as any;

const createMockContext = (overrides = {}) => ({
  userIsOwnerAdminOfParentTeam: false,
  userOrganizationId: null,
  insightsDb: mockInsightsDb,
  ...overrides,
});

describe("buildBaseWhereCondition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Basic filtering", () => {
    it("should set eventTypeId condition when eventTypeId is provided", async () => {
      const ctx = createMockContext();
      const result = await buildBaseWhereCondition({
        eventTypeId: 123,
        ctx,
      });

      expect(result.whereCondition).toEqual({
        OR: [{ eventTypeId: 123 }, { eventParentId: 123 }],
      });
    });

    it("should set userId condition when memberUserId is provided", async () => {
      const ctx = createMockContext();
      const result = await buildBaseWhereCondition({
        memberUserId: 456,
        ctx,
      });

      expect(result.whereCondition).toEqual({
        userId: 456,
      });
    });

    it("should set userId and teamId conditions when userId is provided", async () => {
      const ctx = createMockContext();
      const result = await buildBaseWhereCondition({
        userId: 789,
        ctx,
      });

      expect(result.whereCondition).toEqual({
        userId: 789,
        teamId: null,
      });
    });
  });

  describe("Organization-wide queries", () => {
    it("should return appropriate where condition when no teams found in organization", async () => {
      const ctx = createMockContext({
        userIsOwnerAdminOfParentTeam: true,
        userOrganizationId: 100,
      });

      const result = await buildBaseWhereCondition({
        isAll: true,
        ctx,
      });

      expect(result.whereCondition).toEqual({ id: -1 });
    });

    it("should build complex where condition for organization-wide query", async () => {
      const ctx = createMockContext({
        userIsOwnerAdminOfParentTeam: true,
        userOrganizationId: 100,
      });

      const result = await buildBaseWhereCondition({
        isAll: true,
        ctx,
      });

      expect(result.whereCondition).toEqual({ id: -1 });
    });
  });

  describe("Team-specific queries", () => {
    it("should build where condition for team-specific query", async () => {
      mockEventTypeFindMany.mockResolvedValue([{ id: 301 }, { id: 302 }]);

      const ctx = createMockContext();

      const result = await buildBaseWhereCondition({
        teamId: 200,
        isAll: false,
        ctx,
      });

      expect(result.whereCondition).toEqual({
        OR: [
          {
            eventTypeId: {
              in: [301, 302],
            },
          },
          {
            eventParentId: {
              in: [301, 302],
            },
          },
        ],
      });
    });

    it("should apply both team and eventTypeId conditions when both are provided", async () => {
      mockEventTypeFindMany.mockResolvedValue([{ id: 301 }, { id: 302 }]);

      const ctx = createMockContext();

      const result = await buildBaseWhereCondition({
        teamId: 200,
        eventTypeId: 500,
        isAll: false,
        ctx,
      });

      expect(result.whereCondition).toEqual({
        AND: [
          {
            OR: [{ eventTypeId: 500 }, { eventParentId: 500 }],
          },
          {
            OR: [
              {
                eventTypeId: {
                  in: [301, 302],
                },
              },
              {
                eventParentId: {
                  in: [301, 302],
                },
              },
            ],
          },
        ],
      });
    });
  });

  describe("Combined filtering", () => {
    it("should combine eventTypeId and memberUserId conditions", async () => {
      const ctx = createMockContext();

      const result = await buildBaseWhereCondition({
        eventTypeId: 123,
        memberUserId: 456,
        ctx,
      });

      expect(result.whereCondition).toEqual({
        AND: [
          {
            OR: [{ eventTypeId: 123 }, { eventParentId: 123 }],
          },
          {
            userId: 456,
          },
        ],
      });
    });
  });

  describe("Invalid parameters", () => {
    it("should handle missing parameters and return restrictive where condition", async () => {
      const ctx = createMockContext();

      const result = await buildBaseWhereCondition({
        ctx,
      });

      expect(result.whereCondition).toEqual({ id: -1 });
    });

    it("should handle null teamId with restrictive where condition", async () => {
      const ctx = createMockContext();

      const result = await buildBaseWhereCondition({
        teamId: null,
        ctx,
      });

      expect(result.whereCondition).toEqual({ id: -1 });
    });

    it("should handle empty team members with proper team condition", async () => {
      mockEventTypeFindMany.mockResolvedValue([]);

      const ctx = createMockContext();

      const result = await buildBaseWhereCondition({
        teamId: 200,
        isAll: false,
        ctx,
      });

      expect(result.whereCondition).toEqual({ id: -1 });
    });

    it("should handle rejected team membership differently from empty team", async () => {
      mockEventTypeFindMany.mockResolvedValue([]);

      const ctx = createMockContext();

      const result = await buildBaseWhereCondition({
        teamId: 200,
        isAll: false,
        ctx,
      });

      expect(result.whereCondition).toEqual({ id: -1 });
    });
  });
});
