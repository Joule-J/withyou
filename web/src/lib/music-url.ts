export type ParsedMusicUrl = {
  videoId: string;
  normalizedUrl: string;
};

export function parseMusicUrl(value: string): ParsedMusicUrl | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "music.youtube.com" || url.pathname !== "/watch") {
      return null;
    }
    const videoId = url.searchParams.get("v");
    if (!videoId || !/^[A-Za-z0-9_-]{6,32}$/.test(videoId)) return null;
    return {
      videoId,
      normalizedUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    };
  } catch {
    return null;
  }
}
