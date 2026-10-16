/**
 * restaurant-ordering - Order food as a customer.
 * Sources: client/src/pages/food/FoodHomePage.jsx,
 * client/src/pages/food/FoodRestaurantPage.jsx,
 * client/src/pages/OrderDetailsPage.jsx, client/src/pages/OrderHistoryPage.jsx
 * Routes: /food, /restaurants, /food/restaurants/:restaurantId,
 * /restaurants/r/:restaurantId, /food/orders/:orderId, /orders
 */

const guide = {
  id: 'restaurant-ordering',
  area: 'restaurants',
  slug: 'restaurant-ordering',
  title: 'Order food as a customer',
  audiences: ['customer'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Find a restaurant, build an order, pay with the right method, and track the order to pickup or delivery.',
  intendedRoles: ['Customer'],
  prerequisites: [
    { text: 'Browsing is open to everyone. Sign in to your OxSteed account before checkout so the order can be tracked and recovered.', href: '/login' },
  ],
  processMap: {
    nodes: [
      { id: 'browse', label: 'Browse the food directory', type: 'terminal' },
      { id: 'open', label: 'Open a restaurant', type: 'step' },
      { id: 'order', label: 'Start order and add items', type: 'step' },
      { id: 'cart', label: 'Review the cart and check out', type: 'step' },
      { id: 'signin', label: 'Sign in if needed', type: 'decision' },
      { id: 'payment', label: 'Choose a payment method', type: 'step' },
      { id: 'place', label: 'Place the order', type: 'step' },
      { id: 'track', label: 'Track and receive the order', type: 'terminal' },
    ],
    edges: [
      { from: 'browse', to: 'open' },
      { from: 'open', to: 'order' },
      { from: 'order', to: 'cart' },
      { from: 'cart', to: 'signin' },
      { from: 'signin', to: 'payment', label: 'Signed in' },
      { from: 'signin', to: 'cart', label: 'Not signed in' },
      { from: 'payment', to: 'place' },
      { from: 'place', to: 'track' },
    ],
  },
  processMapText:
    'Browse the food directory at /food and open a restaurant. Choose "Start order" and add items from the menu. Open the cart and continue to checkout, signing in when prompted. Fill in pickup or delivery details, choose a payment method, and place the order. Track the order from the confirmation screen or your order history.',
  steps: [
    {
      id: 'restaurant-ordering-s1',
      title: 'Browse the food directory',
      body: 'Open /food ("Local Food Directory"). Use the search field ("Search restaurants or cuisines") and "Search", or "Near me" for nearby spots. Restaurants show "Open now" or "Closed", prep time ranges, and delivery terms.',
      expectedResult: 'A list of restaurants near you, or results for your search.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food',
          state: 'Food directory with restaurant results, light mode',
          alt: 'Food directory with restaurant listings',
          caption: 'Browsing the food directory, desktop view.',
          annotations: [
            { n: 1, label: 'Search field', locator: 'main input[type=search]' },
            { n: 2, label: 'Near me button', locator: 'main button' },
            { n: 3, label: 'Restaurant cards', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food',
          state: 'Food directory with restaurant results, light mode',
          alt: 'Food directory on a phone screen',
          caption: 'Browsing the food directory, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-ordering-s2',
      title: 'Open a restaurant and explore the menu',
      body: 'Open a restaurant. Tabs at the top offer "Menu", "Info", "Reviews", "Deals", and "Media". Use the menu search ("Search ...") and filters ("All", "Vegetarian", "Vegan", "Spicy"). "Sold out" items cannot be added.',
      expectedResult: 'You can see the full menu with prices and availability.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/restaurants/:restaurantId',
          state: 'Restaurant page menu tab, light mode',
          alt: 'Restaurant page with menu items',
          caption: 'A restaurant menu, desktop view.',
          annotations: [
            { n: 1, label: 'Menu tabs', locator: 'main nav' },
            { n: 2, label: 'Menu items', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/restaurants/:restaurantId',
          state: 'Restaurant page menu tab, light mode',
          alt: 'Restaurant menu on a phone screen',
          caption: 'A restaurant menu, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-ordering-s3',
      title: 'Start the order and add items',
      body: 'Choose "Start order". On each item, choose the add control ("Add 1 · $X") and pick any required options first. "Your order" shows the running total ("Order · 2 item(s)").',
      expectedResult: 'The order tray shows your items and the running total.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/restaurants/:restaurantId',
          state: 'Restaurant page with items in the order tray, light mode',
          alt: 'Order tray with added items',
          caption: 'Adding items to the order, desktop view.',
          annotations: [
            { n: 1, label: 'Add item control', locator: 'main button' },
            { n: 2, label: 'Your order tray', locator: 'main aside' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/restaurants/:restaurantId',
          state: 'Restaurant page with items in the order tray, light mode',
          alt: 'Order tray on a phone screen',
          caption: 'Adding items to the order, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-ordering-s4',
      title: 'Review the cart and continue to checkout',
      body: 'Choose "View cart", then "Checkout". If you are not signed in, you see "Sign in to continue checkout": choose "Sign in to continue". Then enter the "Pickup details" or "Delivery details" (name, phone, address, and "Pickup time" or "Delivery time") and choose "Continue to payment".',
      expectedResult: 'You reach the "Payment method" step with the order summary ("Order summary", "Subtotal", "Tax", "Tip", "Total").',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/restaurants/:restaurantId',
          state: 'Cart with items and checkout button, light mode',
          alt: 'Cart view with items and totals',
          caption: 'Reviewing the cart, desktop view.',
          annotations: [
            { n: 1, label: 'Cart items', locator: 'main section' },
            { n: 2, label: 'Checkout button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/restaurants/:restaurantId',
          state: 'Cart with items and checkout button, light mode',
          alt: 'Cart on a phone screen',
          caption: 'Reviewing the cart, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-ordering-s5',
      title: 'Choose a payment method',
      body: 'On "Payment method", pick one: "Restaurant credit" (spends your balance held at this restaurant, shown as "{{amount}} available"; this is per-restaurant credit, not OxSteed Credit), "Pay by card" ("Pay online with your card"), "Pay at the restaurant" ("Card or cash, settled with the restaurant"), "Pay on delivery", or "Pay with restaurant payment app" ("Use the restaurant\'s payment instructions and upload proof"). Guests may also see "Guest Credit" ("Pay with OxSteed Credit as a guest (up to $25/order)"), which uses OxSteed Credit, not restaurant credit. For direct payment, "Upload receipt" or "Enter confirmation" before placing the order.',
      expectedResult: 'The payment method is selected and any required proof is attached.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/restaurants/:restaurantId',
          state: 'Payment method selection, light mode',
          alt: 'Payment method options including restaurant credit and card',
          caption: 'Choosing a payment method, desktop view.',
          annotations: [
            { n: 1, label: 'Restaurant credit option', locator: 'main section' },
            { n: 2, label: 'Pay by card option', locator: 'main section' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/restaurants/:restaurantId',
          state: 'Payment method selection, light mode',
          alt: 'Payment methods on a phone screen',
          caption: 'Choosing a payment method, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-ordering-s6',
      title: 'Place the order',
      body: 'Review the "Order summary" (items, "Subtotal", "Tax", "Tip", "Total"). Add a "Promo code" ("e.g. SUMMER10") or "Notes for the kitchen" ("Allergies, extra sauce, no onions") if wanted, then choose "Place order · {{total}}". Restaurant credit shows the note "Your restaurant credit is charged when the order is placed."',
      expectedResult: 'You see "Order placed!" and "Your order number is #X."',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/restaurants/:restaurantId',
          state: 'Order summary with Place order button, light mode',
          alt: 'Order summary before placing',
          caption: 'Placing the order, desktop view.',
          annotations: [
            { n: 1, label: 'Order summary', locator: 'main section' },
            { n: 2, label: 'Place order button', locator: 'main button' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/restaurants/:restaurantId',
          state: 'Order summary with Place order button, light mode',
          alt: 'Order summary on a phone screen',
          caption: 'Placing the order, mobile view.',
          annotations: [],
        },
      ],
    },
    {
      id: 'restaurant-ordering-s7',
      title: 'Track the order',
      body: 'From the confirmation screen, use "Live status" and the "Estimated time", or open the order from /orders later. Food orders also open /food/track/:token ("Track Order") with "Order", "Status", "Ready around", "Payment", "Items", "Total", and "Print Receipt". From the order detail page you can also use "Track order live".',
      expectedResult: 'You can follow the order status from placed through ready to completed.',
      screenshots: [
        {
          viewport: 'desktop',
          screen: '/food/track/:token',
          state: 'Order placed confirmation with live status, light mode',
          alt: 'Order confirmation with tracking',
          caption: 'Tracking the order, desktop view.',
          annotations: [
            { n: 1, label: 'Order placed confirmation', locator: 'main section' },
            { n: 2, label: 'Live status', locator: 'main' },
          ],
        },
        {
          viewport: 'mobile',
          screen: '/food/track/:token',
          state: 'Order placed confirmation with live status, light mode',
          alt: 'Order confirmation on a phone screen',
          caption: 'Tracking the order, mobile view.',
          annotations: [],
        },
      ],
    },
  ],
  confirmOutcome: 'The order shows "Order placed!" with an order number, and it appears in your order history at /orders with the right status.',
  recovery: [
    {
      problem: 'You see "Sign in to continue checkout" and cannot pay.',
      solution: 'Choose "Sign in to continue". Browsing is open to everyone, but checkout needs an OxSteed account so the order can be tracked and recovered.',
    },
    {
      problem: 'You see "Insufficient balance" on the Restaurant credit option.',
      solution: 'That is your per-restaurant balance, separate from OxSteed Credit. Add restaurant credit at /restaurant-credit, or choose another payment method.',
    },
    {
      problem: 'The restaurant requires a minimum order.',
      solution: 'Add more items until you meet "This restaurant requires a minimum order of X."',
    },
    {
      problem: 'Placing the order fails.',
      solution: 'You see "We couldn\'t place your order. Please try again." Check your connection and that the payment proof (if paying the restaurant directly) is attached, then retry.',
    },
  ],
  supportContact: 'For order help, use the in-app support page at /support.',
  relatedGuides: ['restaurant-cancellations', 'financial-restaurant-credit', 'financial-oxsteed-credit', 'restaurant-pickup-delivery-handoff'],
  siteLinks: [
    { label: 'Food directory', href: '/food' },
    { label: 'My orders', href: '/orders' },
    { label: 'Restaurant credit', href: '/restaurant-credit' },
  ],
  sources: [
    { type: 'route', ref: '/food' },
    { type: 'route', ref: '/food/restaurants/:restaurantId' },
    { type: 'route', ref: '/food/orders/:orderId' },
    { type: 'screen', ref: 'client/src/pages/food/FoodHomePage.jsx' },
    { type: 'screen', ref: 'client/src/pages/food/FoodRestaurantPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/OrderDetailsPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/OrderHistoryPage.jsx' },
  ],
};

export default guide;
