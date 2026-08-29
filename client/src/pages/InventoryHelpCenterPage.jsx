import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  Bike,
  Boxes,
  CheckCircle2,
  ChefHat,
  ClipboardCheck,
  Cloud,
  CreditCard,
  KeyRound,
  LifeBuoy,
  MapPin,
  MonitorUp,
  PackageCheck,
  QrCode,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
  UsersRound,
  Utensils,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';

const APP_GUIDES = {
  restaurant: {
    name: 'OxSteed Restaurant',
    eyebrow: 'Customer ordering app',
    title: 'Browse, order, and manage food orders',
    description:
      'Learn how customers use the OxSteed Restaurant app to discover restaurants, browse menus, sign in at checkout, place orders, track status, save favorites, and request help.',
    supportApp: 'restaurant',
    coverage: ['Guest browsing', 'City and market discovery', 'Restaurant menus', 'Sign in at checkout', 'Cart and ordering', 'Order history', 'Favorites', 'Rewards and promos', 'Support cases'],
    setupSteps: [
      ['Choose a city or market', 'Markets come from active restaurants. If no active restaurants exist, the app should show no cities instead of hardcoded test markets.', MapPin],
      ['Browse as a guest', 'Guests can search restaurants, menus, dishes, and favorites without signing in. Sign in is required when placing an order.', Store],
      ['Sign in before checkout', 'Customers must use an OxSteed account before checkout so orders are tied to a real customer and unnecessary orders are reduced.', KeyRound],
      ['Confirm order details', 'Before placing an order, review restaurant, pickup or delivery option, notes, payment, and contact details.', Receipt],
    ],
    workflows: [
      ['Find restaurants', 'Use Home or Discover to search by restaurant, cuisine, dish, or market.', ['Select a city or use the available market list.', 'Search or browse active restaurants.', 'Open a restaurant to see menu, hours, and availability.', 'If no restaurants appear, the market has no active/orderable restaurants yet.'], ShoppingBag],
      ['Build a cart', 'Add menu items, modifiers, quantity, and notes before checkout.', ['Open a menu item.', 'Choose required options and modifiers.', 'Add customer notes only when useful for the kitchen.', 'Review the cart before continuing.'], ShoppingCart],
      ['Place an order', 'Customers sign in at checkout and submit the order to the restaurant.', ['Sign in when prompted.', 'Confirm pickup or delivery details.', 'Submit payment if required.', 'Track the order from Orders.'], CreditCard],
      ['Get help with an order', 'Support cases connect the customer, restaurant, and OxSteed escalation path.', ['Open Account -> Help & Support.', 'Choose the issue type.', 'Select the order or restaurant.', 'Describe what happened without sharing card numbers or passwords.'], LifeBuoy],
    ],
    roles: [
      ['Guest', 'Can browse restaurants and menus before signing in.'],
      ['Customer', 'Can place orders, save favorites, track orders, and create support cases.'],
      ['Restaurant', 'Receives orders and resolves restaurant-controlled issues first.'],
      ['OxSteed support', 'Handles payment, safety, fraud, account, and escalation-sensitive cases.'],
    ],
    troubleshooting: [
      'If no cities appear, no active restaurants are currently available.',
      'If a restaurant is missing, confirm the restaurant status is active and its city is set correctly.',
      'If checkout is blocked, sign in first and confirm the cart still has available items.',
      'If order status looks stale, refresh Orders and check network connection.',
      'If support is needed, attach the order when creating the case.',
    ],
  },
  manager: {
    name: 'OxSteed Manager',
    eyebrow: 'Restaurant operations',
    title: 'Run restaurant operations from one workspace',
    description:
      'Use OxSteed Manager for owner and manager workflows: live orders, menus, team access, Vortex codes, reports, support requests, and restaurant readiness.',
    supportApp: 'manager',
    coverage: ['Owner sign in', 'Manager workspace', 'Vortex team codes', 'Menus', 'Orders', 'Team', 'Reports', 'Support requests', 'Multi-location context'],
    setupSteps: [
      ['Sign in as owner or manager', 'The app should resolve your owned or assigned restaurant workspace after sign in.', UsersRound],
      ['Select the restaurant workspace', 'For multi-location teams, verify the correct restaurant before changing menus, team, or operations.', Store],
      ['Create Vortex join codes', 'Owners and managers create role-specific codes for employees who need access to restaurant apps.', KeyRound],
      ['Review live readiness', 'Check menu availability, open orders, staffing, inventory alerts, and support issues before service starts.', ClipboardCheck],
    ],
    workflows: [
      ['Manage orders', 'Track order volume, active tickets, delays, and handoff issues.', ['Open the orders or overview workspace.', 'Review active, delayed, and completed tickets.', 'Coordinate kitchen, POS, runner, and display workflows.', 'Escalate unusual issues through support.'], Receipt],
      ['Update menu availability', 'Keep customers from ordering unavailable items.', ['Open menu management.', 'Toggle unavailable items before service or when stock runs out.', 'Confirm POS, kitchen, and customer app availability is synced.', 'Re-enable items when stock is restored.'], Utensils],
      ['Manage team access', 'Use Vortex codes and memberships to control app access.', ['Create a code for the correct role.', 'Share it with the employee.', 'Review joined members.', 'Revoke or update roles when staff changes.'], UsersRound],
      ['Review reports', 'Use sales, order, team, and service reports to spot operational problems.', ['Open Reports.', 'Compare daily volume, delays, and completion.', 'Check affected menu items and staffing patterns.', 'Use findings to adjust service setup.'], MonitorUp],
    ],
    roles: [
      ['Owner', 'Can manage workspace, team access, menus, and business-level settings.'],
      ['Manager', 'Can operate daily service, manage menus, review team activity, and handle support workflows.'],
      ['Employee', 'Uses role-specific apps such as Crew, Kitchen, POS, Inventory, or Runner.'],
      ['OxSteed admin', 'Can assist with workspace, identity, support, and escalation issues.'],
    ],
    troubleshooting: [
      'If no workspace loads, verify the signed-in account owns or belongs to a restaurant business.',
      'If team members cannot join, create a fresh Vortex code for the correct role.',
      'If menu changes do not appear, check backend sync and refresh the customer app.',
      'If reports look empty, confirm real orders exist for the selected restaurant.',
      'If ownership is wrong, contact OxSteed support before creating duplicate businesses.',
    ],
  },
  pos: {
    name: 'OxSteed POS',
    eyebrow: 'Point of sale',
    title: 'Take orders, payments, and shifts at the counter',
    description:
      'Use OxSteed POS for counter orders, cart building, payments, held orders, discounts, staff switching, shift summaries, and cash drawer workflows.',
    supportApp: 'pos',
    coverage: ['Staff switch', 'Register setup', 'Cart building', 'Payments', 'Held orders', 'Discounts', 'Shift summary', 'Cash drawer', 'Sync status'],
    setupSteps: [
      ['Join the restaurant workspace', 'Use the correct Vortex code or owner/manager sign-in for the restaurant where this POS is used.', KeyRound],
      ['Choose register context', 'Confirm restaurant, station, staff member, language, and service mode before taking orders.', CreditCard],
      ['Connect payment and cash workflows', 'Verify payment provider, receipt flow, taxes, discounts, and cash drawer expectations.', Receipt],
      ['Check sync before service', 'Use Sync Status before opening if the POS has been offline or used during a network outage.', Cloud],
    ],
    workflows: [
      ['Create an order', 'Build a cart for dine-in, pickup, or counter service.', ['Select menu items.', 'Apply modifiers and notes.', 'Review taxes, discounts, and totals.', 'Send the order to kitchen or checkout.'], ShoppingCart],
      ['Take payment', 'Collect card, cash, or configured payment method.', ['Choose payment type.', 'Confirm amount due.', 'Complete payment.', 'Print, email, or show receipt if configured.'], CreditCard],
      ['Hold or recover orders', 'Use held orders when a customer pauses checkout or a cashier needs to return later.', ['Tap Held Orders.', 'Save the cart with enough context.', 'Recover the order when the customer returns.', 'Clear stale held orders at shift end.'], ClipboardCheck],
      ['End a shift', 'Use shift summaries and cash drawer checks to close service cleanly.', ['Open Shift Summary.', 'Review sales, payments, discounts, and cash activity.', 'Close drawer or record variance.', 'Report unusual discrepancies.'], Receipt],
    ],
    roles: [
      ['Owner', 'Configures POS access, payment rules, taxes, and reporting expectations.'],
      ['Manager', 'Supervises discounts, voids, shift summaries, and drawer exceptions.'],
      ['Cashier', 'Creates orders, takes payments, and manages held orders based on permissions.'],
      ['Kitchen', 'Receives POS tickets after orders are sent.'],
    ],
    troubleshooting: [
      'If menu items are missing, confirm menu availability and selected restaurant workspace.',
      'If payment fails, retry only after checking whether the first attempt completed.',
      'If kitchen does not see a ticket, check POS sync and kitchen device connection.',
      'If totals look wrong, verify taxes, modifiers, discounts, and order type.',
      'If cash drawer variance appears, record notes before closing shift.',
    ],
  },
  kitchen: {
    name: 'OxSteed Kitchen',
    eyebrow: 'Kitchen display system',
    title: 'Run prep, expo, and ticket handoff',
    description:
      'Use OxSteed Kitchen to manage incoming tickets, station prep, item availability, expo handoff, runner coordination, and service history.',
    supportApp: 'kitchen',
    coverage: ['Device mode', 'Ticket queue', 'Station prep', 'Expo board', 'Prep times', 'POS sync', 'Inventory hooks', 'Runner handoff', 'Audit history'],
    setupSteps: [
      ['Pair or sign in to the workspace', 'Kitchen devices must be tied to the correct restaurant and role before tickets appear.', KeyRound],
      ['Choose device mode', 'Set the device as main board, station, expo, or customer display depending on where it sits.', MonitorUp],
      ['Confirm ticket sources', 'Kitchen can receive orders from POS, customer app, kiosk, and manager workflows.', Receipt],
      ['Review prep and availability rules', 'Prep times and item availability affect customer promises and POS behavior.', ChefHat],
    ],
    workflows: [
      ['Manage the ticket queue', 'Move tickets through accepted, preparing, ready, and completed states.', ['Open the kitchen queue.', 'Prioritize by promised time and order type.', 'Update status as prep advances.', 'Keep expo and display screens aligned.'], ClipboardCheck],
      ['Run station prep', 'Station devices focus cooks on the items assigned to their station.', ['Choose station mode.', 'Review item-level prep tasks.', 'Mark items done when ready for expo.', 'Flag delays early.'], ChefHat],
      ['Use expo handoff', 'Expo coordinates final plating, bagging, and customer or runner handoff.', ['Open Expo Board.', 'Confirm all station items are complete.', 'Mark order ready.', 'Hand off to customer, counter, or runner.'], PackageCheck],
      ['Handle unavailable items', 'Use inventory hooks and manager coordination when an item cannot be prepared.', ['Flag item availability.', 'Tell manager or POS if orders are affected.', 'Prevent new sales for unavailable items.', 'Restore availability only when ready.'], AlertTriangle],
    ],
    roles: [
      ['Kitchen lead', 'Owns queue flow, readiness, and escalation during service.'],
      ['Station cook', 'Completes assigned item-level prep tasks.'],
      ['Expo', 'Confirms order completeness and handoff.'],
      ['Manager', 'Adjusts prep settings, item availability, reports, and staffing.'],
    ],
    troubleshooting: [
      'If tickets are missing, confirm POS/customer ordering is synced and the device is on the correct workspace.',
      'If a station sees the wrong items, check device mode and station assignment.',
      'If ready orders do not show on Display, check queue/display sync.',
      'If runner handoff is missing, confirm delivery mode and runner assignment.',
      'If a ticket status is wrong, use audit history to review what changed.',
    ],
  },
  display: {
    name: 'OxSteed Display',
    eyebrow: 'Guest display and kiosk',
    title: 'Show order status and support guest self-service',
    description:
      'Use OxSteed Display for customer-facing order status, queue boards, kiosk-style ordering, TV display mode, and device setup at the restaurant.',
    supportApp: 'display',
    coverage: ['Device pairing', 'Display mode', 'Queue board', 'Kiosk mode', 'Order status', 'Restaurant selection', 'TV placement', 'Refresh behavior', 'Guest visibility'],
    setupSteps: [
      ['Place the device', 'Use Display on an iPad at the entrance, counter, pickup area, or TV-connected display.', MonitorUp],
      ['Connect the restaurant workspace', 'Pair or sign in so Display knows which restaurant and order queue to show.', KeyRound],
      ['Choose display purpose', 'Select kiosk ordering, customer queue board, pickup display, or internal display mode.', QrCode],
      ['Test during service', 'Confirm new orders, ready orders, and completed orders move correctly before guests rely on it.', CheckCircle2],
    ],
    workflows: [
      ['Run a queue board', 'Show customers when their order is being prepared or ready.', ['Choose Queue Display.', 'Place the screen where guests can see it.', 'Confirm ready orders appear quickly.', 'Clear completed orders based on restaurant policy.'], MonitorUp],
      ['Use kiosk ordering', 'Let guests browse and start orders on a dedicated device.', ['Open Kiosk mode.', 'Confirm restaurant and menu availability.', 'Let guests build orders.', 'Require sign-in or staff checkout when needed by policy.'], ShoppingBag],
      ['Manage pickup visibility', 'Keep ready orders visible without exposing private customer data.', ['Show first name, initials, ticket number, or order code.', 'Avoid full addresses or sensitive notes.', 'Confirm handoff at pickup.', 'Remove completed orders promptly.'], Receipt],
      ['Recover from display issues', 'Refresh or re-pair when the screen stops updating.', ['Tap refresh or reload device.', 'Check network connection.', 'Confirm the restaurant workspace.', 'Restart display mode if needed.'], Cloud],
    ],
    roles: [
      ['Owner', 'Decides where guest display and kiosk devices are placed.'],
      ['Manager', 'Pairs devices, chooses mode, and monitors guest flow.'],
      ['Front counter', 'Uses display state to coordinate pickup and guest questions.'],
      ['Guest', 'Views order status or uses kiosk mode where enabled.'],
    ],
    troubleshooting: [
      'If no orders show, confirm the selected restaurant and display mode.',
      'If the TV is behind, refresh the display and check network stability.',
      'If the wrong restaurant appears, clear/re-pair the device.',
      'If kiosk ordering is unavailable, confirm the restaurant has an active menu.',
      'If customer information is too visible, adjust display settings before service.',
    ],
  },
  crew: {
    name: 'OxSteed Crew',
    eyebrow: 'Staff workspace',
    title: 'Coordinate restaurant staff work',
    description:
      'Use OxSteed Crew for team onboarding, shift readiness, tasks, checklists, training, issue reporting, and day-to-day restaurant coordination.',
    supportApp: 'crew',
    coverage: ['Vortex join code', 'Staff profile', 'Tasks', 'Checklists', 'Training', 'Shift readiness', 'Issue reporting', 'Manager handoff', 'Support'],
    setupSteps: [
      ['Join with a Vortex code', 'Crew members use a code from the owner, manager, or OxSteed admin to join the restaurant workspace.', KeyRound],
      ['Confirm your role', 'Your assigned role controls which tasks, training, and actions you can see.', UsersRound],
      ['Review today’s priorities', 'Start with tasks, checklists, shift notes, and manager instructions before service.', ClipboardCheck],
      ['Complete required training', 'Training mode helps new staff learn workflows before touching live operations.', CheckCircle2],
    ],
    workflows: [
      ['Complete checklists', 'Use checklists for opening, closing, cleaning, prep, and safety tasks.', ['Open the assigned checklist.', 'Complete each item honestly.', 'Add notes for blocked tasks.', 'Submit so managers can review readiness.'], ClipboardCheck],
      ['Work assigned tasks', 'Tasks keep staff aligned during service.', ['Open today’s task list.', 'Prioritize urgent or manager-assigned tasks.', 'Mark tasks complete when finished.', 'Escalate blocked items.'], CheckCircle2],
      ['Report an issue', 'Report problems before they affect guests or service.', ['Open issue reporting.', 'Choose the category.', 'Add detail and area.', 'Submit to manager or OxSteed support path.'], AlertTriangle],
      ['Use training mode', 'Practice app workflows without changing live restaurant data.', ['Open Learn or Training.', 'Choose a lesson.', 'Complete the scenario.', 'Ask a manager before moving to live tasks.'], UsersRound],
    ],
    roles: [
      ['Employee', 'Completes tasks, checklists, and training assigned by the restaurant.'],
      ['Shift lead', 'Coordinates staff during service and escalates issues.'],
      ['Manager', 'Creates tasks, reviews completion, and manages access.'],
      ['Owner', 'Controls workspace setup and staff policies.'],
    ],
    troubleshooting: [
      'If the Vortex code fails, ask the manager for a fresh role-specific code.',
      'If tasks are missing, confirm you joined the correct restaurant workspace.',
      'If training is unavailable, check your app version and assigned role.',
      'If you cannot complete a checklist, add a note and tell the shift lead.',
      'If account access is wrong, sign out and sign back in before contacting support.',
    ],
  },
  inventory: {
    name: 'OxSteed Inventory',
    eyebrow: 'Inventory operations',
    title: 'Setup and workflow guides',
    description:
      'Learn how restaurant teams use OxSteed Inventory to count stock, receive deliveries, report waste, request items, track supplier issues, scan items, and keep menu impact accurate.',
    supportApp: 'inventory',
    coverage: ['First-time setup', 'Vortex workspace access', 'Inventory areas', 'Stock counts', 'Receiving', 'Waste', 'Requests', 'Supplier issues', 'Sync troubleshooting'],
    setupSteps: [
      ['Sign in with your OxSteed account', 'Use the same OxSteed account connected to your restaurant business. Owners are recognized automatically after sign in; team members join with a Vortex workspace code.', UsersRound],
      ['Join or select the restaurant workspace', 'Inventory is scoped to a restaurant workspace. Team members enter a Vortex code; owners can load owned workspaces directly.', KeyRound],
      ['Choose the inventory area', 'Areas keep stock separated by Main inventory, Bar, Walk-in cooler, Prep line, Dry storage, or another location.', Boxes],
      ['Confirm sync health', 'The Home screen shows whether the app is synced. If pending events exist, use More -> Sync Status -> Sync Now before relying on counts.', Cloud],
    ],
    workflows: [
      ['Count item', 'Use counts when you physically check stock on hand.', ['Open Count item from Quick actions or Stock.', 'Select the correct area.', 'Enter current quantity and unit.', 'Save so stock risk and menu impact update after sync.'], ClipboardCheck],
      ['Receive', 'Use receiving when a supplier delivery arrives.', ['Open Receive and choose the item or request.', 'Enter quantity received, supplier, invoice note, and mismatch details.', 'Save so stock increases in the selected area.', 'Report missing or damaged items as supplier issues.'], PackageCheck],
      ['Report waste', 'Use waste when inventory is spoiled, damaged, expired, or used outside a sale.', ['Open Report waste and select the item.', 'Choose reason, quantity, and area.', 'Add a note if menu items are affected.', 'Save so OxSteed lowers available stock.'], Trash2],
      ['Request stock', 'Use requests when an item needs reorder approval or restocking.', ['Open Request and choose the item.', 'Enter quantity, urgency, area, and reason.', 'Managers review pending requests.', 'Approved requests become supplier orders or transfers.'], ShoppingCart],
      ['Supplier issue', 'Track delivery, price, quality, or availability problems.', ['Open Supplier issue and describe what happened.', 'Attach item, supplier, and delivery/request if available.', 'Move status from open to monitoring, in progress, or resolved.', 'Use history to spot repeat supplier problems.'], AlertTriangle],
      ['Scan item', 'Use scanning to find an item quickly.', ['Open Scan item and allow camera access.', 'Scan barcode or QR code.', 'If scanning fails, search manually.', 'Report barcode issues so setup can be corrected.'], QrCode],
    ],
    roles: [
      ['Owner', 'Can access owned restaurant workspaces, review inventory risk, and manage setup.'],
      ['Manager', 'Can monitor stock, approve requests, receive deliveries, and resolve supplier issues.'],
      ['Employee', 'Can count, receive, waste, request, and scan based on permissions.'],
      ['OxSteed admin', 'Can help troubleshoot account, workspace, sync, and support cases.'],
    ],
    troubleshooting: [
      'A synced state means saved inventory events have reached OxSteed.',
      'Pending events mean the app is holding local changes until connection is available.',
      'If items are missing, confirm the selected restaurant workspace and area first.',
      'If menu impact looks wrong, check whether the menu item is linked to inventory.',
      'If an internal server error continues, retry after a fresh sync and contact support.',
    ],
  },
  runner: {
    name: 'OxSteed Runner',
    eyebrow: 'Delivery runner app',
    title: 'Accept runs, navigate routes, and prove delivery',
    description:
      'Use OxSteed Runner for restaurant delivery workflows: joining a workspace, accepting runs, route guidance, pickup, drop-off proof, issue reporting, and manager coordination.',
    supportApp: 'runner',
    coverage: ['Runner sign in', 'Workspace join code', 'Run offers', 'Pickup', 'Navigation', 'Drop-off proof', 'Customer contact', 'Issue reporting', 'Location use'],
    setupSteps: [
      ['Sign in as a runner', 'Use the OxSteed account assigned to runner work. The app should operate you as a runner after sign in.', Bike],
      ['Join the restaurant workspace', 'Enter the Vortex code from the manager or owner if your account is not already linked.', KeyRound],
      ['Allow location access', 'Location supports route display, pickup timing, and proof timestamps while you are actively running orders.', MapPin],
      ['Review active workspace', 'Confirm you are delivering for the correct restaurant before accepting runs.', Store],
    ],
    workflows: [
      ['Accept a run', 'Run offers should be accepted only when you can complete them.', ['Open the run offer.', 'Review restaurant, distance, and timing.', 'Accept or decline within the allowed time.', 'Go to pickup after accepting.'], Bike],
      ['Pickup from restaurant', 'Confirm the order is ready and matches the run.', ['Arrive at the restaurant.', 'Check ticket/order details.', 'Confirm pickup in the app.', 'Report delays or missing items immediately.'], PackageCheck],
      ['Complete delivery', 'Use proof so the restaurant, customer, and support team can trust completion.', ['Navigate to the drop-off.', 'Follow customer instructions.', 'Capture photo, signature, PIN, or left-at-door proof.', 'Mark delivered only after handoff/proof is complete.'], CheckCircle2],
      ['Report issue', 'Use issue reporting for wrong address, missing customer, delay, damage, or safety concern.', ['Open Issues or Report Issue.', 'Choose the issue type.', 'Add details and proof if needed.', 'Wait for manager or support instructions.'], AlertTriangle],
    ],
    roles: [
      ['Runner', 'Accepts and completes delivery runs for assigned restaurants.'],
      ['Manager', 'Assigns or monitors runs and resolves restaurant-side delivery issues.'],
      ['Customer', 'Receives delivery updates and may provide handoff instructions.'],
      ['OxSteed support', 'Assists with safety, payment, fraud, and escalation-sensitive delivery cases.'],
    ],
    troubleshooting: [
      'If login fails, confirm the app is using OxSteed auth and the account exists.',
      'If the Vortex code says expired, ask the manager for a fresh runner code.',
      'If routes look wrong, refresh the route and confirm the address.',
      'If proof upload fails, keep local evidence and retry sync.',
      'If you need multi-restaurant access, confirm the current backend supports it before accepting runs for multiple businesses.',
    ],
  },
};

