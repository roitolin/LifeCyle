export function getDefaultProfileAvatar(gender?: string | null) {
  return String(gender || '').trim().toLowerCase() === 'female'
    ? '/Female.png'
    : '/Male.png'
}

export function getProfileAvatar(photoURL?: string | null, gender?: string | null) {
  return photoURL?.trim() || getDefaultProfileAvatar(gender)
}
