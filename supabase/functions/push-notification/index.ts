// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  pushSentAt?: string | null;
};

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: NotificationRecord | null;
  old_record: NotificationRecord | null;
};

type PushPreferences = {
  serviceRequests?: boolean;
  payments?: boolean;
  messages?: boolean;
  announcements?: boolean;
  sound?: boolean;
};

type PushTokenRow = {
  expo_push_token: string;
  preferences: PushPreferences | null;
};

type ExpoPushTicket = {
  status?: 'ok' | 'error';
  details?: { error?: string };
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_EXPO_BATCH_SIZE = 100;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function preferenceCategory(type: string) {
  const normalized = type.trim().toLowerCase();
  if (normalized.includes('payment') || normalized.includes('refund')) return 'payments';
  if (
    normalized === 'support_message' ||
    normalized === 'message' ||
    normalized.startsWith('message_') ||
    normalized.startsWith('chat_')
  ) {
    return 'messages';
  }
  if (
    normalized === 'announcement_new' ||
    normalized === 'funeral_new_product'
  ) {
    return 'announcements';
  }
  if (
    normalized.startsWith('request_') ||
    normalized.startsWith('funeral_request_')
  ) {
    return 'serviceRequests';
  }
  return null;
}

function preferenceEnabled(
  type: string,
  preferences: PushPreferences | null
) {
  const category = preferenceCategory(type);
  return category === null || preferences?.[category] !== false;
}

function chunks<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration is incomplete.' }, 500);
  }

  const webhookSecret =
    request.headers.get('x-lifecycle-webhook-secret')?.trim() ?? '';
  if (!/^[0-9a-f]{64}$/.test(webhookSecret)) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: secretMatches, error: secretError } = await admin.rpc(
    'verify_push_notification_webhook_secret',
    { p_secret: webhookSecret }
  );
  if (secretError || secretMatches !== true) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400);
  }

  const notification = payload.record;
  if (
    payload.type !== 'INSERT' ||
    payload.schema !== 'public' ||
    payload.table !== 'notifications' ||
    !notification?.id ||
    !notification.userId
  ) {
    return jsonResponse({ ignored: true });
  }

  const { data: currentNotification, error: notificationError } = await admin
    .from('notifications')
    .select('pushSentAt')
    .eq('id', notification.id)
    .maybeSingle();
  if (notificationError) {
    return jsonResponse({ error: notificationError.message }, 500);
  }
  if (currentNotification?.pushSentAt) {
    return jsonResponse({ duplicate: true });
  }

  const { data: tokenRows, error: tokenError } = await admin
    .from('push_notification_tokens')
    .select('expo_push_token, preferences')
    .eq('user_id', notification.userId)
    .eq('enabled', true);
  if (tokenError) {
    return jsonResponse({ error: tokenError.message }, 500);
  }

  const eligibleTokens = ((tokenRows ?? []) as PushTokenRow[]).filter((row) =>
    preferenceEnabled(notification.type, row.preferences)
  );
  if (eligibleTokens.length === 0) {
    return jsonResponse({ sent: 0 });
  }

  const recordData =
    notification.data &&
    typeof notification.data === 'object' &&
    !Array.isArray(notification.data)
      ? notification.data
      : {};
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;

  let sent = 0;
  const invalidTokens: string[] = [];

  for (const batch of chunks(eligibleTokens, MAX_EXPO_BATCH_SIZE)) {
    const messages = batch.map((row) => {
      const soundEnabled = row.preferences?.sound !== false;
      return {
        to: row.expo_push_token,
        title: notification.title.slice(0, 150),
        body: notification.body.slice(0, 1000),
        priority: 'high',
        channelId: soundEnabled
          ? 'lifecycle-alerts'
          : 'lifecycle-silent',
        ...(soundEnabled ? { sound: 'default' } : {}),
        data: {
          ...recordData,
          notificationId: notification.id,
          userId: notification.userId,
          type: notification.type,
        },
      };
    });

    const expoResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });
    const responseBody = await expoResponse.json();
    if (!expoResponse.ok) {
      return jsonResponse(
        { error: 'Expo rejected the push request.', details: responseBody },
        502
      );
    }

    const tickets = (responseBody?.data ?? []) as ExpoPushTicket[];
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') sent += 1;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        const token = batch[index]?.expo_push_token;
        if (token) invalidTokens.push(token);
      }
    });
  }

  if (invalidTokens.length > 0) {
    await admin
      .from('push_notification_tokens')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in('expo_push_token', invalidTokens);
  }

  await admin
    .from('notifications')
    .update({ pushSentAt: new Date().toISOString() })
    .eq('id', notification.id);

  return jsonResponse({
    sent,
    disabledTokens: invalidTokens.length,
  });
});
