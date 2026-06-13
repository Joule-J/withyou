import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type YouTubePlayerHandle = {
  load(videoId: string, startSeconds: number, autoplay: boolean): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  currentTime(): number;
  duration(): number;
  state(): YouTubePlayerState;
  videoId(): string | null;
};

type Props = {
  onReady: () => void;
  onError: (message: string) => void;
  onEnded?: () => void;
};

let apiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { onReady, onError, onEnded },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onEndedRef = useRef(onEnded);
  const [ready, setReady] = useState(false);

  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  onEndedRef.current = onEnded;

  useEffect(() => {
    let disposed = false;
    void loadYouTubeApi().then(() => {
      if (disposed || !containerRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 0,
          disablekb: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            setReady(true);
            onReadyRef.current();
          },
          onError: () => onErrorRef.current("Bu parca YouTube oynaticisinda acilamadi."),
          onStateChange: (event) => {
            if (event.data === 0) onEndedRef.current?.();
          },
        },
      });
    });
    return () => {
      disposed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      load(videoId, startSeconds, autoplay) {
        if (autoplay) playerRef.current?.loadVideoById({ videoId, startSeconds });
        else playerRef.current?.cueVideoById({ videoId, startSeconds });
      },
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      seek: (seconds) => playerRef.current?.seekTo(seconds, true),
      currentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      duration: () => playerRef.current?.getDuration() ?? 0,
      state: () => playerRef.current?.getPlayerState() ?? -1,
      videoId: () => playerRef.current?.getVideoData().video_id ?? null,
    }),
    [],
  );

  return (
    <div className="player-frame" aria-label="YouTube oynatici">
      <div ref={containerRef} />
      {!ready && <div className="player-loading">Oynatici yukleniyor...</div>}
    </div>
  );
});
