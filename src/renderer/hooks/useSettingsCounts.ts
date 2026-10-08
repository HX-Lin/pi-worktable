import { useEffect, useState } from "react";

import { call, mcpGetConfig } from "@/lib/api-client";

export type SettingsCounts = Partial<Record<"models" | "plugins" | "mcp" | "channels" | "agents", number>>;

interface Params {
  /** Only load while the settings dialog is open. */
  enabled: boolean;
  cwd: string | null;
}

/**
 * Small counts for the settings rail. Each source is optional: a failing or slow
 * one just leaves its badge off rather than holding up the dialog.
 */
export function useSettingsCounts({ enabled, cwd }: Params): SettingsCounts {
  const [counts, setCounts] = useState<SettingsCounts>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      const next: SettingsCounts = {};

      const [models, plugins, mcp, channels] = await Promise.allSettled([
        call("modelsConfig.get"),
        call("plugins.list", cwd ? { cwd } : undefined),
        mcpGetConfig(cwd),
        call("channels.list"),
      ]);

      if (models.status === "fulfilled") {
        const providers = (models.value as { providers?: unknown[] }).providers;
        if (Array.isArray(providers)) next.models = providers.length;
      }
      if (plugins.status === "fulfilled") {
        const packages = (plugins.value as { packages?: unknown[] }).packages;
        if (Array.isArray(packages)) next.plugins = packages.length;
      }
      if (mcp.status === "fulfilled") {
        const servers = (mcp.value as { servers?: unknown[] }).servers;
        if (Array.isArray(servers)) next.mcp = servers.length;
      }
      if (channels.status === "fulfilled") {
        const accounts = (channels.value as { accounts?: unknown[] }).accounts;
        if (Array.isArray(accounts)) next.channels = accounts.length;
      }

      if (!cancelled) setCounts(next);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, cwd]);

  return counts;
}
