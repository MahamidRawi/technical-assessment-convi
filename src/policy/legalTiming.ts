// Israeli statute of limitations for personal-injury torts: 7 years (84 months).
// (Separate windows exist for NII work-accident notice (12 months) and the
// auto-insurance claim notice (24 months); those are notice deadlines, not the
// SoL itself, and live with the workflows that need them.)
export const SOL_WINDOW_MONTHS = 84;
const SOL_APPROACHING_MONTHS = 12;
const SOL_RECENTLY_EXPIRED_MONTHS = 12;

export interface LegalFlags {
  approachingSoL: boolean;
  monthsToSoL: number | null;
}

export function deriveLegalFlags(monthsSinceEvent: number | null): LegalFlags {
  if (monthsSinceEvent === null) return { approachingSoL: false, monthsToSoL: null };
  const monthsToSoL = SOL_WINDOW_MONTHS - monthsSinceEvent;
  const approachingSoL =
    monthsToSoL <= SOL_APPROACHING_MONTHS && monthsToSoL > -SOL_RECENTLY_EXPIRED_MONTHS;
  return { approachingSoL, monthsToSoL };
}
