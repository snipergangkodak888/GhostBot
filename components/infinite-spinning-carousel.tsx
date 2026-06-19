'use client'

import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay, Navigation, Pagination } from 'swiper/modules'

// Import Swiper styles
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

interface CarouselItem {
  id: string | number
  title: string
  image?: string
  description?: string
}

interface InfiniteSpinningCarouselProps {
  items: CarouselItem[]
  slidesPerView?: number | 'auto'
  spaceBetween?: number
  speed?: number
  autoplayDelay?: number
  showNavigation?: boolean
  showPagination?: boolean
  className?: string
}

export function InfiniteSpinningCarousel({
  items,
  slidesPerView = 3,
  spaceBetween = 20,
  speed = 600,
  autoplayDelay = 3000,
  showNavigation = true,
  showPagination = true,
  className = '',
}: InfiniteSpinningCarouselProps) {
  // Swiper requires at least (slidesPerView + 1) slides for seamless looping
  // If not enough items, we can't use loop mode
  const canLoop = items.length > (typeof slidesPerView === 'number' ? slidesPerView : 1)

  return (
    <div className={`infinite-carousel-wrapper ${className}`}>
      <Swiper
        modules={[Autoplay, Navigation, Pagination]}
        spaceBetween={spaceBetween}
        slidesPerView={slidesPerView}
        speed={speed}
        loop={canLoop}
        loopAdditionalSlides={2}
        autoplay={{
          delay: autoplayDelay,
          disableOnInteraction: false,
          pauseOnMouseEnter: true,
        }}
        navigation={showNavigation}
        pagination={showPagination ? { clickable: true } : false}
        breakpoints={{
          320: {
            slidesPerView: 1,
            spaceBetween: 10,
          },
          640: {
            slidesPerView: 2,
            spaceBetween: 15,
          },
          1024: {
            slidesPerView: typeof slidesPerView === 'number' ? slidesPerView : 3,
            spaceBetween: spaceBetween,
          },
        }}
        className="infinite-swiper"
      >
        {items.map((item) => (
          <SwiperSlide key={item.id}>
            <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl p-4 h-full">
              {item.image && (
                <div className="aspect-video rounded-xl overflow-hidden mb-3 bg-white/5">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <h3 className="text-lg font-semibold text-white mb-1">{item.title}</h3>
              {item.description && (
                <p className="text-sm text-gray-400">{item.description}</p>
              )}
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      <style jsx global>{`
        .infinite-swiper {
          padding-bottom: 40px;
        }
        
        .infinite-swiper .swiper-button-prev,
        .infinite-swiper .swiper-button-next {
          color: white;
          background: rgba(0, 0, 0, 0.5);
          width: 40px;
          height: 40px;
          border-radius: 50%;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .infinite-swiper .swiper-button-prev:after,
        .infinite-swiper .swiper-button-next:after {
          font-size: 16px;
          font-weight: bold;
        }
        
        .infinite-swiper .swiper-button-prev:hover,
        .infinite-swiper .swiper-button-next:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        
        .infinite-swiper .swiper-pagination-bullet {
          background: rgba(255, 255, 255, 0.3);
          opacity: 1;
        }
        
        .infinite-swiper .swiper-pagination-bullet-active {
          background: white;
        }
      `}</style>
    </div>
  )
}

// Example usage component
export function CarouselExample() {
  const sampleItems: CarouselItem[] = [
    { id: 1, title: 'Item 1', description: 'Description for item 1' },
    { id: 2, title: 'Item 2', description: 'Description for item 2' },
    { id: 3, title: 'Item 3', description: 'Description for item 3' },
    { id: 4, title: 'Item 4', description: 'Description for item 4' },
    { id: 5, title: 'Item 5', description: 'Description for item 5' },
    { id: 6, title: 'Item 6', description: 'Description for item 6' },
  ]

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-white mb-4">Infinite Carousel</h2>
      <InfiniteSpinningCarousel
        items={sampleItems}
        slidesPerView={3}
        spaceBetween={20}
        autoplayDelay={3000}
      />
    </div>
  )
}
