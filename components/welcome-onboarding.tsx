"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Rocket, Coins, Trophy, Sparkles } from "lucide-react"

interface WelcomeOnboardingProps {
  onComplete: () => void
}

const ONBOARDING_SCREENS = [
  {
    title: "Welcome to Metal!",
    subtitle: "Trade gold, earn Metal tokens",
    description: "Track live gold prices, complete tasks, and earn Metal tokens you can withdraw as USDT.",
    icon: Rocket,
  },
  {
    title: "Earn Metal Tokens",
    subtitle: "Complete tasks & watch ads",
    description: "Earn Metal tokens by completing tasks, watching ads, and inviting friends. Level up through battles!",
    icon: Coins,
  },
  {
    title: "Climb the Leaderboard",
    subtitle: "Compete with friends",
    description: "Invite friends, earn medals in battles, and climb the global leaderboard to become a top trader!",
    icon: Trophy,
  },
]

export default function WelcomeOnboarding({ onComplete }: WelcomeOnboardingProps) {
  const [currentScreen, setCurrentScreen] = useState(0)

  const handleNext = () => {
    if (currentScreen < ONBOARDING_SCREENS.length - 1) {
      setCurrentScreen(currentScreen + 1)
    } else {
      // Mark onboarding as complete and call callback
      localStorage.setItem('metal_onboarding_complete', 'true')
    }
  }

  const handlePrev = () => {
    if (currentScreen > 0) {
      setCurrentScreen(currentScreen - 1)
    }
  }

  const handleSkip = () => {
    localStorage.setItem('metal_onboarding_complete', 'true')
  }

  const screen = ONBOARDING_SCREENS[currentScreen]
  const Icon = screen.icon
  const isLastScreen = currentScreen === ONBOARDING_SCREENS.length - 1

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Skip Button */}
      <div className="flex justify-end p-4">
        <button 
          onClick={handleSkip}
          className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-32">
        {/* Icon with app-themed background */}
        <div className="w-32 h-32 rounded-full bg-white/10 border border-white/20 flex items-center justify-center mb-8">
          <Icon className="w-16 h-16 text-white" />
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-white text-center mb-2">
          {screen.title}
        </h1>

        {/* Subtitle */}
        <p className="text-lg font-medium text-gray-400 text-center mb-4">
          {screen.subtitle}
        </p>

        {/* Description */}
        <p className="text-gray-500 text-center max-w-sm leading-relaxed">
          {screen.description}
        </p>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black to-transparent">
        {/* Progress Dots */}
        <div className="flex justify-center gap-2 mb-6">
          {ONBOARDING_SCREENS.map((_, index) => (
            <div
              key={index}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                index === currentScreen 
                  ? 'bg-white w-8' 
                  : index < currentScreen 
                    ? 'bg-white/50 w-2.5' 
                    : 'bg-white/20 w-2.5'
              }`}
            />
          ))}
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center gap-4">
          {/* Back Button */}
          <button
            onClick={handlePrev}
            disabled={currentScreen === 0}
            className={`flex items-center justify-center w-14 h-14 rounded-full border transition-all ${
              currentScreen === 0 
                ? 'border-white/10 text-gray-700 cursor-not-allowed' 
                : 'border-white/20 text-white hover:bg-white/10'
            }`}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          {/* Next/Get Started Button */}
          <button
            onClick={handleNext}
            className="flex-1 h-14 rounded-full font-semibold text-lg transition-all flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-200"
          >
            {isLastScreen ? 'Get Started' : 'Next'}
            {!isLastScreen && <ChevronRight className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
