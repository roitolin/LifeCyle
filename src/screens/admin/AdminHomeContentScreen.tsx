import { useCallback, useState } from 'react';
import { Alert, ImageBackground, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { Button, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { useAuth } from '@/context/AuthContext';
import { uploadHomeHeroImage } from '@/services';
import { colors, radii, spacing } from '@/theme';
import {
  getHomeHeroContent,
  saveHomeHeroContent,
  type HomeHeroTarget,
} from '@/utils/homeHero';

export default function AdminHomeContentScreen() {
  const { user } = useAuth();
  const [title, setTitle] = useState('Explore available caskets');
  const [subtitle, setSubtitle] = useState('Compare current listings from approved funeral shops.');
  const [buttonLabel, setButtonLabel] = useState('Browse now');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [target, setTarget] = useState<HomeHeroTarget>('shops');
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const content = await getHomeHeroContent({ includeInactive: true });
      if (!content) return;
      setTitle(content.title);
      setSubtitle(content.subtitle);
      setButtonLabel(content.buttonLabel);
      setImageUrl(content.imageUrl);
      setTarget(content.target);
      setIsActive(content.isActive);
      setUpdatedAt(content.updatedAt);
    } catch (error: any) {
      Alert.alert('Unable to load home feature', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const choosePhoto = async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.82,
    });
    if (picker.canceled || !picker.assets[0]) return;

    setUploading(true);
    try {
      const nextUrl = await uploadHomeHeroImage(picker.assets[0].uri);
      setImageUrl(nextUrl);
    } catch (error: any) {
      Alert.alert('Upload failed', error?.message || 'The banner photo could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!user?.id) {
      Alert.alert('Admin session required', 'Sign in again before saving home content.');
      return;
    }
    if (!title.trim() || !subtitle.trim() || !buttonLabel.trim()) {
      Alert.alert('Complete the feature', 'Title, supporting text, and button label are required.');
      return;
    }
    if (isActive && !imageUrl) {
      Alert.alert('Photo required', 'Choose a banner photo before making the feature visible.');
      return;
    }

    setSaving(true);
    try {
      const saved = await saveHomeHeroContent({
        title,
        subtitle,
        buttonLabel,
        imageUrl,
        target,
        isActive,
      }, user.id);
      setUpdatedAt(saved.updatedAt);
      Alert.alert('Home feature saved', saved.isActive ? 'The banner is now visible on the mobile home screen.' : 'The draft was saved but remains hidden.');
    } catch (error: any) {
      Alert.alert('Save failed', error?.message || 'The home feature could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps='handled'>
      <View style={styles.heading}>
        <Text variant='headlineSmall' style={styles.title}>Mobile home feature</Text>
        <Text style={styles.subtitle}>Control the editorial banner shown above the casket catalog.</Text>
      </View>

      <View style={styles.preview}>
        {imageUrl ? (
          <ImageBackground source={{ uri: imageUrl }} resizeMode='cover' style={styles.previewImage}>
            <View style={styles.previewOverlay}>
              <Text style={styles.previewTitle} numberOfLines={2}>{title || 'Feature title'}</Text>
              <Text style={styles.previewSubtitle} numberOfLines={3}>{subtitle || 'Supporting text'}</Text>
              <View style={styles.previewButton}><Text style={styles.previewButtonText}>{buttonLabel || 'Browse now'}</Text></View>
            </View>
          </ImageBackground>
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderTitle}>No banner photo selected</Text>
            <Text style={styles.photoPlaceholderText}>Use a landscape image with a clear subject and room for text.</Text>
          </View>
        )}
      </View>

      <View style={styles.photoActions}>
        <Button mode='outlined' icon='image-outline' onPress={() => void choosePhoto()} loading={uploading} disabled={loading || uploading || saving}>
          {imageUrl ? 'Replace photo' : 'Choose photo'}
        </Button>
        {imageUrl ? <Button mode='text' onPress={() => setImageUrl(null)} disabled={uploading || saving}>Remove</Button> : null}
      </View>

      <TextInput mode='outlined' label='Title' value={title} onChangeText={setTitle} maxLength={80} disabled={loading} style={styles.input} />
      <Text style={styles.characterCount}>{title.length}/80</Text>
      <TextInput mode='outlined' label='Supporting text' value={subtitle} onChangeText={setSubtitle} maxLength={160} multiline disabled={loading} style={styles.input} />
      <Text style={styles.characterCount}>{subtitle.length}/160</Text>
      <TextInput mode='outlined' label='Button label' value={buttonLabel} onChangeText={setButtonLabel} maxLength={30} disabled={loading} style={styles.input} />
      <Text style={styles.characterCount}>{buttonLabel.length}/30</Text>

      <Text style={styles.fieldLabel}>Button destination</Text>
      <SegmentedButtons
        value={target}
        onValueChange={(value) => setTarget(value as HomeHeroTarget)}
        buttons={[
          { value: 'shops', label: 'Funeral shops' },
          { value: 'catalog', label: 'Casket catalog' },
        ]}
        style={styles.segmented}
      />

      <View style={styles.visibilityRow}>
        <View style={styles.visibilityCopy}>
          <Text style={styles.visibilityTitle}>Show on customer home</Text>
          <Text style={styles.visibilityText}>{isActive ? 'Visible after you save.' : 'Saved as a hidden draft.'}</Text>
        </View>
        <Switch value={isActive} onValueChange={setIsActive} disabled={loading || saving} />
      </View>

      {updatedAt ? <Text style={styles.updatedText}>Last saved {new Date(updatedAt).toLocaleString(undefined, { hour12: true })}</Text> : null}
      <Button mode='contained' onPress={() => void save()} loading={saving} disabled={loading || uploading || saving} contentStyle={styles.saveButtonContent}>
        Save home feature
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl, backgroundColor: colors.surfaceWarm },
  heading: { marginBottom: spacing.lg },
  title: { color: colors.text, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 20, marginTop: spacing.xs },
  preview: { overflow: 'hidden', borderRadius: radii.xl, backgroundColor: colors.primaryDark, aspectRatio: 1.55 },
  previewImage: { flex: 1 },
  previewOverlay: { flex: 1, width: '72%', justifyContent: 'center', alignItems: 'flex-start', padding: spacing.lg, backgroundColor: 'rgba(20, 28, 26, 0.72)' },
  previewTitle: { color: colors.surface, fontSize: 20, lineHeight: 24, fontWeight: '800' },
  previewSubtitle: { color: '#eef1ec', fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  previewButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.surface, marginTop: spacing.md },
  previewButtonText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  photoPlaceholderTitle: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  photoPlaceholderText: { color: '#d9d6cd', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: spacing.sm },
  photoActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.lg },
  input: { backgroundColor: colors.surface, marginTop: spacing.sm },
  characterCount: { color: colors.textMuted, fontSize: 11, textAlign: 'right', marginTop: spacing.xs },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
  segmented: { marginBottom: spacing.lg },
  visibilityRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderWidth: 1, borderColor: colors.borderWarm, borderRadius: radii.md, backgroundColor: colors.surface },
  visibilityCopy: { flex: 1, paddingRight: spacing.md },
  visibilityTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  visibilityText: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },
  updatedText: { color: colors.textMuted, fontSize: 11, marginTop: spacing.lg },
  saveButtonContent: { minHeight: 48 },
  saveButton: { marginTop: spacing.md },
});
