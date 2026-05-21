export type FeatureFlag =
  | "customerDashboard"
  | "postJob"
  | "helperDashboard"
  | "pushRegistration"
  | "twoFactorAuth"
  | "businessHubLite";

export const featureFlags: Record<FeatureFlag, boolean> = {
  customerDashboard: true,
  postJob: true,
  helperDashboard: true,
  pushRegistration: true,
  twoFactorAuth: true,
  businessHubLite: false
};

export function isEnabled(flag: FeatureFlag) {
  return featureFlags[flag];
}
