"use client"

import * as React from 'react'
import { cn } from '@/lib/utils'

type MarqueeProps = React.ComponentPropsWithoutRef<'div'> & {
  reverse?: boolean
  pauseOnHover?: boolean
  vertical?: boolean
  durationSeconds?: number
}

export function Marquee({
  className,
  children,
  reverse = false,
  pauseOnHover = false,
  vertical = false,
  durationSeconds = 30,
  ...props
}: MarqueeProps) {
  // Duplicate children to create a seamless loop
  const content = React.Children.toArray(children)
  const items = [...content, ...content]

  return (
    <div
      className={cn(
        'marquee',
        vertical && 'marquee--vertical',
        reverse && 'marquee--reverse',
        pauseOnHover && 'marquee--pause-on-hover',
        className,
      )}
      style={{
        // @ts-ignore CSS custom property
        '--duration': `${Math.max(8, durationSeconds)}s`,
      }}
      {...props}
    >
      <div className="marquee__inner">
        {items.map((child, i) => (
          <div className="marquee__item" key={i}>{child}</div>
        ))}
      </div>
    </div>
  )
}

export default Marquee
