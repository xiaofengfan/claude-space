import { useState, useCallback, useEffect, useRef } from 'react'

export function useSplitter(options: {
  direction: 'horizontal' | 'vertical'
  initialSize: number
  minSize?: number
  maxSize?: number
  reverse?: boolean
  onResize?: (size: number) => void
}) {
  const { direction, initialSize, minSize = 100, maxSize = 600, reverse, onResize } = options
  const [size, setSize] = useState(initialSize)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ pos: 0, size: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    startRef.current = {
      pos: direction === 'horizontal' ? e.clientX : e.clientY,
      size: size,
    }
  }, [direction, size])

  useEffect(() => {
    if (!dragging) return

    const onMouseMove = (e: MouseEvent) => {
      let delta = (direction === 'horizontal' ? e.clientX : e.clientY) - startRef.current.pos
      if (reverse) delta = -delta
      const newSize = Math.min(maxSize, Math.max(minSize, startRef.current.size + delta))
      setSize(newSize)
      onResize?.(newSize)
    }

    const onMouseUp = () => {
      setDragging(false)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging, direction, minSize, maxSize, onResize])

  return { size, dragging, onMouseDown }
}
