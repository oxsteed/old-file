import { useId } from 'react';
import './OxsteedAnimatedLogo.css';

// Animated OxSteed brand mark, rebuilt from the official logo asset.
// Brand-exact colors sampled from the logo file: tile #16213d, mark #f97216.
// Variants:
//   "pulse" (default): quiet looping heartbeat for loading states. No hammer.
//   "full":    the brand moment. A small claw hammer taps the pulse origin
//              (bottom left), the x flashes light blue on impact, then the
//              double-beat pulse travels and the letters light up in turn.
// Reduced motion: all animation stops and the mark renders as the still logo
// with the pulse line fully drawn. No user-visible strings: the mark is
// decorative (aria-hidden) wherever it is placed next to real copy.
export default function OxsteedAnimatedLogo({ size = 96, variant = 'pulse', className = '' }) {
  const uid = useId().replace(/:/g, '');
  const tileId = `ox-tile-${uid}`;
  const steelId = `ox-steel-${uid}`;
  const steelDarkId = `ox-steel-dark-${uid}`;
  const woodId = `ox-wood-${uid}`;
  const isFull = variant === 'full';

  return (
    <svg
      className={`ox-anim${isFull ? ' ox-anim--full' : ' ox-anim--pulse'}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 240 240"
      role="img"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={tileId}>
          <rect x="8" y="8" width="224" height="224" rx="52" />
        </clipPath>
        <linearGradient id={steelId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef2f7" />
          <stop offset="0.45" stopColor="#b9c2cd" />
          <stop offset="0.75" stopColor="#7d8894" />
          <stop offset="1" stopColor="#5a636e" />
        </linearGradient>
        <linearGradient id={steelDarkId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#aab4bf" />
          <stop offset="1" stopColor="#66707c" />
        </linearGradient>
        <linearGradient id={woodId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d9ab72" />
          <stop offset="0.55" stopColor="#a4713a" />
          <stop offset="1" stopColor="#7c4f24" />
        </linearGradient>
      </defs>
      <g className="ox-anim__shake">
        <g clipPath={`url(#${tileId})`}>
          <rect x="8" y="8" width="224" height="224" fill="#16213d" />
          <g className="ox-anim__orbit">
            <g className="ox-anim__kick" fill="none" stroke="#f97216" strokeWidth="11" strokeLinecap="round">
              <path d="M 34 74 A 92 92 0 0 1 92 30" />
              <path d="M 206 166 A 92 92 0 0 1 148 210" />
            </g>
          </g>
          <g className="ox-anim__orbit-rev">
            <g className="ox-anim__kick-rev" fill="none" stroke="#f97216" strokeWidth="8" strokeLinecap="round" opacity="0.85">
              <path d="M 206 74 A 92 92 0 0 0 148 30" />
              <path d="M 34 166 A 92 92 0 0 0 92 210" />
            </g>
          </g>
          <circle className="ox-anim__ripple" cx="62" cy="146" r="22" fill="none" stroke="#f97216" strokeWidth="3" />
          <circle className="ox-anim__echo" cx="120" cy="120" r="66" fill="none" stroke="#f97216" strokeWidth="2" />
          <circle cx="120" cy="120" r="66" fill="#f97216" />
          <text x="120" y="128" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="56" fontWeight="800" fill="#ffffff" letterSpacing="1">
            <tspan>O</tspan>
            <tspan className="ox-anim__x-hit">x</tspan>
            <tspan>S</tspan>
          </text>
          <text x="120" y="128" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="56" fontWeight="800" fill="#ffe1b8" letterSpacing="1">
            <tspan className="ox-anim__glow-o">O</tspan>
            <tspan className="ox-anim__glow-x">x</tspan>
            <tspan className="ox-anim__glow-s">S</tspan>
          </text>
          <polyline
            className="ox-anim__pulse"
            points="62,146 92,146 100,128 110,162 119,138 127,146 134,136 140,154 146,146 178,146"
            fill="none"
            stroke="#ffffff"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle className="ox-anim__flash" cx="62" cy="146" r="8" fill="#ffffff" />
        </g>
      </g>
      {isFull && (
        <g className="ox-anim__hammer">
          <g transform="translate(62,146) rotate(39.4)">
            <path d="M -5 4 L 5 4 L 3.5 66 Q 3.5 70 0 70 Q -3.5 70 -3.5 66 Z" fill={`url(#${woodId})`} />
            <line x1="0" y1="10" x2="0" y2="60" stroke="#7a4d22" strokeWidth="1" opacity="0.55" />
            <ellipse cx="0" cy="68" rx="4" ry="3" fill="#6e4520" />
            <path d="M -5 2 L 5 2 L 4 -6 L -4 -6 Z" fill="#2f333b" />
            <path d="M 8 -12 C 20 -18, 30 -24, 34 -20 C 36 -14, 30 -4, 22 2 L 12 10 L 8 -12 Z" fill={`url(#${steelDarkId})`} />
            <path d="M 18 -12 L 26 -2" stroke="#3f4650" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M -28 -10 Q -30 0 -28 10 L 10 10 Q 13 10 13 0 L 13 -10 Q 13 -12 10 -12 Z" fill={`url(#${steelId})`} />
            <rect x="-28" y="-10" width="6" height="20" rx="2" fill="#4a525e" />
            <line x1="-26" y1="-8" x2="-26" y2="8" stroke="#e8edf3" strokeWidth="1.2" opacity="0.8" />
            <line x1="-24" y1="-9" x2="10" y2="-11" stroke="#ffffff" strokeWidth="1.5" opacity="0.55" />
          </g>
        </g>
      )}
    </svg>
  );
}
