import { supabase } from '@/lib/supabase'

export type AdminSettlementAccount = {
  channel: 'bank' | 'ewallet'
  providerName: string
  accountHolder: string
  accountNumber: string
  updatedAt: string | null
}

export async function getAdminSettlementAccount(): Promise<AdminSettlementAccount | null> {
  const { data, error } = await supabase.from('admin_settlement_account')
    .select('channel, provider_name, account_holder, account_number, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    channel: data.channel,
    providerName: data.provider_name,
    accountHolder: data.account_holder,
    accountNumber: data.account_number,
    updatedAt: data.updated_at,
  }
}

export async function saveAdminSettlementAccount(account: Omit<AdminSettlementAccount, 'updatedAt'>): Promise<void> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw userError || new Error('Please sign in again.')
  const { error } = await supabase.from('admin_settlement_account').upsert({
    id: 1,
    channel: account.channel,
    provider_name: account.providerName.trim(),
    account_holder: account.accountHolder.trim(),
    account_number: account.accountNumber.trim(),
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }, { onConflict: 'id' })
  if (error) throw error
}
