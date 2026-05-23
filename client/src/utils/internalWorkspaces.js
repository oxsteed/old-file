export const INTERNAL_WORKSPACE_ROUTE_ALIASES = {
  hr: 'hr',
  people: 'hr',
  'human-resources': 'hr',
  human_resources: 'hr',
  legal: 'legal',
  finance: 'finance',
  marketing: 'marketing',
  executive: 'executive',
  technology: 'technology',
  data: 'data',
  corporate_ops: 'corporate_ops',
  corporateops: 'corporate_ops',
  'corporate-ops': 'corporate_ops',
};

const CORPORATE_OPS_PLAYBOOK = {
  label: 'Corporate Operations',
  icon: 'Building2',
  accent: 'from-orange-400 via-amber-500 to-yellow-500',
  mission: 'Turns launch plans into repeatable marketplace operations and customer outcomes.',
  launchObjective: 'Stand up onboarding, support, verification, and day-to-day execution for each market team.',
  owns: ['Marketplace operations and SLAs', 'Customer and helper onboarding', 'Escalations, verification, and payments operations'],
  firstHireCodes: ['director_operations', 'customer_success_manager', 'verification_compliance'],
};

const HR_PLAYBOOK = {
  label: 'HR',
  icon: 'Users',
  accent: 'from-fuchsia-400 via-violet-500 to-indigo-500',
  mission: 'Builds the local team, hiring engine, and administrative backbone.',
  launchObjective: 'Recruit the country team, define HR process, and make the office and admin side dependable from day one.',
  owns: ['Hiring and org design', 'HR operations and employee experience', 'Office, admin, and people systems'],
  firstHireCodes: ['vp_people', 'talent_acquisition', 'office_facilities_manager'],
};

export const INTERNAL_WORKSPACE_PLAYBOOKS = {
  executive: {
    label: 'Executive',
    icon: 'Crown',
    accent: 'from-amber-400 via-orange-400 to-red-500',
    mission: 'Sets country strategy, governance, budget, and launch sequencing.',
    launchObjective: 'Make the market-entry plan real with executive accountability, partner decisions, and operating-model clarity.',
    owns: ['Country entry decision-making', 'Executive escalation and risk calls', 'Budget approval and cross-team coordination'],
    firstHireCodes: ['vp_strategy_bizdev', 'vp_operations', 'general_counsel'],
  },
  technology: {
    label: 'Technology',
    icon: 'Cpu',
    accent: 'from-cyan-400 via-sky-500 to-blue-600',
    mission: 'Keeps the product stable while localizing workflows, tooling, and support operations.',
    launchObjective: 'Ship country-specific configuration, payments, compliance hooks, and internal tools without slowing the core platform.',
    owns: ['Platform reliability and security', 'Localization and internal tools', 'Technical delivery for launch-critical work'],
    firstHireCodes: ['vp_engineering', 'devops_sre', 'senior_fullstack_developer'],
  },
  corporate_ops: CORPORATE_OPS_PLAYBOOK,
  operations: CORPORATE_OPS_PLAYBOOK,
  marketing: {
    label: 'Marketing',
    icon: 'Megaphone',
    accent: 'from-pink-400 via-rose-500 to-red-500',
    mission: 'Drives demand, partnerships, and local market awareness.',
    launchObjective: 'Create the launch story, demand engine, and channel partnerships that bring in customers and providers fast.',
    owns: ['Go-to-market strategy', 'Brand, performance, and content', 'Partnerships and pipeline building'],
    firstHireCodes: ['director_marketing', 'growth_marketing_manager', 'partnerships_manager'],
  },
  finance: {
    label: 'Finance',
    icon: 'BadgeDollarSign',
    accent: 'from-emerald-400 via-green-500 to-lime-500',
    mission: 'Protects the business with solid controls, licensing, and financial visibility.',
    launchObjective: 'Set up local compliance, payment controls, reporting, and licensing so launch can scale safely.',
    owns: ['Compliance and licensing', 'Financial controls and treasury', 'Contracts, risk, and insurance readiness'],
    firstHireCodes: ['controller', 'compliance_officer', 'insurance_licensing_coord'],
  },
  legal: {
    label: 'Legal',
    icon: 'Scale',
    accent: 'from-indigo-400 via-violet-500 to-purple-600',
    mission: 'Protects the company with contracts, regulatory interpretation, privacy discipline, and legal controls.',
    launchObjective: 'Keep new-market expansion contract-ready, regulator-aware, and operationally safe as the platform grows.',
    owns: ['Contracts and legal review', 'Privacy, data, and regulatory guidance', 'Compliance reporting and legal escalation'],
    firstHireCodes: ['chief_legal_officer', 'legal_counsel', 'contracts_manager'],
  },
  hr: HR_PLAYBOOK,
  people: HR_PLAYBOOK,
  data: {
    label: 'Data',
    icon: 'LineChart',
    accent: 'from-slate-300 via-slate-400 to-slate-500',
    mission: 'Creates the measurement loop that shows whether the launch is healthy or drifting.',
    launchObjective: 'Instrument the launch so leadership can spot traction, fraud, unit economics, and product gaps early.',
    owns: ['KPIs and launch dashboards', 'Research and experimentation', 'Analytics for growth, quality, and fraud prevention'],
    firstHireCodes: ['data_science_manager', 'bi_analyst', 'innovation_lead'],
  },
};

