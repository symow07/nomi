/**
 * M12.1 harness runner — promoted to src/trust/harness.ts in M15 so it also
 * runs at runtime (the Pilot Readiness "Validate" action). This shim keeps the
 * existing test import path; the CI gate and the runtime validator share ONE
 * harness (HarnessTenant + the real engine), so they can never drift.
 */
export {
  runScenario, runAll, formatReport,
  type ScenarioReport, type HarnessReport,
} from '../../src/trust/harness.js';
