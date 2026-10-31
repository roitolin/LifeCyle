import { useEffect, useRef } from 'react'
import './useProductScrollReveal.css'

const REVEAL_SELECTOR = '[data-product-scroll-reveal]'

export function useProductScrollReveal<T extends HTMLElement>(refreshKey: string) {
  const containerRef = useRef<T>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const cards = Array.from(container.querySelectorAll<HTMLElement>(REVEAL_SELECTOR))
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    cards.forEach((card, index) => {
      card.classList.remove('product-scroll-reveal-visible')
      card.style.setProperty('--product-reveal-delay', `${(index % 5) * 55}ms`)
    })

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      cards.forEach(card => card.classList.add('product-scroll-reveal-visible'))
      return
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('product-scroll-reveal-visible')
        observer.unobserve(entry.target)
      })
    }, {
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.08,
    })

    cards.forEach(card => observer.observe(card))
    return () => observer.disconnect()
  }, [refreshKey])

  return containerRef
}
