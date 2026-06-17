export type ParsedMusicUrl = {
  videoId: string;
  normalizedUrl: string;
};

export function parseMusicUrl(value: string): ParsedMusicUrl | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase();
    let videoId: string | null = null;
    if ((host === "music.youtube.com" || host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") && url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (!videoId || !/^[A-Za-z0-9_-]{6,32}$/.test(videoId)) return null;
    return {
      videoId,
      normalizedUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    };
  } catch {
    return null;
  }
}
