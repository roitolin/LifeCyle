// In-memory component/service checks. No network, uploads, or payment provider calls.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function loadSource(file, imports) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (name) => {
    if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.mp3')) return { uri: name };
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, Date, Number, String, Boolean, Promise, Math, console }, { filename: file });
  return exports;
}

const request = {
  id: 'request-1',
  shopId: 'shop-1',
  shopName: 'Peace Funeral Home',
  productName: 'Classic Wood Casket',
  paymentOption: 'downpayment',
  remainingBalance: 13000,
  downpaymentAmountSnapshot: 5000,
  productFullPrice: 18000,
  status: 'payment_verified',
  paymentVerifiedAt: '2026-10-31',
};
let insertPayload;
let checkoutPayload;
const service = loadSource('src/services/remainingBalancePayments.ts', {
  './supabaseClient': {
    supabase: {
      functions: {
        invoke: async (name, { body }) => {
          assert.equal(name, 'create-balance-xendit-checkout');
          checkoutPayload = body;
          return { data: { requestId: body.requestId, checkoutUrl: 'https://checkout-staging.xendit.co/mock-session', testMode: true, livemode: false } };
        },
      },
      from: (table) => {
        assert.equal(table, 'funeral_balance_payments');
        return {
          insert: (payload) => {
            insertPayload = payload;
            return { select: () => ({ single: async () => ({ data: { id: 'payment-1', ...payload } }) }) };
          },
        };
      },
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: 'customer-1',
              user_metadata: { full_name: 'Customer Test' },
            },
          },
        }),
      },
    },
  },
  './supabaseStorage': {
    uploadDigitalBalanceReceipt: async () => 'funeral-balance-receipts/request-1/customer-1/receipt.jpg',
  },
});

assert.equal(service.canPayRemainingBalance(request), true);
for (const change of [
  { paymentOption: 'full' },
  { status: 'awaiting_payment' },
  { paymentVerifiedAt: null },
  { remainingBalance: 0 },
  { remainingBalance: -1 },
  { remainingBalance: 'bad' },
]) {
  assert.equal(service.canPayRemainingBalance({ ...request, ...change }), false);
}
assert.equal(service.balanceReceiverType({ channelCode: 'PH_MAYA' }), 'wallet');
assert.equal(service.balanceReceiverType({ channelCode: 'PH_METROBANK' }), 'bank');

