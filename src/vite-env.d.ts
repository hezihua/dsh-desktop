/// <reference types="vite/client" />

type HarnessStatus = {
  phase: 'starting' | 'ready' | 'error'
  message: string
  url?: string
  logPath?: string
  logTail?: string
  safeMode?: boolean
}

interface DesktopInfo {
  appVersion: string
  dshVersion: string
  url: string | null
  error: string
  phase: 'starting' | 'ready' | 'error'
  message: string
  logPath: string
  logTail: string
  dshHome: string
  safeMode: boolean
}

interface Window {
  desktop?: {
    getInfo: () => Promise<DesktopInfo>
    restartHarness: () => Promise<{ ok: boolean }>
    restartSafe?: () => Promise<{ ok: boolean }>
    openLog?: () => Promise<{ ok: boolean; path: string }>
    setOverlay?: (visible: boolean) => Promise<void>
    minimize?: () => Promise<void>
    maximize?: () => Promise<void>
    close?: () => Promise<void>
    isMaximized?: () => Promise<boolean>
    onMaximizedChange?: (callback: (maximized: boolean) => void) => () => void
    onHarnessStatus: (callback: (status: HarnessStatus) => void) => () => void
  }
  updater?: {
    check: () => Promise<{ ok: boolean; reason?: string; updateInfo?: unknown }>
    download: () => Promise<{ ok: boolean; reason?: string }>
    install: () => Promise<{ ok: boolean; reason?: string }>
    on: (channel: string, callback: (payload?: unknown) => void) => () => void
  }
}
