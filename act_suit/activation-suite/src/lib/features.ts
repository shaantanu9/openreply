// Server mirror of app-tauri/src-tauri/src/licence/features.rs (spec §5).
// Keep this file in sync with the Rust Features struct — they are wire-compatible
// via the JWT `features` claim.

export type PlanId = "free" | "pro" | "live_pass" | "team" | "pro_trial";

export type Features = {
  /** null = unlimited */
  max_workspaces: number | null;
  /** null = unlimited */
  max_sources: number | null;
  scheduler: boolean;
  monitors: boolean;
  export_pdf: boolean;
  export_csv: boolean;
  history_days: number;
  max_devices: number;
  plan_id: PlanId;
  live_pass_active: boolean;
  is_trial: boolean;
  trial_days_left: number;
};

export function freeFeatures(): Features {
  return {
    max_workspaces: 1,
    max_sources: 3,
    scheduler: false,
    monitors: false,
    export_pdf: false,
    export_csv: false,
    history_days: 30,
    max_devices: 1,
    plan_id: "free",
    live_pass_active: false,
    is_trial: false,
    trial_days_left: 0,
  };
}

export function proFeatures(): Features {
  return {
    max_workspaces: null,
    max_sources: null,
    scheduler: false,
    monitors: false,
    export_pdf: true,
    export_csv: true,
    history_days: 365,
    max_devices: 1,
    plan_id: "pro",
    live_pass_active: false,
    is_trial: false,
    trial_days_left: 0,
  };
}

export function proWithLivePassFeatures(): Features {
  return {
    max_workspaces: null,
    max_sources: null,
    scheduler: true,
    monitors: true,
    export_pdf: true,
    export_csv: true,
    history_days: 365,
    max_devices: 2,
    plan_id: "live_pass",
    live_pass_active: true,
    is_trial: false,
    trial_days_left: 0,
  };
}

export function teamFeatures(): Features {
  return {
    max_workspaces: null,
    max_sources: null,
    scheduler: true,
    monitors: true,
    export_pdf: true,
    export_csv: true,
    history_days: 365,
    max_devices: 3,
    plan_id: "team",
    live_pass_active: true,
    is_trial: false,
    trial_days_left: 0,
  };
}

export function proTrialFeatures(days_left: number): Features {
  return {
    ...proFeatures(),
    plan_id: "pro_trial",
    is_trial: true,
    trial_days_left: Math.max(0, Math.floor(days_left)),
  };
}

/**
 * Resolve the feature set for a licence given its stored plan fields.
 * Trial precedence: if `is_trial` is true and `trial_ends_at` is in the future,
 * user gets pro_trial — otherwise fall back to the concrete plan.
 */
export function featuresFor(input: {
  plan_id: PlanId | string;
  live_pass_active: boolean;
  is_trial: boolean;
  trial_ends_at: number | null;
}): Features {
  const nowSec = Math.floor(Date.now() / 1000);
  if (input.is_trial && input.trial_ends_at && input.trial_ends_at > nowSec) {
    const daysLeft = Math.floor((input.trial_ends_at - nowSec) / 86400);
    return proTrialFeatures(daysLeft);
  }
  switch (input.plan_id) {
    case "team":
      return teamFeatures();
    case "live_pass":
      return proWithLivePassFeatures();
    case "pro":
      return input.live_pass_active ? proWithLivePassFeatures() : proFeatures();
    case "pro_trial":
      // trial expired — downgrade
      return freeFeatures();
    case "free":
    default:
      return freeFeatures();
  }
}
