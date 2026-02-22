import { describe, expect, it } from "vitest";
import {
  assertBranchName,
  assertPathSegment,
  assertUuid,
  safePagination,
} from "@nosis/features/shared/api/worker-api-validation";

describe("worker api validation", () => {
  it("accepts valid UUID values", () => {
    expect(() =>
      assertUuid("11111111-2222-4333-8444-555555555555", "conversation ID")
    ).not.toThrow();
  });

  it("rejects invalid UUID values", () => {
    expect(() => assertUuid("not-a-uuid", "conversation ID")).toThrow(
      "Invalid conversation ID"
    );
  });

  it("normalizes branch names with trim", () => {
    expect(assertBranchName(" feature/alpha ", "head branch")).toBe(
      "feature/alpha"
    );
  });

  it("rejects path segments with invalid characters", () => {
    expect(() => assertPathSegment("acme/repo", "repository name")).toThrow(
      "Invalid repository name"
    );
  });

  it("clamps and floors pagination values", () => {
    expect(safePagination(999.9, -5, 200)).toEqual({ limit: 200, offset: 0 });
  });
});
