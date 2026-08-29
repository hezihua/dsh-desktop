/// <reference types="vite/client" />

type HarnessStatus =
  | { phase: 'starting'; message: string }
  | { phase: 'ready'; message: string; url?: string }
  | { phase: 'error'; message: string }

interface DesktopInfo {
  appVersion: string
  dshVersion: string
  url: string | null
  error: string
  phase: 'starting' | 'ready' | 'error'
  message: string
  logPath: string
  dshHome: string
}

interface Window {
  desktop?: {
    getInfo: () => Promise<DesktopInfo>
    restartHarness: () => Promise<{ ok: boolean }>
    quit: () => Promise<{ ok: boolean }>
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
