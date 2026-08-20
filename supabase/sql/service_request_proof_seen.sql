-- LifeCycle - COMPLETION PROOF "SEEN" RECEIPT
-- Run this once in the Supabase SQL editor.
--
-- Adds completionProofSeenAt so the shop can see whether the family
-- already viewed the completion proof (read receipt). The requester's app
-- sets this when they open the request while it is awaiting their
-- confirmation; the shop displays "Seen by the family" vs "Delivered".

alter table public.funeral_service_requests
  add column if not exists "completionProofSeenAt" timestamptz;

comment on column public.funeral_service_requests."completionProofSeenAt" is
  'When the requester first viewed the shop''s completion proof (status = awaiting_customer_confirmation). Null until the family has seen it.';

notify pgrst, 'reload schema';
