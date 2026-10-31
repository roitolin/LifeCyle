export function getDefaultProfileAvatar(gender?: string | null) {
  const normalizedGender = String(gender || '').trim().toLowerCase()
  if (normalizedGender === 'female') return '/Female.png'
  if (normalizedGender === 'male') return '/Male.png'
  return '/Default.png'
}

export function getProfileAvatar(photoURL?: string | null, gender?: string | null) {
  return photoURL?.trim() || getDefaultProfileAvatar(gender)
}
