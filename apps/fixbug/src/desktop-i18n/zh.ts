import type { MessageTree } from './en';
import { fixbug } from './fixbug-zh';

export const zh: MessageTree = {
  common: {
    loading: '加载中…',
    save: '保存',
    saving: '保存中…',
  },
  app: {
    brandTag: '本机 Harness',
    settings: '设置',
    backToChat: '返回对话',
    chatSection: '对话',
  },
  agents: {
    railTitle: '助手',
    unavailable: '配置不可用',
    desktop: {
      label: '通用助手',
      description: '工作区沙箱内对话与文件操作（bash，仅限所选目录）',
    },
    'infini-bugfix': {
      label: 'Infini Bugfix（运维）',
      description: '本机 server-agent；fixbug 仅 API/UI，由客户端 Harness 驱动',
    },
    'risk-portal': {
      label: 'Risk Portal',
      description: '风控 skills + risk-portal-tools（本机 Harness）',
    },
  },
  workspace: {
    label: '工作区',
    notSelected: '尚未选择工作区文件夹',
    pick: '选择文件夹',
    change: '更换',
    picking: '选择中…',
  },
  chat: {
    connecting: '正在连接 Harness…',
    roleUser: '你',
    roleAssistant: '助手',
    emptyTitle: '开始对话',
    emptyHint: '选好上方工作区文件夹后，直接描述要做的文件或命令即可。',
    placeholder: '今天帮你做些什么？在工作区里创建、修改文件或运行命令',
    inputAria: '消息输入',
    sendAria: '发送',
    sendingAria: '发送中',
    cancelAria: '停止生成',
    canceled: '已停止。',
    status: {
      embedded: '内嵌启动',
      external: '外部 Harness',
      noApiKey: ' · 未配置 API Key（请打开「设置」）',
      workspace: ' · 工作区 {path}',
      harnessDown: 'Harness 未运行（{root}）',
    },
  },
  settings: {
    title: 'LLM 配置',
    language: '界面语言',
    languageEn: 'English',
    languageZh: '中文',
    back: '返回对话',
    lede: '只需三项：Base URL、API Key、模型 ID（OpenAI 兼容）。保存时会根据 Base URL 自动匹配 Harness 路由。',
    configFile: '配置文件',
    routing: '路由推断',
    status: '状态',
    configured: '已配置',
    notConfigured: '未配置 API Key',
    baseUrlHint:
      '示例：OpenRouter https://openrouter.ai/api/v1，OpenAI https://api.openai.com/v1，Ollama http://127.0.0.1:11434/v1。',
    apiKey: 'API Key',
    apiKeyOverwrite: '输入新 Key 以覆盖',
    apiKeyMasked: '已保存 Key 以掩码显示；点击输入框可填写新 Key 覆盖。',
    modelId: '模型 ID',
    errBaseUrl: '请填写 Base URL',
    errApiKey: '请填写 API Key',
    errModel: '请填写模型 ID',
    saved: '已保存，Harness 已重新加载环境',
  },
  fixbug,
};
