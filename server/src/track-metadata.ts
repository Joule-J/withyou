const OEMBED_TIMEOUT_MS = 4_000;

type OEmbedResponse = {
  title?: string;
};

export async function resolveTrackTitle(videoId: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);

  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as OEmbedResponse;
    const title = payload.title?.trim();
    return title ? title : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