function nodes(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== 'object') return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = (node) => nodes(node).filter((item) => typeof item === 'string' || typeof item === 'number').join(' ').replace(/\s+/g, ' ').trim();
const find = (tree, predicate) => {
  const match = nodes(tree).find((node) => node && typeof node === 'object' && predicate(node));
  assert.ok(match, 'Expected UI control was not found');
  return match;
};
async function panel({ isShop = false, payments = [], receivers = [] } = {}) {
  let cursor = 0;
  let focused = false;
  const state = [];
  const calls = [];
  const alerts = [];
  const hooks = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useCallback: (callback) => callback,
    useEffect: (cb) => { cb(); },
    useMemo: (cb) => cb(),
  };
  const Native = Object.fromEntries([
    'ActivityIndicator', 'Image', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View',
  ].map((name) => [name, name]));
  Native.StyleSheet = { create: (styles) => styles, absoluteFill: {} };
  Native.Platform = { OS: 'android' };
  Native.AppState = {
    currentState: 'active',
    addEventListener: () => ({ remove: () => undefined }),
  };
  Native.Alert = { alert: (...args) => alerts.push(args) };
  Native.Linking = { openURL: async (url) => calls.push({ type: 'openUrl', url }) };
  Native.Animated = {
    Value: function(v) { this.val = v; this.interpolate = () => ({}); this.setValue = (x) => { this.val = x; }; },
    timing: () => ({ start: (cb) => cb && cb({ finished: true }) }),
    spring: () => ({ start: (cb) => cb && cb({ finished: true }) }),
    parallel: (arr) => ({ start: (cb) => { arr.forEach((a) => a.start && a.start()); if (cb) cb({ finished: true }); } }),
    View: 'View',
  };
  Native.Easing = {
    bezier: () => ({}),
    out: () => ({}),
    inOut: () => ({}),
    ease: {},
  };

  const component = loadSource('src/components/RemainingBalancePaymentCard.tsx', {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': Native,
    '@expo/vector-icons': { Ionicons: 'Icon' },
    '@react-navigation/native': { useFocusEffect: (effect) => { if (!focused) { focused = true; effect(); } } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '@/utils/funeralCatalog': { formatPhilippinePeso: (value) => `PHP ${Number(value).toLocaleString('en-US')}` },
    '@/services/remainingBalancePayments': {
      ...service,
      getBalanceReceiptUrl: async () => 'https://example.test/private-signed-receipt?token=mock',
      loadBalancePayments: async () => ({ payments, receivers }),
      submitBalancePayment: async (input) => {
        calls.push({ type: 'cash', input });
        return { id: 'saved-cash', request_id: input.requestId, amount: 13000, method: input.method, status: 'submitted', submitted_at: '2026-10-31' };
      },
      submitOnlineBalancePayment: async (input) => {
        calls.push({ type: 'online', input });
        return { requestId: input.requestId, checkoutUrl: 'https://checkout-staging.xendit.co/mock-session', testMode: true, livemode: false };
      },
      syncOnlineBalancePayment: async (requestId) => {
        calls.push({ type: 'sync', requestId });
        return { requestId, paid: false, status: 'submitted', testMode: true, livemode: false };
      },
      reviewBalancePayment: async (id, status, reason) => {
        calls.push({ type: 'review', id, status, reason });
        return { ...payments[0], status, rejection_reason: reason, reviewed_at: '2026-10-31' };
      },
      approveShopCashBalancePayment: async (reqId) => {
        calls.push({ type: 'approveCash', reqId });
        return { id: 'saved-approved-cash', request_id: reqId, amount: 13000, method: 'cash', status: 'verified', reviewed_at: '2026-10-31' };
      },
    },
  });

  const render = () => {
    cursor = 0;
    const wrapper = component.default({ request, isShop });
    return wrapper?.type(wrapper.props);
  };
  render(); await tick();
  return {
    render, calls, alerts,
    confirm: async () => { alerts.at(-1)[2].find((button) => button.onPress)?.onPress(); await tick(); },
  };
}

