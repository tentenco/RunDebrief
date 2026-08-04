interface AppMarkProps {
  decorative?: boolean;
}

export function AppMark({ decorative = false }: AppMarkProps) {
  return (
    <svg
      className="app-mark"
      viewBox="0 0 64 64"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "Debrief"}
    >
      <rect className="app-mark-surface" x="4" y="4" width="56" height="56" rx="14" />
      <path
        className="app-mark-page"
        d="M19 17h15c10 0 17 6 17 15s-7 15-17 15H19V17Z"
      />
      <path className="app-mark-cut" d="M29 25h5c5 0 8 3 8 7s-3 7-8 7h-5V25Z" />
      <path className="app-mark-line" d="M21 51h22" />
    </svg>
  );
}
