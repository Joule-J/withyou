import { describe, expect, it } from "vitest";
import { InMemoryPlaylistRepository } from "../src/playlist-repository.js";

describe("InMemoryPlaylistRepository", () => {
  it("preserves playlist track thumbnails when saving and listing", async () => {
    const repository = new InMemoryPlaylistRepository();

    await repository.save({
      name: "Love Songs",
      tracks: [
        {
          title: "Shape of You",
          videoId: "dQw4w9WgXcQ",
          musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
          thumbnailUrl: "https://img.example/shape.jpg",
        },
      ],
    });

    await expect(repository.list()).resolves.toMatchObject([
      {
        name: "Love Songs",
        tracks: [
          {
            title: "Shape of You",
            thumbnailUrl: "https://img.example/shape.jpg",
          },
        ],
      },
    ]);
  });
});
