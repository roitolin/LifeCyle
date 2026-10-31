import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/services/supabaseClient';
import { getSupabaseOAuthRedirectTo } from '@/services/supabaseAuthRedirect';
import { colors, radii, spacing } from '@/theme';

WebBrowser.maybeCompleteAuthSession();

type SocialProvider = 'google' | 'facebook';

type SocialAuthButtonsProps = {
  disabled?: boolean;
  onError: (title: string, message: string) => void;
};

const providerLabel: Record<SocialProvider, string> = {
  google: 'Google',
  facebook: 'Facebook',
};

function GoogleIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 18 18" accessibilityElementsHidden>
      <Path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.702-1.567 2.684-3.874 2.684-6.615Z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.909-2.259c-.806.54-1.836.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.333A9 9 0 0 0 9 18Z" />
      <Path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.167.281-1.706V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.333Z" />
      <Path fill="#EA4335" d="M9 3.58c1.322 0 2.508.454 3.442 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.333C4.672 5.165 6.656 3.58 9 3.58Z" />
    </Svg>
  );
}

function FacebookIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={11} fill="#1877F2" />
      <Path fill="#ffffff" d="M13.5 20v-7h2.35l.35-2.73h-2.7V8.53c0-.79.22-1.33 1.35-1.33h1.44V4.76c-.25-.03-1.1-.1-2.1-.1-2.08 0-3.51 1.27-3.51 3.61v2H8.32V13h2.36v7h2.82Z" />
    </Svg>
  );
}

async function ensureProviderIsEnabled(provider: SocialProvider) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Social sign-in configuration is missing from this app build.');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
  });
  if (!response.ok) {
    throw new Error('Unable to check social sign-in availability. Please try again.');
  }

  const settings = await response.json() as { external?: Partial<Record<SocialProvider, boolean>> };
  if (!settings.external?.[provider]) {
    throw new Error(`${providerLabel[provider]} sign-in is not available yet. Please use email and password for now.`);
  }
}

function getSocialAuthErrorMessage(error: unknown, provider: SocialProvider) {
  const message = error instanceof Error ? error.message : String(error || '');

  if (/provider.*not enabled|unsupported provider/i.test(message)) {
    return `${providerLabel[provider]} sign-in is not configured yet. Please contact LifeCycle support.`;
  }
  if (/network|fetch|connection|timeout/i.test(message)) {
    return 'Check your internet connection and try again.';
  }

  return message || `Unable to continue with ${providerLabel[provider]}. Please try again.`;
}

async function createSessionFromRedirect(url: string) {
  const parsed = new URL(url);
  const query = parsed.searchParams;
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const errorDescription = query.get('error_description') || hash.get('error_description');

  if (errorDescription) throw new Error(errorDescription);

  const code = query.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const accessToken = hash.get('access_token') || query.get('access_token');
  const refreshToken = hash.get('refresh_token') || query.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('The sign-in provider did not return a valid session.');
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
}

export default function SocialAuthButtons({ disabled = false, onError }: SocialAuthButtonsProps) {
  const [activeProvider, setActiveProvider] = useState<SocialProvider | null>(null);

  const signIn = async (provider: SocialProvider) => {
    setActiveProvider(provider);

    try {
      await ensureProviderIsEnabled(provider);
      const redirectTo = getSupabaseOAuthRedirectTo();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          scopes: provider === 'facebook' ? 'email,public_profile' : undefined,
          queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error('The sign-in provider did not return a login page.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        await createSessionFromRedirect(result.url);
      }
    } catch (error) {
      onError(
        `${providerLabel[provider]} sign-in failed`,
        getSocialAuthErrorMessage(error, provider),
      );
    } finally {
      setActiveProvider(null);
    }
  };

  const isBusy = activeProvider !== null;

  return (
    <View style={styles.container}>
      <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        disabled={disabled || isBusy}
        onPress={() => void signIn('google')}
        style={[styles.button, (disabled || isBusy) && styles.buttonDisabled]}
      >
        {activeProvider === 'google' ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <GoogleIcon />
        )}
        <Text style={styles.buttonText}>{activeProvider === 'google' ? 'Opening Google...' : 'Continue with Google'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Continue with Facebook"
        disabled={disabled || isBusy}
        onPress={() => void signIn('facebook')}
        style={[styles.button, (disabled || isBusy) && styles.buttonDisabled]}
      >
        {activeProvider === 'facebook' ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <FacebookIcon />
        )}
        <Text style={styles.buttonText}>{activeProvider === 'facebook' ? 'Opening Facebook...' : 'Continue with Facebook'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 9, marginTop: 18 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderWarm },
  dividerText: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  button: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  buttonDisabled: { opacity: 0.58 },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
});
