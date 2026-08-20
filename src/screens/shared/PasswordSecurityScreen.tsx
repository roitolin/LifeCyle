import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card } from 'react-native-paper';
import { KeyboardAwareScrollView } from '@/components';
import { auth } from '@/services/supabaseAuth';
import { supabase } from '@/services/supabaseClient';
import { recordAccountActivity } from '@/utils/accountActivity';

export default function PasswordSecurityScreen() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visibleField, setVisibleField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const email = auth.currentUser?.email || '';

  const updatePassword = async () => {
    if (!currentPassword) {
      Alert.alert('Current password required', 'Enter your current password to continue.');
      return;
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      Alert.alert('Use a stronger password', 'Use at least 8 characters with a letter and a number.');
      return;
    }
    if (newPassword !== confirmation) {
      Alert.alert('Passwords do not match', 'Confirm the same new password in both fields.');
      return;
    }
    if (newPassword === currentPassword) {
      Alert.alert('Choose a new password', 'Your new password must be different from your current password.');
      return;
    }

    setSaving(true);
    try {
      const result = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (result.error) throw new Error('Your current password is incorrect.');
      if (result.data.user?.id !== auth.currentUser?.uid) throw new Error('We could not verify this account.');

      const update = await supabase.auth.updateUser({ password: newPassword });
      if (update.error) throw update.error;
      await recordAccountActivity('password_changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      Alert.alert('Password updated', 'Your account password has been changed.');
    } catch (error: any) {
      Alert.alert('Update failed', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
      >
        <View style={styles.hero}>
          <View style={styles.shield}>
            <Ionicons name='shield-checkmark-outline' size={28} color='#41514d' />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Protect your account</Text>
            <Text style={styles.heroText}>Use a unique password you do not use for other services.</Text>
          </View>
        </View>

        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionLabel}>PASSWORD & SECURITY</Text>
            <View style={styles.emailRow}>
              <Ionicons name='mail-outline' size={18} color='#62706b' />
              <View style={styles.emailCopy}>
                <Text style={styles.emailLabel}>Signed-in email</Text>
                <Text numberOfLines={1} style={styles.email}>{email || 'Unavailable'}</Text>
              </View>
              <Ionicons name='checkmark-circle' size={19} color='#2f6b4f' />
            </View>

            <PasswordField
              label='Current password'
              value={currentPassword}
              onChangeText={setCurrentPassword}
              visible={visibleField === 'current'}
              onToggle={() => setVisibleField(visibleField === 'current' ? null : 'current')}
            />
            <PasswordField
              label='New password'
              value={newPassword}
              onChangeText={setNewPassword}
              visible={visibleField === 'new'}
              onToggle={() => setVisibleField(visibleField === 'new' ? null : 'new')}
            />
            <Text style={styles.hint}>At least 8 characters with a letter and a number.</Text>
            <PasswordField
              label='Confirm new password'
              value={confirmation}
              onChangeText={setConfirmation}
              visible={visibleField === 'confirm'}
              onToggle={() => setVisibleField(visibleField === 'confirm' ? null : 'confirm')}
            />

            <Button
              mode='contained'
              buttonColor='#22312d'
              onPress={updatePassword}
              loading={saving}
              disabled={saving}
              style={styles.button}
              contentStyle={styles.buttonContent}
            >
              Update password
            </Button>
          </Card.Content>
        </Card>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function PasswordField({ label, value, onChangeText, visible, onToggle }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        <Ionicons name='lock-closed-outline' size={18} color='#7a8580' />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize='none'
          autoCorrect={false}
          placeholder={`Enter ${label.toLowerCase()}`}
          placeholderTextColor='#9aa29e'
          style={styles.input}
        />
        <TouchableOpacity accessibilityLabel={visible ? 'Hide password' : 'Show password'} onPress={onToggle} style={styles.eye}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color='#62706b' />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1ec' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18, paddingBottom: 120, gap: 14 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: 16,
    borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#d6e2d2',
  },
  shield: {
    width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  heroCopy: { flex: 1 },
  heroTitle: { color: '#22312d', fontSize: 18, fontWeight: '800' },
  heroText: { color: '#62706b', fontSize: 12, lineHeight: 18, marginTop: 3 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff' },
  sectionLabel: { color: '#62706b', fontSize: 11, fontWeight: '800', marginBottom: 12 },
  emailRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12,
    padding: 12, marginBottom: 16, backgroundColor: '#ebf1e8',
  },
  emailCopy: { flex: 1, minWidth: 0 },
  emailLabel: { color: '#41514d', fontSize: 11, fontWeight: '700' },
  email: { color: '#62706b', fontSize: 12, marginTop: 2 },
  fieldGroup: { marginBottom: 14 },
  label: { color: '#41514d', fontSize: 13, fontWeight: '700', marginBottom: 7 },
  field: {
    minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12,
    borderWidth: 1, borderColor: '#d9d6cd', paddingLeft: 13, backgroundColor: '#ffffff',
  },
  input: { flex: 1, color: '#22312d', fontSize: 14, paddingVertical: 12 },
  eye: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#7a8580', fontSize: 11, marginTop: -7, marginBottom: 14 },
  button: { borderRadius: 999, marginTop: 4 },
  buttonContent: { minHeight: 48 },
});
