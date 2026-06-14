import type { PlaylistRecord, PlaylistRepository } from "./playlist-repository.js";
import { parseMusicUrl } from "./schemas.js";
import { resolveTrackMetadata } from "./track-metadata.js";

export class PlaylistService {
  constructor(private readonly repository: PlaylistRepository) {}

  listPlaylists(): Promise<PlaylistRecord[]> {
    return this.repository.list();
  }

  async savePlaylist(name: string, musicUrls: string[]): Promise<PlaylistRecord> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("LIST_NAME_REQUIRED");
    }

    const uniqueUrls = [...new Set(musicUrls.map((url) => url.trim()).filter(Boolean))];
    if (uniqueUrls.length === 0) {
      throw new Error("LIST_TRACKS_REQUIRED");
    }

    const tracks = await Promise.all(
      uniqueUrls.map(async (musicUrl) => {
        const parsed = parseMusicUrl(musicUrl);
        if (!parsed) throw new Error("INVALID_MUSIC_URL");
        const metadata = await resolveTrackMetadata(parsed.videoId);
        return {
          title: metadata.title ?? parsed.videoId,
          thumbnailUrl: metadata.thumbnailUrl,
          videoId: parsed.videoId,
          musicUrl: parsed.normalizedUrl,
        };
      }),
    );

    return this.repository.save({
      name: normalizedName,
      tracks,
    });
  }

  reorderPlaylist(playlistId: string, orderedMusicUrls: string[]): Promise<PlaylistRecord> {
    return this.repository.reorder(playlistId, orderedMusicUrls);
  }

  deletePlaylist(playlistId: string): Promise<void> {
    return this.repository.delete(playlistId);
  }
}
