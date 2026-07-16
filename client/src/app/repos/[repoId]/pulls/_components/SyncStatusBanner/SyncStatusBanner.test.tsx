import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Repo } from "@devdigest/shared";
import { SyncStatusBanner, timeAgo } from "./SyncStatusBanner";
import prReviewMessages from "../../../../../../../messages/en/prReview.json";

const repo = (overrides: Partial<Repo> = {}): Repo => ({
  id: "r1",
  workspace_id: "w1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
  pr_synced_at: null,
  pr_sync_error: null,
  ...overrides,
});

function renderBanner(r: Repo | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages }}>
      <SyncStatusBanner repo={r} />
    </NextIntlClientProvider>,
  );
}

describe("SyncStatusBanner", () => {
  it("renders nothing while sync is healthy (no error)", () => {
    renderBanner(repo());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing when there is no active repo", () => {
    renderBanner(null);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the failure banner with last-sync age and reason", () => {
    const syncedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    renderBanner(repo({ pr_sync_error: "HTTP 503", pr_synced_at: syncedAt }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("2h ago");
    expect(alert.textContent).toContain("HTTP 503");
  });

  it("shows the never-synced variant when pr_synced_at is null", () => {
    renderBanner(repo({ pr_sync_error: "GITHUB_TOKEN is not configured" }));
    expect(screen.getByRole("alert").textContent).toContain("never synced");
  });

  it("dismiss hides the banner", () => {
    renderBanner(repo({ pr_sync_error: "HTTP 503" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-07-17T12:00:00.000Z");
  it.each([
    ["2026-07-17T11:59:40.000Z", "just now"],
    ["2026-07-17T11:15:00.000Z", "45m ago"],
    ["2026-07-17T09:00:00.000Z", "3h ago"],
    ["2026-07-14T12:00:00.000Z", "3d ago"],
  ])("%s → %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});
