const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://axwwihzwvhkfvbglgopj.supabase.co';
const supabaseKey = 'sb_publishable_qAW3TZzdmjmxu-Z1wt08TQ_dw2X_yeF';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('funeral_service_requests')
    .select('id, requesterId, shopId, status, paymentProvider, providerCheckoutId, providerPaymentId, paymentVerifiedAt, paymentAmount, shopNetAmount, commissionAmount')
    .eq('id', 'f0777de0-6add-08b7-e281-e05581e5a600')
    .single();

  console.log('Current order data:', data, error);
}

check();
