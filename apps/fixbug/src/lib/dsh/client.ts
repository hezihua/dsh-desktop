import path from "node:path";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import {
  getDshBridgePath,
  getDshProviderModel,
  getHarnessUrl,
  isHarnessConfigured,
} from "@/lib/dsh/config";

let harnessInstance: DeepSeekHarness | null = null;
let harnessInit: Promise<DeepSeekHarness> | null = null;

function resolveNodeBin(): string {
  return process.execPath;
}

function buildLaunchSpec(model?: string) {
  const remoteUrl = getHarnessUrl();
  if (!remoteUrl) {
    throw new Error("HARNESS_URL 未配置");
  }

  const projectRoot = process.cwd();
  return {
    launch: {
      command: resolveNodeBin(),
      args: [getDshBridgePath(), remoteUrl],
      cwd: projectRoot,
      env: {
        ...process.env,
        HARNESS_URL: remoteUrl,
        HARNESS_PRODUCT: process.env.HARNESS_PRODUCT?.trim() || "server-agent",
      },
    },
    cwd: projectRoot,
    ...getDshProviderModel(model),
  };
}

export async function getDshHarness(model?: string): Promise<DeepSeekHarness> {
  if (!isHarnessConfigured()) {
    throw new Error("未配置 HARNESS_URL");
  }

  if (harnessInstance) return harnessInstance;
  if (harnessInit) return harnessInit;

  harnessInit = (async () => {
    const { launch, cwd, provider, model: resolvedModel } = buildLaunchSpec(model);
    const harness = new DeepSeekHarness({
      launch,
      cwd,
      provider,
      model: resolvedModel,
      maxTokens: Number(process.env.DSH_MAX_TOKENS || 16384),
    });
    await harness.start();
    harnessInstance = harness;
    return harness;
  })();

  try {
    return await harnessInit;
  } catch (error) {
    harnessInit = null;
    harnessInstance = null;
    throw error;
  }
}

export async function resetDshHarness(): Promise<void> {
  const current = harnessInstance;
  harnessInstance = null;
  harnessInit = null;
  if (current) {
    await current.close().catch(() => undefined);
  }
}
