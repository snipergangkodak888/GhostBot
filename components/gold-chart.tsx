"use client"

import { useEffect, useRef, useState, useCallback, memo } from "react"
import {
  createChart,
  ColorType,
  AreaSeries,
  IChartApi,
  ISeriesApi,
  Time,
  CrosshairMode,
  LineType,
} from "lightweight-charts"

type TimeRange = "1m" | "5m" | "15m" | "1h" | "4h" | "1D"

interface LineData {
  time: Time
  value: number
}

interface GoldChartProps {
  onPriceUpdate?: (price: number, change24h: number) => void
}

// Colors per interval — matching the TradingView range-switcher demo style
const INTERVAL_COLORS: Record<TimeRange, { line: string; topArea: string; bottomArea: string }> = {
  "1m":  { line: "#FFD700", topArea: "rgba(255,215,0,0.28)", bottomArea: "rgba(255,215,0,0.02)" },
  "5m":  { line: "#FFA500", topArea: "rgba(255,165,0,0.28)", bottomArea: "rgba(255,165,0,0.02)" },
  "15m": { line: "#2962FF", topArea: "rgba(41,98,255,0.28)", bottomArea: "rgba(41,98,255,0.02)" },
  "1h":  { line: "rgb(225, 87, 90)", topArea: "rgba(225,87,90,0.28)", bottomArea: "rgba(225,87,90,0.02)" },
  "4h":  { line: "rgb(242, 142, 44)", topArea: "rgba(242,142,44,0.28)", bottomArea: "rgba(242,142,44,0.02)" },
  "1D":  { line: "rgb(164, 89, 209)", topArea: "rgba(164,89,209,0.28)", bottomArea: "rgba(164,89,209,0.02)" },
}

const RANGE_CONFIG: Record<
  TimeRange,
  { label: string; interval: string; limit: number; pollInterval: number }
> = {
  "1m": { label: "1m", interval: "1m", limit: 120, pollInterval: 3000 },
  "5m": { label: "5m", interval: "5m", limit: 120, pollInterval: 5000 },
  "15m": { label: "15m", interval: "15m", limit: 120, pollInterval: 10000 },
  "1h": { label: "1H", interval: "1h", limit: 120, pollInterval: 15000 },
  "4h": { label: "4H", interval: "4h", limit: 120, pollInterval: 30000 },
  "1D": { label: "1D", interval: "1d", limit: 120, pollInterval: 60000 },
}

