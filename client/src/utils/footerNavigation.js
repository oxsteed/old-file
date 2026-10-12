import { LAUNCH_VISIBILITY } from './launchScope.js';
import { canUseQrGenerator } from './modeAccess.js';

const link = (to, labelKey) => ({ to, labelKey });

export function footerNavigation(user, { showSupportWorkspace = false, visibility = LAUNCH_VISIBILITY } = {}) {
  const explore = [link('/restaurants', 'nav.orderFood'), link('/direct', 'footer.direct'), link('/delivery', 'footer.delivery')];
  if (visibility.oxsteedMedia) explore.push(link('/media', 'footer.media'));
  if (visibility.productMarketplace) explore.push(link('/products', 'footer.products'));
  const company = [link('/how-it-works', 'footer.howOxsteedWorks'), link('/about', 'footer.about'),
    link('/careers', 'footer.careers'), link('/consulting-intake', 'footer.consultingIntake')];
  const help = [link('/support', 'footer.support'), link('/learn', 'nav.learnToDiy')];
  if (visibility.footerUtilityPills) help.push(link('/vortex', 'footer.teamAccess'));
  if (visibility.genericQrGenerator && canUseQrGenerator(user)) help.push(link('/qr-generator', 'footer.qrGenerator'));
  if (user && showSupportWorkspace) help.push(link('/support/agent', 'nav.supportWorkspace'));
  return [{ id: 'explore', labelKey: 'footer.explore', links: explore },
    { id: 'company', labelKey: 'footer.company', links: company },
    { id: 'help', labelKey: 'footer.help', links: help }];
}
