/**
 * Branded empty-state illustrations in the Disco language:
 * thin line-art, a single node morphing along a spine from
 * source-violet → client-rose. Decorative only (aria-hidden),
 * transparent background, ~128px square. Additive — keyed by name.
 */

type EmptyArtName = 'clients' | 'queue' | 'library';

const SIZE = 128;

/** Shared gradient + soft-glow defs, id-scoped per illustration to avoid collisions. */
function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-spine`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--color-source)" />
        <stop offset="100%" stopColor="var(--color-client)" />
      </linearGradient>
      <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="var(--color-client)" stopOpacity="0.22" />
        <stop offset="100%" stopColor="var(--color-client)" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/**
 * clients — two roster cards on a violet→rose spine, the right one
 * "rebranded" (rose), implying one identity reused across builds.
 */
function ClientsArt() {
  const id = 'ea-clients';
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <Defs id={id} />
      {/* spine */}
      <path
        d="M30 64 C 46 44, 82 84, 98 64"
        stroke={`url(#${id}-spine)`}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* source card */}
      <rect
        x="16"
        y="46"
        width="34"
        height="36"
        rx="6"
        stroke="var(--color-line)"
        strokeWidth="1.25"
      />
      <circle cx="33" cy="58" r="4.5" stroke="var(--color-source)" strokeWidth="1.25" />
      <line x1="23" y1="70" x2="43" y2="70" stroke="var(--color-line)" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="23" y1="75" x2="38" y2="75" stroke="var(--color-line)" strokeWidth="1.25" strokeLinecap="round" />
      {/* client card (rebranded) */}
      <circle cx="79" cy="64" r="26" fill={`url(#${id}-glow)`} />
      <rect
        x="78"
        y="46"
        width="34"
        height="36"
        rx="6"
        stroke="var(--color-client)"
        strokeWidth="1.25"
      />
      <circle cx="95" cy="58" r="4.5" stroke="var(--color-client)" strokeWidth="1.25" />
      <line x1="85" y1="70" x2="105" y2="70" stroke="var(--color-line)" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="85" y1="75" x2="100" y2="75" stroke="var(--color-line)" strokeWidth="1.25" strokeLinecap="round" />
      {/* morph node travelling the spine */}
      <circle cx="64" cy="64" r="3" fill="var(--color-client)" />
    </svg>
  );
}

/**
 * queue — a build pipeline: source node → progress spine → client node,
 * with two faint "queued" tracks waiting below.
 */
function QueueArt() {
  const id = 'ea-queue';
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <Defs id={id} />
      {/* active build track */}
      <circle cx="48" cy="44" r="22" fill={`url(#${id}-glow)`} />
      <path
        d="M26 44 H 102"
        stroke="var(--color-line)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M26 44 H 70"
        stroke={`url(#${id}-spine)`}
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* source node */}
      <circle cx="26" cy="44" r="5" stroke="var(--color-source)" strokeWidth="1.5" />
      {/* travelling morph node */}
      <circle cx="70" cy="44" r="3.5" fill="var(--color-client)" />
      {/* client target */}
      <circle cx="102" cy="44" r="5" stroke="var(--color-client)" strokeWidth="1.5" strokeDasharray="2 2.5" />
      {/* queued tracks waiting */}
      <path d="M26 70 H 90" stroke="var(--color-line-soft)" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="26" cy="70" r="4" stroke="var(--color-line)" strokeWidth="1.25" />
      <path d="M26 90 H 76" stroke="var(--color-line-soft)" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="26" cy="90" r="4" stroke="var(--color-line)" strokeWidth="1.25" />
    </svg>
  );
}

/**
 * library — stacked template snapshots fanned along the spine,
 * the front one violet (source). Spare; reserved for a snapshot
 * library empty state.
 */
function LibraryArt() {
  const id = 'ea-library';
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <Defs id={id} />
      <circle cx="64" cy="64" r="30" fill={`url(#${id}-glow)`} />
      <rect x="40" y="34" width="48" height="60" rx="7" stroke="var(--color-line-soft)" strokeWidth="1.25" transform="rotate(-9 64 64)" />
      <rect x="40" y="34" width="48" height="60" rx="7" stroke="var(--color-line)" strokeWidth="1.25" transform="rotate(9 64 64)" />
      <rect x="40" y="34" width="48" height="60" rx="7" stroke={`url(#${id}-spine)`} strokeWidth="1.5" />
      <line x1="50" y1="50" x2="78" y2="50" stroke="var(--color-source)" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="50" y1="62" x2="78" y2="62" stroke="var(--color-line)" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="50" y1="72" x2="70" y2="72" stroke="var(--color-line)" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="64" cy="64" r="3" fill="var(--color-client)" />
    </svg>
  );
}

const ART: Record<EmptyArtName, () => React.ReactElement> = {
  clients: ClientsArt,
  queue: QueueArt,
  library: LibraryArt,
};

export function EmptyArt({ name, className }: { name: EmptyArtName; className?: string }) {
  const Art = ART[name];
  return (
    <div className={className} aria-hidden="true" style={{ lineHeight: 0 }}>
      <Art />
    </div>
  );
}
