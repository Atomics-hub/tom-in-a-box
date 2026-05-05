import type { AgentResult } from "../types";
import { runVerificationAgent, type VerificationContext } from "./verification";

export function runPoc(context: VerificationContext): Promise<AgentResult> {
  return runVerificationAgent("audit-poc", context);
}
