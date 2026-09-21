import React from 'react'

export function DaemonttyLogo({ size = 24, className }: { size?: number; className?: string }) {
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
        {/* Platinum Outer Stroke */}
        <linearGradient id="corp-outer-grad" x1="12" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>

        {/* Sapphire Azure Inner Loop */}
        <linearGradient id="corp-inner-grad" x1="16" y1="14" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="60%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>

        <filter id="corp-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#0284c7" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Outer Executive 'D' */}
      <path
        d="M13 11H26C33.2 11 38 16 38 24C38 32 33.2 37 26 37H13V11Z"
        stroke="url(#corp-outer-grad)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Inner Architectural Loop */}
      <path
        d="M18 16H25C29.2 16 32.5 19.5 32.5 24C32.5 28.5 29.2 32 25 32H18V16Z"
        stroke="url(#corp-inner-grad)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#corp-glow)"
      />

      {/* Enterprise Terminal Chevron '>' */}
      <path
        d="M22 20.5L26 24L22 27.5"
        stroke="#38bdf8"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
