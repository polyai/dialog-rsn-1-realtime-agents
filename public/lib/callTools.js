/**
 * The two tools every agent here ends a call with. Both are terminal: the model says its last
 * line as it calls the tool (a `poly_spoken` argument), the page plays it, then hangs up.
 *
 *   transfer_call(reason, utterance)  hand the caller to a person. In production, this is
 *                                     where your telephony moves the call (a SIP REFER, a
 *                                     queue). Here it says the line and ends the call.
 *   end_call(utterance)               say goodbye and hang up once the caller is done.
 */
import { tool, spoken, hangUp } from "./agents.js";

/** @param {{ reasons: string[], onTransfer?: (args: object, ctx: object) => void }} opts */
export function transferCallTool({ reasons = ["SPEAK_TO", "OUT_OF_SCOPE", "COMPLAINT"], onTransfer } = {}) {
  return tool({
    name: "transfer_call",
    description: "Transfer the caller to a person on the team. This ends your part of the call.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", enum: reasons, description: "Why the caller needs a person." },
        utterance: spoken("What you say before the transfer, e.g. 'Let me put you through to the team.'"),
      },
      required: ["reason", "utterance"],
    },
    execute: (args, ctx) => {
      onTransfer?.(args, ctx);
      ctx.breadcrumb?.(`Transferred to a person (${args.reason})`, args);
      return hangUp({ transferred: true });
    },
  });
}

/** @param {string} goodbye an example goodbye, for the model to say in its own words */
export function endCallTool(goodbye) {
  return tool({
    name: "end_call",
    description: "End the call once the caller has everything they need and has said goodbye, or says there's nothing else.",
    parameters: {
      type: "object",
      properties: { utterance: spoken(`Your goodbye, e.g. '${goodbye}'`) },
      required: ["utterance"],
    },
    execute: () => hangUp({ ended: true }),
  });
}
