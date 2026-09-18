select public.reconcile_xendit_service_event(
  'xendit:sync:ps-6aab51b2467a09491ec3dda2:py-05acddde-a439-4610-802d-a19de2725b0c',
  'payment_session.status_sync',
  'payment_completed',
  'ps-6aab51b2467a09491ec3dda2',
  'f0777de0-6add-08b7-e281-e05581e5a600',
  'py-05acddde-a439-4610-802d-a19de2725b0c',
  null,
  null,
  null,
  null,
  'PHP',
  45000.00,
  null,
  false,
  '{"sync": true, "channelCode": "GCASH"}'::jsonb,
  'gcash'
);

select id, status, "paymentProvider", "providerPaymentMethod", "providerStatus", "providerPaymentId", "providerCheckoutId", "paymentVerifiedAt", "commissionAmount", "shopNetAmount"
from public.funeral_service_requests
where id = 'f0777de0-6add-08b7-e281-e05581e5a600';
