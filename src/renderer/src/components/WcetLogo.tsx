import React from 'react'

export function WcetLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <defs>
        <linearGradient id="wcet-w-grad" x1="6" y1="12" x2="30" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="100%" stopColor="#00d2b4" />
        </linearGradient>
        <linearGradient id="wcet-chevron-grad" x1="26" y1="12" x2="42" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00e5a3" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <filter id="wcet-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2.5" floodColor="#00f0ff" floodOpacity="0.45" />
        </filter>
        <filter id="wcet-chevron-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2.5" floodColor="#10b981" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Letter 'W' */}
      <path
        d="M8 14L15 34L21 19L27 34L32 19"
        stroke="url(#wcet-w-grad)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#wcet-glow)"
      />

      {/* Terminal Chevron Prompt '>' */}
      <path
        d="M29 14L39 24L29 34"
        stroke="url(#wcet-chevron-grad)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#wcet-chevron-glow)"
      />
    </svg>
  )
}
