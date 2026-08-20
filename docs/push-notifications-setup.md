# Push notification deployment

The mobile client registers an Expo push token for each signed-in physical
device. Expo's push service then routes notifications through FCM on Android
and APNs on iOS. A Supabase Database Webhook calls the push-notification
Edge Function whenever a row is inserted into public.notifications.

## 1. Create the token table, RPCs, and secure webhook

Apply the checked-in Supabase migrations. The webhook secret is generated
inside Postgres, encrypted with Supabase Vault, and never stored in this repo.

~~~powershell
npx supabase db push --linked --skip-vault
~~~

## 2. Deploy the Edge Function

From the project directory:

~~~powershell
npx supabase functions deploy push-notification --no-verify-jwt --use-api
~~~

Create an Expo access token, enable Enhanced Security for Push Notifications,
and save the token as a Supabase secret:

~~~powershell
npx supabase secrets set EXPO_ACCESS_TOKEN=your_expo_access_token
~~~

## 3. Database Webhook

Migration `20260818001000_push_notification_webhook.sql` creates an asynchronous
`pg_net` trigger on `public.notifications`. Requests carry only the dedicated
Vault-backed webhook secret. The function rejects all other requests even
though gateway JWT verification is disabled for this webhook receiver.

## 4. Configure Android FCM v1

1. Add Android package com.Roi.lifecycle to a Firebase project.
2. Download google-services.json into the Expo project root.
3. Add googleServicesFile: "./google-services.json" inside the android
   object in config/expo/app.config.js.
4. Generate a Firebase service-account key for FCM v1. Never commit this
   private key.
5. Run eas credentials, then upload the key under Android > production >
   Google Service Account > FCM V1.

## 5. Configure Apple APNs

Run eas credentials, select iOS, and create or upload the APNs push key for
bundle identifier com.Roi.lifecycle. Apple requires a paid Developer Program
account for device push credentials.

## 6. Rebuild and test

Push notifications do not work in Expo Go on SDK 53 and later. Create and
install a development or production build on a physical device:

~~~powershell
eas build --profile development --platform android
eas build --profile development --platform ios
~~~

Sign in, approve notification permission, and insert a test row into
public.notifications. Verify foreground, background, and fully closed app
delivery. Android users can independently change sound behavior for the
**LifeCycle updates** notification channel in system settings.

## Official references

- https://docs.expo.dev/push-notifications/push-notifications-setup/
- https://docs.expo.dev/push-notifications/fcm-credentials/
- https://supabase.com/docs/guides/functions/examples/push-notifications