function GoldChart({ onPriceUpdate }: GoldChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [selectedRange, setSelectedRange] = useState<TimeRange>("15m")
  const [currentPrice, setCurrentPrice] = useState<number>(0)
  const [priceChange, setPriceChange] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(false)

  // Initialize chart once
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.5)",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,215,0,0.3)", width: 1, style: 2, labelBackgroundColor: "rgba(255,215,0,0.8)" },
        horzLine: { color: "rgba(255,215,0,0.3)", width: 1, style: 2, labelBackgroundColor: "rgba(255,215,0,0.8)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.1)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: false },
    })

    // AreaSeries = line chart with gradient fill — matching range-switcher demo style
    const defaultColors = INTERVAL_COLORS["15m"]
    const series = chart.addSeries(AreaSeries, {
      lineColor: defaultColors.line,
      topColor: defaultColors.topArea,
      bottomColor: defaultColors.bottomArea,
      lineWidth: 2,
      lineType: LineType.Curved,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: defaultColors.line,
    })

    chartRef.current = chart
    seriesRef.current = series

    // Handle container resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
      }
    }

    const observer = new ResizeObserver(handleResize)
    observer.observe(chartContainerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Fetch full historical data for the selected range
  const fetchHistoricalData = useCallback(
    async (range: TimeRange) => {
      const config = RANGE_CONFIG[range]
      setIsLoading(true)
      try {
        const response = await fetch(
          `/api/proxy/binance?symbol=XAUTUSDT&interval=${config.interval}&limit=${config.limit}`
        )
        if (!response.ok) return

        const data = await response.json()
        if (!Array.isArray(data) || data.length === 0) return

        // Convert OHLCV candles to line data (close price)
        const lineData: LineData[] = data.map((d: any[]) => ({
          time: (d[0] / 1000) as Time,
          value: parseFloat(d[4]), // close price
        }))

        if (seriesRef.current && lineData.length > 0) {
          // Swap data + apply interval color — exactly like the demo's setChartInterval()
          const colors = INTERVAL_COLORS[range]
          seriesRef.current.setData(lineData)
          seriesRef.current.applyOptions({
            lineColor: colors.line,
            topColor: colors.topArea,
            bottomColor: colors.bottomArea,
            crosshairMarkerBackgroundColor: colors.line,
          })
          chartRef.current?.timeScale().fitContent()

          const lastPrice = lineData[lineData.length - 1].value
          const firstPrice = lineData[0].value
          const change = ((lastPrice - firstPrice) / firstPrice) * 100

          setCurrentPrice(lastPrice)
          setPriceChange(change)
          onPriceUpdate?.(lastPrice, change)
        }
      } catch (error) {
        console.error("Failed to fetch historical data:", error)
      } finally {
        setIsLoading(false)
      }
    },
    [onPriceUpdate]
  )

  // Poll latest data point to keep chart updating live
  const pollLatestCandle = useCallback(
    async (range: TimeRange) => {
      const config = RANGE_CONFIG[range]
      try {
        const response = await fetch(
          `/api/proxy/binance?symbol=XAUTUSDT&interval=${config.interval}&limit=2`
        )
        if (!response.ok) return

        const data = await response.json()
        if (!Array.isArray(data) || data.length === 0) return

        const latest = data[data.length - 1]
        const point: LineData = {
          time: (latest[0] / 1000) as Time,
          value: parseFloat(latest[4]), // close price
        }

        if (seriesRef.current) {
          seriesRef.current.update(point)
        }

        setCurrentPrice(point.value)
      } catch {
        // Silent — will retry on next poll cycle
      }
    },
    []
  )

  // Range switcher: swap data + color + restart polling (following demo pattern)
  const setChartInterval = useCallback(
    (range: TimeRange) => {
      // Clear existing poll
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }

      setSelectedRange(range)

      // Fetch full dataset for the new range
      fetchHistoricalData(range)

      // Start polling for live updates at range-appropriate frequency
      const config = RANGE_CONFIG[range]
      pollRef.current = setInterval(() => {
        pollLatestCandle(range)
      }, config.pollInterval)
    },
    [fetchHistoricalData, pollLatestCandle]
  )

  // Initial load + start polling
  useEffect(() => {
    setChartInterval(selectedRange)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-full">
      {/* Price Header */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-[#FFD700]">GOLD/USDT</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#FFD700] animate-pulse" />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-2xl font-bold text-white">
              ${currentPrice > 0 ? currentPrice.toFixed(2) : "---"}
            </span>
            {currentPrice > 0 && (
              <span
                className={`text-sm font-semibold ${
                  priceChange >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {priceChange >= 0 ? "+" : ""}
                {priceChange.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        {isLoading && (
          <div className="w-4 h-4 border-2 border-[#FFD700]/30 border-t-[#FFD700] rounded-full animate-spin" />
        )}
      </div>

      {/* Chart */}
      <div
        ref={chartContainerRef}
        className="w-full rounded-xl overflow-hidden border border-white/5"
        style={{ height: 260 }}
      />

      {/* Range Switcher — following TradingView range-switcher demo pattern */}
      <div className="flex items-center justify-center gap-1 mt-3">
        {(Object.keys(RANGE_CONFIG) as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => setChartInterval(range)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedRange === range
                ? "bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30"
                : "bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent"
            }`}
          >
            {RANGE_CONFIG[range].label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default memo(GoldChart)
