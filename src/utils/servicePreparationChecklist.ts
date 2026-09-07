import { supabase } from '@/services/supabaseClient';

export type ServicePreparationChecklist = {
  details_confirmed: boolean;
  family_contacted: boolean;
  item_prepared: boolean;
  schedule_confirmed: boolean;
  delivery_scheduled: boolean;
};

export const EMPTY_SERVICE_PREPARATION_CHECKLIST: ServicePreparationChecklist = {
  details_confirmed: false,
  family_contacted: false,
  item_prepared: false,
  schedule_confirmed: false,
  delivery_scheduled: false,
};

const CHECKLIST_COLUMNS =
  'details_confirmed, family_contacted, item_prepared, schedule_confirmed, delivery_scheduled';

export async function getServicePreparationChecklist(
  serviceRequestId: string
): Promise<ServicePreparationChecklist> {
  const { data, error } = await supabase
    .from('service_request_shop_checklists')
    .select(CHECKLIST_COLUMNS)
    .eq('service_request_id', serviceRequestId)
    .maybeSingle();

  if (error) throw error;
  return data
    ? {
        details_confirmed: Boolean(data.details_confirmed),
        family_contacted: Boolean(data.family_contacted),
        item_prepared: Boolean(data.item_prepared),
        schedule_confirmed: Boolean(data.schedule_confirmed),
        delivery_scheduled: Boolean(data.delivery_scheduled),
      }
    : { ...EMPTY_SERVICE_PREPARATION_CHECKLIST };
}

export async function saveServicePreparationChecklist(
  serviceRequestId: string,
  shopId: string,
  checklist: ServicePreparationChecklist
): Promise<ServicePreparationChecklist> {
  const { data, error } = await supabase
    .from('service_request_shop_checklists')
    .upsert(
      {
        service_request_id: serviceRequestId,
        shop_id: shopId,
        ...checklist,
      },
      { onConflict: 'service_request_id' }
    )
    .select(CHECKLIST_COLUMNS)
    .single();

  if (error) throw error;
  return {
    details_confirmed: Boolean(data.details_confirmed),
    family_contacted: Boolean(data.family_contacted),
    item_prepared: Boolean(data.item_prepared),
    schedule_confirmed: Boolean(data.schedule_confirmed),
    delivery_scheduled: Boolean(data.delivery_scheduled),
  };
}
