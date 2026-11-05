import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { KeyboardAwareScrollView } from '@/components';
import { forgetRememberedAccount } from '@/services/deviceAccounts';
import { auth } from '@/services/supabaseAuth';
import { supabase } from '@/services/supabaseClient';

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const readFunctionError = async (error: any, fallback: string) => {
  try {
    const body = await error?.context?.json?.();
    if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  } catch {
    // Fall back to the client error below when the response body is unavailable.
  }
  return error?.message || fallback;
};

export default function PrivacyDataScreen() {
  const [exporting, setExporting] = useState(false);
  const [deletionModalVisible, setDeletionModalVisible] = useState(false);
  const [deletionConfirmation, setDeletionConfirmation] = useState('');
  const [deletionSaving, setDeletionSaving] = useState(false);

  const exportMyData = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert('Session required', 'Please sign in again before exporting your data.');
      return;
    }

    setExporting(true);
    try {
      const [
        profileResult,
        requestsResult,
        blocksResult,
        notificationsResult,
        deletionRequestsResult,
      ] = await Promise.all([
        supabase
          .from('users')
          .select('id,email,fullName,gender,dateOfBirth,photoURL,termsAccepted,termsAcceptedAt,createdAt,updatedAt')
          .eq('id', currentUser.uid)
          .maybeSingle(),
        supabase
          .from('funeral_service_requests')
          .select('*')
          .eq('requesterId', currentUser.uid)
          .order('createdAt', { ascending: false }),
        supabase
          .from('user_blocks')
          .select('blockedId,createdAt')
          .eq('blockerId', currentUser.uid)
          .order('createdAt', { ascending: false }),
        supabase
          .from('notifications')
          .select('id,type,title,body,read,createdAt')
          .eq('userId', currentUser.uid)
          .order('createdAt', { ascending: false }),
        supabase
          .from('account_deletion_requests')
          .select('*')
          .eq('user_id', currentUser.uid)
          .order('requested_at', { ascending: false }),
      ]);

      const firstError = profileResult.error
        || requestsResult.error
        || blocksResult.error
        || notificationsResult.error
        || deletionRequestsResult.error;
      if (firstError) throw firstError;

      const report = {
        exportedAt: new Date().toISOString(),
        account: profileResult.data || { id: currentUser.uid, email: currentUser.email },
        serviceRequests: requestsResult.data || [],
        blockedAccountIds: blocksResult.data || [],
        notifications: notificationsResult.data || [],
        deletionRequests: deletionRequestsResult.data || [],
      };
      const reportJson = escapeHtml(JSON.stringify(report, null, 2));
      const html = `
        <!doctype html>
        <html>
          <head>
            <meta charset='utf-8' />
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #22312d; padding: 28px; }
              h1 { margin: 0; font-size: 25px; }
              p { color: #62706b; line-height: 1.5; }
              pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f4f6f3; border: 1px solid #d9d6cd; border-radius: 12px; padding: 16px; font-size: 9px; line-height: 1.5; }
            </style>
          </head>
          <body>
            <h1>LifeCycle Account Data Export</h1>
            <p>This report contains data associated with ${escapeHtml(currentUser.email || currentUser.uid)}.</p>
            <pre>${reportJson}</pre>
          </body>
        </html>
      `;
      const file = await Print.printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Export created', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Export My LifeCycle Data',
        UTI: 'com.adobe.pdf',
      });
    } catch (error: any) {
      Alert.alert('Export failed', error?.message || 'Your account data could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  const requestDeletion = () => {
    setDeletionConfirmation('');
    setDeletionModalVisible(true);
  };

  const deleteAccount = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || deletionSaving) return;

    setDeletionSaving(true);
    try {
      const { data, error } = await supabase
        .functions
        .invoke('account-deletion', { body: { confirmation: 'DELETE' } });
      if (error) throw new Error(await readFunctionError(error, 'Unable to delete your account.'));
      if (!data?.deleted) throw new Error(data?.error || 'Unable to delete your account.');

      setDeletionModalVisible(false);
      await forgetRememberedAccount(currentUser.uid).catch(() => undefined);
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      Alert.alert('Account Deleted', 'Your account has been permanently deleted.');
    } catch (error: any) {
      Alert.alert('Account Not Deleted', error?.message || 'Unable to delete your account.');
    } finally {
      setDeletionSaving(false);
    }
  };

  const confirmDeletion = () => {
    if (deletionConfirmation.trim() !== 'DELETE') {
      Alert.alert('Confirmation Required', 'Type DELETE exactly to continue.');
      return;
    }

    Alert.alert(
      'Permanently delete your account?',
      'This cannot be undone. Your account and eligible account data will be permanently deleted without admin approval.',
      [
        { text: 'Keep My Account', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: () => void deleteAccount(),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name='finger-print-outline' size={29} color='#ffffff' />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Privacy & data</Text>
            <Text style={styles.heroText}>Understand, export, or permanently delete your account data.</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>YOUR DATA</Text>
        <View style={styles.infoCard}>
          <InfoRow icon='person-outline' title='Account information' description='Your profile, email, and acceptance records.' />
          <InfoRow icon='document-text-outline' title='Service information' description='Your service requests and related payment details.' />
          <InfoRow icon='notifications-outline' title='App activity' description='Your notifications and blocked-account list.' last />
        </View>

        <Text style={[styles.sectionLabel, styles.spacedLabel]}>DATA CONTROLS</Text>
        <View style={styles.actionCard}>
          <TouchableOpacity accessibilityRole='button' disabled={exporting} onPress={exportMyData} style={styles.actionRow}>
            <View style={styles.actionIcon}>
              <Ionicons name='download-outline' size={21} color='#41514d' />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>{exporting ? 'Preparing export...' : 'Export My Data'}</Text>
              <Text style={styles.actionDescription}>Create a shareable PDF copy of your account data.</Text>
            </View>
            <Ionicons name='chevron-forward' size={18} color='#8a928d' />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole='button'
            onPress={requestDeletion}
            disabled={deletionSaving}
            style={[styles.actionRow, styles.lastRow]}
          >
            <View style={[styles.actionIcon, styles.dangerIcon]}>
              <Ionicons name='trash-outline' size={21} color='#a52b2b' />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.dangerTitle}>Delete Account</Text>
              <Text style={styles.actionDescription}>Permanently delete your account without admin approval.</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.notice}>
          <Ionicons name='lock-closed-outline' size={20} color='#2f6b4f' />
          <Text style={styles.noticeText}>Exports are generated only after checking your signed-in account.</Text>
        </View>
      </KeyboardAwareScrollView>

      <Modal visible={deletionModalVisible} transparent animationType='fade' onRequestClose={() => setDeletionModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAwareScrollView contentContainerStyle={styles.modalScrollContent}>
            <View style={styles.modalCard}>
              <View style={styles.modalIcon}>
                <Ionicons name='warning-outline' size={27} color='#a52b2b' />
              </View>
              <Text style={styles.modalTitle}>Delete your account</Text>
              <Text style={styles.modalText}>
                No admin approval is required. This action is permanent. Active services or pending shop payments must be resolved first.
              </Text>
              <Text style={styles.modalLabel}>Type DELETE to continue *</Text>
              <TextInput
                style={styles.modalInput}
                value={deletionConfirmation}
                onChangeText={setDeletionConfirmation}
                placeholder='DELETE'
                placeholderTextColor='#9aa39d'
                autoCapitalize='characters'
                maxLength={10}
              />
              <TouchableOpacity
                style={[styles.submitDeleteButton, deletionConfirmation.trim() !== 'DELETE' && styles.disabledDeleteButton]}
                onPress={confirmDeletion}
                disabled={deletionSaving || deletionConfirmation.trim() !== 'DELETE'}
              >
                {deletionSaving ? <ActivityIndicator size='small' color='#ffffff' /> : null}
                <Text style={styles.submitDeleteText}>{deletionSaving ? 'Deleting...' : 'Continue'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDeletionModalVisible(false)} disabled={deletionSaving}>
                <Text style={styles.modalCancelText}>Keep My Account</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ icon, title, description, last = false }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last && styles.lastRow]}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={19} color='#41514d' />
      </View>
      <View style={styles.actionCopy}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoDescription}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1ec' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18, paddingBottom: 120 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 13, padding: 17, borderRadius: 18,
    backgroundColor: '#22312d', marginBottom: 22,
  },
  heroIcon: {
    width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroCopy: { flex: 1 },
  heroTitle: { color: '#ffffff', fontSize: 21, fontWeight: '900' },
  heroText: { color: '#d6dfda', fontSize: 12, lineHeight: 18, marginTop: 3 },
  sectionLabel: { color: '#62706b', fontSize: 11, fontWeight: '800', marginLeft: 2, marginBottom: 9 },
  spacedLabel: { marginTop: 20 },
  infoCard: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff' },
  infoRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderBottomWidth: 1, borderBottomColor: '#e7e5df' },
  infoIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ebf1e8' },
  infoTitle: { color: '#22312d', fontSize: 13, fontWeight: '800' },
  infoDescription: { color: '#7a8580', fontSize: 10, lineHeight: 15, marginTop: 2 },
  actionCard: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff' },
  actionRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderBottomWidth: 1, borderBottomColor: '#e7e5df' },
  lastRow: { borderBottomWidth: 0 },
  actionIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ebf1e8' },
  dangerIcon: { backgroundColor: '#fff0f0' },
  actionCopy: { flex: 1, minWidth: 0 },
  actionTitle: { color: '#22312d', fontSize: 14, fontWeight: '800' },
  dangerTitle: { color: '#a52b2b', fontSize: 14, fontWeight: '800' },
  actionDescription: { color: '#7a8580', fontSize: 10, lineHeight: 15, marginTop: 3 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, padding: 13, borderRadius: 14, backgroundColor: '#e5efe5' },
  noticeText: { flex: 1, color: '#41514d', fontSize: 11, lineHeight: 17 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(16, 19, 18, 0.65)', justifyContent: 'center' },
  modalScrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 22, backgroundColor: '#ffffff', padding: 20 },
  modalIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff0f0' },
  modalTitle: { color: '#22312d', fontSize: 20, fontWeight: '900', marginTop: 14 },
  modalText: { color: '#62706b', fontSize: 12, lineHeight: 19, marginTop: 7 },
  modalLabel: { color: '#41514d', fontSize: 12, fontWeight: '800', marginTop: 15, marginBottom: 6 },
  modalInput: { minHeight: 46, borderWidth: 1, borderColor: '#d9d6cd', borderRadius: 13, backgroundColor: '#fbfaf7', paddingHorizontal: 13, color: '#22312d' },
  submitDeleteButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#a52b2b', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  disabledDeleteButton: { opacity: 0.5 },
  submitDeleteText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  modalCancelButton: { minHeight: 46, borderRadius: 14, backgroundColor: '#eef1ec', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  modalCancelText: { color: '#41514d', fontSize: 13, fontWeight: '900' },
});
