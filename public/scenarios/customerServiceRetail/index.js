import { authenticationAgent } from "./authentication.js";
import { returnsAgent } from "./returns.js";
import { salesAgent } from "./sales.js";
import { simulatedHumanAgent } from "./simulatedHuman.js";

// Who can hand off to whom. Every agent can reach every other.
authenticationAgent.handoffs.push(returnsAgent, salesAgent, simulatedHumanAgent);
returnsAgent.handoffs.push(authenticationAgent, salesAgent, simulatedHumanAgent);
salesAgent.handoffs.push(authenticationAgent, returnsAgent, simulatedHumanAgent);
simulatedHumanAgent.handoffs.push(authenticationAgent, returnsAgent, salesAgent);

export default [authenticationAgent, returnsAgent, salesAgent, simulatedHumanAgent];
