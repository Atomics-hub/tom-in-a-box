import type { AgentResult } from "../types";
import { runVerificationAgent, type VerificationContext } from "./verification";

export function runWriteup(context: VerificationContext): Promise<AgentResult> {
  return runVerificationAgent("audit-writeup", context);
}
