import { z } from "zod";

const nickname = z.string().trim().min(2).max(24);
const roomCode = z.string().trim().length(6).transform((value) => value.toUpperCase());
const participantId = z.string().uuid();
const reconnectToken = z.string().min(32).max(256);

export const createRoomSchema = z.object({
  nickname,
});

export const joinRoomSchema = z.object({
  roomCode,
  nickname,
});

export const reconnectRoomSchema = z.object({
  roomCode,
  participantId,
  reconnectToken,
});

export const leaveRoomSchema = z.object({
  roomCode,
});

export const playerCommandSchema = z
  .object({
    type: z.enum(["play", "pause", "seek", "change_track"]),
    videoId: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
    musicUrl: z.string().url(),
    title: z.string().trim().max(200).optional(),
    positionSeconds: z.number().finite().min(0).max(86_400),
    clientCommandId: z.string().min(1).max(100),
    isPlaying: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    const url = parseMusicUrl(value.musicUrl);
    if (!url || url.videoId !== value.videoId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "musicUrl must be a YouTube Music watch URL matching videoId",
      });
    }
  });

export const stateReportSchema = z.object({
  videoId: z.string().trim().min(1).max(32),
  positionSeconds: z.number().finite().min(0).max(86_400),
  isPlaying: z.boolean(),
});

export const clockPingSchema = z.object({
  clientSentAtMs: z.number().finite().nonnegative(),
});

export const queueAddSchema = z.object({
  musicUrls: z.array(z.string().url()).min(1).max(20),
});

export function parseMusicUrl(value: string): { videoId: string; normalizedUrl: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "music.youtube.com" || url.pathname !== "/watch") {
      return null;
    }

    const videoId = url.searchParams.get("v");
    if (!videoId || !/^[A-Za-z0-9_-]{6,32}$/.test(videoId)) {
      return null;
    }

    return {
      videoId,
      normalizedUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    };
  } catch {
    return null;
  }
}
