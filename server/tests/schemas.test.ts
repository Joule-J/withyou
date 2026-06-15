import { describe, expect, it } from "vitest";
import { parseMusicUrl, playerCommandSchema, queueAddSchema, queueReplaceSchema } from "../src/schemas.js";

describe("YouTube Music validation", () => {
  it("normalizes a YouTube Music watch URL", () => {
    expect(parseMusicUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM")).toEqual({
      videoId: "dQw4w9WgXcQ",
      normalizedUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("rejects non YouTube Music URLs and mismatched video IDs", () => {
    expect(parseMusicUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(
      playerCommandSchema.safeParse({
        type: "play",
        videoId: "different",
        musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        positionSeconds: 0,
        clientCommandId: "1",
      }).success,
    ).toBe(false);
  });

  it("allows saved playlists to be replayed with more tracks than a single queue add", () => {
    const musicUrls = Array.from(
      { length: 21 },
      (_, index) => `https://music.youtube.com/watch?v=track${String(index).padStart(2, "0")}`,
    );

    expect(queueAddSchema.safeParse({ musicUrls }).success).toBe(false);
    expect(queueReplaceSchema.safeParse({ musicUrls }).success).toBe(true);
  });
});
