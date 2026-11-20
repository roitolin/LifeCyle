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

const CHAT_MEDIA_BUCKET = 'chat-media';
const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_CHAT_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_CHAT_VIDEO_BYTES = 50 * 1024 * 1024;

export type ChatMediaType = 'image' | 'video' | 'audio' | 'file';

export type UploadedChatMedia = {
  mediaUrl: string;
  mediaType: ChatMediaType;
  mediaName: string;
  mediaDuration?: number | null;
};

export async function uploadChatMedia(
  uri: string,
  options: {
    mediaType: ChatMediaType;
    fileName?: string;
    mimeType?: string;
    durationSeconds?: number | null;
  }
): Promise<UploadedChatMedia> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to send attachments.');

  const { mediaType } = options;
  let uploadUri = uri;
  let contentType = options.mimeType || (
    mediaType === 'image'
      ? 'image/jpeg'
      : mediaType === 'video'
        ? 'video/mp4'
        : mediaType === 'audio'
          ? 'audio/mp4'
          : 'application/octet-stream'
  );
  let ext = (options.fileName || uri).split('?')[0].split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

  if (mediaType === 'image') {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1280 } }],
      { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG }
    );
    uploadUri = manipulated.uri;
    contentType = 'image/jpeg';
    ext = 'jpg';
  } else if (mediaType === 'video') {
    if (!['mp4', 'mov', 'webm', 'm4v', '3gp'].includes(ext)) ext = 'mp4';
    if (!contentType.startsWith('video/')) {
      contentType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
    }
  } else if (mediaType === 'audio') {
    if (!['m4a', 'mp3', 'wav', 'aac', '3gp', 'amr', 'ogg', 'webm'].includes(ext)) ext = 'm4a';
    if (!contentType.startsWith('audio/')) {
      contentType = ext === 'm4a' ? 'audio/mp4' : `audio/${ext}`;
    }
  } else {
    if (!ext || ext.length > 5) ext = 'bin';
  }

  const base64 = await FileSystem.readAsStringAsync(uploadUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binaryData = decodeBase64(base64);

  const maxBytes =
    mediaType === 'video'
      ? MAX_CHAT_VIDEO_BYTES
      : mediaType === 'audio'
        ? MAX_CHAT_AUDIO_BYTES
        : MAX_CHAT_IMAGE_BYTES;

  if (binaryData.byteLength > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw new Error(`This ${mediaType} is too large. Maximum size is ${maxMb} MB.`);
  }

  const objectName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
  const objectPath = `${userData.user.id}/${mediaType}/${objectName}`;
  const mediaName = options.fileName || `${mediaType}-${Date.now()}.${ext}`;

  let targetBucket = CHAT_MEDIA_BUCKET;
  let { error: uploadError } = await supabase.storage
    .from(targetBucket)
    .upload(objectPath, binaryData, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError && mediaType === 'image' && /bucket.*not found/i.test(uploadError.message)) {
    targetBucket = STORAGE_BUCKET;
    const fallbackPath = `service-media/${userData.user.id}/${objectName}`;
    const retry = await supabase.storage
      .from(targetBucket)
      .upload(fallbackPath, binaryData, {
        contentType,
        cacheControl: '3600',
        upsert: false,
      });
    uploadError = retry.error;
    if (!uploadError) {
      const { data } = supabase.storage.from(targetBucket).getPublicUrl(fallbackPath);
      return {
        mediaUrl: data.publicUrl,
        mediaType,
        mediaName,
        mediaDuration: options.durationSeconds ?? null,
      };
    }
  }

  if (uploadError) {
    throw new Error('Supabase Storage upload failed: ' + uploadError.message);
  }

  const { data } = supabase.storage.from(targetBucket).getPublicUrl(objectPath);
  if (!data.publicUrl) throw new Error('Supabase Storage did not return a media URL.');

  return {
    mediaUrl: data.publicUrl,
    mediaType,
    mediaName,
    mediaDuration: options.durationSeconds ?? null,
  };
}

