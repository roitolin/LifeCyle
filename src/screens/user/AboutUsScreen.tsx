import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type TeamMember = {
  name: string;
  image: ImageSourcePropType;
};

const teamMembers: TeamMember[] = [
  { name: 'Cyrus Coyoca', image: require('../../../assets/member-photos/cyrus-coyoca.jpg') },
  { name: 'Daisy Derial', image: require('../../../assets/member-photos/daisy-derial.jpg') },
  { name: 'Ezra Baguhin', image: require('../../../assets/member-photos/ezra-baguhin.png') },
  { name: 'Mary Sheen Punay', image: require('../../../assets/member-photos/mary-sheen-punay.png') },
  { name: 'Roi Veinze Tolin', image: require('../../../assets/member-photos/roi-veinze-tolin.png') },
  { name: 'Samuel Monares Jr.', image: require('../../../assets/member-photos/samuel-monares-jr.png') },
];

const journey = [
  ['Browse shops and products', 'View active funeral shops, their listed products, and the details they provide.'],
  ['Coordinate with a shop', 'Send service information and communicate directly with the selected provider.'],
  ['Follow each request', 'Check request, payment, and completion updates from your account.'],
] as const;

export default function AboutUsScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.introduction}>
          <Text accessibilityRole='header' style={styles.title}>About LifeCycle</Text>
          <Text style={styles.lead}>
            LifeCycle helps families find funeral-service providers, share arrangement details,
            and follow service and payment updates in one place.
          </Text>
        </View>

        <View style={styles.infoPanel}>
          <View style={styles.infoSection}>
            <Text style={styles.infoTitle}>What LifeCycle does</Text>
            <Text style={styles.bodyText}>
              The app supports shop discovery, product browsing, service requests, messaging,
              and status tracking during funeral arrangements.
            </Text>
          </View>
          <View style={styles.infoSection}>
            <Text style={styles.infoTitle}>How shops participate</Text>
            <Text style={styles.bodyText}>
              Funeral shops provide their own business, product, availability, and pricing details.
              They are responsible for confirming those details with each family.
            </Text>
          </View>
          <View style={[styles.infoSection, styles.infoSectionLast]}>
            <Text style={styles.infoTitle}>Before confirming a service</Text>
            <Text style={styles.bodyText}>
              Review the shop information and confirm the final scope, schedule, price, and
              fulfillment details directly with the provider.
            </Text>
          </View>
        </View>

        <Text accessibilityRole='header' style={styles.sectionTitle}>How it works</Text>
        <View style={styles.steps}>
          {journey.map(([title, description], index) => (
            <View key={title} style={styles.stepRow}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>{title}</Text>
                <Text style={styles.bodyText}>{description}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text accessibilityRole='header' style={styles.sectionTitle}>Project team</Text>
        <Text style={styles.sectionDescription}>The six-member team behind LifeCycle.</Text>
        <View style={styles.teamGrid}>
          {teamMembers.map((member) => (
            <View key={member.name} style={styles.member}>
              <Image
                source={member.image}
                style={styles.memberPhoto}
                resizeMode='cover'
                accessibilityLabel={`${member.name}, LifeCycle project team`}
              />
              <Text style={styles.memberName}>{member.name}</Text>
            </View>
          ))}
        </View>

        <View style={styles.contactRow}>
          <View style={styles.contactCopy}>
            <Text style={styles.contactTitle}>Need help?</Text>
            <Text style={styles.contactText}>Contact LifeCycle support from your profile.</Text>
          </View>
          <Pressable
            accessibilityRole='button'
            onPress={() => navigation.navigate('Contact')}
            style={({ pressed }) => [styles.contactButton, pressed && styles.pressed]}
          >
            <Text style={styles.contactButtonText}>Contact support</Text>
            <Ionicons name='arrow-forward' size={16} color='#ffffff' />
          </Pressable>
        </View>

        <Text style={styles.footerText}>© {new Date().getFullYear()} LifeCycle Funeral Services Philippines</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f5f7' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 18, paddingBottom: 56 },
  introduction: { paddingVertical: 10, marginBottom: 18 },
  title: { color: '#17243d', fontSize: 28, lineHeight: 34, fontWeight: '800' },
  lead: { maxWidth: 640, color: '#58677b', fontSize: 14, lineHeight: 22, marginTop: 8 },
  infoPanel: { overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: '#d8e0e8', backgroundColor: '#ffffff', marginBottom: 26 },
  infoSection: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#e4e9ef' },
  infoSectionLast: { borderBottomWidth: 0 },
  infoTitle: { color: '#17243d', fontSize: 15, fontWeight: '800', marginBottom: 5 },
  bodyText: { color: '#58677b', fontSize: 13, lineHeight: 20 },
  sectionTitle: { color: '#17243d', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  sectionDescription: { color: '#69788b', fontSize: 13, marginTop: -4, marginBottom: 12 },
  steps: { marginBottom: 28 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#dfe5eb' },
  stepNumber: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#315f50' },
  stepNumberText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  stepCopy: { flex: 1 },
  stepTitle: { color: '#17243d', fontSize: 14, fontWeight: '800', marginBottom: 3 },
  teamGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  member: { width: '48%', flexGrow: 1, minWidth: 130 },
  memberPhoto: { width: '100%', aspectRatio: 1, maxHeight: 210, borderRadius: 10, backgroundColor: '#e5eaf0' },
  memberName: { color: '#17243d', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 7 },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 18, borderTopWidth: 1, borderTopColor: '#d8e0e8' },
  contactCopy: { flex: 1, minWidth: 190 },
  contactTitle: { color: '#17243d', fontSize: 15, fontWeight: '800' },
  contactText: { color: '#69788b', fontSize: 12, lineHeight: 18, marginTop: 3 },
  contactButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 9, backgroundColor: '#315f50', paddingHorizontal: 14 },
  contactButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.78 },
  footerText: { color: '#7b8796', fontSize: 11, textAlign: 'center', marginTop: 12 },
});
