import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import {
  Image,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type IconName = ComponentProps<typeof Ionicons>['name'];

type ValueCard = {
  title: string;
  description: string;
  icon: IconName;
};

type JourneyStep = {
  title: string;
  description: string;
};

type TeamMember = {
  name: string;
  image: ImageSourcePropType;
};

const highlights = [
  { value: 'One place', label: 'to coordinate arrangements' },
  { value: 'Clear', label: 'request and payment updates' },
  { value: 'Human', label: 'support when it matters' },
];

const values: ValueCard[] = [
  {
    title: 'Our mission',
    icon: 'heart-outline',
    description:
      'Help families coordinate funeral services with greater clarity, dignity, and confidence during a difficult time.',
  },
  {
    title: 'Our vision',
    icon: 'sparkles-outline',
    description:
      'A compassionate service network where trustworthy funeral support is easier to discover, understand, and access.',
  },
  {
    title: 'Our promise',
    icon: 'shield-checkmark-outline',
    description:
      'Design every feature around respectful communication, transparent progress, and meaningful user control.',
  },
];

const journey: JourneyStep[] = [
  {
    title: 'Discover',
    description: 'Explore funeral shops, products, and available service options.',
  },
  {
    title: 'Coordinate',
    description: 'Share arrangement details and communicate with the selected provider.',
  },
  {
    title: 'Stay informed',
    description: 'Follow request, payment, and completion updates in one organized place.',
  },
];

const teamMembers: TeamMember[] = [
  {
    name: 'Cyrus Coyoca',
    image: require('../../../assets/member-photos/cyrus-coyoca.jpg'),
  },
  {
    name: 'Daisy Derial',
    image: require('../../../assets/member-photos/daisy-derial.jpg'),
  },
  {
    name: 'Ezra Baguhin',
    image: require('../../../assets/member-photos/ezra-baguhin.png'),
  },
  {
    name: 'Mary Sheen Punay',
    image: require('../../../assets/member-photos/mary-sheen-punay.png'),
  },
  {
    name: 'Roi Veinze Tolin',
    image: require('../../../assets/member-photos/roi-veinze-tolin.png'),
  },
  {
    name: 'Samuel Monares Jr.',
    image: require('../../../assets/member-photos/samuel-monares-jr.png'),
  },
];

export default function AboutUsScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroOrbLarge} />
          <View style={styles.heroOrbSmall} />

          <View style={styles.eyebrowRow}>
            <View style={styles.brandMark}>
              <Ionicons name='leaf-outline' size={21} color='#ffffff' />
            </View>
            <Text style={styles.eyebrow}>ABOUT LIFECYCLE</Text>
          </View>

          <Text accessibilityRole='header' style={styles.heroTitle}>
            Compassion, clarity, and connection.
          </Text>
          <Text style={styles.heroSubtitle}>
            LifeCycle helps families find funeral-service providers, coordinate important
            details, and stay informed throughout the arrangement process.
          </Text>

          <View style={styles.highlightRow}>
            {highlights.map((item) => (
              <View key={item.value} style={styles.highlightCard}>
                <Text style={styles.highlightValue}>{item.value}</Text>
                <Text style={styles.highlightLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.introCard}>
          <View style={styles.introIcon}>
            <Ionicons name='people-outline' size={25} color='#2f6b4f' />
          </View>
          <View style={styles.introCopy}>
            <Text accessibilityRole='header' style={styles.introTitle}>
              Why LifeCycle exists
            </Text>
            <Text style={styles.bodyText}>
              Funeral arrangements often involve urgent decisions, many details, and several
              conversations at once. LifeCycle brings those tasks together so families can
              spend less time navigating confusion and more time caring for one another.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>WHAT GUIDES US</Text>
        <View style={styles.valueStack}>
          {values.map((item) => (
            <View key={item.title} style={styles.valueCard}>
              <View style={styles.valueIcon}>
                <Ionicons name={item.icon} size={22} color='#2f6b4f' />
              </View>
              <View style={styles.valueCopy}>
                <Text style={styles.valueTitle}>{item.title}</Text>
                <Text style={styles.valueDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>HOW IT HELPS</Text>
        <View style={styles.journeyCard}>
          {journey.map((item, index) => (
            <View
              key={item.title}
              style={[styles.journeyRow, index === journey.length - 1 && styles.lastJourneyRow]}
            >
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.journeyCopy}>
                <Text style={styles.journeyTitle}>{item.title}</Text>
                <Text style={styles.journeyDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.trustCard}>
          <View style={styles.trustHeader}>
            <Ionicons name='information-circle-outline' size={22} color='#2f6b4f' />
            <Text style={styles.trustTitle}>Built for informed decisions</Text>
          </View>
          <Text style={styles.trustText}>
            LifeCycle supports discovery, communication, requests, and payment tracking.
            Funeral-service providers remain responsible for confirming availability, pricing,
            service details, and fulfillment directly with each family.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>THE PROJECT TEAM</Text>
        <View style={styles.teamCard}>
          <View style={styles.teamHeadingRow}>
            <View>
              <Text accessibilityRole='header' style={styles.teamTitle}>
                Meet the people behind LifeCycle
              </Text>
              <Text style={styles.teamSubtitle}>
                A six-member team building a more organized funeral-service experience.
              </Text>
            </View>
          </View>

          <View style={styles.teamGrid}>
            {teamMembers.map((member) => (
              <View key={member.name} style={styles.memberCard}>
                <Image
                  source={member.image}
                  style={styles.memberPhoto}
                  resizeMode='cover'
                  accessibilityLabel={member.name + ', LifeCycle project team'}
                />
                <Text style={styles.memberName}>{member.name}</Text>
                <Text style={styles.memberRole}>Project Team</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.supportCard}>
          <View style={styles.supportIcon}>
            <Ionicons name='chatbubble-ellipses-outline' size={23} color='#ffffff' />
          </View>
          <View style={styles.supportCopy}>
            <Text style={styles.supportTitle}>Questions or concerns?</Text>
            <Text style={styles.supportText}>
              Contact the LifeCycle support team from your profile.
            </Text>
          </View>
          <Pressable
            accessibilityRole='button'
            onPress={() => navigation.navigate('Contact')}
            style={({ pressed }) => [styles.supportButton, pressed && styles.pressed]}
          >
            <Text style={styles.supportButtonText}>Contact</Text>
            <Ionicons name='arrow-forward' size={16} color='#22312d' />
          </Pressable>
        </View>

        <Text style={styles.footerText}>
          © {new Date().getFullYear()} LifeCycle Funeral Services Philippines
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#eef1ec',
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 64,
  },
  hero: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#22312d',
    padding: 21,
    marginBottom: 14,
  },
  heroOrbLarge: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    top: -105,
    right: -68,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  heroOrbSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -64,
    left: -38,
    backgroundColor: 'rgba(142,170,157,0.16)',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  eyebrow: {
    color: '#b9c8c0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  heroTitle: {
    maxWidth: 520,
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 37,
    fontWeight: '900',
  },
  heroSubtitle: {
    maxWidth: 610,
    color: '#d6dfda',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
  },
  highlightRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 20,
  },
  highlightCard: {
    flex: 1,
    minWidth: 110,
    minHeight: 82,
    borderRadius: 15,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  highlightValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  highlightLabel: {
    color: '#c8d3cd',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    padding: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
    marginBottom: 24,
  },
  introIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5efe5',
  },
  introCopy: {
    flex: 1,
  },
  introTitle: {
    color: '#22312d',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 6,
  },
  bodyText: {
    color: '#56635e',
    fontSize: 13,
    lineHeight: 21,
  },
  sectionLabel: {
    color: '#62706b',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.9,
    marginLeft: 2,
    marginBottom: 9,
  },
  valueStack: {
    gap: 9,
    marginBottom: 24,
  },
  valueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    padding: 16,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
  },
  valueIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ebf1e8',
  },
  valueCopy: {
    flex: 1,
  },
  valueTitle: {
    color: '#22312d',
    fontSize: 15,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  valueDescription: {
    color: '#62706b',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 4,
  },
  journeyCard: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
    marginBottom: 14,
  },
  journeyRow: {
    flexDirection: 'row',
    gap: 13,
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e7e5df',
  },
  lastJourneyRow: {
    borderBottomWidth: 0,
  },
  stepNumber: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2f6b4f',
  },
  stepNumberText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  journeyCopy: {
    flex: 1,
  },
  journeyTitle: {
    color: '#22312d',
    fontSize: 14,
    fontWeight: '900',
  },
  journeyDescription: {
    color: '#62706b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  trustCard: {
    padding: 16,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#cfdccc',
    backgroundColor: '#e5efe5',
    marginBottom: 24,
  },
  trustHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trustTitle: {
    color: '#284d3b',
    fontSize: 14,
    fontWeight: '900',
  },
  trustText: {
    color: '#41514d',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 8,
  },
  teamCard: {
    padding: 16,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
    marginBottom: 14,
  },
  teamHeadingRow: {
    marginBottom: 15,
  },
  teamTitle: {
    color: '#22312d',
    fontSize: 18,
    fontWeight: '900',
  },
  teamSubtitle: {
    color: '#62706b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  teamGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  memberCard: {
    width: '48%',
    flexGrow: 1,
    minWidth: 130,
    alignItems: 'center',
    padding: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#e2e1da',
    backgroundColor: '#f8faf7',
  },
  memberPhoto: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 190,
    borderRadius: 12,
    backgroundColor: '#e5efe5',
  },
  memberName: {
    color: '#22312d',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 9,
  },
  memberRole: {
    color: '#2f6b4f',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  supportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#2f6b4f',
  },
  supportIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  supportCopy: {
    flex: 1,
  },
  supportTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  supportText: {
    color: '#dbe6e0',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  supportButtonText: {
    color: '#22312d',
    fontSize: 11,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.78,
  },
  footerText: {
    color: '#7a8580',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 22,
  },
});
