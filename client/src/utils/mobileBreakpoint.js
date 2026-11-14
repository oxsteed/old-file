// The one shared definition of "mobile" for the client: a viewport narrower
// than the Tailwind lg: breakpoint (1024px). Previously "mobile" was defined
// four different ways (SupportWidget fullscreen at <640px, FAB/sticky-bar
// colour and visibility at lg: = 1024px, the Navbar hamburger at 1360px,
// the PWA launcher offset at 640px), so tablets and narrow desktop windows
// got a mixed mobile/desktop UI. The Navbar 1360px rule is deliberately NOT
// part of this token: it is a nav-density breakpoint, not device identity.
//
// Emile's rule lives here too: below 1024px the support FAB and the sticky
// Book button are green; at 1024px and above they are dark.
export const MOBILE_BREAKPOINT_PX = 1024;

export function isMobileWidth(width, breakpoint = MOBILE_BREAKPOINT_PX) {
  return Number(width) < breakpoint;
}
