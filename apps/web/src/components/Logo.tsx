/** The Disco mark: a source node morphing into a client node across the transform spine. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="disco-spine" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c6cf0" />
          <stop offset="1" stopColor="#ff5a8a" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="16" r="5" stroke="#7c6cf0" strokeWidth="2" />
      <path d="M13 16 H24" stroke="url(#disco-spine)" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 11 L25 16 L20 21" stroke="#ff5a8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
