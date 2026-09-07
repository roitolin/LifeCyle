import { supabase } from '@/services/supabaseClient';

export type ShopScheduleEventType =
  | 'appointment'
  | 'delivery'
  | 'follow_up'
  | 'blocked'
  | 'other';

export type ShopScheduleEvent = {
  id: string;
  shop_id: string;
  title: string;
  event_type: ShopScheduleEventType;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  related_service_request_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ShopScheduleEventInput = {
  title: string;
  eventType: ShopScheduleEventType;
  eventDate: string;
  startTime: string;
  endTime?: string;
  location?: string;
  notes?: string;
};

const EVENT_COLUMNS =
  'id, shop_id, title, event_type, event_date, start_time, end_time, location, notes, related_service_request_id, created_at, updated_at';

export async function listShopScheduleEvents(
  shopId: string,
  fromDate: string,
  toDate: string
): Promise<ShopScheduleEvent[]> {
  const { data, error } = await supabase
    .from('shop_schedule_events')
    .select(EVENT_COLUMNS)
    .eq('shop_id', shopId)
    .gte('event_date', fromDate)
    .lte('event_date', toDate)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) throw error;
  return (data || []) as ShopScheduleEvent[];
}

export async function createShopScheduleEvent(
  shopId: string,
  input: ShopScheduleEventInput
): Promise<ShopScheduleEvent> {
  const { data, error } = await supabase
    .from('shop_schedule_events')
    .insert({
      shop_id: shopId,
      title: input.title.trim(),
      event_type: input.eventType,
      event_date: input.eventDate,
      start_time: input.startTime,
      end_time: input.endTime?.trim() || null,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select(EVENT_COLUMNS)
    .single();

  if (error) throw error;
  return data as ShopScheduleEvent;
}

export async function updateShopScheduleEvent(
  eventId: string,
  input: ShopScheduleEventInput
): Promise<ShopScheduleEvent> {
  const { data, error } = await supabase
    .from('shop_schedule_events')
    .update({
      title: input.title.trim(),
      event_type: input.eventType,
      event_date: input.eventDate,
      start_time: input.startTime,
      end_time: input.endTime?.trim() || null,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .eq('id', eventId)
    .select(EVENT_COLUMNS)
    .single();

  if (error) throw error;
  return data as ShopScheduleEvent;
}

export async function deleteShopScheduleEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('shop_schedule_events').delete().eq('id', eventId);
  if (error) throw error;
}
