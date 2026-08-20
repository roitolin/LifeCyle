import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type LegalDocumentSection = {
  title: string;
  paragraphs: readonly string[];
  bulletPoints?: readonly string[];
};

type LegalDocumentScreenProps = {
  title: string;
  eyebrow: string;
  description: string;
  dateLabel: string;
  date: string;
  icon: IconName;
  sections: readonly LegalDocumentSection[];
  closingNote?: string;
};

export default function LegalDocumentScreen({
  title,
  eyebrow,
  description,
  dateLabel,
  date,
  icon,
  sections,
  closingNote,
}: LegalDocumentScreenProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}>
              <Ionicons name={icon} size={27} color="#ffffff" />
            </View>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
          </View>

          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text selectable style={styles.description}>
            {description}
          </Text>

          <View style={styles.datePill}>
            <Ionicons name="calendar-clear-outline" size={15} color="#d6dfda" />
            <Text style={styles.dateText}>
              {dateLabel}: {date}
            </Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <Ionicons name="reader-outline" size={21} color="#2f6b4f" />
          <Text style={styles.summaryText}>
            This document applies when you use the LifeCycle mobile app, website, account,
            service-request tools, shop features, and related services.
          </Text>
        </View>

        {sections.map((section, index) => (
          <View key={section.title} style={styles.sectionCard}>
            <View style={styles.sectionHeading}>
              <Text accessibilityElementsHidden style={styles.sectionNumber}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {section.title}
              </Text>
            </View>

            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} selectable style={styles.bodyText}>
                {paragraph}
              </Text>
            ))}

            {section.bulletPoints?.map((point) => (
              <View key={point} style={styles.bulletRow}>
                <View style={styles.bullet} />
                <Text selectable style={styles.bulletText}>
                  {point}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {closingNote ? (
          <View style={styles.contactCard}>
            <View style={styles.contactIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#2f6b4f" />
            </View>
            <View style={styles.contactCopy}>
              <Text style={styles.contactTitle}>Questions about this document?</Text>
              <Text selectable style={styles.contactText}>
                {closingNote}
              </Text>
            </View>
          </View>
        ) : null}

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
    maxWidth: 720,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 72,
  },
  hero: {
    padding: 20,
    borderRadius: 22,
    backgroundColor: '#22312d',
    marginBottom: 14,
    overflow: 'hidden',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  eyebrow: {
    flex: 1,
    color: '#b9c8c0',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: {
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  description: {
    color: '#d6dfda',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 9,
  },
  datePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dateText: {
    color: '#e5ebe8',
    fontSize: 11,
    fontWeight: '700',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cfdccc',
    backgroundColor: '#e5efe5',
    marginBottom: 12,
  },
  summaryText: {
    flex: 1,
    color: '#41514d',
    fontSize: 12,
    lineHeight: 19,
  },
  sectionCard: {
    padding: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#ffffff',
    marginBottom: 11,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 11,
  },
  sectionNumber: {
    minWidth: 34,
    color: '#2f6b4f',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    paddingVertical: 6,
    paddingHorizontal: 7,
    borderRadius: 9,
    backgroundColor: '#ebf1e8',
    textAlign: 'center',
  },
  sectionTitle: {
    flex: 1,
    color: '#22312d',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  bodyText: {
    color: '#4f5e59',
    fontSize: 14,
    lineHeight: 23,
    marginBottom: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2f6b4f',
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    color: '#4f5e59',
    fontSize: 14,
    lineHeight: 22,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9d6cd',
    backgroundColor: '#f8faf7',
    marginTop: 3,
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5efe5',
  },
  contactCopy: {
    flex: 1,
  },
  contactTitle: {
    color: '#22312d',
    fontSize: 13,
    fontWeight: '900',
  },
  contactText: {
    color: '#62706b',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 4,
  },
  footerText: {
    color: '#7a8580',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
  },
});
