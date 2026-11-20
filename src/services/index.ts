export { auth, db } from "./supabaseAuth";
export { supabase } from "./supabaseClient";
export {
  uploadCertificate,
  uploadProfilePicture,
  uploadShopImage,
  uploadReportEvidence,
  uploadHomeHeroImage,
  uploadChatMedia,
  type ChatMediaType,
  type UploadedChatMedia,
} from './supabaseStorage';