export const INTERNAL_ROLE_FOCUS = {
  vp_strategy_bizdev: 'Owns market-entry strategy, local partnerships, and expansion pacing.',
  vp_operations: 'Builds the local execution system and clears cross-functional blockers.',
  general_counsel: 'Owns legal structure, contracts, and regulatory interpretation.',
  vp_engineering: 'Leads technical delivery for launch-critical platform changes.',
  devops_sre: 'Keeps uptime, deployments, monitoring, and incident response healthy.',
  senior_fullstack_developer: 'Ships customer-facing and internal workflows needed for launch.',
  director_operations: 'Runs the daily operating rhythm for the new country.',
  customer_success_manager: 'Owns service quality, retention, and issue resolution.',
  verification_compliance: 'Protects marketplace trust with checks, reviews, and controls.',
  director_marketing: 'Owns launch narrative, positioning, and channel mix.',
  growth_marketing_manager: 'Builds repeatable acquisition loops and campaign measurement.',
  partnerships_manager: 'Opens local business channels and strategic relationships.',
  controller: 'Owns reporting discipline, controls, and close processes.',
  compliance_officer: 'Keeps the operation aligned with rules and internal policies.',
  chief_legal_officer: 'Owns legal leadership, major contracts, and high-risk regulatory escalations.',
  legal_counsel: 'Advises on contracts, legal interpretation, and policy risk.',
  contracts_manager: 'Runs contract drafting, tracking, and renewal discipline.',
  privacy_regulatory_manager: 'Owns privacy response and regulatory process alignment.',
  legal_operations_manager: 'Keeps legal intake, records, and operational follow-through moving.',
  insurance_licensing_coord: 'Tracks local registrations, permits, and coverage.',
  vp_people: 'Designs the org, hiring plan, and people policies.',
  talent_acquisition: 'Sources and closes the critical early hires.',
  office_facilities_manager: 'Keeps the local office and admin setup running cleanly.',
  data_science_manager: 'Leads measurement, forecasting, and decision support.',
  bi_analyst: 'Builds the dashboards leadership will rely on each week.',
  innovation_lead: 'Turns new market learnings into product and process experiments.',
};

export function formatWorkspaceLabel(code) {
  return String(code || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeInternalWorkspaceCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return INTERNAL_WORKSPACE_ROUTE_ALIASES[raw] || raw.replace(/-/g, '_');
}

export function internalWorkspaceSlug(code) {
  return String(code || '').trim().toLowerCase().replace(/_/g, '-');
}

export function getInternalWorkspaceMeta(workspace) {
  const code = normalizeInternalWorkspaceCode(workspace);
  const playbook = INTERNAL_WORKSPACE_PLAYBOOKS[code];
  const slug = internalWorkspaceSlug(code);
  if (playbook) {
    return {
      code,
      slug,
      ...playbook,
      dashboardPath: `/internal/${slug}`,
      loginPath: `/internal/${slug}/login`,
    };
  }
  return {
    code,
    slug,
    label: formatWorkspaceLabel(code),
    icon: 'Building2',
    accent: 'from-slate-400 via-slate-500 to-slate-700',
    mission: 'Runs a company-wide internal function for OxSteed.',
    launchObjective: 'Keep the department staffed, aligned, and accountable as OxSteed expands.',
    owns: ['Department planning', 'Cross-functional execution', 'Operational readiness'],
    firstHireCodes: [],
    dashboardPath: `/internal/${slug}`,
    loginPath: `/internal/${slug}/login`,
  };
}

export function canAccessInternalWorkspace(user, workspace) {
  if (!user || !workspace) return false;
  const normalizedWorkspace = normalizeInternalWorkspaceCode(workspace);
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  if (user.role !== 'employee') return false;
  return normalizeInternalWorkspaceCode(user.internal_access_route) === normalizedWorkspace;
}
