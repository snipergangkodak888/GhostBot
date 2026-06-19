"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type AnimatedShinyTextProps = React.HTMLAttributes<HTMLSpanElement>

export const AnimatedShinyText = React.forwardRef<HTMLSpanElement, AnimatedShinyTextProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "relative inline-flex bg-[linear-gradient(110deg,#ffd700_45%,#ffffff_55%,#ffd700)] bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer",
          className
        )}
        {...props}
      >
        {children}
      </span>
    )
  }
)

AnimatedShinyText.displayName = "AnimatedShinyText"
