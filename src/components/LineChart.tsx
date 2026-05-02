import { useRef, useState } from 'react'

// ─── Design tokens (must match index.css) ────────────────────────────────────
const ACCENT        = '#f97316'
const EDGE          = '#2e2e45'
const INK           = '#ededf5'
const INK_SEC       = '#8888a8'
const INK_DIS       = '#454560'
const ELEVATED      = '#1c1c2e'

// ─── Chart geometry ───────────────────────────────────────────────────────────
const VW = 320
const VH = 168
const PAD = { top: 24, right: 16, bottom: 32, left: 44 }
const IW  = VW - PAD.left - PAD.right   // 260
const IH  = VH - PAD.top  - PAD.bottom  // 112

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineChartProps {
  values:   number[]    // one per data point
  dates:    string[]    // short x-axis label per point  (e.g. "Jan 5")
  tooltips: string[]    // two-line tooltip per point, joined by '\n'
  unit?:    string      // appended to y-axis labels
  gradId?:  string      // unique SVG gradient ID (needed if multiple charts on page)
}

// ─── Bezier path (Catmull-Rom → cubic Bezier) ─────────────────────────────────

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const d: string[] = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const cp1x = (p1.x + (p2.x - p0.x) / 6).toFixed(1)
    const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(1)
    const cp2x = (p2.x - (p3.x - p1.x) / 6).toFixed(1)
    const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(1)
    d.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`)
  }
  return d.join(' ')
}

// ─── Nice round step for Y-axis ───────────────────────────────────────────────

function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1
  const mag  = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const frac = roughStep / mag
  if (frac <= 1) return mag
  if (frac <= 2) return 2 * mag
  if (frac <= 5) return 5 * mag
  return 10 * mag
}

// ─── Which data-point indices get an x-axis date label ────────────────────────

function xLabelIndices(n: number, max = 5): number[] {
  if (n <= 1)   return [0]
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => Math.round(i * step))
}

// ─── Tooltip box (pure SVG) ───────────────────────────────────────────────────

function Tooltip({ x, y, lines }: { x: number; y: number; lines: string[] }) {
  // Rough char width estimates
  const PX = 8; const PY = 6; const LINE_H = 14
  const w = Math.max(...lines.map((l, i) => l.length * (i === 0 ? 7 : 5.8))) + PX * 2
  const h = lines.length * LINE_H + PY * 2

  // Clamp so box stays inside chart area
  const bx = Math.max(PAD.left, Math.min(x - w / 2, PAD.left + IW - w))
  const by = Math.max(PAD.top - 4, y - h - 8)

  return (
    <g>
      <rect x={bx} y={by} width={w} height={h} rx={5}
        fill={ELEVATED} stroke={EDGE} strokeWidth={1} />
      {lines.map((line, i) => (
        <text
          key={i}
          x={bx + PX}
          y={by + PY + LINE_H * i + 9}
          fill={i === 0 ? INK : INK_SEC}
          fontSize={i === 0 ? 12 : 10}
          fontWeight={i === 0 ? '600' : 'normal'}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LineChart({
  values, dates, tooltips, unit = '', gradId = 'lcg',
}: LineChartProps) {
  const svgRef  = useRef<SVGSVGElement>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  if (values.length === 0) return null

  const n    = values.length
  const minV = Math.min(...values)
  const maxV = Math.max(...values)

  // Y-axis ticks
  const yStep = niceStep((maxV - minV || maxV * 0.1 || 10) / 4)
  const yMin  = Math.floor(minV / yStep) * yStep
  const yMax  = Math.ceil(maxV  / yStep) * yStep
  const yTicks: number[] = []
  for (let v = yMin; v <= yMax; v += yStep) yTicks.push(v)

  function svgX(i: number) {
    return n === 1 ? PAD.left + IW / 2 : PAD.left + (i / (n - 1)) * IW
  }
  function svgY(v: number) {
    return PAD.top + IH - ((v - yMin) / (yMax - yMin || 1)) * IH
  }

  const pts      = values.map((v, i) => ({ x: svgX(i), y: svgY(v) }))
  const linePath = smoothPath(pts)
  const areaPath = `${linePath} L ${pts[n-1].x} ${PAD.top+IH} L ${pts[0].x} ${PAD.top+IH} Z`
  const labelIdx = xLabelIndices(n, 5)

  // ── pointer interaction ──
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx  = ((e.clientX - rect.left) / rect.width) * VW
    let best = 0, bestDist = Infinity
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - sx)
      if (d < bestDist) { bestDist = d; best = i }
    })
    setActiveIdx(best)
  }

  const ap = activeIdx !== null ? pts[activeIdx] : null

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      className="overflow-visible touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setActiveIdx(null)}
      onPointerDown={onPointerMove}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={ACCENT} stopOpacity="0.22" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0"    />
        </linearGradient>
        <clipPath id={`${gradId}-clip`}>
          <rect x={PAD.left} y={PAD.top} width={IW} height={IH} />
        </clipPath>
      </defs>

      {/* Y-axis grid + labels */}
      {yTicks.map(v => {
        const y = svgY(v)
        if (y < PAD.top - 2 || y > PAD.top + IH + 2) return null
        return (
          <g key={v}>
            <line x1={PAD.left} y1={y} x2={PAD.left + IW} y2={y}
              stroke={EDGE} strokeWidth={1} />
            <text x={PAD.left - 5} y={y + 4}
              fill={INK_DIS} fontSize={10} textAnchor="end">
              {v}{unit}
            </text>
          </g>
        )
      })}

      {/* Area + line (clipped) */}
      <g clipPath={`url(#${gradId}-clip)`}>
        <path d={areaPath} fill={`url(#${gradId})`} />
      </g>
      <path d={linePath} fill="none"
        stroke={ACCENT} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" />

      {/* Dots — omit when many points to avoid clutter */}
      {n <= 20 && pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y}
          r={activeIdx === i ? 5.5 : 3}
          fill={ACCENT}
          stroke={activeIdx === i ? ELEVATED : 'none'}
          strokeWidth={activeIdx === i ? 2 : 0}
        />
      ))}
      {/* Always show active dot even when many points */}
      {n > 20 && ap && activeIdx !== null && (
        <circle cx={ap.x} cy={ap.y} r={5.5}
          fill={ACCENT} stroke={ELEVATED} strokeWidth={2} />
      )}

      {/* X-axis labels */}
      {labelIdx.map(i => (
        <text key={i} x={pts[i].x} y={PAD.top + IH + 18}
          fill={INK_DIS} fontSize={10} textAnchor="middle">
          {dates[i]}
        </text>
      ))}

      {/* Crosshair + tooltip */}
      {ap && activeIdx !== null && (
        <>
          <line
            x1={ap.x} y1={PAD.top} x2={ap.x} y2={PAD.top + IH}
            stroke={ACCENT} strokeWidth={1} strokeDasharray="3 2" opacity={0.5}
          />
          <Tooltip
            x={ap.x}
            y={ap.y}
            lines={tooltips[activeIdx].split('\n')}
          />
        </>
      )}
    </svg>
  )
}
