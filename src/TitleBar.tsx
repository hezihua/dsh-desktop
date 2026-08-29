import { useEffect, useState } from 'react'

export function TitleBar() {
	const [maximized, setMaximized] = useState(false)

	useEffect(() => {
		if (!window.desktop?.isMaximized) return
		void window.desktop.isMaximized().then(setMaximized)
		return window.desktop.onMaximizedChange?.(setMaximized)
	}, [])

	return (
		<header className="titlebar">
			<div className="titlebar-drag" onDoubleClick={() => void window.desktop?.maximize?.()}>
				<span className="titlebar-mark" aria-hidden="true" />
				<span className="titlebar-title">DeepSeek Harness</span>
			</div>
			<div className="titlebar-controls">
				<button
					type="button"
					className="titlebar-btn"
					aria-label="最小化"
					onClick={() => void window.desktop?.minimize?.()}
				>
					<svg viewBox="0 0 12 12" width="12" height="12">
						<rect x="1" y="5.25" width="10" height="1.5" rx="0.4" fill="currentColor" />
					</svg>
				</button>
				<button
					type="button"
					className="titlebar-btn"
					aria-label={maximized ? '还原' : '最大化'}
					onClick={() => void window.desktop?.maximize?.()}
				>
					{maximized ? (
						<svg viewBox="0 0 12 12" width="12" height="12">
							<path
								d="M3.5 3.5h5.2V8.7H3.5V3.5zm1.2 1.2v3.8h2.8V4.7H4.7zM2.2 2.2h5.4v1.1H3.3v4.3H2.2V2.2z"
								fill="currentColor"
							/>
						</svg>
					) : (
						<svg viewBox="0 0 12 12" width="12" height="12">
							<rect
								x="2.2"
								y="2.2"
								width="7.6"
								height="7.6"
								rx="0.6"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.4"
							/>
						</svg>
					)}
				</button>
				<button
					type="button"
					className="titlebar-btn titlebar-btn-close"
					aria-label="关闭"
					onClick={() => void window.desktop?.close?.()}
				>
					<svg viewBox="0 0 12 12" width="12" height="12">
						<path
							d="M2.4 2.4l7.2 7.2M9.6 2.4L2.4 9.6"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</div>
		</header>
	)
}
