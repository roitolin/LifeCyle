import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from '@/components';

type SettingsButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  last?: boolean;
};

export default function AccountSecurityScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name='settings-outline' size={28} color='#ffffff' />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Account settings</Text>
            <Text style={styles.heroText}>Manage passwords, signed-in devices, privacy, and account activity.</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>SECURITY</Text>
        <View style={styles.menuCard}>
          <SettingsButton
            icon='lock-closed-outline'
            title='Password & Security'
            description='Verify your email and change your account password.'
            onPress={() => navigation.navigate('PasswordSecurity')}
          />
          <SettingsButton
            icon='phone-portrait-outline'
            title='Active Sessions'
            description='Review signed-in devices and remotely sign them out.'
            onPress={() => navigation.navigate('ActiveSessions')}
          />
          <SettingsButton
            icon='log-in-outline'
            title='Login & Logout History'
            description='Review when and where your account was accessed.'
            onPress={() => navigation.navigate('AccountActivityLog')}
            last
          />
        </View>

        <Text style={[styles.sectionLabel, styles.secondSectionLabel]}>PRIVACY & ACTIVITY</Text>
        <View style={styles.menuCard}>
          <SettingsButton
            icon='ban-outline'
            title='Blocked Accounts'
            description='Review and unblock accounts you have blocked.'
            onPress={() => navigation.navigate('BlockedAccounts')}
          />
          <SettingsButton
            icon='time-outline'
            title='Activity Log'
            description='Review password and account security changes.'
            onPress={() => navigation.navigate('AccountChangesActivity')}
            last
          />
        </View>

        <View style={styles.notice}>
          <Ionicons name='shield-checkmark-outline' size={21} color='#2f6b4f' />
          <Text style={styles.noticeText}>Only you can view your account activity.</Text>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function SettingsButton({ icon, title, description, onPress, last = false }: SettingsButtonProps) {
  return (
    <TouchableOpacity
      accessibilityRole='button'
      onPress={onPress}
      style={[styles.menuRow, last && styles.lastRow]}
    >
      <View style={styles.menuIcon}>
        <Ionicons name={icon} size={22} color='#41514d' />
      </View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDescription}>{description}</Text>
      </View>
      <Ionicons name='chevron-forward' size={19} color='#8a928d' />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1ec' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18, paddingBottom: 120 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 18,
    backgroundColor: '#22312d', marginBottom: 24,
  },
  heroIcon: {
    width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroCopy: { flex: 1 },
  heroTitle: { color: '#ffffff', fontSize: 21, fontWeight: '900' },
  heroText: { color: '#d6dfda', fontSize: 12, lineHeight: 18, marginTop: 4 },
  sectionLabel: { color: '#62706b', fontSize: 11, fontWeight: '800', marginLeft: 2, marginBottom: 9 },
  secondSectionLabel: { marginTop: 20 },
  menuCard: {
    overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: '#d9d6cd', backgroundColor: '#ffffff',
  },
  menuRow: {
    minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e7e5df',
  },
  lastRow: { borderBottomWidth: 0 },
  menuIcon: {
    width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ebf1e8',
  },
  menuCopy: { flex: 1, minWidth: 0 },
  menuTitle: { color: '#22312d', fontSize: 15, fontWeight: '800' },
  menuDescription: { color: '#7a8580', fontSize: 11, lineHeight: 17, marginTop: 3 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 13,
    borderRadius: 14, backgroundColor: '#e5efe5',
  },
  noticeText: { flex: 1, color: '#41514d', fontSize: 12, lineHeight: 17 },
});
