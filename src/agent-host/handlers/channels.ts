import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";

/**
 * channels handlers.
 */
export function channelHandlers(ctx: HandlerContext) {
  const { channelManager } = ctx;

  return {
    "channels.list": async () => channelManager.snapshot(),

    "channels.accountUpsert": async (params) => channelManager.upsertAccount(params.account),

    "channels.accountConnect": async (params) => channelManager.connectAccount(params.account),

    "channels.accountDelete": async (params) => channelManager.deleteAccount(params.accountId),

    "channels.start": async (params) => {
      await channelManager.startAccount(params.accountId);
      return { ok: true as const };
    },

    "channels.stop": async (params) => {
      await channelManager.stopAccount(params.accountId);
      return { ok: true as const };
    },

    "channels.restart": async (params) => {
      await channelManager.restartAccount(params.accountId);
      return { ok: true as const };
    },

    "channels.probe": async (params) => channelManager.probe(params.accountId),

    "channels.loginStart": async (params) => channelManager.startLogin(params.channel, params.force),

    "channels.loginWait": async (params) => channelManager.waitLogin(params.channel, params.sessionKey),

    "channels.loginSubmitCode": async (params) => {
      channelManager.submitLoginCode(params.channel, params.sessionKey, params.code);
      return { ok: true as const };
    },

    "channels.loginCancel": async (params) => {
      channelManager.cancelLogin(params.channel, params.sessionKey);
      return { ok: true as const };
    },

    "channels.pairingApprove": async (params) => channelManager.approvePairing(params.pairingId),

    "channels.pairingReject": async (params) => channelManager.rejectPairing(params.pairingId),

    "channels.bindingUpsert": async (params) => channelManager.upsertBinding(params.binding),

    "channels.bindingDelete": async (params) => channelManager.deleteBinding(params.bindingId),

    "channels.testSend": async (params) => channelManager.testSend(params.accountId, params.peerId, params.message),
  } satisfies Partial<ApiHandlerSet>;
}
