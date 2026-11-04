import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabaseClient';

const STORAGE_BUCKET = 'avatars';
const DEATH_CERTIFICATE_BUCKET = 'death-certificates';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type UploadFolder = 'profiles' | 'service-media' | 'report-evidence' | 'home-content' | 'shops';

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

export const uploadShopImage = (uri: string) =>
  uploadImageToSupabase(uri, 'shops');

export const uploadCertificate = (uri: string) =>
  uploadImageToSupabase(uri, 'service-media');

export async function uploadBalancePaymentReceipt(requestId: string, uri: string): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Sign in before uploading a receipt.');
  const image = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
    compress: 0.8, format: ImageManipulator.SaveFormat.JPEG,
  });
  const base64 = await FileSystem.readAsStringAsync(image.uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = decodeBase64(base64);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Choose a receipt image smaller than 10 MB.');
  const storagePath = `${requestId}/${data.user.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error: uploadError } = await supabase.storage.from('funeral-balance-receipts').upload(storagePath, bytes, {
    contentType: 'image/jpeg', upsert: false,
  });
  if (uploadError) throw uploadError;
  return storagePath;
}

const DIGITAL_RECEIPT_FALLBACK_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0d' +
  'Hx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4e' +
  'Hh4eHh4eHh4eHh7/wAARCAEAAHgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA' +
  '/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCSAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=';

export async function uploadDigitalBalanceReceipt(
  requestId: string,
  _details?: {
    amount?: number | string;
    channelLabel?: string;
    reference?: string;
    payerName?: string;
    shopName?: string;
    productName?: string;
  }
): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Sign in before uploading a receipt.');

  const tempUri = `${FileSystem.cacheDirectory || ''}receipt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
  try {
    await FileSystem.writeAsStringAsync(tempUri, DIGITAL_RECEIPT_FALLBACK_BASE64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return await uploadBalancePaymentReceipt(requestId, tempUri);
  } finally {
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {
      // ignore temporary cache cleanup failure
    }
  }
}

export type SecureVaultUpload = {
  storagePath: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
};

export async function uploadDeathCertificateToVault(
  documentId: string,
  uri: string,
  originalFileName = 'Death Certificate.jpg'
): Promise<SecureVaultUpload> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to upload a Death Certificate.');

  const preparedImage = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 2000 } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
  );
  const base64 = await FileSystem.readAsStringAsync(preparedImage.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const imageData = decodeBase64(base64);
  if (imageData.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('The Death Certificate must be smaller than 10 MB.');
  }

  const objectName = Date.now() + '-' + Math.random().toString(16).slice(2) + '.jpg';
  const storagePath = documentId + '/' + userData.user.id + '/' + objectName;
  const { error: uploadError } = await supabase.storage
    .from(DEATH_CERTIFICATE_BUCKET)
    .upload(storagePath, imageData, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadError) {
    throw new Error('Secure vault upload failed: ' + uploadError.message);
  }

  return {
    storagePath,
    originalFileName,
    mimeType: 'image/jpeg',
    fileSizeBytes: imageData.byteLength,
  };
}

export const uploadReportEvidence = (uri: string) =>
  uploadImageToSupabase(uri, 'report-evidence');

export const uploadHomeHeroImage = (uri: string) =>
  uploadImageToSupabase(uri, 'home-content');
