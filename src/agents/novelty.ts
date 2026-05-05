import type { AgentResult } from "../types";
import { runVerificationAgent, type VerificationContext } from "./verification";

export function runNovelty(context: VerificationContext): Promise<AgentResult> {
  return runVerificationAgent("novelty", context);
}
