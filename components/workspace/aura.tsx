import { cn } from "@/lib/utils"

/** A ball of soft light. `edge` keeps one side crisp, and lets the other dissolve. */
export function Orb({
  core,
  mid,
  edge,
  at,
  className,
  style,
}: {
  core: string
  mid: string
  /** Where the light is brightest, for a crisp edge on that side. */
  edge?: boolean
  at?: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      aria-hidden
      className={cn("bot-orb", edge && "bot-orb-edge", className)}
      style={
        { "--c1": core, "--c2": mid, "--at": at, ...style } as React.CSSProperties
      }
    />
  )
}

/** Recovery's mark: a small star glowing from the middle. */
export function AuraStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={className}>
      <defs>
        <radialGradient id="bot-star-fill">
          <stop offset="0%" stopColor="#f77fc4" />
          <stop offset="48%" stopColor="#f3bfe8" />
          <stop offset="100%" stopColor="#f6d9f4" />
        </radialGradient>
      </defs>
      <path
        fill="url(#bot-star-fill)"
        stroke="url(#bot-star-fill)"
        strokeWidth="10"
        strokeLinejoin="round"
        d="M50 14 60 39 87 41 66 58 73 85 50 70 27 85 34 58 13 41 40 39Z"
      />
    </svg>
  )
}

/** Half or whole: how much of the thing got done. */
export function SunGlyph({
  fill,
  className,
}: {
  fill: "half" | "full"
  className?: string
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <defs>
        <radialGradient id={`bot-sun-${fill}`}>
          <stop offset="0%" stopColor="#f26a3d" />
          <stop offset="60%" stopColor="#ffa63d" />
          <stop offset="100%" stopColor="#ffd9a8" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="white" opacity="0.7" />
      {fill === "full" ? (
        <circle cx="12" cy="12" r="10" fill={`url(#bot-sun-${fill})`} />
      ) : (
        <path d="M12 2a10 10 0 0 0 0 20z" fill={`url(#bot-sun-${fill})`} />
      )}
    </svg>
  )
}

/**
 * The countdown. The light draws in toward the middle and a fine line runs out
 * around it, so the time left can be felt without reading anything.
 */
export function FocusOrb({
  fraction,
  running,
  className,
  children,
}: {
  /** Share of the session still to go, from 1 down to 0. */
  fraction: number
  running: boolean
  className?: string
  children: React.ReactNode
}) {
  const left = Math.max(0, Math.min(1, fraction))
  return (
    <div className={cn("bot-focus-orb", !running && "is-paused", className)}>
      <div
        className="bot-focus-scale"
        style={{ transform: `scale(${0.7 + 0.3 * left})` }}
      >
        <div
          aria-hidden
          className={cn("bot-focus-light", running && "bot-breathe")}
        />
      </div>
      <svg viewBox="0 0 200 200" aria-hidden>
        <circle
          cx="100"
          cy="100"
          r="98"
          fill="none"
          stroke="rgb(255 255 255 / 0.35)"
          strokeWidth="1"
        />
        <circle
          className="bot-focus-arc"
          cx="100"
          cy="100"
          r="98"
          fill="none"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          strokeDashoffset={-(1 - left) * 100}
          transform="rotate(-90 100 100)"
        />
        <g
          className="bot-focus-hand"
          style={{ transform: `rotate(${(1 - left) * 360}deg)` }}
        >
          <circle cx="100" cy="2" r="4" fill="white" />
        </g>
      </svg>
      <div className="bot-focus-center">{children}</div>
    </div>
  )
}

const BLOOMS = [
  ["10%", "34px", "#FFA63D", "-70px", "0ms"],
  ["28%", "24px", "#F77FC4", "-54px", "120ms"],
  ["46%", "40px", "#86ACEA", "-80px", "60ms"],
  ["64%", "26px", "#F26A3D", "-60px", "180ms"],
  ["82%", "36px", "#BFE58A", "-74px", "90ms"],
] as const

/** A few small lights rising, when something is truly finished. */
export function Confetti() {
  return (
    <div aria-hidden className="bot-confetti">
      {BLOOMS.map(([x, s, c, y, d]) => (
        <i
          key={x}
          style={
            {
              "--x": x,
              "--s": s,
              "--c": c,
              "--y": y,
              "--d": d,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
