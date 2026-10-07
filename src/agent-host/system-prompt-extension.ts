import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

export interface DesktopPromptSettings {
  forceEmpty: boolean;
  toolchainPrompt: string;
}

export function createDesktopSystemPromptExtension(settings: DesktopPromptSettings): InlineExtension {
  return {
    name: "DesktopSystemPrompt",
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", (event) => ({
        systemPrompt: settings.forceEmpty
          ? ""
          : [event.systemPrompt, settings.toolchainPrompt].filter(Boolean).join("\n\n"),
      }));
    },
  };
}
