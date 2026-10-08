import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "node:crypto";
import path from "path";
import { ModelRuntime, createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { type AuthInteraction } from "@earendil-works/pi-ai";
import { RpcError } from "../../contract/types";
import { BUILTIN_SESSION_EXTENSIONS } from "../builtin-providers";
import { resolveLoginCode } from "../auth-login";
import {
  getSharedModelRuntime,
  modelCatalogRefreshCoordinator,
  reloadSharedModelRuntimeConfig,
} from "../model-runtime";
import { credentialStateMatches } from "../credential-sync";
import {
  credentialMutationFailure,
  describeApiKeyProviderAuth,
  projectModelsList,
  readModelsJson,
  resolveModelsCwd,
  writeModelsJson,
} from "./helpers";

/**
 * models handlers.
 */
export function modelHandlers(ctx: HandlerContext) {
  const { authLogin } = ctx;

  return {
    "models.list": async (params) => {
      const cwd = resolveModelsCwd(params as { cwd?: string } | void);
      const agentDir = getAgentDir();
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        resourceLoaderOptions: { extensionFactories: BUILTIN_SESSION_EXTENSIONS },
      });
      return projectModelsList(services.modelRuntime, services.settingsManager, {
        source: process.env.PI_OFFLINE === undefined ? "cache" : "offline",
        refreshed: false,
        aborted: false,
        warnings: [],
      });
    },

    "models.refresh": async (params) => {
      const { requestId } = params as { cwd?: string; requestId: string };
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Invalid model refresh request id" });
      }
      const cwd = resolveModelsCwd(params);
      const agentDir = getAgentDir();
      const { services, catalog } = await modelCatalogRefreshCoordinator.refresh(cwd, requestId, (signal) =>
        createAgentSessionServices({
          cwd,
          agentDir,
          modelRuntimeSignal: signal,
          resourceLoaderOptions: { extensionFactories: BUILTIN_SESSION_EXTENSIONS },
        }),
      );
      return projectModelsList(services.modelRuntime, services.settingsManager, catalog);
    },

    "models.refreshCancel": (params) => {
      const { requestId } = params as { requestId: string };
      return { ok: true as const, cancelled: modelCatalogRefreshCoordinator.cancel(requestId) };
    },

    "modelsConfig.get": () => readModelsJson() as never,

    "modelsConfig.set": async (params) => {
      const body = params as Record<string, unknown>;
      // ISSUE-009: refuse to persist empty overwrite without explicit providers key from a real load
      if (!body || typeof body !== "object" || !("providers" in body)) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Invalid models config payload" });
      }
      writeModelsJson(body);
      await reloadSharedModelRuntimeConfig();
      return { ok: true as const };
    },

    "modelsConfig.test": async (params) => {
      const body = params as unknown as {
        providerName?: string;
        provider?: Record<string, unknown>;
        model?: Record<string, unknown>;
      };
      const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
      if (!providerName) return { ok: false, error: "providerName is required" };
      if (!body.provider || typeof body.provider !== "object") {
        return { ok: false, error: "provider is required" };
      }
      if (!body.model || typeof body.model !== "object") {
        return { ok: false, error: "model is required" };
      }
      const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
      if (!modelId) return { ok: false, error: "Model ID is required" };

      let tempDir: string | undefined;
      try {
        tempDir = mkdtempSync(path.join(tmpdir(), "pi-desktop-model-test-"));
        const modelsPath = path.join(tempDir, "models.json");
        writeFileSync(
          modelsPath,
          JSON.stringify(
            {
              providers: {
                [providerName]: {
                  ...body.provider,
                  models: [{ ...body.model, id: modelId }],
                },
              },
            },
            null,
            2,
          ),
          "utf8",
        );

        const modelRuntime = await ModelRuntime.create({ modelsPath, allowModelNetwork: false });
        const loadError = modelRuntime.getError();
        if (loadError) return { ok: false, error: loadError };

        const model = modelRuntime.getModel(providerName, modelId);
        if (!model) return { ok: false, error: `Model not found: ${providerName}/${modelId}` };

        const auth = await modelRuntime.getAuth(model);
        if (!auth) return { ok: false, error: `No authentication found for "${providerName}"` };

        const TEST_TIMEOUT_MS = 20_000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        let status: number | undefined;
        const startedAt = Date.now();
        const testSessionId = `pi-desktop-model-test-${randomUUID()}`;
        const configuredBaseUrl = [body.model.baseUrl, body.provider.baseUrl]
          .find((value): value is string => typeof value === "string" && value.trim().length > 0)
          ?.toLowerCase();
        const isOpenCodeEndpoint =
          providerName === "opencode" ||
          providerName === "opencode-go" ||
          configuredBaseUrl?.includes("opencode.ai") === true;
        try {
          const message = await modelRuntime.completeSimple(
            model,
            {
              messages: [
                {
                  role: "user",
                  content: "Reply with OK only.",
                  timestamp: Date.now(),
                },
              ],
            },
            {
              maxTokens: 16,
              timeoutMs: TEST_TIMEOUT_MS,
              maxRetries: 0,
              cacheRetention: "none",
              // OpenCode Go requires x-opencode-session for request routing. The
              // normal agent path supplies the session id, but this standalone
              // model probe has no AgentSession, so give it an isolated id.
              sessionId: testSessionId,
              ...(isOpenCodeEndpoint
                ? { headers: { "x-opencode-session": testSessionId, "x-opencode-client": "pi" } }
                : {}),
              signal: controller.signal,
              onResponse: (response: { status: number }) => {
                status = response.status;
              },
            },
          );

          const latencyMs = Date.now() - startedAt;
          if (message.stopReason === "error" || message.stopReason === "aborted") {
            return {
              ok: false,
              error: message.errorMessage ?? (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
              latencyMs,
              status,
            };
          }
          const responseText = message.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("")
            .slice(0, 300);
          return { ok: true, latencyMs, status, responseText };
        } finally {
          clearTimeout(timeout);
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        if (tempDir) {
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      }
    },

    "auth.providers": async () => {
      const modelRuntime = await getSharedModelRuntime();
      const storedProviders = new Set(
        (await modelRuntime.listCredentials())
          .filter((entry) => entry.type === "oauth")
          .map((entry) => entry.providerId),
      );
      const EXCLUDED = new Set(["anthropic"]);
      const DISPLAY_NAMES: Record<string, string> = {
        "openai-codex": "ChatGPT Plus/Pro",
        "github-copilot": "GitHub Copilot",
      };
      const result = modelRuntime
        .getProviders()
        .filter((p) => p.auth.oauth && !EXCLUDED.has(p.id))
        .map((p) => ({
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: false,
          authenticated: storedProviders.has(p.id),
          loggedIn: storedProviders.has(p.id),
        }));
      return { providers: result };
    },

    "auth.allProviders": async () => {
      const modelRuntime = await getSharedModelRuntime();
      const all = modelRuntime.getModels();
      const EXCLUDED_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);
      const seen = new Set<string>();
      const result: Array<{
        id: string;
        displayName: string;
        configured: boolean;
        source?: string;
        modelCount: number;
      }> = [];
      for (const model of all) {
        if (seen.has(model.provider)) continue;
        seen.add(model.provider);
        if (EXCLUDED_PROVIDER_IDS.has(model.provider)) continue;
        const provider = modelRuntime.getProvider(model.provider);
        if (!provider?.auth.apiKey || provider.auth.oauth) continue;
        const status = modelRuntime.getProviderAuthStatus(model.provider);
        if (status.source === "models_json_key") continue;
        result.push({
          id: model.provider,
          displayName: provider.name,
          ...describeApiKeyProviderAuth(status),
          source: status.label ?? status.source,
          modelCount: all.filter((candidate) => candidate.provider === model.provider).length,
        });
      }
      return { providers: result as never };
    },

    "auth.setApiKey": async (params) => {
      const { provider, key } = params as { provider: string; key: string };
      if (!provider || !key?.trim()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "provider and key required" });
      }
      const modelRuntime = await getSharedModelRuntime();
      let promptCount = 0;
      const interaction: AuthInteraction = {
        async prompt(request) {
          promptCount += 1;
          if (promptCount !== 1 || request.type !== "secret") {
            throw new Error(`${provider} requires an interactive, multi-field login flow`);
          }
          return key.trim();
        },
        notify() {},
      };
      try {
        await modelRuntime.login(provider, "api_key", interaction);
      } catch (error) {
        return credentialMutationFailure(modelRuntime, provider, { present: true, type: "api_key" }, error);
      }
      if (!(await credentialStateMatches(modelRuntime, provider, { present: true, type: "api_key" }))) {
        throw new RpcError({
          code: "INTERNAL",
          message: `Key for ${provider} was written but not readable back`,
        });
      }
      return { ok: true as const, synchronized: true };
    },

    "auth.deleteApiKey": async (params) => {
      const { provider } = params as { provider: string };
      const modelRuntime = await getSharedModelRuntime();
      try {
        await modelRuntime.logout(provider);
      } catch (error) {
        return credentialMutationFailure(modelRuntime, provider, { present: false, type: "api_key" }, error);
      }
      if (!(await credentialStateMatches(modelRuntime, provider, { present: false, type: "api_key" }))) {
        throw new RpcError({ code: "INTERNAL", message: `Key removal for ${provider} could not be verified` });
      }
      return { ok: true as const, synchronized: true };
    },

    "auth.logout": async (params) => {
      const { provider } = params as { provider: string };
      const modelRuntime = await getSharedModelRuntime();
      try {
        await modelRuntime.logout(provider);
      } catch (error) {
        return credentialMutationFailure(modelRuntime, provider, { present: false }, error);
      }
      if (!(await credentialStateMatches(modelRuntime, provider, { present: false }))) {
        throw new RpcError({ code: "INTERNAL", message: `Logout for ${provider} could not be verified` });
      }
      return { ok: true as const, synchronized: true };
    },

    "auth.loginSubmit": async (params) => {
      const { provider, token, code } = params as {
        provider: string;
        token: string;
        code: string;
      };
      if (!token.startsWith(`${provider}-`)) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Token does not match provider" });
      }
      if (!resolveLoginCode(token, code)) {
        throw new RpcError({ code: "NOT_FOUND", message: "No pending login for token" });
      }
      return { ok: true as const };
    },

    "auth.loginStart": async (params) => {
      const { provider } = params as { provider: string };
      const result = await authLogin.start(provider);
      return { ok: true as const, started: result.started };
    },

    "auth.loginCancel": async (params) => {
      const { provider } = params as { provider: string };
      authLogin.cancel(provider);
      return { ok: true as const };
    },
  } satisfies Partial<ApiHandlerSet>;
}
