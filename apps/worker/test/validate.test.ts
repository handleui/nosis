import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { requestHasBody, validatePagination } from "../src/validate";

function catchError(run: () => void): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

describe("validatePagination", () => {
  test("returns default pagination when values are omitted", () => {
    expect(validatePagination(undefined, undefined)).toEqual({
      limit: 100,
      offset: 0,
    });
  });

  test("rejects limit values above max page size", () => {
    const error = catchError(() => validatePagination("501", "0"));
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(400);
  });

  test("rejects negative offsets", () => {
    const error = catchError(() => validatePagination("100", "-1"));
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(400);
  });
});

describe("requestHasBody", () => {
  test("returns false when neither content-length nor transfer-encoding is set", () => {
    const headers = new Headers();
    expect(requestHasBody(headers)).toBe(false);
  });

  test("returns false when content-length is zero", () => {
    const headers = new Headers({ "content-length": "0" });
    expect(requestHasBody(headers)).toBe(false);
  });

  test("returns true when content-length is positive", () => {
    const headers = new Headers({ "content-length": "12" });
    expect(requestHasBody(headers)).toBe(true);
  });

  test("returns true when transfer-encoding is present", () => {
    const headers = new Headers({ "transfer-encoding": "chunked" });
    expect(requestHasBody(headers)).toBe(true);
  });
});
