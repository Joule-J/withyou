import { PrismaClient } from "@prisma/client";

export type PlaylistTrackRecord = {
  id: string;
  title: string;
  videoId: string;
  musicUrl: string;
  position: number;
};

export type PlaylistRecord = {
  id: string;
  name: string;
  tracks: PlaylistTrackRecord[];
  updatedAt: string;
};

export type PlaylistDraft = {
  name: string;
  tracks: Array<{
    title: string;
    videoId: string;
    musicUrl: string;
  }>;
};

export interface PlaylistRepository {
  list(): Promise<PlaylistRecord[]>;
  save(input: PlaylistDraft): Promise<PlaylistRecord>;
  delete(playlistId: string): Promise<void>;
}

export class InMemoryPlaylistRepository implements PlaylistRepository {
  private playlists = new Map<string, PlaylistRecord>();

  async list(): Promise<PlaylistRecord[]> {
    return [...this.playlists.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(input: PlaylistDraft): Promise<PlaylistRecord> {
    const existing = [...this.playlists.values()].find((playlist) => playlist.name === input.name);
    const next: PlaylistRecord = {
      id: existing?.id ?? `playlist-${Math.random().toString(36).slice(2, 10)}`,
      name: input.name,
      updatedAt: new Date().toISOString(),
      tracks: input.tracks.map((track, index) => ({
        id: `${existing?.id ?? input.name}-${index}`,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        position: index,
      })),
    };
    this.playlists.set(next.id, next);
    return next;
  }

  async delete(playlistId: string): Promise<void> {
    this.playlists.delete(playlistId);
  }
}

export class PrismaPlaylistRepository implements PlaylistRepository {
  private cache: PlaylistRecord[] = [];

  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<PlaylistRecord[]> {
    if (this.cache.length > 0) {
      void this.refreshCache();
      return this.cache;
    }

    return this.refreshCache();
  }

  async save(input: PlaylistDraft): Promise<PlaylistRecord> {
    const playlist = await this.prisma.playlist.upsert({
      where: { name: input.name },
      update: {
        tracks: {
          deleteMany: {},
          create: input.tracks.map((track, index) => ({
            title: track.title,
            videoId: track.videoId,
            musicUrl: track.musicUrl,
            position: index,
          })),
        },
      },
      create: {
        name: input.name,
        tracks: {
          create: input.tracks.map((track, index) => ({
            title: track.title,
            videoId: track.videoId,
            musicUrl: track.musicUrl,
            position: index,
          })),
        },
      },
      include: {
        tracks: {
          orderBy: { position: "asc" },
        },
      },
    });

    const record = {
      id: playlist.id,
      name: playlist.name,
      updatedAt: playlist.updatedAt.toISOString(),
      tracks: playlist.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        position: track.position,
      })),
    };
    this.cache = [record, ...this.cache.filter((item) => item.id !== record.id)];
    return record;
  }

  async delete(playlistId: string): Promise<void> {
    await this.prisma.playlist.delete({ where: { id: playlistId } });
    this.cache = this.cache.filter((playlist) => playlist.id !== playlistId);
  }

  private async refreshCache(): Promise<PlaylistRecord[]> {
    const mappedPromise = this.prisma.playlist
      .findMany({
        include: {
          tracks: {
            orderBy: { position: "asc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      })
      .then((playlists) =>
        playlists.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          updatedAt: playlist.updatedAt.toISOString(),
          tracks: playlist.tracks.map((track) => ({
            id: track.id,
            title: track.title,
            videoId: track.videoId,
            musicUrl: track.musicUrl,
            position: track.position,
          })),
        })),
      );

    this.cache = await withTimeout(mappedPromise, 800, this.cache);
    return this.cache;
  }
}

let prismaClient: PrismaClient | null = null;

export function createPlaylistRepository(env: NodeJS.ProcessEnv = process.env): PlaylistRepository {
  if (!env.DATABASE_URL) {
    return new InMemoryPlaylistRepository();
  }

  prismaClient ??= new PrismaClient();
  return new PrismaPlaylistRepository(prismaClient);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
