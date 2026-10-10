import { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Button as PaperButton } from 'react-native-paper';
import { AppBackButton, KeyboardAwareScrollView } from '@/components';
import { useAppDialog } from '@/hooks/useAppDialog';
import { colors, radii, spacing } from '@/theme';
import { supabase } from '@/services/supabaseClient';

type ResetPasswordScreenProps = {
  recoveryUrl: string;
  onCancel: () => void;
  onComplete: () => void;
};

const getRecoveryToken = (recoveryUrl: string) => {
  try {
    const parsed = new URL(recoveryUrl);
    if (parsed.searchParams.get('type') !== 'recovery') return '';
    return parsed.searchParams.get('token_hash') || '';
  } catch {
    return '';
  }
};

export default function ResetPasswordScreen({ recoveryUrl, onCancel, onComplete }: ResetPasswordScreenProps) {
  const tokenHash = useMemo(() => getRecoveryToken(recoveryUrl), [recoveryUrl]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const { showDialog, dialog } = useAppDialog();

  const cancelRecovery = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    onCancel();
  };

  const resetPassword = async () => {
    if (!tokenHash && !recoveryVerified) {
      showDialog({
        title: 'Invalid Reset Link',
        message: 'Request a new password reset email and use only the newest link.',
        tone: 'danger',
      });
      return;
    }
    if (password.length < 8) {
      showDialog({ title: 'Password Too Short', message: 'Use at least 8 characters.', tone: 'warning' });
      return;
    }
    if (password !== confirmPassword) {
      showDialog({ title: 'Passwords Do Not Match', message: 'Enter the same password in both fields.', tone: 'warning' });
      return;
    }

    setLoading(true);
    try {
      if (!recoveryVerified) {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        });
        if (verifyError) throw verifyError;
        if (!data.session) throw new Error('Recovery session was not created.');
        setRecoveryVerified(true);
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      await supabase.auth.signOut({ scope: 'local' });
      showDialog({
        title: 'Password Updated',
        message: 'Your password has been reset. Log in with your new password.',
        tone: 'success',
        actions: [{ label: 'Back to Login', mode: 'contained', onPress: onComplete }],
      });
    } catch (error: any) {
      const code = String(error?.code || '');
      const message =
        code === 'otp_expired' || code === 'invalid_credentials'
          ? 'This reset link is invalid, expired, or already used. Request a new link and use only the newest email.'
          : code === 'same_password'
            ? 'Your new password must be different from your current password.'
            : code === 'weak_password'
              ? 'Choose a stronger password with at least 8 characters.'
              : 'Unable to reset your password right now. Please request a new link and try again.';
      showDialog({ title: 'Reset Failed', message, tone: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.page}>
      <NavigationBar hidden={false} style='dark' />
      <StatusBar hidden={false} style='dark' />
      <SafeAreaView edges={['top', 'bottom']} style={styles.page}>
        <KeyboardAwareScrollView
          style={styles.page}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps='handled'
        >
          <View style={styles.formShell}>
            <AppBackButton
              style={styles.backButton}
              onPress={() => void cancelRecovery()}
              accessibilityLabel='Cancel password reset'
            />

            <View style={styles.brandRow}>
              <Image source={require('../../../assets/Icon/IconTraparent.png')} style={styles.brandMark} resizeMode='contain' />
              <Text style={styles.brandName}>LifeCycle</Text>
            </View>

            <View style={styles.headingBlock}>
              <Text style={styles.title}>Create new password</Text>
              <Text style={styles.subtitle}>Choose a secure password for your LifeCycle account.</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>New password</Text>
              <View style={styles.passwordFieldWrap}>
                <TextInput
                  accessibilityLabel='New password'
                  placeholder='At least 8 characters'
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete='new-password'
                  textContentType='newPassword'
                  style={[styles.input, styles.passwordInput]}
                />
                <TouchableOpacity
                  accessibilityRole='button'
                  accessibilityLabel={showPassword ? 'Hide passwords' : 'Show passwords'}
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((current) => !current)}
                >
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Confirm new password</Text>
              <TextInput
                accessibilityLabel='Confirm new password'
                placeholder='Enter it again'
                placeholderTextColor={colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                autoComplete='new-password'
                textContentType='newPassword'
                returnKeyType='done'
                onSubmitEditing={() => void resetPassword()}
                style={styles.input}
              />
            </View>

            <PaperButton
              mode='contained'
              loading={loading}
              disabled={loading}
              onPress={() => void resetPassword()}
              style={styles.primaryButton}
              contentStyle={styles.primaryButtonContent}
              labelStyle={styles.primaryButtonLabel}
              buttonColor={colors.primaryDark}
            >
              {loading ? 'Updating...' : 'Reset Password'}
            </PaperButton>
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surfaceWarm },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  formShell: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  backButton: { alignSelf: 'flex-start', marginBottom: spacing.xl, backgroundColor: 'transparent', borderWidth: 0 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxl },
  brandMark: { width: 44, height: 44 },
  brandName: { color: colors.text, fontSize: 20, fontWeight: '800' },
  headingBlock: { marginBottom: spacing.xl },
  title: { color: colors.text, fontSize: 32, lineHeight: 40, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 24, marginTop: spacing.sm },
  fieldGroup: { marginBottom: spacing.lg },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  passwordFieldWrap: { position: 'relative' },
  passwordInput: { paddingRight: 52 },
  eyeButton: {
    position: 'absolute',
    right: 2,
    top: 2,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: { borderRadius: radii.md, marginTop: spacing.sm, elevation: 0 },
  primaryButtonContent: { minHeight: 52 },
  primaryButtonLabel: { fontWeight: '800', fontSize: 15, lineHeight: 20, includeFontPadding: false },
});
