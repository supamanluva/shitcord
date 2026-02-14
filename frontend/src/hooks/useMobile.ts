import { useState, useEffect } from 'react'

/**
 * Detects mobile devices using multiple signals:
 * 1. Screen width (< 1024px)
 * 2. Touch support
 * 3. User agent string
 * 
 * Also adds/removes 'is-mobile' class on <html> for CSS targeting.
 */
export function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => detectMobile())

  useEffect(() => {
    const check = () => {
      const mobile = detectMobile()
      setIsMobile(mobile)
      document.documentElement.classList.toggle('is-mobile', mobile)
    }

    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return isMobile
}

function detectMobile(): boolean {
  // Check user agent for mobile devices
  const ua = navigator.userAgent || ''
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua)

  // Check for touch support
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  // Check screen width (real screen, not viewport - catches "Request Desktop Site")
  const smallScreen = window.screen.width <= 1024 || window.screen.height <= 1024

  // Mobile if: (has touch AND small screen) OR (mobile user agent)
  return (hasTouch && smallScreen) || mobileUA
}
