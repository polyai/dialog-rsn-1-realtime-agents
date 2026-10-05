import simpleHandoff from "./simpleHandoff.js";
import customerServiceRetail from "./customerServiceRetail/index.js";
import chatSupervisor from "./chatSupervisor/index.js";
import knowledgeAgent from "./knowledgeAgent/index.js";

// Scenario key -> its agents. The first agent is where a call starts.
export const allAgentSets = {
  simpleHandoff,
  customerServiceRetail,
  chatSupervisor,
  knowledgeAgent,
};

export const defaultAgentSetKey = "chatSupervisor";

export const labels = {
  simpleHandoff: "Simple handoff",
  customerServiceRetail: "Retail customer service",
  chatSupervisor: "Chat supervisor",
  knowledgeAgent: "Knowledge agent",
};
