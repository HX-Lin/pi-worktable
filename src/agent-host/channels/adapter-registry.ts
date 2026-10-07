import type { ChannelId } from "../../shared/channel-types";
import type { ChannelAdapter } from "./types";
import { FeishuAdapter } from "./adapters/feishu/adapter";

export class AdapterRegistry {
  private readonly adapters = new Map<ChannelId, ChannelAdapter>();

  constructor() {
    this.register(new FeishuAdapter());
  }

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: ChannelId): ChannelAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Channel adapter is unavailable: ${id}`);
    return adapter;
  }
}
