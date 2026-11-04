import AsyncStorage from '@react-native-async-storage/async-storage';

const TUTORIAL_STORAGE_KEY_PREFIX = '@lifecycle/app-walkthrough-completed-v1';

export async function hasCompletedAppTutorial(userId?: string | null): Promise<boolean> {
  try {
    const key = `${TUTORIAL_STORAGE_KEY_PREFIX}:${userId || 'guest'}`;
    const value = await AsyncStorage.getItem(key);
    return value === 'true';
  } catch {
    return false;
  }
}

export async function markAppTutorialCompleted(userId?: string | null): Promise<void> {
  try {
    const key = `${TUTORIAL_STORAGE_KEY_PREFIX}:${userId || 'guest'}`;
    await AsyncStorage.setItem(key, 'true');
  } catch (error) {
    console.warn('Failed to save app tutorial state:', error);
  }
}

export async function resetAppTutorial(userId?: string | null): Promise<void> {
  try {
    const key = `${TUTORIAL_STORAGE_KEY_PREFIX}:${userId || 'guest'}`;
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn('Failed to reset app tutorial state:', error);
  }
}