function getGuide(key) {
  return APP_GUIDES[key] || APP_GUIDES.inventory;
}

function IconCard({ item }) {
  const [title, body, Icon] = item;
  return (
    <article style={cardStyle}>
      <span style={iconShellStyle}><Icon size={24} /></span>
      <h3 style={cardTitleStyle}>{title}</h3>
      <p style={cardTextStyle}>{body}</p>
    </article>
  );
}

function WorkflowCard({ item }) {
  const [title, summary, steps, Icon] = item;
  return (
    <article style={workflowCardStyle}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span style={workflowIconStyle}><Icon size={24} /></span>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 22, letterSpacing: '-.04em' }}>{title}</h3>
          <p style={{ margin: 0, color: '#64748b', lineHeight: 1.55 }}>{summary}</p>
        </div>
      </div>
      <ol style={{ margin: '18px 0 0', paddingLeft: 20, color: '#334155', lineHeight: 1.7 }}>
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </article>
  );
}

export default function InventoryHelpCenterPage({ appKey }) {
  const { t } = useTranslation();
  const params = useParams();
  const resolvedKey = appKey || params.restaurantAppHelpSlug || 'inventory';
  const guide = getGuide(resolvedKey);

  return (
    <PageShell>
      <PageMeta
        title={t('inventoryHelpCenter.metaTitle', { defaultValue: `${guide.name} Help Center` })}
        description={t('inventoryHelpCenter.metaDescription', { defaultValue: `Setup guides and workflow instructions for ${guide.name}.` })}
        url={`https://oxsteed.com/help/${resolvedKey}`}
      />

      <div style={{
        background:
          'radial-gradient(circle at 12% 0%, rgba(249,115,22,.20), transparent 28rem), radial-gradient(circle at 88% 10%, rgba(15,23,42,.10), transparent 24rem), #f8fafc',
        overflowX: 'hidden',
        width: '100%',
        maxWidth: '100vw',
        boxSizing: 'border-box',
      }}>
        <section style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: 'clamp(42px, 8vw, 86px) clamp(18px, 4vw, 44px) 34px',
          width: '100%',
          boxSizing: 'border-box',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 28, alignItems: 'stretch', width: '100%', minWidth: 0 }}>
            <div style={{
              borderRadius: 34,
              background: '#0f172a',
              color: '#fff',
              padding: 'clamp(28px, 5vw, 56px)',
              boxShadow: '0 28px 80px rgba(15,23,42,.22)',
              position: 'relative',
              overflow: 'hidden',
              minWidth: 0,
              width: '100%',
              boxSizing: 'border-box',
            }}>
              <div style={{
                position: 'absolute',
                right: -80,
                top: -80,
                width: 240,
                height: 240,
                borderRadius: '50%',
                background: 'rgba(249,115,22,.22)',
              }} />
              <div style={{ position: 'relative' }}>
                <span style={eyebrowStyle}>{guide.eyebrow}</span>
                <h1 style={{
                  margin: '16px 0',
                  fontSize: 'clamp(42px, 8vw, 82px)',
	                  lineHeight: .92,
	                  letterSpacing: '-.08em',
	                  overflowWrap: 'anywhere',
	                }}>
                  {guide.title}
                </h1>
                <p style={{
                  margin: 0,
                  maxWidth: 780,
                  color: '#cbd5e1',
                  fontSize: 'clamp(17px, 2vw, 21px)',
	                  lineHeight: 1.65,
	                  overflowWrap: 'break-word',
	                }}>
                  {guide.description}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26 }}>
                  <a href="#setup" style={primaryCtaStyle}>{t('inventoryHelpCenter.startSetup', { defaultValue: 'Start setup' })} <ArrowRight size={18} /></a>
                  <a href="#workflows" style={secondaryCtaStyle}>{t('inventoryHelpCenter.viewWorkflows', { defaultValue: 'View workflows' })}</a>
                </div>
              </div>
            </div>

            <aside style={{
              borderRadius: 34,
              background: '#fff',
              padding: 26,
              boxShadow: '0 24px 70px rgba(15,23,42,.10)',
	              border: '1px solid #e2e8f0',
	              minWidth: 0,
	              width: '100%',
	              boxSizing: 'border-box',
	            }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 24, letterSpacing: '-.04em', color: '#0f172a' }}>{t('inventoryHelpCenter.whatThisGuideCovers', { defaultValue: 'What this guide covers' })}</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                {guide.coverage.map((item) => (
                  <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#334155' }}>
                    <CheckCircle2 size={18} color="#f97316" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section id="setup" style={sectionStyle}>
          <span style={sectionKickerStyle}>{t('inventoryHelpCenter.firstTimeSetup', { defaultValue: 'First-time setup' })}</span>
          <h2 style={sectionTitleStyle}>{t('inventoryHelpCenter.beforeAppGoesLive', { defaultValue: 'Before the app goes live' })}</h2>
          <p style={sectionIntroStyle}>
            Start with the correct OxSteed account, restaurant workspace, app role, and sync state.
            Most app issues come from being in the wrong workspace or using a role that does not match the task.
          </p>
          <div style={gridStyle}>
            {guide.setupSteps.map((item) => <IconCard key={item[0]} item={item} />)}
          </div>
        </section>

        <section id="workflows" style={sectionStyle}>
          <span style={sectionKickerStyle}>{t('inventoryHelpCenter.dailyWorkflows', { defaultValue: 'Daily workflows' })}</span>
          <h2 style={sectionTitleStyle}>{t('inventoryHelpCenter.howUsed', { defaultValue: 'How {{name}} should be used', name: guide.name })}</h2>
          <p style={sectionIntroStyle}>
            These flows match the job this app is meant to do inside the restaurant stack.
            Use the right action so orders, team activity, inventory, display state, and support history stay accurate.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 18 }}>
            {guide.workflows.map((item) => <WorkflowCard key={item[0]} item={item} />)}
          </div>
        </section>

        <section style={sectionStyle}>
          <span style={sectionKickerStyle}>{t('inventoryHelpCenter.rolesAndAccess', { defaultValue: 'Roles and access' })}</span>
          <h2 style={sectionTitleStyle}>{t('inventoryHelpCenter.whoShouldDoWhat', { defaultValue: 'Who should do what?' })}</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {guide.roles.map(([role, detail]) => (
              <div key={role} style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
                gap: 16,
                padding: 18,
                borderRadius: 20,
                background: '#fff',
                border: '1px solid #e2e8f0',
              }}>
                <strong style={{ color: '#0f172a' }}>{role}</strong>
                <span style={{ color: '#475569', lineHeight: 1.55 }}>{detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={sectionStyle}>
          <span style={sectionKickerStyle}>{t('inventoryHelpCenter.syncAndTroubleshooting', { defaultValue: 'Sync and troubleshooting' })}</span>
          <h2 style={sectionTitleStyle}>{t('inventoryHelpCenter.whenSomethingIsWrong', { defaultValue: 'When something does not look right' })}</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
            gap: 18,
            alignItems: 'stretch',
          }}>
            <div style={{
              borderRadius: 28,
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              padding: 24,
            }}>
              <LifeBuoy size={34} color="#f97316" />
              <h3 style={{ margin: '14px 0 8px', fontSize: 26, letterSpacing: '-.05em' }}>{t('inventoryHelpCenter.needHelp', { defaultValue: 'Need help?' })}</h3>
              <p style={{ margin: 0, color: '#9a3412', lineHeight: 1.6 }}>
                If the guide does not solve it, open a support request from the app or email support with
                your restaurant name, account email, app name, workspace, and what you expected to happen.
              </p>
              <a href={`/support/escalation?app=${guide.supportApp}`} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 18,
                color: '#fff',
                background: '#f97316',
                borderRadius: 999,
                padding: '12px 16px',
                fontWeight: 900,
                textDecoration: 'none',
              }}>
                {t('inventoryHelpCenter.contactSupport', { defaultValue: 'Contact support' })} <ArrowRight size={18} />
              </a>
            </div>
            <div style={{
              borderRadius: 28,
              background: '#fff',
              border: '1px solid #e2e8f0',
              padding: 24,
            }}>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 14 }}>
                {guide.troubleshooting.map((rule) => (
                  <li key={rule} style={{ display: 'flex', gap: 12, color: '#334155', lineHeight: 1.55 }}>
                    <CheckCircle2 size={20} color="#16a34a" style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

const eyebrowStyle = {
  display: 'inline-flex',
  borderRadius: 999,
  padding: '8px 12px',
  background: 'rgba(249,115,22,.16)',
  color: '#fed7aa',
  fontWeight: 900,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontSize: 12,
};

const sectionStyle = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '34px clamp(18px, 4vw, 44px)',
  width: '100%',
  maxInlineSize: '100vw',
  boxSizing: 'border-box',
  overflowX: 'hidden',
};

const sectionKickerStyle = {
  display: 'inline-flex',
  color: '#f97316',
  fontWeight: 900,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontSize: 12,
  marginBottom: 10,
};

const sectionTitleStyle = {
  margin: '0 0 10px',
  color: '#0f172a',
  fontSize: 'clamp(30px, 5vw, 54px)',
  lineHeight: 1,
  letterSpacing: '-.07em',
};

const sectionIntroStyle = {
  margin: '0 0 22px',
  maxWidth: 780,
  color: '#64748b',
  fontSize: 18,
  lineHeight: 1.65,
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
  gap: 16,
};

const cardStyle = {
  borderRadius: 26,
  background: '#fff',
  border: '1px solid #e2e8f0',
  padding: 22,
  boxShadow: '0 18px 48px rgba(15,23,42,.07)',
  minWidth: 0,
  boxSizing: 'border-box',
};

const iconShellStyle = {
  width: 52,
  height: 52,
  borderRadius: 18,
  display: 'grid',
  placeItems: 'center',
  background: '#fff7ed',
  color: '#f97316',
};

const cardTitleStyle = {
  margin: '16px 0 8px',
  color: '#0f172a',
  fontSize: 21,
  letterSpacing: '-.04em',
};

const cardTextStyle = {
  margin: 0,
  color: '#64748b',
  lineHeight: 1.6,
};

const workflowCardStyle = {
  borderRadius: 28,
  background: '#fff',
  border: '1px solid #e2e8f0',
  padding: 24,
  boxShadow: '0 20px 55px rgba(15,23,42,.08)',
  minWidth: 0,
  boxSizing: 'border-box',
};

const workflowIconStyle = {
  width: 52,
  height: 52,
  borderRadius: 18,
  display: 'grid',
  placeItems: 'center',
  background: '#0f172a',
  color: '#fb923c',
  flex: '0 0 auto',
};

const primaryCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: '#0f172a',
  background: '#fb923c',
  borderRadius: 999,
  padding: '13px 18px',
  fontWeight: 900,
  textDecoration: 'none',
};

const secondaryCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  color: '#fff',
  border: '1px solid rgba(255,255,255,.24)',
  borderRadius: 999,
  padding: '13px 18px',
  fontWeight: 900,
  textDecoration: 'none',
};
