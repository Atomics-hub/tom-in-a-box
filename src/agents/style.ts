import type { AgentResult } from "../types";
import { runVerificationAgent, type VerificationContext } from "./verification";

export function runStyle(context: VerificationContext): Promise<AgentResult> {
  return runVerificationAgent("style-consistency", context);
}
