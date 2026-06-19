"use client"

import { createContext, useContext, useState, useCallback, ReactNode } from "react"

type NavbarContextType = {
  isNavbarVisible: boolean
  hideNavbar: () => void
  showNavbar: () => void
}

const NavbarContext = createContext<NavbarContextType | undefined>(undefined)

export function NavbarProvider({ children }: { children: ReactNode }) {
  const [isNavbarVisible, setIsNavbarVisible] = useState(true)

  const hideNavbar = useCallback(() => setIsNavbarVisible(false), [])
  const showNavbar = useCallback(() => setIsNavbarVisible(true), [])

  return (
    <NavbarContext.Provider value={{ isNavbarVisible, hideNavbar, showNavbar }}>
      {children}
    </NavbarContext.Provider>
  )
}

export function useNavbar() {
  const context = useContext(NavbarContext)
  if (!context) {
    throw new Error("useNavbar must be used within a NavbarProvider")
  }
  return context
}
