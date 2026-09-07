import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabaseClient';

const STORAGE_BUCKET = 'avatars';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type UploadFolder = 'profiles' | 'service-media' | 'report-evidence' | 'home-content';

function decodeBase64(value: string) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function uploadImageToSupabase(uri: string, folder: UploadFolder): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to upload an image.');

  const manipulatedImage = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
  );
  const base64 = await FileSystem.readAsStringAsync(manipulatedImage.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const imageData = decodeBase64(base64);

  if (imageData.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('The image is too large. Please choose an image smaller than 10 MB.');
  }

  const objectName =
    Date.now() + '-' + Math.random().toString(16).slice(2) + '.jpg';
  const objectPath = folder + '/' + userData.user.id + '/' + objectName;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, imageData, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    throw new Error('Supabase Storage upload failed: ' + uploadError.message);
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  if (!data.publicUrl) throw new Error('Supabase Storage did not return an image URL.');
  return data.publicUrl;
}

export const uploadProfilePicture = (uri: string) =>
  uploadImageToSupabase(uri, 'profiles');

export const uploadCertificate = (uri: string) =>
  uploadImageToSupabase(uri, 'service-media');

export const uploadReportEvidence = (uri: string) =>
  uploadImageToSupabase(uri, 'report-evidence');

export const uploadHomeHeroImage = (uri: string) =>
  uploadImageToSupabase(uri, 'home-content');
