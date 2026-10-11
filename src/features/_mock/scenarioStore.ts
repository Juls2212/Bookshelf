// TEMPORARY dev-only scenario switcher, replaced in Phase 3/4 by the real data layer.
import { create } from 'zustand';

export const MOCK_SCENARIOS = [
  'full',
  'empty',
  'loading',
  'noResults',
  'noReading',
  'noRecommendation',
  'offline',
  'error',
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

type ScenarioState = {
  scenario: MockScenario;
  setScenario: (scenario: MockScenario) => void;
};

// Not persisted on purpose: every launch starts with the full dataset.
export const useScenarioStore = create<ScenarioState>()((set) => ({
  scenario: 'full',
  setScenario: (scenario) => set({ scenario }),
}));

/** Production builds always see the full dataset. */
export function useMockScenario(): MockScenario {
  const scenario = useScenarioStore((state) => state.scenario);
  return __DEV__ ? scenario : 'full';
}
