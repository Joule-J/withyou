import type { PlaybackState } from "../types";

export const DRIFT_TOLERANCE_SECONDS = 0.5;
export const HARD_SYNC_DRIFT_SECONDS = 1.4;
export const POST_ACTION_SETTLE_MS = 2_500;

export function targetPosition(playback: PlaybackState, estimatedServerTimeMs: number): number {
  if (!playback.isPlaying) return playback.positionSeconds;
  return Math.max(
    0,
    playback.positionSeconds + (estimatedServerTimeMs - playback.updatedAtServerMs) / 1_000,
  );
}

export function shouldCorrectDrift(currentSeconds: number, targetSeconds: number): boolean {
  return Math.abs(currentSeconds - targetSeconds) >= DRIFT_TOLERANCE_SECONDS;
}

export function driftAmount(currentSeconds: number, targetSeconds: number): number {
  return Math.abs(currentSeconds - targetSeconds);
}

export function isHardSyncRequired(currentSeconds: number, targetSeconds: number): boolean {
  return driftAmount(currentSeconds, targetSeconds) >= HARD_SYNC_DRIFT_SECONDS;
}

export function canCorrectDrift(playerState: YouTubePlayerState): boolean {
  return playerState === 1 || playerState === 2;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function acceptsRevision(currentRevision: number, incomingRevision: number): boolean {
  return incomingRevision >= currentRevision;
}
