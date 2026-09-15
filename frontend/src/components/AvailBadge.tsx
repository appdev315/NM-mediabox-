import { useAvailability } from '../utils/availability';

interface AvailBadgeProps {
  type?: string;
  id?: string | number;
  className?: string;
}

/**
 * Honest player-availability badge for poster cards.
 * Renders nothing while status is unknown — no guessing, no extra requests.
 */
export function AvailBadge({ type, id, className }: AvailBadgeProps) {
  const status = useAvailability(type, id);
  if (status === 'unknown' || id === undefined || id === null) return null;
  const available = status === 'available';
  return (
    <span
      className={className || 'absolute bottom-1.5 left-1.5 z-20'}
      title={available ? 'Плеер доступен' : 'Только трейлер'}
    >
      <span
        className={`flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-md border backdrop-blur-sm ${
          available
            ? 'bg-green-600/85 text-white border-green-400/40'
            : 'bg-black/70 text-amber-300 border-amber-400/30'
        }`}
      >
        {available ? '▶' : '🎬'}
      </span>
    </span>
  );
}
