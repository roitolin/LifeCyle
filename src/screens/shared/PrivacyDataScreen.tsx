import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { KeyboardAwareScrollView } from '@/components';
import { auth } from '@/services/supabaseAuth';
import { supabase } from '@/services/supabaseClient';

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

type DeletionRequest = {
  id: string;
  status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'completed';
  reason: string;
  admin_note: string | null;
  requested_at: string;
  updated_at: string;
};

const deletionStatusMeta = (status: DeletionRequest['status']) => {
  if (status === 'pending') return { label: 'Pending Review', color: '#9a5b32', background: '#fff7ed' };
  if (status === 'in_review') return { label: 'In Review', color: '#1c4f7e', background: '#e0eefa' };
  if (status === 'approved') return { label: 'Approved', color: '#166534', background: '#dcfce7' };
  if (status === 'rejected') return { label: 'Rejected', color: '#991b1b', background: '#fee2e2' };
  if (status === 'completed') return { label: 'Completed', color: '#ffffff', background: '#14532d' };
  return { label: 'Cancelled', color: '#4c5b57', background: '#eef1ec' };
};

export default function PrivacyDataScreen() {
  const [exporting, setExporting] = useState(false);
  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(null);
  const [deletionLoading, setDeletionLoading] = useState(true);
  const [deletionModalVisible, setDeletionModalVisible] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionConfirmation, setDeletionConfirmation] = useState('');
  const [deletionSaving, setDeletionSaving] = useState(false);

  const loadDeletionRequest = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    try {
      const { data, error } = await supabase
        .from('account_deletion_requests')
        .select('*')
        .eq('user_id', currentUser.uid)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setDeletionRequest((data as DeletionRequest | null) ?? null);
    } catch (error) {
      console.warn('Unable to load account deletion status:', error);
    } finally {
      setDeletionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeletionRequest();
  }, [loadDeletionRequest]);

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
        refundsResult,
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
          .from('service_refund_requests')
          .select('*')
          .eq('requester_id', currentUser.uid)
          .order('requested_at', { ascending: false }),
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
        || refundsResult.error
        || deletionRequestsResult.error;
      if (firstError) throw firstError;

      const report = {
        exportedAt: new Date().toISOString(),
        account: profileResult.data || { id: currentUser.uid, email: currentUser.email },
        serviceRequests: requestsResult.data || [],
        blockedAccountIds: blocksResult.data || [],
        notifications: notificationsResult.data || [],
        refundRequests: refundsResult.data || [],
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
    setDeletionReason('');
    setDeletionConfirmation('');
    setDeletionModalVisible(true);
  };

  const submitDeletionRequest = async () => {
    const currentUser = auth.currentUser;
    const reason = deletionReason.trim();
    if (!currentUser || deletionSaving) return;
    if (reason.length < 10) {
      Alert.alert('More Detail Needed', 'Please enter at least 10 characters explaining your request.');
      return;
    }
    if (deletionConfirmation.trim().toUpperCase() !== 'DELETE') {
      Alert.alert('Confirmation Required', 'Type DELETE exactly to confirm this request.');
      return;
    }

    setDeletionSaving(true);
    try {
      const { data, error } = await supabase
        .from('account_deletion_requests')
        .insert({ user_id: currentUser.uid, reason })
        .select('*')
        .single();
      if (error) throw error;
      setDeletionRequest(data as DeletionRequest);
      setDeletionModalVisible(false);
      Alert.alert('Request Submitted', 'You can track the review status from Privacy & Data.');
    } catch (error: any) {
      Alert.alert('Request Failed', error?.code === '23505'
        ? 'You already have an active account deletion request.'
        : error?.message || 'Unable to submit your deletion request.');
    } finally {
      setDeletionSaving(false);
    }
  };

  const cancelDeletionRequest = () => {
    if (!deletionRequest || deletionRequest.status !== 'pending') return;
    Alert.alert('Cancel Deletion Request', 'Withdraw this pending request?', [
      { text: 'Keep Request', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setDeletionSaving(true);
          try {
            const { data, error } = await supabase
              .from('account_deletion_requests')
              .update({ status: 'cancelled' })
              .eq('id', deletionRequest.id)
              .eq('status', 'pending')
              .select('*')
              .single();
            if (error) throw error;
            setDeletionRequest(data as DeletionRequest);
          } catch (error: any) {
            Alert.alert('Update Failed', error?.message || 'Unable to withdraw the request.');
          } finally {
            setDeletionSaving(false);
          }
        },
      },
    ]);
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
            <Text style={styles.heroText}>Understand, export, or request deletion of your account data.</Text>
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
            disabled={deletionLoading || deletionSaving || Boolean(deletionRequest && ['pending', 'in_review', 'approved'].includes(deletionRequest.status))}
            style={[styles.actionRow, styles.lastRow]}
          >
            <View style={[styles.actionIcon, styles.dangerIcon]}>
              <Ionicons name='trash-outline' size={21} color='#a52b2b' />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.dangerTitle}>Request Account Deletion</Text>
              <Text style={styles.actionDescription}>Submit a verified request and track its review status.</Text>
            </View>
          </TouchableOpacity>
        </View>

        {deletionRequest ? (
          <View style={styles.deletionStatusCard}>
            <View style={styles.deletionStatusHeader}>
              <Text style={styles.deletionStatusTitle}>Deletion Request</Text>
              <View style={[styles.statusBadge, { backgroundColor: deletionStatusMeta(deletionRequest.status).background }]}>
                <Text style={[styles.statusBadgeText, { color: deletionStatusMeta(deletionRequest.status).color }]}>
                  {deletionStatusMeta(deletionRequest.status).label}
                </Text>
              </View>
            </View>
            <Text style={styles.deletionStatusReason}>{deletionRequest.reason}</Text>
            {deletionRequest.admin_note ? <Text style={styles.deletionAdminNote}>Admin response: {deletionRequest.admin_note}</Text> : null}
            <Text style={styles.deletionTimestamp}>Requested {new Date(deletionRequest.requested_at).toLocaleString()}</Text>
            {deletionRequest.status === 'pending' ? (
              <TouchableOpacity style={styles.withdrawButton} onPress={cancelDeletionRequest} disabled={deletionSaving}>
                <Text style={styles.withdrawButtonText}>{deletionSaving ? 'Updating...' : 'Withdraw Request'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

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
              <Text style={styles.modalTitle}>Request account deletion</Text>
              <Text style={styles.modalText}>
                An administrator will verify the request before deletion. Active service, payment, refund, or dispute records may need to be resolved first.
              </Text>
              <Text style={styles.modalLabel}>Why are you requesting deletion? *</Text>
              <TextInput
                style={[styles.modalInput, styles.reasonInput]}
                value={deletionReason}
                onChangeText={setDeletionReason}
                placeholder='Enter at least 10 characters'
                placeholderTextColor='#9aa39d'
                multiline
                maxLength={500}
              />
              <Text style={styles.modalLabel}>Type DELETE to confirm *</Text>
              <TextInput
                style={styles.modalInput}
                value={deletionConfirmation}
                onChangeText={setDeletionConfirmation}
                placeholder='DELETE'
                placeholderTextColor='#9aa39d'
                autoCapitalize='characters'
                maxLength={10}
              />
              <TouchableOpacity style={styles.submitDeleteButton} onPress={() => void submitDeletionRequest()} disabled={deletionSaving}>
                {deletionSaving ? <ActivityIndicator size='small' color='#ffffff' /> : null}
                <Text style={styles.submitDeleteText}>{deletionSaving ? 'Submitting...' : 'Submit Deletion Request'}</Text>
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
  deletionStatusCard: { marginTop: 14, borderRadius: 17, borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff', padding: 15 },
  deletionStatusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  deletionStatusTitle: { color: '#22312d', fontSize: 15, fontWeight: '900' },
  statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statusBadgeText: { fontSize: 10, fontWeight: '900' },
  deletionStatusReason: { color: '#41514d', fontSize: 12, lineHeight: 18, marginTop: 12 },
  deletionAdminNote: { color: '#7f1d1d', fontSize: 12, lineHeight: 18, marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#fff0f0' },
  deletionTimestamp: { color: '#7a8580', fontSize: 10, marginTop: 10 },
  withdrawButton: { minHeight: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef1ec', marginTop: 12 },
  withdrawButtonText: { color: '#4c5b57', fontSize: 12, fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(16, 19, 18, 0.65)', justifyContent: 'center' },
  modalScrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 22, backgroundColor: '#ffffff', padding: 20 },
  modalIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff0f0' },
  modalTitle: { color: '#22312d', fontSize: 20, fontWeight: '900', marginTop: 14 },
  modalText: { color: '#62706b', fontSize: 12, lineHeight: 19, marginTop: 7 },
  modalLabel: { color: '#41514d', fontSize: 12, fontWeight: '800', marginTop: 15, marginBottom: 6 },
  modalInput: { minHeight: 46, borderWidth: 1, borderColor: '#d9d6cd', borderRadius: 13, backgroundColor: '#fbfaf7', paddingHorizontal: 13, color: '#22312d' },
  reasonInput: { minHeight: 100, paddingTop: 12, textAlignVertical: 'top' },
  submitDeleteButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#a52b2b', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  submitDeleteText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  modalCancelButton: { minHeight: 46, borderRadius: 14, backgroundColor: '#eef1ec', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  modalCancelText: { color: '#41514d', fontSize: 13, fontWeight: '900' },
});
