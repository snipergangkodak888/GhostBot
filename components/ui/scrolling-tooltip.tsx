"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

const ScrollingTooltipProvider = TooltipPrimitive.Provider

const ScrollingTooltip = TooltipPrimitive.Root

const ScrollingTooltipTrigger = TooltipPrimitive.Trigger

const ScrollingTooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={12}
      side="left"
      align="center"
      className={cn(
        "z-[100] overflow-hidden rounded-md bg-white px-2 py-1 text-[10px] text-gray-900 shadow-lg border border-gray-200",
        className
      )}
      {...props}
    >
      <div className="w-[70px] overflow-hidden whitespace-nowrap">
        <span className="inline-block animate-scroll-infinite font-medium">
          {children}
          <span className="inline-block w-4"></span>
          {children}
        </span>
      </div>
      <TooltipPrimitive.Arrow 
        className="fill-white stroke-gray-200" 
        width={10} 
        height={5}
      />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
ScrollingTooltipContent.displayName = TooltipPrimitive.Content.displayName

export { ScrollingTooltip, ScrollingTooltipTrigger, ScrollingTooltipContent, ScrollingTooltipProvider }
