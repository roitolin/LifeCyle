-- Repair receiver rows left pending by the former admin UI, which only marked
-- the legacy funeral_shops payout fields as verified. Customer checkout reads
-- funeral_shop_payout_accounts, so only an exact matching legacy verification
-- is safe to carry forward.
begin;

update public.funeral_shop_payout_accounts account
set "verifiedByAdmin" = true,
    "verifiedAt" = coalesce(account."verifiedAt", shop."payoutVerifiedAt", now()),
    "updatedAt" = now()
from public.funeral_shops shop
where shop.id = account."shopId"
  and coalesce(shop."payoutVerifiedByAdmin", false)
  and account."channelCode" = shop."payoutChannelCode"
  and account."accountName" = shop."payoutAccountName"
  and account."accountNumber" = shop."payoutAccountNumber"
  and account."verifiedByAdmin" is distinct from true;

commit;
