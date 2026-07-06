export type PlanTier = 'FREE' | 'BASIC' | 'PRO';

export interface PlanLimits {
  devices:     number;  // -1 = unlimited
  automations: number;
  cameras:     number;
  historyDays: number;
  energy:      boolean;
  voice:       boolean;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  FREE:  { devices: 3,  automations: 3,  cameras: 0, historyDays: 7,   energy: false, voice: false },
  BASIC: { devices: 15, automations: 15, cameras: 0, historyDays: 30,  energy: true,  voice: true  },
  PRO:   { devices: -1, automations: -1, cameras: 5, historyDays: 365, energy: true,  voice: true  },
};

export const PLAN_PRICES = {
  FREE:  { monthly: 0,    annual: 0     },
  BASIC: { monthly: 3.99, annual: 39.99 },
  PRO:   { monthly: 6.99, annual: 69.99 },
};
