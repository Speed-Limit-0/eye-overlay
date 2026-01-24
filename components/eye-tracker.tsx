"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { EyeOff } from "lucide-react"
import { MeetPip } from "@/components/meet-pip"

type Side = "left" | "right" | null

interface EyePosition {
  x: number
  y: number
}

export function EyeTracker() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pipRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isWebcamOn, setIsWebcamOn] = useState(false)
  const [isTracking, setIsTracking] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eyePosition, setEyePosition] = useState<EyePosition | null>(null)
  const animationRef = useRef<number | null>(null)
  const modelRef = useRef<any>(null)

  const [ballSide, setBallSide] = useState<"left" | "right">("left")
  const [targetVertical, setTargetVertical] = useState<"top" | "bottom" | "center" | null>(null)
  const [cursorSide, setCursorSide] = useState<Side>(null)
  const [cursorVertical, setCursorVertical] = useState<"top" | "bottom" | "center">("center")
  const [gazeSide, setGazeSide] = useState<Side>(null)
  const [lastDefinitiveGazeSide, setLastDefinitiveGazeSide] = useState<"left" | "right" | null>(null)
  const [isCursorHoveringPip, setIsCursorHoveringPip] = useState(false)
  const [pipPosition, setPipPosition] = useState<{ side: "left" | "right"; vertical: "top" | "bottom" | "center" }>({
    side: "left",
    vertical: "center"
  })
  const [isUserControllingPip, setIsUserControllingPip] = useState(false)
  
  const targetVerticalRef = useRef<"top" | "bottom" | "center" | null>(null)
  const reEngageTimerRef = useRef<NodeJS.Timeout | null>(null)
  const cursorMoveDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const prevCursorSideRef = useRef<Side>(null)
  const gazeAtPipStartTimeRef = useRef<number | null>(null)

  useEffect(() => {
    // Only enable smart cursor tracking when eye tracking is active
    if (!isTracking) return

    const handleMouseMove = (e: MouseEvent) => {
      const screenWidth = window.innerWidth
      const screenHeight = window.innerHeight
      
      // Divide screen into thirds horizontally and vertically
      const leftThird = screenWidth / 3
      const rightThird = (screenWidth * 2) / 3
      const topThird = screenHeight / 3
      const bottomThird = (screenHeight * 2) / 3
      
      // Determine horizontal zone
      let newCursorSide: Side
      if (e.clientX < leftThird) {
        newCursorSide = "left"
      } else if (e.clientX > rightThird) {
        newCursorSide = "right"
      } else {
        newCursorSide = null // center
      }
      
      // Determine vertical zone
      let newCursorVertical: "top" | "bottom" | "center"
      if (e.clientY < topThird) {
        newCursorVertical = "top"
      } else if (e.clientY > bottomThird) {
        newCursorVertical = "bottom"
      } else {
        newCursorVertical = "center"
      }
      
      setCursorSide(newCursorSide)
      setCursorVertical(newCursorVertical)
      
      // Check if we're within 1 second grace period after looking at PiP
      const isWithinGracePeriod = gazeAtPipStartTimeRef.current !== null && 
        (Date.now() - gazeAtPipStartTimeRef.current) < 1000
      
      // Simple cursor tracking: only trigger when cursor ENTERS PIP's zone (not when it's already there)
      // Skip if: user is controlling PIP, user is looking at PIP (unless in grace period), or cursor is hovering over PIP
      if (
        !isUserControllingPip &&
        (gazeSide !== pipPosition.side || isWithinGracePeriod) &&
        !isCursorHoveringPip &&
        targetVertical === null // Don't trigger if PIP is already moving
      ) {
        // Check if cursor just ENTERED the PIP's zone (wasn't there before, but is now)
        const wasInPipZone = prevCursorSideRef.current === pipPosition.side
        const isNowInPipZone = newCursorSide === pipPosition.side
        const cursorJustEnteredZone = !wasInPipZone && isNowInPipZone
        
        if (cursorJustEnteredZone) {
          // Clear any existing debounce
          if (cursorMoveDebounceRef.current) {
            clearTimeout(cursorMoveDebounceRef.current)
          }
          
          // Debounce the movement to prevent rapid toggling
          cursorMoveDebounceRef.current = setTimeout(() => {
            // Calculate opposite position
            const oppositeSide: "left" | "right" = pipPosition.side === "left" ? "right" : "left"
            
            // For vertical, move to opposite or center if cursor is in center
            let oppositeVertical: "top" | "bottom" | "center"
            if (newCursorVertical === "top") {
              oppositeVertical = "bottom"
            } else if (newCursorVertical === "bottom") {
              oppositeVertical = "top"
            } else {
              // If cursor is in center, toggle vertical position
              oppositeVertical = pipPosition.vertical === "top" ? "bottom" : pipPosition.vertical === "bottom" ? "top" : "center"
            }
            
            console.log(`Cursor entered PIP zone (${pipPosition.side}/${pipPosition.vertical}), moving to ${oppositeSide}/${oppositeVertical}`)
            
            setTargetVertical(oppositeVertical)
            setBallSide(oppositeSide)
            cursorMoveDebounceRef.current = null
          }, 150) // 150ms debounce - prevents rapid movements but feels responsive
        }
      }
      
      // Update previous cursor side for next comparison
      prevCursorSideRef.current = newCursorSide
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      if (cursorMoveDebounceRef.current) {
        clearTimeout(cursorMoveDebounceRef.current)
      }
    }
  }, [isTracking, isUserControllingPip, gazeSide, pipPosition, isCursorHoveringPip, targetVertical])

  // Track when user starts looking at PiP side and manage grace period
  useEffect(() => {
    // Only enable gaze tracking when eye tracking is active
    if (!isTracking) return

    if (gazeSide === pipPosition.side) {
      // User is looking at PiP side
      if (gazeAtPipStartTimeRef.current === null) {
        // Just started looking at PiP side
        gazeAtPipStartTimeRef.current = Date.now()
        console.log("Started looking at PiP side, 1 second grace period begins")
        
        // Set a timer to log when grace period ends
        setTimeout(() => {
          if (gazeAtPipStartTimeRef.current !== null) {
            console.log("Grace period ended, eye gaze logic now active")
          }
        }, 1000)
      }
    } else {
      // User is NOT looking at PiP side anymore
      if (gazeAtPipStartTimeRef.current !== null) {
        console.log("Stopped looking at PiP side, grace period cleared")
        gazeAtPipStartTimeRef.current = null
      }
    }
  }, [isTracking, gazeSide, pipPosition.side])

  const handlePipMouseEnter = useCallback(() => {
    setIsCursorHoveringPip(true)
  }, [])

  const handlePipMouseLeave = useCallback(() => {
    setIsCursorHoveringPip(false)
  }, [])

  const handlePipPositionChange = useCallback((position: { side: "left" | "right"; vertical: "top" | "bottom" | "center" }) => {
    setPipPosition(position)
    
    // Clear target vertical once pip reaches target
    if (targetVerticalRef.current && position.vertical === targetVerticalRef.current) {
      setTargetVertical(null)
      targetVerticalRef.current = null
    }
  }, [])

  const handlePipDragStart = useCallback(() => {
    // User is taking control - disable automatic movement
    setIsUserControllingPip(true)
    
    // Clear any existing timer
    if (reEngageTimerRef.current) {
      clearTimeout(reEngageTimerRef.current)
      reEngageTimerRef.current = null
    }
  }, [])

  const handlePipDragEnd = useCallback((finalPosition: { side: "left" | "right"; vertical: "top" | "bottom" | "center" }) => {
    // Sync target with actual position after drag
    setBallSide(finalPosition.side)
    setTargetVertical(null) // Clear any pending vertical target
    targetVerticalRef.current = null
    
    // User released - start 10 second timer to re-engage
    if (reEngageTimerRef.current) {
      clearTimeout(reEngageTimerRef.current)
    }
    
    reEngageTimerRef.current = setTimeout(() => {
      setIsUserControllingPip(false)
      reEngageTimerRef.current = null
    }, 10000) // 10 seconds
  }, [])

  // Start webcam automatically on mount
  useEffect(() => {
    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        })

        streamRef.current = stream
        setIsWebcamOn(true)

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to access webcam")
      }
    }

    startWebcam()
  }, [])

  // Set stream on video element when it becomes available
  useEffect(() => {
    if (videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch((err) => {
        console.error("Error playing video:", err)
      })
    }
  }, [isWebcamOn])

  // Sync targetVertical state with ref
  useEffect(() => {
    targetVerticalRef.current = targetVertical
  }, [targetVertical])


  const startTracking = useCallback(async () => {
    if (!streamRef.current) {
      setError("Webcam not available")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const [tf, faceLandmarksDetection] = await Promise.all([
        import("@tensorflow/tfjs-core"),
        import("@tensorflow-models/face-landmarks-detection"),
      ])

      await import("@tensorflow/tfjs-backend-webgl")
      await tf.setBackend("webgl")
      await tf.ready()

      const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh
      const detector = await faceLandmarksDetection.createDetector(model, {
        runtime: "tfjs",
        refineLandmarks: true,
        maxFaces: 1,
      })

      modelRef.current = detector
      setIsTracking(true)
      setIsLoading(false)

      detectFace(detector)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start tracking")
      setIsLoading(false)
    }
  }, [])

  const detectFace = useCallback(async (detector: any) => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")

    if (!ctx) return

    const detect = async () => {
      if (!video || video.readyState !== 4) {
        animationRef.current = requestAnimationFrame(detect)
        return
      }

      try {
        const faces = await detector.estimateFaces(video)

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        if (faces.length > 0) {
          const face = faces[0]
          const keypoints = face.keypoints

          const leftIrisCenter = keypoints.find((k: any) => k.name === "leftIrisCenter") || keypoints[468]
          const rightIrisCenter = keypoints.find((k: any) => k.name === "rightIrisCenter") || keypoints[473]

          const leftEyeInner = keypoints[133]
          const leftEyeOuter = keypoints[33]
          const rightEyeInner = keypoints[362]
          const rightEyeOuter = keypoints[263]

          if (leftIrisCenter && rightIrisCenter) {
            const avgIrisX = (leftIrisCenter.x + rightIrisCenter.x) / 2
            const avgIrisY = (leftIrisCenter.y + rightIrisCenter.y) / 2

            const leftEyeCenterX = (leftEyeInner.x + leftEyeOuter.x) / 2
            const rightEyeCenterX = (rightEyeInner.x + rightEyeOuter.x) / 2
            const eyeCenterX = (leftEyeCenterX + rightEyeCenterX) / 2

            const leftEyeCenterY = (leftEyeInner.y + leftEyeOuter.y) / 2
            const rightEyeCenterY = (rightEyeInner.y + rightEyeOuter.y) / 2
            const eyeCenterY = (leftEyeCenterY + rightEyeCenterY) / 2

            const leftEyeWidth = Math.abs(leftEyeOuter.x - leftEyeInner.x)
            const rightEyeWidth = Math.abs(rightEyeOuter.x - rightEyeInner.x)
            const avgEyeWidth = (leftEyeWidth + rightEyeWidth) / 2

            const offsetX = (avgIrisX - eyeCenterX) / avgEyeWidth
            const offsetY = (avgIrisY - eyeCenterY) / avgEyeWidth

            const normalizedX = 0.5 - offsetX * 2
            const normalizedY = 0.5 + offsetY * 3

            setEyePosition({ x: normalizedX, y: normalizedY })

            // Add center threshold to prevent hunting between left/right
            const centerThreshold = 0.05 // Creates a center zone of 0.35-0.65
            if (normalizedX < 0.5 - centerThreshold) {
              setGazeSide("left")
              setLastDefinitiveGazeSide("left")
            } else if (normalizedX > 0.5 + centerThreshold) {
              setGazeSide("right")
              setLastDefinitiveGazeSide("right")
            } else {
              setGazeSide(null) // Center - don't update lastDefinitiveGazeSide
            }

            ctx.fillStyle = "#22c55e"
            ctx.beginPath()
            ctx.arc(leftIrisCenter.x, leftIrisCenter.y, 5, 0, 2 * Math.PI)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(rightIrisCenter.x, rightIrisCenter.y, 5, 0, 2 * Math.PI)
            ctx.fill()
          }
        }
      } catch (err) {
        console.error("Detection error:", err)
      }

      animationRef.current = requestAnimationFrame(detect)
    }

    detect()
  }, [])

  const stopTracking = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    modelRef.current = null
    setIsTracking(false)
    setEyePosition(null)
    setGazeSide(null)
  }, [])

  useEffect(() => {
    return () => {
      stopTracking()
      
      // Stop webcam stream on unmount
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks()
        tracks.forEach((track) => track.stop())
        streamRef.current = null
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      
      // Clean up timers on unmount
      if (reEngageTimerRef.current) {
        clearTimeout(reEngageTimerRef.current)
      }
      if (cursorMoveDebounceRef.current) {
        clearTimeout(cursorMoveDebounceRef.current)
      }
    }
  }, [stopTracking])

  return (
    <div className="h-screen w-screen overflow-hidden relative flex flex-col items-center justify-center">
      <div
        ref={pipRef}
        onMouseEnter={handlePipMouseEnter}
        onMouseLeave={handlePipMouseLeave}
      >
        <MeetPip 
          side={ballSide} 
          targetVertical={targetVertical}
          videoRef={videoRef} 
          isTracking={isWebcamOn}
          isEyeTrackingEnabled={isTracking}
          onPositionChange={handlePipPositionChange}
          onDragStart={handlePipDragStart}
          onDragEnd={handlePipDragEnd}
          isEnlarged={isTracking && (isCursorHoveringPip || lastDefinitiveGazeSide === pipPosition.side)}
          onStartTracking={startTracking}
          onStopTracking={stopTracking}
          isLoading={isLoading}
          isWebcamOn={isWebcamOn}
        />
      </div>

      {isTracking && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
          <div className="px-6 py-4">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between gap-8">
                <span className="text-muted-foreground">Looking:</span>
                <span className="font-semibold text-foreground capitalize">
                  {gazeSide === "left" ? "left" : gazeSide === "right" ? "right" : "center"}
                </span>
              </li>
              <li className="flex justify-between gap-8">
                <span className="text-muted-foreground">Cursor:</span>
                <span className="font-semibold text-foreground capitalize">
                  {cursorSide || "center"} / {cursorVertical}
                </span>
              </li>
              <li className="flex justify-between gap-8">
                <span className="text-muted-foreground">Pip:</span>
                <span className="font-semibold text-foreground capitalize">
                  {pipPosition.side} / {pipPosition.vertical}
                </span>
              </li>
              <li className="flex justify-between gap-8">
                <span className="text-muted-foreground">Target:</span>
                <span className="font-semibold text-foreground capitalize">
                  {ballSide} / {targetVertical || "center"}
                </span>
              </li>
              <li className="flex justify-between gap-8">
                <span className="text-muted-foreground">Hovering Pip:</span>
                <span className="font-semibold text-foreground">{isCursorHoveringPip ? "yes" : "no"}</span>
              </li>
              <li className="flex justify-between gap-8">
                <span className="text-muted-foreground">Looking at Pip:</span>
                <span className="font-semibold text-foreground">{gazeSide === pipPosition.side ? "yes" : "no"}</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Hidden canvas for face detection processing */}
      <div className="hidden">
        <canvas ref={canvasRef} width={320} height={240} />
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center">
          <div className="text-center text-muted-foreground flex items-center gap-2">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p>Loading face detection model...</p>
          </div>
        </div>
      )}

      {/* How It Works Overview */}
      {!isTracking && !isLoading && (
        <Card className="max-w-[480px] mb-8 bg-background/80 backdrop-blur-sm border-0 shadow-none">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold text-left mb-2 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Google Meet Autopilot
            </h2>
            <p className="text-left text-muted-foreground mb-6 text-sm">
              Tired of your meeting window blocking your work? With autopilot, your video stays visible but moves out of the way automatically.
            </p>
            <div className="grid gap-4 text-sm">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  1
                </div>
                <div>
                  <p className="font-semibold text-foreground">Eye Tracking</p>
                  <p className="text-muted-foreground">Your webcam detects where you're looking on the screen in real-time using AI-powered face mesh detection.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  2
                </div>
                <div>
                  <p className="font-semibold text-foreground">Smart Movement</p>
                  <p className="text-muted-foreground">The video preview automatically moves away from your cursor, staying out of your way while you work.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  3
                </div>
                <div>
                  <p className="font-semibold text-foreground">Stay Visible</p>
                  <p className="text-muted-foreground">When you look at the video, it stays put. Drag it manually to override automatic positioning for 10 seconds.</p>
                </div>
              </div>
            </div>
            <p className="text-left text-muted-foreground mt-6 text-sm flex items-center gap-2">
              Click <EyeOff className="w-4 h-4 inline" /> to enable!
            </p>
          </CardContent>
        </Card>
      )}


      {/* Error Display */}
      {error && (
        <Card className="bg-destructive/10 border-destructive absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <CardContent className="p-4">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
