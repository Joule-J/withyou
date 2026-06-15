import { describe, expect, it, vi } from "vitest";
import { InMemoryPlaylistRepository, PrismaPlaylistRepository } from "../src/playlist-repository.js";

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

describe("PrismaPlaylistRepository", () => {
  it("waits for the first DB load instead of returning an empty cache", async () => {
    vi.useFakeTimers();
    const repository = new PrismaPlaylistRepository({
      playlist: {
        findMany: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve([
                {
                  id: "playlist-1",
                  name: "Roadtrip",
                  updatedAt: new Date("2026-06-14T12:00:00Z"),
                  tracks: [
                    {
                      id: "track-1",
                      title: "Song A",
                      videoId: "dQw4w9WgXcQ",
                      musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
                      thumbnailUrl: null,
                      position: 0,
                    },
                  ],
                },
              ]);
            }, 900);
          }),
      },
    } as never);

    const listPromise = repository.list();
    await vi.advanceTimersByTimeAsync(900);
    await expect(listPromise).resolves.toEqual([
      {
        id: "playlist-1",
        name: "Roadtrip",
        updatedAt: "2026-06-14T12:00:00.000Z",
        tracks: [
          {
            id: "track-1",
            title: "Song A",
            videoId: "dQw4w9WgXcQ",
            musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
            thumbnailUrl: undefined,
            position: 0,
          },
        ],
      },
    ]);

    vi.useRealTimers();
  });

  it("reorders DB tracks through temporary positions to avoid unique collisions", async () => {
    const positionWrites: Array<{ id: string; position: number }> = [];
    const tracks = [
      {
        id: "track-a",
        title: "Song A",
        videoId: "dQw4w9WgXcQ",
        musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        thumbnailUrl: null,
        position: 0,
      },
      {
        id: "track-b",
        title: "Song B",
        videoId: "y8MArfXrn80",
        musicUrl: "https://music.youtube.com/watch?v=y8MArfXrn80",
        thumbnailUrl: null,
        position: 1,
      },
    ];
    const repository = new PrismaPlaylistRepository({
      playlist: {
        findUnique: async () => ({
          id: "playlist-1",
          name: "Roadtrip",
          updatedAt: new Date("2026-06-14T12:00:00Z"),
          tracks,
        }),
        update: async () => ({
          id: "playlist-1",
          name: "Roadtrip",
          updatedAt: new Date("2026-06-14T12:00:01Z"),
        }),
        findUniqueOrThrow: async () => ({
          id: "playlist-1",
          name: "Roadtrip",
          updatedAt: new Date("2026-06-14T12:00:01Z"),
          tracks: [...tracks].sort((a, b) => a.position - b.position),
        }),
      },
      playlistTrack: {
        update: ({ where, data }: { where: { id: string }; data: { position: number } }) => {
          positionWrites.push({ id: where.id, position: data.position });
          const track = tracks.find((item) => item.id === where.id);
          if (track) track.position = data.position;
          return Promise.resolve(track);
        },
      },
      $transaction: async (operations: Array<Promise<unknown>>) => {
        await Promise.all(operations);
      },
    } as never);

    await repository.reorder("playlist-1", [
      "https://music.youtube.com/watch?v=y8MArfXrn80",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    ]);

    expect(positionWrites).toEqual([
      { id: "track-b", position: -1 },
      { id: "track-a", position: -2 },
      { id: "track-b", position: 0 },
      { id: "track-a", position: 1 },
    ]);
  });
});
