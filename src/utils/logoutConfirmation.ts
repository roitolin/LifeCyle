type ShowDialog = (config: {
  title: string;
  message: string;
  tone?: 'session' | 'danger';
  actions?: {
    label: string;
    mode?: 'text' | 'contained' | 'outlined';
    onPress?: () => void | Promise<void>;
  }[];
}) => void;

type ConfirmLogoutParams = {
  logout: () => Promise<void>;
  showDialog: ShowDialog;
  onError?: (error: unknown) => void;
};

export function confirmLogout({ logout, showDialog, onError }: ConfirmLogoutParams) {
  showDialog({
    title: 'Log Out',
    message: 'Are you sure you want to log out?',
    tone: 'session',
    actions: [
      { label: 'Cancel', mode: 'outlined' },
      {
        label: 'Log Out',
        mode: 'contained',
        onPress: async () => {
          try {
            await logout();
          } catch (error) {
            if (onError) {
              onError(error);
              return;
            }
            showDialog({
              title: 'Could not log out',
              message: error instanceof Error ? error.message : 'Please try again.',
              tone: 'danger',
            });
          }
        },
      },
    ],
  });
}
