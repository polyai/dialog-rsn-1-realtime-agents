import restaurant from "./restaurant/index.js";
import knowledgeAgent from "./knowledgeAgent/index.js";
import bikeShop from "./bikeShop/index.js";

// Scenario key -> the agent that runs the call.
export const scenarios = {
  restaurant,
  knowledgeAgent,
  bikeShop,
};

export const defaultScenario = "restaurant";

export const labels = {
  restaurant: "Restaurant: bookings, knowledge and French",
  knowledgeAgent: "Knowledge agent",
  bikeShop: "Bike shop: one agent with a flow",
};
