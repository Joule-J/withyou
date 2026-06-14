import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackThumbnailUrl, resolveTrackMetadata } from "../src/track-metadata.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("track metadata", () => {
  it("resolves title and thumbnail from YouTube oEmbed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        title: "Shape of You",
        thumbnail_url: "https://img.youtube.com/shape.jpg",
      }),
    } as Response);

    await expect(resolveTrackMetadata("dQw4w9WgXcQ")).resolves.toEqual({
      title: "Shape of You",
      thumbnailUrl: "https://img.youtube.com/shape.jpg",
    });
  });

  it("falls back to a YouTube thumbnail when oEmbed fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(resolveTrackMetadata("dQw4w9WgXcQ")).resolves.toEqual({
      title: null,
      thumbnailUrl: fallbackThumbnailUrl("dQw4w9WgXcQ"),
    });
  });
});
