"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Eye, EyeOff } from "lucide-react"

interface MeetPipProps {
  side: "left" | "right"
  targetVertical?: "top" | "bottom" | "center" | null
  videoRef?: React.RefObject<HTMLVideoElement>
  isTracking?: boolean
  isEyeTrackingEnabled?: boolean
  onPositionChange?: (position: { side: "left" | "right"; vertical: "top" | "bottom" | "center" }) => void
  onDragStart?: () => void
  onDragEnd?: (finalPosition: { side: "left" | "right"; vertical: "top" | "bottom" | "center" }) => void
  isEnlarged?: boolean
  onStartTracking?: () => void
  onStopTracking?: () => void
  isLoading?: boolean
  isWebcamOn?: boolean
}

// Physics constants
const FRICTION = 0.88 // Velocity damping per frame (higher mass = more friction)
const BOUNCE_DAMPING = 0.3 // Bounce damping when hitting boundaries (barely bouncy)
const VIEWPORT_PADDING = 24 // Padding from viewport edges in pixels
const MAX_VELOCITY = 15 // Maximum velocity cap (gentler movement)
const EYE_TRACKING_SPRING = 0.08 // Spring constant for eye tracking movement (gentle spring)
const SPRING_DAMPING = 0.85 // Additional damping for spring to prevent oscillation

