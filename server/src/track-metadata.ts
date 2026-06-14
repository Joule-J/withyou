const OEMBED_TIMEOUT_MS = 4_000;

type OEmbedResponse = {
  title?: string;
  thumbnail_url?: string;
};

export type TrackMetadata = {
  title: string | null;
  thumbnailUrl: string;
};

export function fallbackThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export async function resolveTrackMetadata(videoId: string): Promise<TrackMetadata> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);

  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      return {
        title: null,
        thumbnailUrl: fallbackThumbnailUrl(videoId),
      };
    }

    const payload = (await response.json()) as OEmbedResponse;
    const title = payload.title?.trim();
    const thumbnailUrl = payload.thumbnail_url?.trim();
    return {
      title: title ? title : null,
      thumbnailUrl: thumbnailUrl || fallbackThumbnailUrl(videoId),
    };
  } catch {
    return {
      title: null,
      thumbnailUrl: fallbackThumbnailUrl(videoId),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveTrackTitle(videoId: string): Promise<string | null> {
  return (await resolveTrackMetadata(videoId)).title;
}
