/**
 * Feishu H5 JSAPI login.
 *
 * Loads the Feishu h5-js-sdk, waits for `h5sdk.ready`, then requests a one-time
 * auth code with `tt.requestAuthCode`. The relay exchanges that code for the
 * operator's open_id server-side, so the app secret never reaches the browser.
 *
 * Every step reports through `step` so a failure inside the Feishu webview is
 * visible on screen instead of hanging silently.
 */
const DEFAULT_SDK_URL = "https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.36.js";
const READY_TIMEOUT_MS = 12_000;

export type LoginStep = (message: string) => void;

type FeishuGlobals = {
  h5sdk?: {
    ready?: (callback: () => void) => void;
    error?: (callback: (error: unknown) => void) => void;
  };
  tt?: {
    requestAuthCode?: (options: {
      appId: string;
      success: (result: { code: string }) => void;
      fail: (error: { errMsg?: string }) => void;
    }) => void;
    setNavigationBarTitle?: (options: { title: string }) => void;
  };
};

function feishuGlobals(): FeishuGlobals {
  return window as unknown as FeishuGlobals;
}

let sdkPromise: Promise<void> | null = null;

function ensureSdk(): Promise<void> {
  // `tt` may exist before `h5sdk.ready` is callable; wait for the SDK's own
  // readiness hook rather than trusting the presence of `tt` alone.
  if (typeof feishuGlobals().h5sdk?.ready === "function") return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const url = import.meta.env.VITE_FEISHU_H5_SDK_URL || DEFAULT_SDK_URL;
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("无法加载飞书 H5 SDK"));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Set the title the Feishu client shows above the page.
 *
 * `document.title` is what most in-app browsers use, and the native navigation bar is updated too
 * when the JSAPI happens to be loaded. Best effort by design: nothing here may break the page.
 */
export function setNavigationTitle(title: string): void {
  try {
    document.title = title;
  } catch {
    /* ignore */
  }
  const set = feishuGlobals().tt?.setNavigationBarTitle;
  if (typeof set !== "function") return;
  try {
    set({ title });
  } catch {
    /* older clients reject unknown params */
  }
}

export async function requestAuthCode(appId: string, step: LoginStep = () => {}): Promise<string> {
  step("加载飞书 H5 SDK…");
  await ensureSdk();
  const globals = feishuGlobals();
  step(`h5sdk.ready: ${typeof globals.h5sdk?.ready === "function" ? "可用" : "无"}`);
  step(`tt.requestAuthCode: ${typeof globals.tt?.requestAuthCode === "function" ? "可用" : "无"}`);

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("requestAuthCode 超时（h5sdk.ready 未触发）"));
    }, READY_TIMEOUT_MS);
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      run();
    };
    const call = () => {
      const request = globals.tt?.requestAuthCode;
      if (!request) {
        finish(() => reject(new Error("当前不在飞书客户端内（tt.requestAuthCode 不存在）")));
        return;
      }
      step("调用 requestAuthCode…");
      request({
        appId,
        success: (result) => finish(() => resolve(result.code)),
        fail: (error) => finish(() => reject(new Error(error?.errMsg || "requestAuthCode 失败"))),
      });
    };
    if (typeof globals.h5sdk?.ready === "function") {
      step("等待 h5sdk.ready…");
      globals.h5sdk.ready(call);
    } else {
      call();
    }
  });
}

export async function loginWithFeishu(step: LoginStep = () => {}): Promise<string> {
  step("获取 relay 配置…");
  const configResponse = await fetch("/api/config");
  const config = (await configResponse.json()) as { appId?: string };
  if (!config.appId) throw new Error("relay 未返回 appId，请检查服务器配置");
  step(`appId = ${config.appId}`);

  const code = await requestAuthCode(config.appId, step);
  step("用 code 换取 token…");
  const loginResponse = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const payload = (await loginResponse.json()) as { token?: string; error?: string };
  if (!loginResponse.ok || !payload.token) {
    throw new Error(payload.error || `登录失败 (HTTP ${loginResponse.status})`);
  }
  step("登录成功");
  return payload.token;
}
