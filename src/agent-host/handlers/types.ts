import type { RpcServer } from "../../contract/rpc";
import type { ChannelManager } from "../channels/channel-manager";
import type { createAuthLoginService } from "../auth-login";
import type { createFileWatchService } from "../file-watch";

/** Everything the handler modules share: the server plus the long-lived services. */
export interface HandlerContext {
  server: RpcServer;
  fileWatch: ReturnType<typeof createFileWatchService>;
  authLogin: ReturnType<typeof createAuthLoginService>;
  channelManager: ChannelManager;
}
