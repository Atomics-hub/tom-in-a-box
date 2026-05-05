import { estimateTokens } from "./utils";

export interface CostReservation {
  model: string;
  inputTokens: number;
  maxOutputTokens: number;
  estimatedUsd: number;
}

export class CostTracker {
  readonly reservations: CostReservation[] = [];

  constructor(private readonly capUsd?: number) {}

  reserve(model: string, promptText: string, maxOutputTokens: number): void {
    if (this.capUsd === undefined) return;
    const inputTokens = estimateTokens(promptText);
    const estimatedUsd = estimateModelCostUsd(model, inputTokens, maxOutputTokens);
    const nextTotal = this.reservedUsd + estimatedUsd;
    if (nextTotal > this.capUsd) {
      throw new Error(
        `Cost cap would be exceeded before model call. Cap: $${this.capUsd.toFixed(2)}, reserved: $${this.reservedUsd.toFixed(
          2
        )}, next estimated call: $${estimatedUsd.toFixed(2)}.`
      );
    }
    this.reservations.push({ model, inputTokens, maxOutputTokens, estimatedUsd });
  }

  get reservedUsd(): number {
    return this.reservations.reduce((sum, reservation) => sum + reservation.estimatedUsd, 0);
  }
}

export function estimateModelCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = estimateRates(model);
  return (inputTokens / 1_000_000) * rates.inputUsdPerMTok + (outputTokens / 1_000_000) * rates.outputUsdPerMTok;
}

function estimateRates(model: string): { inputUsdPerMTok: number; outputUsdPerMTok: number } {
  const normalized = model.toLowerCase();
  if (normalized.includes("opus-4-7")) return { inputUsdPerMTok: 5, outputUsdPerMTok: 25 };
  if (normalized.includes("opus")) return { inputUsdPerMTok: 15, outputUsdPerMTok: 75 };
  if (normalized.includes("sonnet")) return { inputUsdPerMTok: 3, outputUsdPerMTok: 15 };
  if (normalized.includes("haiku")) return { inputUsdPerMTok: 0.8, outputUsdPerMTok: 4 };
  return { inputUsdPerMTok: 5, outputUsdPerMTok: 25 };
}