(async () => {
  // Test 1: Direct backend service call verifies client does not set amount/status
  await service.submitBalancePayment({ requestId: 'request-1', method: 'cash', receiverAccountId: 'ignored' });
  assert.equal(insertPayload.receiver_account_id, null);
  assert.equal('amount' in insertPayload, false, 'Client must not set the amount');
  assert.equal('status' in insertPayload, false, 'Client must not mark its payment paid');
  await service.submitOnlineBalancePayment({ requestId: 'request-1' });
  assert.equal(checkoutPayload.paymentMethod, 'ANY', 'The customer chooses the channel in Xendit');
  assert.equal('receiver' in checkoutPayload, false, 'A payout receiver is not a customer payment method');

  // Test 2: Unpaid customer sees Cash and Pay Online buttons
  const customer = await panel();
  const customerTree = customer.render();
  const cashButton = find(customerTree, (n) => n.type === 'TouchableOpacity' && text(n).includes('Cash'));
  const payOnlineButton = find(customerTree, (n) => n.type === 'TouchableOpacity' && text(n).includes('Pay Online'));
  assert.ok(cashButton);
  assert.ok(payOnlineButton);

  // Cash flow: tap cash, confirm alert
  cashButton.props.onPress();
  assert.equal(customer.calls.length, 0, 'Cash choice must require explicit confirmation');
  await customer.confirm();
  assert.equal(customer.calls[0].type, 'cash');
  assert.equal(customer.calls[0].input.method, 'cash');

  // Test 3: Online payment flow with e-wallet account
  const mayaReceiver = { id: 'maya-1', channelCode: 'PH_MAYA', accountName: 'Peace Funeral Shop', accountNumber: '09123456789' };
  const onlineCustomer = await panel({ receivers: [mayaReceiver] });
  let onlineTree = onlineCustomer.render();

  // Tap Pay Online button to open sheet
  const openSheetBtn = find(onlineTree, (n) => n.type === 'TouchableOpacity' && text(n).includes('Pay Online'));
  openSheetBtn.props.onPress();
  await tick();

  onlineTree = onlineCustomer.render();
  // Find the single-tap Pay button in the sheet
  const oneTapPayBtn = find(onlineTree, (n) => n.type === 'TouchableOpacity' && text(n).includes('Pay PHP 13,000 online'));
  assert.ok(oneTapPayBtn, 'Should have one-tap Pay button for Maya');
  assert.equal(oneTapPayBtn.props.disabled, false);

  // Trigger one-click online payment
  await oneTapPayBtn.props.onPress();
  await tick();
  assert.equal(onlineCustomer.calls.length, 2);
  assert.equal(onlineCustomer.calls[0].type, 'online');
  assert.equal(onlineCustomer.calls[0].input.requestId, 'request-1');
  assert.equal('amount' in onlineCustomer.calls[0].input, false, 'The backend must use the authoritative remaining balance');
  assert.equal('receiver' in onlineCustomer.calls[0].input, false);
  assert.equal(onlineCustomer.calls[1].type, 'openUrl');

  // Test 4: Online payment with no receivers displays informative empty state
  const noReceiverCustomer = await panel({ receivers: [] });
  const openNoReceiverSheet = find(noReceiverCustomer.render(), (n) => n.type === 'TouchableOpacity' && text(n).includes('Pay Online'));
  openNoReceiverSheet.props.onPress();
  await tick();
  const noReceiverTree = noReceiverCustomer.render();
  assert.ok(text(noReceiverTree).includes('Online checkout is unavailable for this shop right now.'));
  const disabledSubmit = find(noReceiverTree, (n) => n.type === 'TouchableOpacity' && text(n).includes('Pay PHP 13,000 online'));
  assert.equal(disabledSubmit.props.disabled, true);

  // Test 5: Shop review flow for submitted payment
  const submitted = { id: 'payment-1', method: 'cash', status: 'submitted', amount: 13000, submitted_at: '2026-10-31' };
  const shop = await panel({ isShop: true, payments: [submitted] });
  const approveBtn = find(shop.render(), (n) => n.type === 'TouchableOpacity' && text(n).includes('Approve cash payment'));
  approveBtn.props.onPress();
  assert.equal(shop.calls.length, 0, 'Shop confirmation must require an explicit confirmation alert');
  await shop.confirm();
  assert.equal(shop.calls[0].type, 'review');
  assert.equal(shop.calls[0].status, 'verified');

  // Test 6: Direct shop cash approval for unpaid request
  const unpaidShop = await panel({ isShop: true, payments: [] });
  const directApproveBtn = find(unpaidShop.render(), (n) => n.type === 'TouchableOpacity' && text(n).includes('Approve cash payment'));
  directApproveBtn.props.onPress();
  await unpaidShop.confirm();
  assert.equal(unpaidShop.calls[0].type, 'approveCash');
  assert.equal(unpaidShop.calls[0].reqId, 'request-1');

  // Test 7: Existing provider checkout can be resumed after leaving or restarting the screen
  const activeOnline = {
    id: 'payment-online-1', request_id: 'request-1', method: 'bank', status: 'submitted',
    amount: 13000, submitted_at: '2026-10-31', provider_reference_id: '11111111-1111-4111-8111-111111111111',
    provider_checkout_url: 'https://checkout-staging.xendit.co/existing-session', provider_status: 'active',
  };
  const resumedCustomer = await panel({ payments: [activeOnline], receivers: [mayaReceiver] });
  await tick();
  const resumeButton = find(resumedCustomer.render(), (n) => n.type === 'TouchableOpacity' && text(n).includes('Continue secure checkout'));
  await resumeButton.props.onPress();
  assert.ok(resumedCustomer.calls.some((call) => call.type === 'sync'), 'Existing checkout should synchronize on focus');
  assert.ok(resumedCustomer.calls.some((call) => call.type === 'openUrl' && call.url === activeOnline.provider_checkout_url));

  // eslint-disable-next-line no-console
  console.log('PASS: eligibility, customer cash flow, online checkout, resume/sync recovery, empty receivers guard, and shop approvals.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
