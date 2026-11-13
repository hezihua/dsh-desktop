import { fixbug } from './fixbug-en';

export const en = {
  common: {
    loading: 'Loading…',
    save: 'Save',
    saving: 'Saving…',
  },
  app: {
    brandTag: 'Local Harness',
    settings: 'Settings',
    backToChat: 'Back to chat',
    chatSection: 'Chat',
  },
  agents: {
    railTitle: 'Agents',
    unavailable: 'Unavailable',
    desktop: {
      label: 'Assistant',
      description: 'Chat and files in your workspace sandbox (bash, selected folder only)',
    },
    'infini-bugfix': {
      label: 'Infini Bugfix (Ops)',
      description: 'Local server-agent; fixbug UI/API, driven by desktop Harness',
    },
    'risk-portal': {
      label: 'Risk Portal',
      description: 'Risk skills + risk-portal tools (local Harness)',
    },
  },
  workspace: {
    label: 'Workspace',
    notSelected: 'No workspace folder selected',
    pick: 'Choose folder',
    change: 'Change',
    picking: 'Selecting…',
  },
  chat: {
    connecting: 'Connecting to Harness…',
    roleUser: 'You',
    roleAssistant: 'Assistant',
    emptyTitle: 'Start chatting',
    emptyHint: 'Pick a workspace folder above, then describe files or commands to run.',
    placeholder: 'What can I help you with in your workspace today?',
    inputAria: 'Message',
    sendAria: 'Send',
    sendingAria: 'Sending',
    cancelAria: 'Stop response',
    canceled: 'Stopped.',
    status: {
      embedded: 'Embedded',
      external: 'External Harness',
      noApiKey: ' · API key missing (open Settings)',
      workspace: ' · Workspace {path}',
      harnessDown: 'Harness not running ({root})',
    },
  },
  settings: {
    title: 'LLM',
    language: 'Interface language',
    languageEn: 'English',
    languageZh: '中文',
    back: 'Back to chat',
    lede: 'Three fields: Base URL, API Key, and model ID (OpenAI-compatible). Provider routing is inferred from the URL when you save.',
    configFile: 'Config file',
    routing: 'Inferred provider',
    status: 'Status',
    configured: 'Configured',
    notConfigured: 'API key not set',
    baseUrlHint:
      'Examples: OpenRouter https://openrouter.ai/api/v1, OpenAI https://api.openai.com/v1, Ollama http://127.0.0.1:11434/v1.',
    apiKey: 'API Key',
    apiKeyOverwrite: 'Enter a new key to replace',
    apiKeyMasked: 'Saved key is masked; click the field to enter a new one.',
    modelId: 'Model ID',
    errBaseUrl: 'Base URL is required',
    errApiKey: 'API Key is required',
    errModel: 'Model ID is required',
    saved: 'Saved. Harness environment reloaded.',
  },
  fixbug,
} as const;

export type MessageTree = typeof en;
