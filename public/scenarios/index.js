import restaurant, { margauxPolish } from "./restaurant/index.js";
import knowledgeAgent from "./knowledgeAgent/index.js";
import bikeShop from "./bikeShop/index.js";

// Scenario key -> the agent that runs the call.
export const scenarios = {
  restaurant,
  restaurantPolish: margauxPolish,
  knowledgeAgent,
  bikeShop,
};

export const defaultScenario = "restaurant";

export const labels = {
  restaurant: "Restaurant: bookings, knowledge and French",
  restaurantPolish: "Restaurant in Polish, and English on request",
  knowledgeAgent: "Knowledge agent",
  bikeShop: "Bike shop: one agent with a flow",
};
