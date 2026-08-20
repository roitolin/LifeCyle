import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

export default function PrivacyDataScreen({ navigation }: any) {
  const [exporting, setExporting] = useState(false);

  const exportMyData = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert('Session required', 'Please sign in again before exporting your data.');
      return;
    }

    setExporting(true);
    try {
      const [profileResult, requestsResult, blocksResult, notificationsResult] = await Promise.all([
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
      ]);

      const firstError = profileResult.error || requestsResult.error || blocksResult.error || notificationsResult.error;
      if (firstError) throw firstError;

      const report = {
        exportedAt: new Date().toISOString(),
        account: profileResult.data || { id: currentUser.uid, email: currentUser.email },
        serviceRequests: requestsResult.data || [],
        blockedAccountIds: blocksResult.data || [],
        notifications: notificationsResult.data || [],
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
    Alert.alert(
      'Request account deletion?',
      'Support will verify your identity before permanently deleting your account and eligible personal data.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Contact Support', onPress: () => navigation.navigate('Contact') },
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

          <TouchableOpacity accessibilityRole='button' onPress={requestDeletion} style={[styles.actionRow, styles.lastRow]}>
            <View style={[styles.actionIcon, styles.dangerIcon]}>
              <Ionicons name='trash-outline' size={21} color='#a52b2b' />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.dangerTitle}>Request Account Deletion</Text>
              <Text style={styles.actionDescription}>Contact support for identity verification and permanent deletion.</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.notice}>
          <Ionicons name='lock-closed-outline' size={20} color='#2f6b4f' />
          <Text style={styles.noticeText}>Exports are generated only after checking your signed-in account.</Text>
        </View>
      </KeyboardAwareScrollView>
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
});
