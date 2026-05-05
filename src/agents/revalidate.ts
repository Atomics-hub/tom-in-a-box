import type { AgentResult } from "../types";
import { runVerificationAgent, type VerificationContext } from "./verification";

export function runRevalidate(context: VerificationContext): Promise<AgentResult> {
  return runVerificationAgent("revalidate", context);
}
