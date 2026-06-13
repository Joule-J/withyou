import { describe, expect, it } from "vitest";
import {
  HARD_SYNC_DRIFT_SECONDS,
  POST_ACTION_SETTLE_MS,
  acceptsRevision,
  canCorrectDrift,
  isHardSyncRequired,
  shouldCorrectDrift,
  targetPosition,
} from "./sync";

const playback = {
  revision: 2,
  videoId: "dQw4w9WgXcQ",
  musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
  isPlaying: true,
  positionSeconds: 10,
  updatedAtServerMs: 1_000,
};

describe("player synchronization", () => {
  it("calculates the running target position", () => {
    expect(targetPosition(playback, 3_500)).toBe(12.5);
    expect(targetPosition({ ...playback, isPlaying: false }, 3_500)).toBe(10);
  });

  it("uses a 500 ms drift tolerance", () => {
    expect(shouldCorrectDrift(10, 10.49)).toBe(false);
    expect(shouldCorrectDrift(10, 10.5)).toBe(true);
  });

  it("uses a wider threshold before forcing a hard sync", () => {
    expect(isHardSyncRequired(10, 11.2)).toBe(false);
    expect(isHardSyncRequired(10, 10 + HARD_SYNC_DRIFT_SECONDS)).toBe(true);
    expect(POST_ACTION_SETTLE_MS).toBeGreaterThan(1000);
  });

  it("does not seek while the YouTube player is loading or buffering", () => {
    expect(canCorrectDrift(-1)).toBe(false);
    expect(canCorrectDrift(3)).toBe(false);
    expect(canCorrectDrift(1)).toBe(true);
    expect(canCorrectDrift(2)).toBe(true);
  });

  it("rejects stale revisions", () => {
    expect(acceptsRevision(3, 2)).toBe(false);
    expect(acceptsRevision(3, 3)).toBe(true);
  });
});
