"use client";

import React from "react";
import { Avatar } from "@devdigest/ui";
import { githubAvatarUrl } from "@/lib/github-urls";

/**
 * Real GitHub profile picture for a login, falling back to the initials
 * Avatar when the image fails to load (bot/deleted account, or a non-GitHub
 * username in mock/seed data).
 */
export function GithubAvatar({ login, size = 18 }: { login: string; size?: number }) {
  const [failed, setFailed] = React.useState(false);

  if (failed) return <Avatar name={login} size={size} />;

  return (
    <img
      src={githubAvatarUrl(login)}
      width={size}
      height={size}
      style={{ borderRadius: 99, flexShrink: 0 }}
      referrerPolicy="no-referrer"
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
