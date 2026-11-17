/**
 * The two tools every agent here ends a call with. Both are terminal: the page says a fixed
 * line and hangs up, and the model writes nothing after them.
 *
 *   transfer_call(reason, utterance)  hand the caller to a person. In production, this is
 *                                     where your telephony moves the call (a SIP REFER, a
 *                                     queue). Here it says the line and ends the call.
 *   end_call()                        say goodbye and hang up once the caller is done.
 */
import { tool, endCall } from "./agents.js";

/** @param {{ reasons: string[], onTransfer?: (args: object, ctx: object) => void }} opts */
export function transferCallTool({ reasons = ["SPEAK_TO", "OUT_OF_SCOPE", "COMPLAINT"], onTransfer } = {}) {
  return tool({
    name: "transfer_call",
    description: "Transfer the caller to a person on the team. This ends your part of the call.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", enum: reasons, description: "Why the caller needs a person." },
        utterance: { type: "string", description: "What to say before the transfer, e.g. 'Let me put you through to the team.'" },
      },
      required: ["reason", "utterance"],
    },
    execute: (args, ctx) => {
      onTransfer?.(args, ctx);
      ctx.breadcrumb?.(`Transferred to a person (${args.reason})`, args);
      return endCall(args.utterance || "Let me put you through to the team.", { transferred: true });
    },
  });
}

/** @param {string} goodbye the line said before hanging up */
export function endCallTool(goodbye) {
  return tool({
    name: "end_call",
    description: "End the call once the caller has everything they need and has said goodbye, or says there's nothing else.",
    execute: () => endCall(goodbye, { ended: true }),
  });
}
