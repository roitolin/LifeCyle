import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { uploadCertificate } from '@/services';
import {
  deathCertificateErrorMessage,
  loadDeathCertificateRequest,
  requestDeathCertificate,
  sendDeathCertificate,
  startDeathCertificateProcessing,
  type DeathCertificateRequest,
} from '@/utils/deathCertificateRequest';

type Props = {
  serviceRequestId: string;
  requesterView: boolean;
  ownerView: boolean;
};

const STATUS_COPY = {
  requested: { label: 'Requested', detail: 'The funeral shop has received the request.' },
  processing: { label: 'Processing', detail: 'The funeral shop is processing the Death Certificate.' },
  ready: { label: 'Ready', detail: 'The Death Certificate is ready.' },
} as const;

export default function DeathCertificateRequestCard({ serviceRequestId, requesterView, ownerView }: Props) {
  const [document, setDocument] = useState<DeathCertificateRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      setDocument(await loadDeathCertificateRequest(serviceRequestId));
      setError(null);
    } catch (loadError) {
      setError(deathCertificateErrorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [serviceRequestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await load(true);
      Alert.alert('Death Certificate', success);
    } catch (actionError) {
      Alert.alert('Could Not Update Request', deathCertificateErrorMessage(actionError));
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  const uploadAndSend = useCallback(async () => {
    if (!document || busy) return;
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setBusy(true);
    try {
      const fileUrl = await uploadCertificate(picker.assets[0].uri);
      await sendDeathCertificate(document.id, fileUrl);
      await load(true);
      Alert.alert('Death Certificate Sent', 'The customer can now open the Death Certificate file.');
    } catch (uploadError) {
      Alert.alert('Certificate Not Sent', deathCertificateErrorMessage(uploadError));
    } finally {
      setBusy(false);
    }
  }, [busy, document, load]);

  const openCertificate = useCallback(async () => {
    if (!document?.file_url) return;
    try {
      await Linking.openURL(document.file_url);
    } catch {
      Alert.alert('Cannot Open File', 'The Death Certificate file link is unavailable.');
    }
  }, [document?.file_url]);

  const status = document ? STATUS_COPY[document.status] : null;
  const shopView = !requesterView;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerToggle}
          onPress={() => setExpanded((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Hide document details' : 'Show document details'}
          accessibilityState={{ expanded }}
        >
          <Ionicons name="document-text-outline" size={21} color="#315f50" />
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Death certificate</Text>
            <Text style={styles.subtitle}>{status?.label || (shopView ? 'Waiting for customer' : 'Not requested')}</Text>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={19} color="#6f7e78" />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="Refresh Death Certificate request"
          disabled={refreshing}
          onPress={() => void load(true)}
        >
          {refreshing ? <ActivityIndicator size="small" color="#315f50" /> : <Ionicons name="refresh" size={21} color="#315f50" />}
        </TouchableOpacity>
      </View>

      {expanded && (loading ? (
        <View style={styles.state}>
          <ActivityIndicator color="#315f50" />
          <Text style={styles.stateText}>Loading document request…</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={21} color="#a0443e" />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>Death Certificate request unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
          <TouchableOpacity onPress={() => void load()}><Text style={styles.retry}>Retry</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.statusRow}>
            <View style={[styles.statusIcon, document?.file_url && styles.statusIconReady]}>
              <Ionicons name={document?.file_url ? 'checkmark' : document ? 'time-outline' : 'document-outline'} size={21} color={document?.file_url ? '#ffffff' : '#315f50'} />
            </View>
            <View style={styles.statusCopy}>
              <Text style={styles.statusLabel}>{status?.label || (shopView ? 'Waiting for customer' : 'Not requested')}</Text>
              <Text style={styles.statusDetail}>
                {status?.detail || (shopView
                  ? 'The shop can process this document after the customer requests it.'
                  : 'Request this document when you want the funeral shop to process it.')}
              </Text>
            </View>
          </View>

          {ownerView && !document ? (
            <ActionButton
              label="Request Death Certificate"
              busy={busy}
              icon="paper-plane-outline"
              onPress={() => void run(
                () => requestDeathCertificate(serviceRequestId),
                'Your request was sent to the funeral shop.'
              )}
            />
          ) : null}

          {shopView && document && document.status === 'requested' ? (
            <ActionButton
              label="Mark as Processing"
              busy={busy}
              icon="hourglass-outline"
              secondary
              onPress={() => void run(
                () => startDeathCertificateProcessing(document.id),
                'The customer can now see that the document is being processed.'
              )}
            />
          ) : null}

          {shopView && document ? (
            <ActionButton
              label={document.file_url ? 'Replace Certificate File' : 'Upload and Send Certificate'}
              busy={busy}
              icon="cloud-upload-outline"
              onPress={() => void uploadAndSend()}
            />
          ) : null}

          {document?.file_url ? (
            <ActionButton
              label="Open Death Certificate"
              busy={false}
              icon="open-outline"
              secondary
              onPress={() => void openCertificate()}
            />
          ) : null}

          <View style={styles.ruleNote}>
            <Ionicons name="shield-checkmark-outline" size={17} color="#53645d" />
            <Text style={styles.ruleText}>Only the funeral shop can upload and send the Death Certificate file.</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ActionButton({
  label,
  busy,
  icon,
  secondary,
  onPress,
}: {
  label: string;
  busy: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  secondary?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, secondary && styles.buttonSecondary, busy && styles.buttonDisabled]}
      disabled={busy}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator size="small" color={secondary ? '#315f50' : '#ffffff'} />
      ) : (
        <Ionicons name={icon} size={17} color={secondary ? '#315f50' : '#ffffff'} />
      )}
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{busy ? 'Please wait…' : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#d8e0e8',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 14 },
  headerToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  headerCopy: { flex: 1 },
  title: { color: '#23332d', fontSize: 16, fontWeight: '900' },
  subtitle: { marginTop: 3, color: '#6f7e78', fontSize: 11, lineHeight: 16 },
  state: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  stateText: { color: '#728079', fontSize: 11 },
  body: { padding: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 15, backgroundColor: '#f7f7f4' },
  statusIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e4eee9' },
  statusIconReady: { backgroundColor: '#3b765e' },
  statusCopy: { flex: 1 },
  statusLabel: { color: '#293a34', fontSize: 13, fontWeight: '900' },
  statusDetail: { marginTop: 3, color: '#718079', fontSize: 10, lineHeight: 15 },
  button: { minHeight: 45, marginTop: 10, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#315f50' },
  buttonSecondary: { backgroundColor: '#f1f3f1', borderWidth: 1, borderColor: '#d5dcd8' },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  buttonTextSecondary: { color: '#315f50' },
  ruleNote: { flexDirection: 'row', gap: 8, marginTop: 13, padding: 11, borderRadius: 12, backgroundColor: '#f2f3ef' },
  ruleText: { flex: 1, color: '#68756f', fontSize: 9, lineHeight: 14 },
  errorCard: { margin: 14, padding: 13, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff1ef' },
  errorCopy: { flex: 1 },
  errorTitle: { color: '#8b3934', fontSize: 12, fontWeight: '900' },
  errorText: { marginTop: 2, color: '#99534e', fontSize: 10, lineHeight: 14 },
  retry: { color: '#315f50', fontSize: 11, fontWeight: '900' },
});
