import knowledgeAgent from "./knowledgeAgent/index.js";
import bikeShop from "./bikeShop/index.js";
import textAgent from "./textAgent/index.js";
import simpleHandoff from "./simpleHandoff.js";

// Scenario key -> its agents. The first agent is where a call starts.
export const allAgentSets = {
  knowledgeAgent,
  bikeShop,
  textAgent,
  simpleHandoff,
};

export const defaultAgentSetKey = "knowledgeAgent";

export const labels = {
  knowledgeAgent: "Knowledge agent",
  bikeShop: "Bike shop: one agent with a flow",
  textAgent: "Bring your text agent",
  simpleHandoff: "Handoffs, from openai-realtime-agents",
};
