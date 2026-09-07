import { supabase } from '@/services/supabaseClient';

export type HomeHeroTarget = 'shops' | 'catalog';

export type HomeHeroContent = {
  id: number;
  title: string;
  subtitle: string;
  buttonLabel: string;
  imageUrl: string | null;
  target: HomeHeroTarget;
  isActive: boolean;
  updatedAt?: string;
};

type HomeHeroRow = {
  id: number;
  title: string;
  subtitle: string;
  button_label: string;
  image_url: string | null;
  target: HomeHeroTarget;
  is_active: boolean;
  updated_at?: string;
};

const HOME_HERO_ID = 1;

function mapHomeHero(row: HomeHeroRow): HomeHeroContent {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    buttonLabel: row.button_label,
    imageUrl: row.image_url,
    target: row.target,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}

export async function getHomeHeroContent(options?: { includeInactive?: boolean }) {
  let query = supabase
    .from('home_hero_content')
    .select('id,title,subtitle,button_label,image_url,target,is_active,updated_at')
    .eq('id', HOME_HERO_ID);

  if (!options?.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapHomeHero(data as HomeHeroRow) : null;
}

export async function saveHomeHeroContent(
  content: Omit<HomeHeroContent, 'id' | 'updatedAt'>,
  adminId: string,
) {
  const { data, error } = await supabase
    .from('home_hero_content')
    .upsert({
      id: HOME_HERO_ID,
      title: content.title.trim(),
      subtitle: content.subtitle.trim(),
      button_label: content.buttonLabel.trim(),
      image_url: content.imageUrl,
      target: content.target,
      is_active: content.isActive,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select('id,title,subtitle,button_label,image_url,target,is_active,updated_at')
    .single();

  if (error) throw error;
  return mapHomeHero(data as HomeHeroRow);
}
