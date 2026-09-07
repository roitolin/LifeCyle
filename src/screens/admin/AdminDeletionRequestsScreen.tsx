import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';

type DeletionStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'completed';

type DeletionRequest = {
  id: string;
  user_id: string | null;
  email_snapshot: string;
  status: DeletionStatus;
  reason: string;
  admin_note: string | null;
  requested_at: string;
  updated_at: string;
};

const statusMeta = (status: DeletionStatus) => {
  if (status === 'pending') return { label: 'Pending', color: '#9a5b32', background: '#fff7ed' };
  if (status === 'in_review') return { label: 'In Review', color: '#1c4f7e', background: '#e0eefa' };
  if (status === 'approved') return { label: 'Approved', color: '#166534', background: '#dcfce7' };
  if (status === 'rejected') return { label: 'Rejected', color: '#991b1b', background: '#fee2e2' };
  if (status === 'completed') return { label: 'Completed', color: '#ffffff', background: '#14532d' };
  return { label: 'Cancelled', color: '#4c5b57', background: '#eef1ec' };
};

export default function AdminDeletionRequestsScreen() {
  const { role } = useAuth();
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<DeletionRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const isRootAdmin = role === 'admin' || role === 'super_admin';

  const loadRequests = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('account_deletion_requests')
        .select('*')
        .order('requested_at', { ascending: false });
      if (error) throw error;
      setRequests((data as DeletionRequest[]) || []);
    } catch (error: any) {
      Alert.alert('Unable to Load Requests', error?.message || 'Try again shortly.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadRequests();
  }, [loadRequests]));

  const pendingCount = useMemo(
    () => requests.filter((request) => ['pending', 'in_review', 'approved'].includes(request.status)).length,
    [requests]
  );

  const updateStatus = useCallback(async (
    request: DeletionRequest,
    status: 'in_review' | 'approved' | 'rejected',
    adminNote?: string
  ) => {
    if (updatingId) return;
    setUpdatingId(request.id);
    try {
      const { data, error } = await supabase
        .from('account_deletion_requests')
        .update({ status, admin_note: adminNote?.trim() || null })
        .eq('id', request.id)
        .eq('status', request.status)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Another administrator already updated this request.');
      setRequests((current) => current.map((item) => item.id === request.id ? data as DeletionRequest : item));
      setRejecting(null);
      setRejectReason('');
    } catch (error: any) {
      Alert.alert('Update Failed', error?.message || 'Unable to update this request.');
    } finally {
      setUpdatingId(null);
    }
  }, [updatingId]);

  const permanentlyDelete = useCallback((request: DeletionRequest) => {
    if (!isRootAdmin || updatingId) return;
    Alert.alert(
      'Permanently Delete Account',
      `Delete ${request.email_snapshot}? This cannot be undone. The server will refuse while active services, refunds, or payments remain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            setUpdatingId(request.id);
            try {
              const { data, error } = await supabase.functions.invoke('account-deletion', {
                body: { deletionRequestId: request.id },
              });
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              Alert.alert('Account Deleted', `${request.email_snapshot} was permanently removed.`);
              await loadRequests();
            } catch (error: any) {
              Alert.alert('Deletion Blocked', error?.message || 'The account could not be deleted.');
            } finally {
              setUpdatingId(null);
            }
          },
        },
      ]
    );
  }, [isRootAdmin, loadRequests, updatingId]);

  if (!isRootAdmin) {
    return (
      <View style={styles.centerState}>
        <Ionicons name='lock-closed-outline' size={34} color='#991b1b' />
        <Text style={styles.emptyTitle}>Root admin access required</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadRequests(); }} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name='trash-bin-outline' size={25} color='#ffffff' /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Account Deletion Queue</Text>
            <Text style={styles.heroText}>{pendingCount} request{pendingCount === 1 ? '' : 's'} requiring action</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.centerState}><ActivityIndicator color='#b91c1c' /></View>
        ) : requests.length === 0 ? (
          <View style={styles.centerState}>
            <Ionicons name='checkmark-circle-outline' size={36} color='#166534' />
            <Text style={styles.emptyTitle}>No deletion requests</Text>
            <Text style={styles.emptyText}>New verified requests will appear here.</Text>
          </View>
        ) : requests.map((request) => {
          const meta = statusMeta(request.status);
          const busy = updatingId === request.id;
          return (
            <View key={request.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardCopy}>
                  <Text style={styles.email}>{request.email_snapshot}</Text>
                  <Text style={styles.date}>{new Date(request.requested_at).toLocaleString()}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: meta.background }]}>
                  <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
              <Text style={styles.reason}>{request.reason}</Text>
              {request.admin_note ? <Text style={styles.adminNote}>Admin note: {request.admin_note}</Text> : null}

              {request.status === 'pending' ? (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.secondaryButton} disabled={busy} onPress={() => void updateStatus(request, 'in_review')}>
                    <Text style={styles.secondaryText}>Start Review</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryButton} disabled={busy} onPress={() => void updateStatus(request, 'approved')}>
                    <Text style={styles.primaryText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dangerButton} disabled={busy} onPress={() => { setRejectReason(''); setRejecting(request); }}>
                    <Text style={styles.dangerText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {request.status === 'in_review' ? (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.primaryButton} disabled={busy} onPress={() => void updateStatus(request, 'approved')}>
                    <Text style={styles.primaryText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dangerButton} disabled={busy} onPress={() => { setRejectReason(''); setRejecting(request); }}>
                    <Text style={styles.dangerText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {request.status === 'approved' ? (
                <TouchableOpacity style={styles.deleteButton} disabled={busy} onPress={() => permanentlyDelete(request)}>
                  {busy ? <ActivityIndicator size='small' color='#ffffff' /> : <Ionicons name='trash-outline' size={17} color='#ffffff' />}
                  <Text style={styles.deleteText}>{busy ? 'Checking...' : 'Delete Account Permanently'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={Boolean(rejecting)} transparent animationType='fade' onRequestClose={() => setRejecting(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject deletion request</Text>
            <Text style={styles.modalText}>Give the user a clear reason for the decision.</Text>
            <TextInput
              style={styles.modalInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder='Required explanation'
              placeholderTextColor='#9ca3af'
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={styles.dangerButtonLarge}
              disabled={!rejecting || rejectReason.trim().length < 3 || Boolean(updatingId)}
              onPress={() => rejecting && void updateStatus(rejecting, 'rejected', rejectReason)}
            >
              <Text style={styles.dangerText}>Reject Request</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setRejecting(null)} disabled={Boolean(updatingId)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: 16, paddingBottom: 80, gap: 12 },
  hero: { borderRadius: 18, padding: 17, backgroundColor: '#991b1b', flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1 },
  heroTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  heroText: { color: '#fee2e2', fontSize: 12, marginTop: 3 },
  centerState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#22312d', fontSize: 16, fontWeight: '900', marginTop: 10 },
  emptyText: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  card: { borderRadius: 17, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 15 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardCopy: { flex: 1 },
  email: { color: '#111827', fontSize: 14, fontWeight: '900' },
  date: { color: '#6b7280', fontSize: 10, marginTop: 3 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { fontSize: 10, fontWeight: '900' },
  reason: { color: '#374151', fontSize: 12, lineHeight: 19, marginTop: 12 },
  adminNote: { color: '#7f1d1d', fontSize: 11, lineHeight: 17, backgroundColor: '#fff0f0', borderRadius: 10, padding: 10, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  primaryButton: { minHeight: 40, borderRadius: 12, paddingHorizontal: 15, backgroundColor: '#166534', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  secondaryButton: { minHeight: 40, borderRadius: 12, paddingHorizontal: 15, backgroundColor: '#e0eefa', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#1c4f7e', fontSize: 12, fontWeight: '900' },
  dangerButton: { minHeight: 40, borderRadius: 12, paddingHorizontal: 15, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: '#991b1b', fontSize: 12, fontWeight: '900' },
  deleteButton: { minHeight: 44, borderRadius: 13, backgroundColor: '#991b1b', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  deleteText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(17,24,39,0.62)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, borderRadius: 20, backgroundColor: '#ffffff', padding: 20 },
  modalTitle: { color: '#111827', fontSize: 19, fontWeight: '900' },
  modalText: { color: '#6b7280', fontSize: 12, lineHeight: 18, marginTop: 5 },
  modalInput: { minHeight: 110, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 13, padding: 12, color: '#111827', textAlignVertical: 'top', marginTop: 14 },
  dangerButtonLarge: { minHeight: 46, borderRadius: 13, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  modalCancel: { minHeight: 44, borderRadius: 13, backgroundColor: '#e0eefa', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
