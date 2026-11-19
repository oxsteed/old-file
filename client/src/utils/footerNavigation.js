import { LAUNCH_VISIBILITY } from './launchScope.js';
import { canUseQrGenerator } from './modeAccess.js';

const link = (to, labelKey) => ({ to, labelKey });

export function footerNavigation(user, { showSupportWorkspace = false, visibility = LAUNCH_VISIBILITY } = {}) {
  // The public footer is a customer-facing discovery surface. Professional,
  // team, and staff destinations stay out of it unless the account already
  // has the corresponding verified access. This keeps the footer consistent
  // with the adaptive authenticated navbar without creating a second policy
  // engine.
  const explore = [
    link('/helpers', 'nav.findHelp'),
    link('/restaurants', 'nav.orderFood'),
    link('/how-it-works', 'footer.howOxsteedWorks'),
  ];
  const services = [link('/direct', 'footer.direct'), link('/delivery', 'footer.delivery')];
  if (visibility.oxsteedMedia) services.push(link('/media', 'footer.media'));
  if (visibility.productMarketplace) services.push(link('/products', 'footer.products'));
  const company = [link('/about', 'footer.about'), link('/careers', 'footer.careers'), link('/support', 'footer.support')];
  const account = user
    ? [link('/dashboard', 'nav.dashboard'), link('/post-job', 'nav.postJob')]
    : [link('/login', 'nav.signIn'), link('/join', 'nav.postJob')];
  if (visibility.genericQrGenerator && canUseQrGenerator(user)) account.push(link('/qr-generator', 'footer.qrGenerator'));
  if (user && showSupportWorkspace) account.push(link('/support/agent', 'nav.supportWorkspace'));
  return [
    { id: 'explore', labelKey: 'footer.explore', links: explore },
    { id: 'services', labelKey: 'footer.services', links: services },
    { id: 'company', labelKey: 'footer.company', links: company },
    { id: 'account', labelKey: 'nav.account', links: account },
  ];
}
