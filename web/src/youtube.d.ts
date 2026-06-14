type YouTubePlayerState = -1 | 0 | 1 | 2 | 3 | 5;

interface YouTubePlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): YouTubePlayerState;
  getVideoData(): { video_id?: string; title?: string };
  destroy(): void;
}

interface Window {
  YT?: {
    Player: new (
      element: HTMLElement,
      options: {
        width: string;
        height: string;
        playerVars: Record<string, number | string>;
        events: {
          onReady: () => void;
          onError: (event: { data: number }) => void;
          onStateChange?: (event: { data: YouTubePlayerState }) => void;
        };
      },
    ) => YouTubePlayer;
  };
  onYouTubeIframeAPIReady?: () => void;
}
