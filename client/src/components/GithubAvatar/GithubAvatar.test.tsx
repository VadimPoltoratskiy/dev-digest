import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GithubAvatar } from "./GithubAvatar";

afterEach(cleanup);

describe("GithubAvatar", () => {
  it("renders an img pointed at github.com/<login>.png", () => {
    // alt="" is intentional (decorative — the username is shown as adjacent
    // text), which drops the img out of the accessibility tree's "img" role.
    const { container } = render(<GithubAvatar login="octocat" size={20} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("https://github.com/octocat.png");
    expect(img.width).toBe(20);
    expect(img.height).toBe(20);
  });

  it("falls back to initials Avatar when the image fails to load", () => {
    const { container } = render(<GithubAvatar login="ghost-bot" size={20} />);
    const img = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("GB")).toBeInTheDocument();
  });
});
