import { useCallback, useEffect, useState } from 'react'
import { TitleBar } from './TitleBar'

type UpdateState =
	| { phase: 'idle' }
	| { phase: 'checking' }
	| { phase: 'available'; version?: string }
	| { phase: 'downloading'; percent: number }
	| { phase: 'downloaded'; version?: string }
	| { phase: 'error'; message: string }

type HarnessPhase = 'starting' | 'ready' | 'error'

export function App() {
	const [harnessPhase, setHarnessPhase] = useState<HarnessPhase>('starting')
	const [harnessMessage, setHarnessMessage] = useState('正在启动 DeepSeek Harness…')
	const [dshVersion, setDshVersion] = useState('')
	const [appVersion, setAppVersion] = useState('')
	const [logPath, setLogPath] = useState('')
	const [logTail, setLogTail] = useState('')
	const [safeMode, setSafeMode] = useState(false)
	const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' })
	const [showUpdateModal, setShowUpdateModal] = useState(false)

	useEffect(() => {
		void window.desktop?.setOverlay?.(showUpdateModal)
	}, [showUpdateModal])

	useEffect(() => {
		let cancelled = false
		const unsubscribers: Array<() => void> = []

		void window.desktop?.getInfo().then((info) => {
			if (cancelled || !info) return
			setAppVersion(info.appVersion)
			setDshVersion(info.dshVersion)
			setLogPath(info.logPath)
			setLogTail(info.logTail || '')
			setSafeMode(Boolean(info.safeMode))
			if (info.phase === 'error' && info.error) {
				setHarnessPhase('error')
				setHarnessMessage(info.error)
			} else if (info.message) {
				setHarnessMessage(info.message)
			}
		})

		if (window.desktop) {
			unsubscribers.push(
				window.desktop.onHarnessStatus((status) => {
					setHarnessPhase(status.phase)
					setHarnessMessage(status.message)
					if (status.logPath) setLogPath(status.logPath)
					if (status.logTail !== undefined) setLogTail(status.logTail)
					if (status.safeMode !== undefined) setSafeMode(status.safeMode)
				}),
			)
		}

		if (window.updater) {
			unsubscribers.push(
				window.updater.on('update:checking', () => {
					setUpdateState({ phase: 'checking' })
				}),
				window.updater.on('update:available', (payload) => {
					const version = (payload as { version?: string } | undefined)?.version
					setUpdateState({ phase: 'available', version })
					setShowUpdateModal(true)
				}),
				window.updater.on('update:not-available', () => {
					setUpdateState({ phase: 'idle' })
					setShowUpdateModal(false)
				}),
				window.updater.on('update:download-progress', (payload) => {
					const percent = Number((payload as { percent?: number } | undefined)?.percent ?? 0)
					setUpdateState({
						phase: 'downloading',
						percent: Number.isFinite(percent) ? percent : 0,
					})
					setShowUpdateModal(true)
				}),
				window.updater.on('update:downloaded', (payload) => {
					const version = (payload as { version?: string } | undefined)?.version
					setUpdateState({ phase: 'downloaded', version })
					setShowUpdateModal(true)
				}),
				window.updater.on('update:error', (payload) => {
					const message = (payload as { message?: string } | undefined)?.message ?? '更新出错'
					setUpdateState({ phase: 'error', message })
					setShowUpdateModal(true)
				}),
			)
		}

		return () => {
			cancelled = true
			for (const off of unsubscribers) off()
		}
	}, [])

	const checkUpdate = useCallback(async () => {
		if (!window.updater) return
		setUpdateState({ phase: 'checking' })
		setShowUpdateModal(true)
		const res = await window.updater.check()
		if (res?.ok === false && res?.reason === 'DEV_MODE') {
			setUpdateState({ phase: 'error', message: '开发模式下不支持自动更新检查（请打包后测试）。' })
		}
	}, [])

	const restartHarness = useCallback(async () => {
		setHarnessPhase('starting')
		setHarnessMessage('正在重新启动 DeepSeek Harness…')
		setSafeMode(false)
		await window.desktop?.restartHarness()
	}, [])

	const restartSafe = useCallback(async () => {
		setHarnessPhase('starting')
		setHarnessMessage('正在以安全模式启动 DeepSeek Harness…')
		setSafeMode(true)
		await window.desktop?.restartSafe?.()
	}, [])

	return (
		<>
			<TitleBar />
			<div className="splash" hidden={harnessPhase === 'ready'}>
				<div className="brand-mark" aria-hidden="true" />
				<div className="brand">DeepSeek Harness</div>
				<div className={`status ${harnessPhase}`}>{harnessMessage}</div>
				<div className="meta">
					桌面 {appVersion || '…'} · 引擎 {dshVersion || '…'}
					{safeMode ? ' · 安全模式' : ''}
				</div>
				<div className="actions">
					{harnessPhase === 'error' ? (
						<>
							<button type="button" onClick={() => void restartHarness()}>
								重试
							</button>
							<button type="button" onClick={() => void restartSafe()}>
								安全模式
							</button>
							<button type="button" className="ghost" onClick={() => void window.desktop?.openLog?.()}>
								打开日志
							</button>
						</>
					) : null}
					<button type="button" onClick={() => void checkUpdate()}>
						检查更新
					</button>
				</div>
				{harnessPhase === 'error' ? (
					<p className="hint">
						安全模式使用独立数据目录，不附着已有服务，也避开 ~/.dsh 里可能损坏的第三方插件。
					</p>
				) : null}
				{harnessPhase === 'error' && logPath ? <p className="log">日志：{logPath}</p> : null}
				{harnessPhase === 'error' && logTail ? <pre className="log-tail">{logTail}</pre> : null}
			</div>

			{showUpdateModal ? (
				<div className="modal-mask">
					<div className="modal" role="dialog" aria-labelledby="update-title">
						<div className="modal-title" id="update-title">
							版本更新
						</div>
						<div className="modal-body">
							<UpdateBody state={updateState} />
						</div>
						<div className="modal-actions">
							{updateState.phase === 'available' ? (
								<button type="button" onClick={() => void window.updater?.download()}>
									现在升级
								</button>
							) : null}
							{updateState.phase === 'downloaded' ? (
								<button type="button" onClick={() => void window.updater?.install()}>
									立即安装
								</button>
							) : null}
							{updateState.phase !== 'downloading' ? (
								<button type="button" className="ghost" onClick={() => setShowUpdateModal(false)}>
									稍后
								</button>
							) : null}
						</div>
					</div>
				</div>
			) : null}
		</>
	)
}

function UpdateBody({ state }: { state: UpdateState }) {
	switch (state.phase) {
		case 'checking':
			return '正在检查更新…'
		case 'available':
			return (
				<>
					发现新版本 <b>{state.version || ''}</b>，是否现在下载并安装？
				</>
			)
		case 'downloading':
			return `正在下载… ${state.percent.toFixed(1)}%`
		case 'downloaded':
			return (
				<>
					新版本 <b>{state.version || ''}</b> 已下载完成，是否立即重启安装？
				</>
			)
		case 'error':
			return `更新失败：${state.message}`
		default:
			return null
	}
}
