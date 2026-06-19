type Props = {
  className?: string;
};

export function MusicMark({ className }: Props) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="presentation">
        <defs>
          <linearGradient id="music-mark-fill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff8fbc" />
            <stop offset="100%" stopColor="#8e79ff" />
          </linearGradient>
        </defs>
        <rect x="8" y="8" width="48" height="48" rx="16" fill="url(#music-mark-fill)" />
        <path
          d="M38 18v18.4a8.3 8.3 0 1 1-3-6.4V22.8l-11 2.5v14.1a8.3 8.3 0 1 1-3-6.4V22.2c0-1.4 1-2.7 2.4-3l12.7-2.9c1.1-.3 1.9.5 1.9 1.7Z"
          fill="#fff7fb"
        />
      </svg>
    </span>
  );
}
