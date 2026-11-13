window.__ModuleLoader__.load({
  id: `@dsh-desktop/agents-panel`,
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useEffect, useState } = React
    const PANEL_ID = 'agents'

    const css = `
.dsh-agents-page{box-sizing:border-box;height:100%;overflow:auto;padding:28px 32px 48px;color:var(--dsw-alias-label-primary)}
.dsh-agents-title{margin:0;font-size:22px;line-height:1.3;font-weight:600}
.dsh-agents-desc{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
.dsh-agents-section{margin:28px 0 10px;color:var(--dsw-alias-label-tertiary);font-size:13px;font-weight:600}
.dsh-agents-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dsh-agents-row{width:100%;display:flex;gap:12px;align-items:flex-start;text-align:left;color:inherit;font:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:14px 16px;cursor:pointer}
.dsh-agents-row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-agents-row.is-active{border-color:var(--dsw-alias-brand-primary)}
.dsh-agents-row:disabled{cursor:default;opacity:.72}
.dsh-agents-mark{flex:none;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-agents-copy{min-width:0;flex:1}
.dsh-agents-name{display:block;font-size:14px;font-weight:600}
.dsh-agents-text{display:block;margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}
.dsh-agents-warn{display:block;margin-top:4px;color:var(--dsw-alias-state-warn-primary);font-size:12px}
.dsh-agents-badge{flex:none;color:var(--dsw-alias-label-caption);font-size:12px}
.dsh-agents-status{margin-top:16px;color:var(--dsw-alias-label-secondary);font-size:13px}
.dsh-agents-error{margin-top:12px;color:var(--dsw-alias-state-error-primary);font-size:13px}
`
    const styleId = '@dsh-desktop/agents-panel/page.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${styleId}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@dsh-desktop/agents-panel'
      tag.dataset.pluginCss = styleId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    function bridge() {
      const host = globalThis.dshDesktopAgents
      if (!host || typeof host.catalog !== 'function' || typeof host.show !== 'function') return null
      return host
    }

    function AgentsGlyph({ size }) {
      const edge = size || 16
      return React.createElement(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        React.createElement('circle', { cx: 9, cy: 8, r: 3 }),
        React.createElement('path', { d: 'M3.5 19c.6-2.6 2.8-4 5.5-4s4.9 1.4 5.5 4' }),
        React.createElement('circle', { cx: 17, cy: 9, r: 2.2 }),
        React.createElement('path', { d: 'M16.2 15.2c1.6.3 2.9 1.3 3.5 2.8' }),
      )
    }

    function AgentsPage() {
      const [catalog, setCatalog] = useState(null)
      const [error, setError] = useState('')
      const [pendingId, setPendingId] = useState('')

      useEffect(() => {
        const host = bridge()
        if (!host) {
          setError('桌面壳未连接，无法读取智能体列表。')
          return undefined
        }
        let alive = true
        host.catalog().then((next) => {
          if (alive) setCatalog(next)
        }).catch((reason) => {
          if (alive) setError(reason instanceof Error ? reason.message : String(reason))
        })
        return () => {
          alive = false
        }
      }, [])

      async function choose(agent) {
        const host = bridge()
        if (!host || !agent.available || pendingId) return
        setPendingId(agent.id)
        setError('')
        try {
          const result = await host.show(agent.id)
          setPendingId('')
          if (!result || result.ok !== true) {
            setError((result && result.message) || '切换失败')
          }
        } catch (reason) {
          setPendingId('')
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }

      const agents = catalog && Array.isArray(catalog.agents) ? catalog.agents : []
      const children = [
        React.createElement('h1', { key: 'title', className: 'dsh-agents-title' }, 'Agents'),
        React.createElement(
          'p',
          { key: 'desc', className: 'dsh-agents-desc' },
          '点击一项后，对话框位置换成该智能体。点击 New Session 回到官方对话框。',
        ),
      ]
      if (!catalog && !error) {
        children.push(React.createElement('p', { key: 'loading', className: 'dsh-agents-status' }, '正在读取智能体…'))
      }
      if (error) {
        children.push(React.createElement('p', { key: 'error', className: 'dsh-agents-error' }, error))
      }
      if (catalog) {
        children.push(React.createElement('div', { key: 'section', className: 'dsh-agents-section' }, '已接入'))
        children.push(React.createElement(
          'ul',
          { key: 'list', className: 'dsh-agents-list' },
          agents.map((agent) => {
            const active = agent.id === catalog.activeId
            const busy = pendingId === agent.id
            let badge = ''
            if (busy) badge = '正在切换…'
            else if (active) badge = '当前'
            return React.createElement(
              'li',
              { key: agent.id },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: active ? 'dsh-agents-row is-active' : 'dsh-agents-row',
                  disabled: !agent.available || Boolean(pendingId),
                  'aria-current': active ? 'true' : undefined,
                  onClick: () => { void choose(agent) },
                },
                React.createElement('span', { className: 'dsh-agents-mark' }, React.createElement(AgentsGlyph, { size: 16 })),
                React.createElement(
                  'span',
                  { className: 'dsh-agents-copy' },
                  React.createElement('span', { className: 'dsh-agents-name' }, agent.label),
                  agent.description
                    ? React.createElement('span', { className: 'dsh-agents-text' }, agent.description)
                    : null,
                  !agent.available && agent.unavailableReason
                    ? React.createElement('span', { className: 'dsh-agents-warn' }, agent.unavailableReason)
                    : null,
                ),
                badge ? React.createElement('span', { className: 'dsh-agents-badge' }, badge) : null,
              ),
            )
          }),
        ))
        if (agents.length === 0) {
          children.push(React.createElement('p', { key: 'empty', className: 'dsh-agents-status' }, '没有可显示的智能体。'))
        }
      }
      return React.createElement('section', { className: 'dsh-agents-page', 'aria-label': 'Agents' }, children)
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
      }, AgentsPage))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 1,
        label: () => 'Agents',
      }, AgentsGlyph))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