export const MeetPip = ({ side, targetVertical = null, videoRef, isTracking = false, isEyeTrackingEnabled = false, onPositionChange, onDragStart, onDragEnd, isEnlarged = false, onStartTracking, onStopTracking, isLoading = false, isWebcamOn = true }: MeetPipProps) => {
  const [dimensions, setDimensions] = useState({ width: 320, height: 280 })
  const [isResizing, setIsResizing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isExpandHovered, setIsExpandHovered] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const resizeStartRef = useRef({ 
    mouseX: 0, 
    mouseY: 0, 
    width: 0, 
    height: 0, 
    anchorX: 0, 
    anchorY: 0,
    startPosX: 0,
    startPosY: 0,
    wrapperLeft: 0
  })
  const dragStartPosRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })
  const currentDimensionsRef = useRef({ width: 320, height: 280 })
  const currentPositionRef = useRef({ x: 0, y: 0 })
  
  // Physics state
  const velocityRef = useRef({ x: 0, y: 0 })
  const lastMousePosRef = useRef({ x: 0, y: 0 })
  const lastMouseTimeRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const targetPositionRef = useRef<{ x: number; y: number } | null>(null)
  const prevSideRef = useRef<"left" | "right">(side)
  const prevTargetVerticalRef = useRef<"top" | "bottom" | "center" | null>(targetVertical)
  
  // Maintain aspect ratio (4:3)
  const ASPECT_RATIO = 4 / 3
  const MIN_WIDTH = 240
  const MAX_WIDTH = 640
  const MIN_HEIGHT = MIN_WIDTH / ASPECT_RATIO
  const MAX_HEIGHT = MAX_WIDTH / ASPECT_RATIO

  // Get viewport bounds with padding
  const getViewportBounds = useCallback(() => {
    const width = currentDimensionsRef.current.width
    const height = currentDimensionsRef.current.height
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    // pos.y is relative to center (0 = viewport center)
    // Pip center position in screen coords = viewportHeight/2 + pos.y
    // Pip top edge = center - height/2 should be >= VIEWPORT_PADDING from top
    // Pip bottom edge = center + height/2 should be <= viewportHeight - VIEWPORT_PADDING from top
    // Therefore:
    // - minY: center should be at least VIEWPORT_PADDING + height/2 from top
    //         In relative coords: VIEWPORT_PADDING + height/2 - viewportHeight/2
    // - maxY: center should be at most viewportHeight - VIEWPORT_PADDING - height/2 from top
    //         In relative coords: viewportHeight - VIEWPORT_PADDING - height/2 - viewportHeight/2
    
    // Calculate bounds based on side
    if (side === "left") {
      return {
        minX: 0, // When pos.x = 0, pip is at VIEWPORT_PADDING from left
        maxX: viewportWidth - width - VIEWPORT_PADDING * 2, // Keep pip within bounds
        minY: VIEWPORT_PADDING + height / 2 - viewportHeight / 2,
        maxY: viewportHeight / 2 - VIEWPORT_PADDING - height / 2,
      }
    } else {
      // For right side, position.x is relative to right edge
      // Negative x moves left, positive x moves right
      return {
        minX: -(viewportWidth - VIEWPORT_PADDING * 2 - width), // Keep pip within bounds
        maxX: 0, // When pos.x = 0, pip is at VIEWPORT_PADDING from right
        minY: VIEWPORT_PADDING + height / 2 - viewportHeight / 2,
        maxY: viewportHeight / 2 - VIEWPORT_PADDING - height / 2,
      }
    }
  }, [side])

  // Clamp position to viewport bounds
  const clampPosition = useCallback((pos: { x: number; y: number }) => {
    const bounds = getViewportBounds()
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, pos.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, pos.y)),
    }
  }, [getViewportBounds])

  // Update DOM directly for smooth animation (bypassing React re-renders)
  const updateDOM = useCallback((pos: { x: number; y: number }) => {
    if (!wrapperRef.current) return
    
    const baseOffset = VIEWPORT_PADDING // Use same padding as vertical (24px)
    const element = wrapperRef.current
    
    // Use transform for better performance instead of left/right changes
    if (side === "left") {
      const translateX = baseOffset + pos.x
      element.style.transform = `translate(${translateX}px, calc(-50% + ${pos.y}px))`
      element.style.left = "0"
      element.style.right = "auto"
    } else {
      const translateX = -(baseOffset - pos.x)
      element.style.transform = `translate(${translateX}px, calc(-50% + ${pos.y}px))`
      element.style.left = "auto"
      element.style.right = "0"
    }
    
    // Report position to parent
    if (onPositionChange) {
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth
      const pipHeight = currentDimensionsRef.current.height
      const pipWidth = currentDimensionsRef.current.width
      const baseOffset = VIEWPORT_PADDING
      
      // Calculate absolute screen position of PiP center
      let pipCenterX: number
      if (side === "left") {
        pipCenterX = baseOffset + pipWidth / 2 + pos.x
      } else {
        pipCenterX = viewportWidth - baseOffset - pipWidth / 2 + pos.x
      }
      
      // Determine which horizontal zone the PiP is actually in
      const leftThirdBoundary = viewportWidth / 3
      const rightThirdBoundary = (viewportWidth * 2) / 3
      
      let reportedSide: "left" | "right"
      if (pipCenterX < leftThirdBoundary) {
        reportedSide = "left"
      } else if (pipCenterX > rightThirdBoundary) {
        reportedSide = "right"
      } else {
        // PiP is in center zone - keep reporting current side
        reportedSide = side
      }
      
      // pos.y is relative to center (0 = center)
      // Divide viewport into thirds vertically
      // Top third: top of screen to 1/3 down
      // Center third: 1/3 to 2/3 down  
      // Bottom third: 2/3 to bottom
      
      // In relative coords (where 0 = viewport center):
      // Top third ends at: viewportHeight/3 - viewportHeight/2 = -viewportHeight/6
      // Bottom third starts at: (2*viewportHeight/3) - viewportHeight/2 = viewportHeight/6
      
      const topThirdBoundary = -viewportHeight / 6
      const bottomThirdBoundary = viewportHeight / 6
      
      let vertical: "top" | "bottom" | "center"
      if (pos.y < topThirdBoundary) {
        vertical = "top"
      } else if (pos.y > bottomThirdBoundary) {
        vertical = "bottom"
      } else {
        vertical = "center"
      }
      
      console.log(`Pip position: x=${pos.x}, y=${pos.y}, centerX=${pipCenterX.toFixed(0)}, side=${reportedSide}, vertical=${vertical}`)
      
      onPositionChange({ side: reportedSide, vertical })
    }
  }, [side, onPositionChange])

  // Physics update function
  const updatePhysics = useCallback(() => {
    const currentPos = currentPositionRef.current
    let newPos = { ...currentPos }
    let newVel = { ...velocityRef.current }

    // Handle eye tracking target position (spring physics)
    if (targetPositionRef.current) {
      const target = targetPositionRef.current
      const dx = target.x - currentPos.x
      const dy = target.y - currentPos.y
      
      // Apply spring force
      newVel.x += dx * EYE_TRACKING_SPRING
      newVel.y += dy * EYE_TRACKING_SPRING
      
      // Apply spring damping to prevent oscillation
      newVel.x *= SPRING_DAMPING
      newVel.y *= SPRING_DAMPING
      
      // If very close to target, snap to it
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(newVel.x) < 0.3 && Math.abs(newVel.y) < 0.3) {
        newPos = { ...target }
        newVel = { x: 0, y: 0 }
        targetPositionRef.current = null
      }
    }

    // Apply velocity
    newPos.x += newVel.x
    newPos.y += newVel.y

    // Apply friction
    newVel.x *= FRICTION
    newVel.y *= FRICTION

    // Clamp velocity
    newVel.x = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, newVel.x))
    newVel.y = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, newVel.y))

    // Check boundaries and bounce
    const bounds = getViewportBounds()
    let bounced = false

    if (newPos.x < bounds.minX) {
      newPos.x = bounds.minX
      newVel.x *= -BOUNCE_DAMPING
      bounced = true
    } else if (newPos.x > bounds.maxX) {
      newPos.x = bounds.maxX
      newVel.x *= -BOUNCE_DAMPING
      bounced = true
    }

    if (newPos.y < bounds.minY) {
      newPos.y = bounds.minY
      newVel.y *= -BOUNCE_DAMPING
      bounced = true
    } else if (newPos.y > bounds.maxY) {
      newPos.y = bounds.maxY
      newVel.y *= -BOUNCE_DAMPING
      bounced = true
    }

    // Stop if velocity is very small
    if (Math.abs(newVel.x) < 0.05 && Math.abs(newVel.y) < 0.05 && !targetPositionRef.current) {
      newVel.x = 0
      newVel.y = 0
    }

    // Update refs
    currentPositionRef.current = newPos
    velocityRef.current = newVel
    
    // Update DOM directly (no React re-render)
    updateDOM(newPos)

    // Continue animation if there's movement or target
    if (
      Math.abs(newVel.x) > 0.005 ||
      Math.abs(newVel.y) > 0.005 ||
      targetPositionRef.current
    ) {
      animationFrameRef.current = requestAnimationFrame(updatePhysics)
    } else {
      // Animation finished
      animationFrameRef.current = null
    }
  }, [getViewportBounds, updateDOM])

  // Start physics animation loop
  const startPhysics = useCallback(() => {
    // Cancel any existing animation to ensure fresh start
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    animationFrameRef.current = requestAnimationFrame(updatePhysics)
  }, [updatePhysics])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (containerRef.current && wrapperRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const wrapperRect = wrapperRef.current.getBoundingClientRect()
      setIsResizing(true)
      
      // Stop any physics
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      velocityRef.current = { x: 0, y: 0 }
      targetPositionRef.current = null
      
      // Store the top-right corner as the anchor point
      resizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        width: currentDimensionsRef.current.width,
        height: currentDimensionsRef.current.height,
        anchorX: rect.right,
        anchorY: rect.top,
        startPosX: currentPositionRef.current.x,
        startPosY: currentPositionRef.current.y,
        wrapperLeft: wrapperRect.left,
      }
    }
  }, [])

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    
    e.preventDefault()

    // Calculate new dimensions independently based on distance from anchor point (top-right corner)
    const rawWidth = resizeStartRef.current.anchorX - e.clientX
    const rawHeight = e.clientY - resizeStartRef.current.anchorY
    
    // Clamp to min/max bounds independently
    const finalWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, rawWidth))
    const finalHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, rawHeight))

    // Calculate position adjustments to keep top-right corner fixed
    const widthDelta = finalWidth - resizeStartRef.current.width
    const heightDelta = finalHeight - resizeStartRef.current.height
    
    // For X: Only adjust for LEFT side (right side anchor is automatic due to right: 0 positioning)
    // For Y: Adjust for centering transform
    const newPosition = {
      x: side === "left" ? resizeStartRef.current.startPosX - widthDelta : resizeStartRef.current.startPosX,
      y: resizeStartRef.current.startPosY + heightDelta / 2,
    }

    // Update refs
    currentDimensionsRef.current = { width: finalWidth, height: finalHeight }
    currentPositionRef.current = newPosition

    // Update React state
    setPosition(newPosition)
    setDimensions({ width: finalWidth, height: finalHeight })
  }, [isResizing, MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT, side])

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Don't start dragging if clicking on buttons, resize handle, or if already resizing
    const target = e.target as HTMLElement
    if (
      target.closest("button") ||
      target.closest("[aria-label='Resize window']") ||
      isResizing
    ) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect()
      setIsDragging(true)
      
      // Notify parent that user is taking control
      onDragStart?.()
      
      // Stop any ongoing physics animation
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      
      // Reset velocity and clear target
      velocityRef.current = { x: 0, y: 0 }
      targetPositionRef.current = null
      
      // Use the actual current position from ref, not stale state
      dragStartPosRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: currentPositionRef.current.x,
        offsetY: currentPositionRef.current.y,
      }
      
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }
      lastMouseTimeRef.current = performance.now()
    }
  }, [isResizing, onDragStart])

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    
    e.preventDefault()

    const deltaX = e.clientX - dragStartPosRef.current.x
    const deltaY = e.clientY - dragStartPosRef.current.y

    const newPos = {
      x: dragStartPosRef.current.offsetX + deltaX,
      y: dragStartPosRef.current.offsetY + deltaY,
    }

    // Clamp position during drag
    const clampedPos = clampPosition(newPos)
    
    // Calculate velocity for fling effect
    const now = performance.now()
    const dt = Math.max(1, now - lastMouseTimeRef.current) / 16.67 // Normalize to ~60fps
    const dx = e.clientX - lastMousePosRef.current.x
    const dy = e.clientY - lastMousePosRef.current.y
    
    if (dt > 0) {
      velocityRef.current = {
        x: (dx / dt) * 0.25, // Scale down for gentle fling
        y: (dy / dt) * 0.25,
      }
    }

    lastMousePosRef.current = { x: e.clientX, y: e.clientY }
    lastMouseTimeRef.current = now

    currentPositionRef.current = clampedPos
    
    // Update React state during drag (not updateDOM to avoid conflicts)
    setPosition(clampedPos)
  }, [isDragging, clampPosition])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    
    // Clamp position to ensure it's within bounds
    const currentPos = currentPositionRef.current
    const clampedPos = clampPosition(currentPos)
    const wasClamped =
      clampedPos.x !== currentPos.x || clampedPos.y !== currentPos.y
    
    if (wasClamped) {
      currentPositionRef.current = clampedPos
      setPosition(clampedPos)
    }
    
    // Always update DOM to report final position after drag
    updateDOM(clampedPos)
    
    // Calculate final position to report to parent
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const pipHeight = currentDimensionsRef.current.height
    const pipWidth = currentDimensionsRef.current.width
    const baseOffset = VIEWPORT_PADDING
    
    // Calculate absolute screen position of PiP center
    let pipCenterX: number
    if (side === "left") {
      pipCenterX = baseOffset + pipWidth / 2 + clampedPos.x
    } else {
      pipCenterX = viewportWidth - baseOffset - pipWidth / 2 + clampedPos.x
    }
    
    // Determine which horizontal zone the PiP is actually in
    const leftThirdBoundary = viewportWidth / 3
    const rightThirdBoundary = (viewportWidth * 2) / 3
    
    let finalSide: "left" | "right"
    if (pipCenterX < leftThirdBoundary) {
      finalSide = "left"
    } else if (pipCenterX > rightThirdBoundary) {
      finalSide = "right"
    } else {
      // PiP is in center zone - keep current side
      finalSide = side
    }
    
    // Calculate vertical zone
    const topThirdBoundary = -viewportHeight / 6
    const bottomThirdBoundary = viewportHeight / 6
    
    let finalVertical: "top" | "bottom" | "center"
    if (clampedPos.y < topThirdBoundary) {
      finalVertical = "top"
    } else if (clampedPos.y > bottomThirdBoundary) {
      finalVertical = "bottom"
    } else {
      finalVertical = "center"
    }
    
    // Notify parent that user released control with final position
    onDragEnd?.({ side: finalSide, vertical: finalVertical })
    
    // Start physics animation with current velocity (fling effect)
    // Also start if position was clamped to allow physics to settle
    if (
      Math.abs(velocityRef.current.x) > 0.05 ||
      Math.abs(velocityRef.current.y) > 0.05 ||
      wasClamped
    ) {
      startPhysics()
    }
  }, [startPhysics, clampPosition, onDragEnd, updateDOM, side])

  // Add/remove event listeners for resize
  useEffect(() => {
    if (isResizing) {
      // Set body cursor and prevent selection during resize
      document.body.style.cursor = "nesw-resize"
      document.body.style.userSelect = "none"
      
      window.addEventListener("mousemove", handleResizeMove)
      window.addEventListener("mouseup", handleResizeEnd)
    } else {
      // Restore body cursor and selection
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      
      window.removeEventListener("mousemove", handleResizeMove)
      window.removeEventListener("mouseup", handleResizeEnd)
    }

    return () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", handleResizeMove)
      window.removeEventListener("mouseup", handleResizeEnd)
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])

  // Always keep refs in sync with state (using useLayoutEffect to run before paint)
  useEffect(() => {
    currentDimensionsRef.current = dimensions
  }, [dimensions])

  useEffect(() => {
    currentPositionRef.current = position
  }, [position])

  // Handle side changes with proper position conversion and animation
  useEffect(() => {
    // Check if side actually changed
    if (prevSideRef.current === side) {
      return
    }
    
    console.log(`Side effect triggered: side changed from ${prevSideRef.current} to ${side}, targetVertical=${targetVertical}`)
    
    const oldSide = prevSideRef.current
    const newSide = side
    prevSideRef.current = side
    
    // Calculate current absolute screen position (before side change)
    const oldPos = currentPositionRef.current
    const width = currentDimensionsRef.current.width
    const viewportWidth = window.innerWidth
    const baseOffset = VIEWPORT_PADDING // Use consistent 24px padding
    
    let absoluteScreenX: number
    if (oldSide === "left") {
      // When on left: screenX = VIEWPORT_PADDING + position.x
      absoluteScreenX = baseOffset + oldPos.x
    } else {
      // When on right: screenX = viewportWidth - VIEWPORT_PADDING - width + position.x
      absoluteScreenX = viewportWidth - baseOffset - width + oldPos.x
    }
    
    // Convert to new coordinate system
    let newPosX: number
    if (newSide === "left") {
      // Target for left side: screenX = VIEWPORT_PADDING + newPos.x
      // newPos.x = screenX - VIEWPORT_PADDING
      newPosX = absoluteScreenX - baseOffset
    } else {
      // Target for right side: screenX = viewportWidth - VIEWPORT_PADDING - width + newPos.x
      // newPos.x = screenX - viewportWidth + VIEWPORT_PADDING + width
      newPosX = absoluteScreenX - viewportWidth + baseOffset + width
    }
    
    // Set the converted position immediately to prevent teleport
    const convertedPos = {
      x: newPosX,
      y: oldPos.y,
    }
    currentPositionRef.current = convertedPos
    setPosition(convertedPos)
    
    // Calculate target Y position based on targetVertical if provided
    const viewportHeight = window.innerHeight
    const pipHeight = currentDimensionsRef.current.height
    const PADDING = 24 // Consistent padding from edges
    
    let targetY: number
    if (targetVertical === "top") {
      // Position at top with 24px padding
      // pip center should be at: PADDING + pipHeight/2 from top
      // In relative coords (where 0 = center): PADDING + pipHeight/2 - viewportHeight/2
      targetY = PADDING + pipHeight / 2 - viewportHeight / 2
      console.log(`Side change: targeting top with ${PADDING}px padding, y=${targetY}, pipHeight=${pipHeight}, viewportHeight=${viewportHeight}`)
    } else if (targetVertical === "bottom") {
      // Position at bottom with 24px padding
      // pip center should be at: viewportHeight - PADDING - pipHeight/2 from top
      // In relative coords: viewportHeight - PADDING - pipHeight/2 - viewportHeight/2
      targetY = viewportHeight / 2 - PADDING - pipHeight / 2
      console.log(`Side change: targeting bottom with ${PADDING}px padding, y=${targetY}, pipHeight=${pipHeight}, viewportHeight=${viewportHeight}`)
    } else {
      // "center" or null - target center
      targetY = 0
      console.log(`Side change: targeting center, y=${targetY}`)
    }
    
    // Animate to target position on the new side
    const targetPos = { x: 0, y: targetY }
    targetPositionRef.current = targetPos
    console.log(`Side change complete: moving from ${oldSide} to ${newSide}, target position:`, targetPos)
    
    // Calculate distance and initial velocity
    const dx = targetPos.x - newPosX
    const dy = targetPos.y - oldPos.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    
    if (distance > 0.5) {
      const directionX = dx / distance
      const directionY = dy / distance
      const initialSpeed = Math.max(distance * 0.1, 2) // Gentle initial velocity
      velocityRef.current = {
        x: directionX * initialSpeed,
        y: directionY * initialSpeed,
      }
    } else {
      velocityRef.current = { x: 0, y: 0 }
    }
    
    // Start physics animation
    startPhysics()
  }, [side, targetVertical, startPhysics, getViewportBounds])

  // Sync prevTargetVerticalRef when targetVertical changes
  useEffect(() => {
    prevTargetVerticalRef.current = targetVertical
  }, [targetVertical])

  // Initialize position on mount
  useEffect(() => {
    // Clamp initial position
    const clampedPos = clampPosition(currentPositionRef.current)
    if (
      clampedPos.x !== currentPositionRef.current.x ||
      clampedPos.y !== currentPositionRef.current.y
    ) {
      currentPositionRef.current = clampedPos
      setPosition(clampedPos)
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Handle window resize - clamp position and restart physics if needed
  useEffect(() => {
    const handleResize = () => {
      const clampedPos = clampPosition(currentPositionRef.current)
      currentPositionRef.current = clampedPos
      setPosition(clampedPos)
      
      // If physics is running, it will handle boundaries
      // Otherwise, ensure we're within bounds
      if (animationFrameRef.current === null) {
        // Check if we need to start physics to correct position
        const bounds = getViewportBounds()
        if (
          currentPositionRef.current.x < bounds.minX ||
          currentPositionRef.current.x > bounds.maxX ||
          currentPositionRef.current.y < bounds.minY ||
          currentPositionRef.current.y > bounds.maxY
        ) {
          startPhysics()
        }
      }
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [clampPosition, getViewportBounds, startPhysics])

  // Add/remove event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      // Set body cursor and prevent selection during drag
      document.body.style.cursor = "move"
      document.body.style.userSelect = "none"
      
      window.addEventListener("mousemove", handleDragMove)
      window.addEventListener("mouseup", handleDragEnd)
    } else {
      // Restore body cursor and selection
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      
      window.removeEventListener("mousemove", handleDragMove)
      window.removeEventListener("mouseup", handleDragEnd)
    }

    return () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", handleDragMove)
      window.removeEventListener("mouseup", handleDragEnd)
    }
  }, [isDragging, handleDragMove, handleDragEnd])

  return (
    <div
      ref={wrapperRef}
      className="fixed top-1/2 z-[9999]"
      style={{
        left: side === "left" ? "0" : "auto",
        right: side === "right" ? "0" : "auto",
        transform: `translate(${side === "left" ? VIEWPORT_PADDING + position.x : -(VIEWPORT_PADDING - position.x)}px, calc(-50% + ${position.y}px))`,
        cursor: isResizing ? "nesw-resize" : isDragging ? "move" : "auto",
        userSelect: isResizing || isDragging ? "none" : "auto",
        willChange: "transform",
      }}
      onMouseDown={handleDragStart}
    >
      <div
        style={{
          transform: `scale(${isEnlarged ? 1.02 : 1})`,
          opacity: isEyeTrackingEnabled ? (isEnlarged ? 1 : 0.25) : 1,
          transition: "transform 0.2s ease-out, opacity 0.2s ease-out",
        }}
      >
        <div
          ref={containerRef}
          className="bg-[#131314] border border-[#595959] overflow-hidden rounded-[4px] relative select-none"
          style={{
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          transition: isResizing ? "none" : "width 0.15s ease-out, height 0.15s ease-out",
          boxShadow:
            "0px 0px 30px 0px rgba(0,0,0,0.25), 0px 0px 3px 0px rgba(0,0,0,0.75), 0px 0px 0px 0.5px #131314",
        }}
      >
        {/* Menu Bar */}
        <div className="absolute top-[-1px] left-[-1px] right-[-1px] h-[54px] bg-[#212122] flex items-center justify-between px-[13px] z-20">
          <div className="flex items-center gap-2">
            <button
              className="bg-[#373738] p-[6px] rounded-[6px] flex items-center justify-center hover:bg-[#404041] transition-colors shrink-0"
              aria-label="Expand"
              tabIndex={0}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseEnter={() => setIsExpandHovered(true)}
              onMouseLeave={() => setIsExpandHovered(false)}
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 16 16" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4 overflow-visible"
              >
                <g>
                  <path 
                    d={isExpandHovered ? "M12.99 12.99L2.99 2.99" : "M11.4926 11.4927L4.48567 4.48573"}
                    stroke="white" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  <path 
                    d="M10.8497 4.25H4.25V10.8497" 
                    stroke="white" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    style={{
                      transform: isExpandHovered ? 'translate(-1.5px, -1.5px)' : 'translate(0, 0)',
                      transition: 'transform 0.2s ease'
                    }}
                  />
                </g>
              </svg>
            </button>
            {onStartTracking && onStopTracking && (
              <button
                className={`p-[6px] rounded-[6px] flex items-center justify-center transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isEyeTrackingEnabled 
                    ? "bg-[#373738] hover:bg-[#404041]" 
                    : "bg-[#FFDDDB] hover:bg-[#FFC8C5]"
                }`}
                aria-label={isEyeTrackingEnabled ? "Disable Eye Tracking" : "Enable Eye Tracking"}
                tabIndex={0}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isEyeTrackingEnabled) {
                    onStopTracking()
                  } else {
                    onStartTracking()
                  }
                }}
                disabled={isLoading || !isWebcamOn}
              >
                {isEyeTrackingEnabled ? (
                  <Eye className="w-4 h-4 text-white" />
                ) : (
                  <EyeOff className="w-4 h-4 text-[#690608]" />
                )}
              </button>
            )}
          </div>
          <button
            className="bg-[#373738] pl-[9px] pr-[10px] py-[6px] rounded-[6px] flex items-center gap-1 hover:bg-[#404041] transition-colors shrink-0"
            aria-label="Close"
            tabIndex={0}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <img
              src="/figma-assets/8e9625f2055bbd7fbb8b63015da602344888aa2f.svg"
              alt=""
              className="w-4 h-4"
            />
            <span className="text-white text-[12px] font-semibold leading-none">Close</span>
          </button>
        </div>

        {/* Webcam Area */}
        <div className="absolute left-[8.5%] right-[8.5%] top-[74px] bottom-[72px] bg-[#535353] rounded-[12px] overflow-hidden z-10">
          {/* Video element - always rendered so ref is available */}
          {videoRef && (
            <video
              ref={videoRef}
              className={`w-full h-full object-cover ${isTracking ? "block" : "hidden"}`}
              width={640}
              height={480}
              playsInline
              muted
              autoPlay
            />
          )}
          
          {/* Placeholder UI when not tracking */}
          {!isTracking && (
            <>
              {/* Audio Indicator */}
              <div className="absolute top-[8px] right-[8px] bg-[#a0c8ff] w-6 h-6 rounded-[12px] flex items-center justify-center gap-[2px] px-1">
                <div className="w-1 h-1 bg-[#002f73] rounded-[2px]" />
                <div className="w-1 h-1 bg-[#002f73] rounded-[2px]" />
                <div className="w-1 h-1 bg-[#002f73] rounded-[2px]" />
              </div>

              {/* Name Label */}
              <p
                className="absolute left-[12px] bottom-[8px] text-white text-[12px] font-semibold leading-none"
                style={{
                  textShadow: "0px 0px 2px rgba(0,0,0,0.75), 0px 0px 4px rgba(0,0,0,0.25)",
                }}
              >
                First Last
              </p>
            </>
          )}
        </div>

        {/* Toolbar */}
        <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 flex gap-2 items-center z-30">
          {/* Microphone Button */}
          <button
            className="bg-[#343537] w-[54px] h-[44px] rounded-[22px] flex items-center justify-center hover:bg-[#3d3e40] transition-colors shrink-0"
            aria-label="Toggle microphone"
            tabIndex={0}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <img
              src="/figma-assets/1a9d400ad1c32f1f2f30b5376cdafa1c6efb28b8.svg"
              alt=""
              className="w-6 h-6"
            />
          </button>

          {/* Camera Button */}
          <button
            className="bg-[#343537] w-[54px] h-[44px] rounded-[22px] flex items-center justify-center hover:bg-[#3d3e40] transition-colors shrink-0"
            aria-label="Toggle camera"
            tabIndex={0}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <img
              src="/figma-assets/d2a7cd073a1cbede4a9a4502e0b858c94b133d2a.svg"
              alt=""
              className="w-6 h-6"
            />
          </button>

          {/* More Options Button */}
          <button
            className="bg-[#343537] w-[26px] h-[44px] rounded-[22px] flex items-center justify-center hover:bg-[#3d3e40] transition-colors shrink-0"
            aria-label="More options"
            tabIndex={0}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <img
              src="/figma-assets/2526c73d112fbbe1c6659615381d1c56b94d5485.svg"
              alt=""
              className="w-6 h-6"
            />
          </button>

          {/* End Call Button */}
          <button
            className="bg-[#f0171e] w-[54px] h-[44px] rounded-[22px] flex items-center justify-center hover:bg-[#d01419] transition-colors shrink-0"
            aria-label="End call"
            tabIndex={0}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <img
              src="/figma-assets/a0aff05fa3a675eb716e66df5a6a410849a07ef1.svg"
              alt=""
              className="w-6 h-6"
            />
          </button>
        </div>

        {/* Handle Icon with larger hit area */}
        <div
          className="absolute bottom-0 left-0 w-8 h-8 z-40 cursor-nesw-resize flex items-end justify-start p-[3px]"
          onMouseDown={handleResizeStart}
          role="button"
          tabIndex={0}
          aria-label="Resize window"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
            }
          }}
        >
          <img
            src="/figma-assets/aa0ea072a2bc582a2acae9dc3313f951345aae88.svg"
            alt=""
            className="w-4 h-4 pointer-events-none"
          />
        </div>
      </div>
      </div>
    </div>
  )
}
