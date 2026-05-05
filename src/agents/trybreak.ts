import type { AgentResult } from "../types";
import { runVerificationAgent, type VerificationContext } from "./verification";

export function runTryBreak(context: VerificationContext): Promise<AgentResult> {
  return runVerificationAgent("trybreak", context);
}
