import { describe, expect, it } from "vitest";
import { parseMusicUrl } from "./music-url";

describe("parseMusicUrl", () => {
  it("normalizes a YouTube Music watch URL", () => {
    expect(parseMusicUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM")).toEqual({
      videoId: "dQw4w9WgXcQ",
      normalizedUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("rejects other hosts and invalid video ids", () => {
    expect(parseMusicUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseMusicUrl("https://music.youtube.com/watch?v=!")).toBeNull();
  });
});
