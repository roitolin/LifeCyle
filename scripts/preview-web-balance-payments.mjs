// Local-only browser QA. The actual components, services, upload conversion,
// and styles run against this in-memory Supabase stub. No real payments/data.
import { createServer } from '../LIFECYCLE_WEB/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../LIFECYCLE_WEB', import.meta.url))
const mockId = '\0balance-preview-client'
const entryId = '\0balance-preview-entry'
const fixture = `
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'empty';
const customer = '11111111-1111-4111-8111-111111111111';
const shop = '22222222-2222-4222-8222-222222222222';
export const request = { id: '33333333-3333-4333-8333-333333333333', shopId: shop,
  requesterId: scenario === 'self' ? shop : customer, paymentOption: scenario === 'full' ? 'full' : 'downpayment',
  remainingBalance: 13000, status: scenario === 'unpaid' ? 'awaiting_payment' : 'payment_verified',
  paymentVerifiedAt: scenario === 'unpaid' ? null : '2026-10-31T10:00:00Z' };
const base = { id: 'payment-test', request_id: request.id, amount: 13000,
  method: scenario === 'wallet-pending' ? 'wallet' : 'cash', status: scenario === 'paid' ? 'verified' : scenario === 'rejected' ? 'rejected' : 'submitted',
  receiver_channel: scenario === 'wallet-pending' ? 'PH_MAYA' : null,
  receiver_name: 'LifeCycle Test Shop', receiver_number: '09123456789',
  payer_name: 'Test Customer', reference_number: 'TEST123456',
  proof_image_path: request.id + '/' + customer + '/receipt.jpg',
  submitted_at: '2026-10-31T10:05:00Z', reviewed_at: scenario === 'paid' ? '2026-10-31T10:10:00Z' : null,
  rejection_reason: scenario === 'rejected' ? 'The receipt does not match the transfer.' : null };
const accounts = scenario === 'no-accounts' ? [] : [
  { id: 'maya', shopId: shop, channelCode: 'PH_MAYA', accountName: 'LifeCycle Test Shop', accountNumber: '09123456789', active: true, verifiedByAdmin: true },
  { id: 'metrobank', shopId: shop, channelCode: 'PH_METROBANK', accountName: 'LifeCycle Test Shop', accountNumber: '123456789012', active: true, verifiedByAdmin: true }
];
export const state = { calls: [], payments: ['cash-pending','wallet-pending','paid','rejected'].includes(scenario) ? [base] : [] };
globalThis.__balanceFixture = state;
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: customer } }, error: null }) },
  from(table) {
    if (!['funeral_balance_payments','funeral_shop_payout_accounts'].includes(table)) throw Error('Unexpected table: ' + table);
    let op = 'read', payload, filters = [];
    const execute = () => {
      state.calls.push({ table, op, payload });
      let rows = table === 'funeral_balance_payments' ? state.payments : accounts;
      if (op === 'insert') {
        if (state.payments.some(p => p.status !== 'rejected')) return { error: { code: '23505' } };
        const saved = { ...base, ...payload, id: 'submitted-' + Date.now(), amount: 13000, status: 'submitted', reviewed_at: null };
        state.payments = [saved, ...state.payments]; return { data: saved, error: null };
      }
      if (op === 'update') {
        const payment = state.payments.find(row => filters.every(([k,v]) => row[k] === v));
        if (!payment) return { error: { message: 'Payment already reviewed.' } };
        Object.assign(payment, payload, { reviewed_at: new Date().toISOString() }); return { data: { ...payment }, error: null };
      }
      rows = rows.filter(row => filters.every(([k,v]) => row[k] === v));
      return { data: rows, error: null };
    };
    const query = {
      select() { return query; }, eq(key,value) { filters.push([key,value]); return query; }, order() { return query; },
      insert(value) { op = 'insert'; payload = value; return query; }, update(value) { op = 'update'; payload = value; return query; },
      single() { return Promise.resolve(execute()); }, then(ok,fail) { return Promise.resolve(execute()).then(ok,fail); }
    }; return query;
  },
  storage: { from(bucket) { if (bucket !== 'funeral-balance-receipts') throw Error('Unexpected bucket'); return {
    upload: async (path, blob, options) => { state.calls.push({ op: 'upload', bucket, path, mime: blob.type, size: blob.size, options }); return { data: { path }, error: null }; },
    createSignedUrl: async (path, ttl) => { state.calls.push({ op: 'sign', path, ttl }); return { data: { signedUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="white"/><text x="30" y="60" font-size="24">Private test receipt</text><text x="30" y="110" font-size="20">PHP 13,000</text></svg>') }, error: null }; }
  }; } }
};`

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import RemainingBalancePaymentCard from '/src/components/RemainingBalancePaymentCard.tsx';
import { request } from 'virtual:balance-preview-client';
import '/src/index.css';
const params = new URLSearchParams(location.search);
const role = params.get('role') === 'shop' ? 'shop' : 'customer';
const width = params.get('width') || '1040';
createRoot(document.getElementById('root')).render(React.createElement('main', { style: {maxWidth: width + 'px', margin: '24px auto', padding: '0 12px'} },
  React.createElement('h1', {style:{fontSize:'20px'}}, 'Balance payment · ' + role),
  React.createElement('p', {style:{fontSize:'12px',color:'#687c72'}}, 'Local test fixture. No real payments, uploads, or database changes.'),
  React.createElement(RemainingBalancePaymentCard, {request,role})));`

const server = await createServer({
  root,
  configFile: root + '/vite.config.ts',
  resolve: { alias: [{ find: '@/lib/supabase', replacement: mockId }] },
  plugins: [{
    name: 'local-balance-payment-preview',
    resolveId(id) {
      if (id === mockId || id === 'virtual:balance-preview-client') return mockId
      if (id === 'virtual:balance-preview-entry') return entryId
    },
    load(id) { if (id === mockId) return fixture; if (id === entryId) return entry },
    configureServer(vite) {
      vite.middlewares.use('/__balance_preview', async (req, res, next) => {
        try {
          const html = await vite.transformIndexHtml(req.url || '/', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balance payment QA</title></head><body style="margin:0;background:#f4f7f5;font-family:Manrope,system-ui,sans-serif"><div id="root"></div><script type="module" src="/@id/virtual:balance-preview-entry"></script></body></html>')
          res.setHeader('Content-Type', 'text/html'); res.end(html)
        } catch (error) { next(error) }
      })
    },
  }],
  server: { host: '127.0.0.1', port: 6055, strictPort: true },
})
await server.listen()
// eslint-disable-next-line no-console
console.log('Mock-only payment preview: http://127.0.0.1:6055/__balance_preview')
process.on('SIGINT', async () => { await server.close(); process.exit(0) })
