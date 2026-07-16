import { describe, it, expect } from "vitest";
import { tagToType, estimateTokens } from "./helpers";

describe("tagToType", () => {
  it("returns 'security' when tags include 'security' and 'owasp'", () => {
    expect(tagToType(["security", "owasp"])).toBe("security");
  });

  it("returns 'security' when tags include only 'sql'", () => {
    expect(tagToType(["sql"])).toBe("security");
  });

  it("returns 'security' when tags include only 'secrets'", () => {
    expect(tagToType(["secrets"])).toBe("security");
  });

  it("returns 'convention' when tags include 'frontend' and 'react'", () => {
    expect(tagToType(["frontend", "react"])).toBe("convention");
  });

  it("returns 'convention' when tags include only 'a11y'", () => {
    expect(tagToType(["a11y"])).toBe("convention");
  });

  it("returns 'custom' when tags include non-matching values like 'cleanup' and 'dx'", () => {
    expect(tagToType(["cleanup", "dx"])).toBe("custom");
  });

  it("returns 'custom' when tags include 'safety', 'database', and 'drizzle'", () => {
    expect(tagToType(["safety", "database", "drizzle"])).toBe("custom");
  });

  it("returns 'custom' for an empty tag array", () => {
    expect(tagToType([])).toBe("custom");
  });

  it("returns 'security' when tags include both 'security' and 'react' (security wins over convention)", () => {
    expect(tagToType(["security", "react"])).toBe("security");
  });

  it("returns 'security' when tags include both 'frontend' and 'owasp' (security wins regardless of order)", () => {
    expect(tagToType(["frontend", "owasp"])).toBe("security");
  });
});

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
