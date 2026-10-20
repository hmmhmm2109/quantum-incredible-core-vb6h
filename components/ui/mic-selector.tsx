"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, ChevronDown, Mic, MicOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"


export interface AudioDevice {
  deviceId: string
  label: string
  groupId: string
}

export interface MicSelectorProps {
  value?: string
  onValueChange?: (deviceId: string) => void
  muted?: boolean
  onMutedChange?: (muted: boolean) => void
  disabled?: boolean
  className?: string
}

export function MicSelector({
  value,
  onValueChange,
  muted,
  onMutedChange,
  disabled,
  className,
}: MicSelectorProps) {
  const { devices, loading, error, hasPermission, loadDevices } =
    useAudioDevices()
  const [selectedDevice, setSelectedDevice] = useState<string>(value || "")
  const [internalMuted, setInternalMuted] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  const isMuted = muted !== undefined ? muted : internalMuted

  useEffect(() => {
    if (value !== undefined) {
      setSelectedDevice(value)
    }
  }, [value])

  const defaultDeviceId = devices[0]?.deviceId || ""
  useEffect(() => {
    if (!selectedDevice && defaultDeviceId) {
      const newDevice = defaultDeviceId
      setSelectedDevice(newDevice)
      onValueChange?.(newDevice)
    }
  }, [defaultDeviceId, selectedDevice, onValueChange])

  const handleDeviceSelect = (deviceId: string, e?: React.MouseEvent) => {
    e?.preventDefault()
    setSelectedDevice(deviceId)
    onValueChange?.(deviceId)
  }

  const handleDropdownOpenChange = async (open: boolean) => {
    setIsDropdownOpen(open)
    if (open && !hasPermission && !loading) {
      await loadDevices()
    }
  }

  const toggleMute = () => {
    const newMuted = !isMuted
    if (muted === undefined) {
      setInternalMuted(newMuted)
    }
    onMutedChange?.(newMuted)
  }

  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-lg border",
        isMuted ? "border-destructive/20 bg-destructive/10" : "border-border bg-background",
        className
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-10 w-10 rounded-none hover:bg-transparent",
          isMuted && "text-destructive hover:text-destructive"
        )}
        disabled={disabled}
        onClick={toggleMute}
        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        aria-pressed={isMuted}
      >
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>

      <div className={cn("h-6 w-px shrink-0", isMuted ? "bg-destructive/20" : "bg-border")} aria-hidden />

      <DropdownMenu onOpenChange={handleDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-10 w-10 rounded-none hover:bg-transparent",
              isMuted && "text-destructive hover:text-destructive"
            )}
            disabled={loading}
            aria-label="Select microphone"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-72">
          {loading ? (
            <DropdownMenuItem disabled>Loading devices...</DropdownMenuItem>
          ) : error ? (
            <DropdownMenuItem disabled>Error: {error}</DropdownMenuItem>
          ) : devices.length === 0 ? (
            <DropdownMenuItem disabled>No microphone found.</DropdownMenuItem>
          ) : (
            devices.map((device) => (
              <DropdownMenuItem
                key={device.deviceId}
                onClick={(e) => handleDeviceSelect(device.deviceId, e)}
                onSelect={(e) => e.preventDefault()}
                className="flex items-center justify-between"
              >
                <span className="truncate">{device.label}</span>
                {selectedDevice === device.deviceId && (
                  <Check className="h-4 w-4 flex-shrink-0" />
                )}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function useAudioDevices() {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasPermission, setHasPermission] = useState(false)

  const loadDevicesWithoutPermission = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const deviceList = await navigator.mediaDevices.enumerateDevices()

      const audioInputs = deviceList
        .filter((device) => device.kind === "audioinput")
        .map((device) => {
          let cleanLabel =
            device.label || `Microphone ${device.deviceId.slice(0, 8)}`
          cleanLabel = cleanLabel.replace(/\s*\([^)]*\)/g, "").trim()

          return {
            deviceId: device.deviceId,
            label: cleanLabel,
            groupId: device.groupId,
          }
        })

      setDevices(audioInputs)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get audio devices"
      )
      console.error("Error getting audio devices:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDevicesWithPermission = useCallback(async () => {
    if (loading) return

    try {
      setLoading(true)
      setError(null)

      const tempStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      tempStream.getTracks().forEach((track) => track.stop())

      const deviceList = await navigator.mediaDevices.enumerateDevices()

      const audioInputs = deviceList
        .filter((device) => device.kind === "audioinput")
        .map((device) => {
          let cleanLabel =
            device.label || `Microphone ${device.deviceId.slice(0, 8)}`
          cleanLabel = cleanLabel.replace(/\s*\([^)]*\)/g, "").trim()

          return {
            deviceId: device.deviceId,
            label: cleanLabel,
            groupId: device.groupId,
          }
        })

      setDevices(audioInputs)
      setHasPermission(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get audio devices"
      )
      console.error("Error getting audio devices:", err)
    } finally {
      setLoading(false)
    }
  }, [loading])

  useEffect(() => {
    loadDevicesWithoutPermission()
  }, [loadDevicesWithoutPermission])

  useEffect(() => {
    const handleDeviceChange = () => {
      if (hasPermission) {
        loadDevicesWithPermission()
      } else {
        loadDevicesWithoutPermission()
      }
    }

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange)

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      )
    }
  }, [hasPermission, loadDevicesWithPermission, loadDevicesWithoutPermission])

  return {
    devices,
    loading,
    error,
    hasPermission,
    loadDevices: loadDevicesWithPermission,
  }
}
