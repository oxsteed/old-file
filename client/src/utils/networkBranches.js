// Single source of truth for the OxSteed Network branch catalog.
// Both the navbar switcher (OxSteedNetworkSwitcher) and the full-page
// app launcher (/network) read from here so the two never drift.
//
// Each entry only routes — access is gated by the destination itself.
// `showSupportWorkspace` is resolved by the caller (the navbar already
// knows whether the user is a support agent).

export function getNetworkBranches(t, { showSupportWorkspace = false } = {}) {
  return [
    { key: 'marketplace',    to: '/jobs',                    title: t('network.marketplace.title', 'OxSteed Marketplace'),     hint: t('network.marketplace.hint', 'Hire local helpers, post jobs, compare bids') },
    { key: 'restaurants',    to: '/restaurants',             title: t('network.restaurants.title', 'OxSteed Restaurants'),      hint: t('network.restaurants.hint', 'Franchise-grade tools for independent restaurants') },
    { key: 'logistics',      to: '/logistics',               title: t('network.logistics.title', 'OxSteed Logistics'),          hint: t('network.logistics.hint', 'Sourcing, pooled orders, shipments') },
    { key: 'businessLaunch', to: '/business-launch-status',  title: t('network.businessLaunch.title', 'OxSteed Business Launch'), hint: t('network.businessLaunch.hint', 'Start and stand up a new business') },
    { key: 'consulting',     to: '/consulting',              title: t('network.consulting.title', 'OxSteed Consulting'),        hint: t('network.consulting.hint', 'Expert guidance and advisory sessions') },
    ...(showSupportWorkspace
      ? [{ key: 'support',   to: '/support/agent',           title: t('network.support.title', 'OxSteed Support Workspace'),    hint: t('network.support.hint', 'Handle tickets and live chats') }]
      : []),
    { key: 'vortex',         to: '/vortex',                  title: t('network.vortex.title', 'Vortex'),                        hint: t('network.vortex.hint', 'Join or manage your workspaces') },
    { key: 'settings',       to: '/settings',                title: t('network.settings.title', 'Settings'),                    hint: t('network.settings.hint', 'Account, billing, notifications, language') },
  ];
}
