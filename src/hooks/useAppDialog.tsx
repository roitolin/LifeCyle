import { useMemo, useState } from "react";
import { View } from 'react-native';
import { Dialog, Portal, Text, Button } from "react-native-paper";
import { colors } from '@/theme';

type DialogAction = {
  label: string;
  onPress?: () => void | Promise<void>;
  mode?: "text" | "contained" | "outlined";
  pendingLabel?: string;
};

type DialogTone = 'default' | 'success' | 'danger' | 'warning' | 'session';

type DialogConfig = {
  title: string;
  message: string;
  tone?: DialogTone;
  actions?: DialogAction[];
};

const toneColors: Record<DialogTone, string> = {
  default: "#b91c1c",
  success: "#166534",
  danger: "#b91c1c",
  warning: "#92400e",
  session: colors.primary,
};

const sessionSurface = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
};

export function useAppDialog() {
  const [config, setConfig] = useState<DialogConfig | null>(null);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const closeDialog = () => {
    if (submittingAction) return;
    setConfig(null);
    setActionError('');
  };

  const showDialog = (nextConfig: DialogConfig) => {
    setSubmittingAction(null);
    setActionError('');
    setConfig({
      tone: "default",
      actions: [{ label: "OK", mode: "contained" }],
      ...nextConfig,
    });
  };

  const dialog = useMemo(
    () => {
      const tone = config?.tone || 'default';
      const isSessionDialog = tone === 'session';
      const accentColor = toneColors[tone];

      return <Portal>
        <Dialog
          visible={!!config}
          dismissable={!submittingAction}
          onDismiss={closeDialog}
          style={{
            width: isSessionDialog ? '88%' : undefined,
            maxWidth: isSessionDialog ? 390 : undefined,
            alignSelf: isSessionDialog ? 'center' : undefined,
            borderRadius: isSessionDialog ? 16 : 22,
            backgroundColor: isSessionDialog ? '#ffffff' : '#fffaf9',
            borderWidth: 1,
            borderColor: isSessionDialog ? '#d9dfe7' : '#fecaca',
          }}
        >
          <Dialog.Title style={{
            color: isSessionDialog ? '#22312d' : accentColor,
            fontWeight: '800',
            fontSize: isSessionDialog ? 16 : undefined,
            textAlign: isSessionDialog ? 'center' : undefined,
            paddingBottom: isSessionDialog ? 12 : undefined,
          }}>
            {config?.title}
          </Dialog.Title>
          {isSessionDialog ? <View style={{ height: 1, marginHorizontal: 20, backgroundColor: colors.border }} /> : null}
          <Dialog.Content style={{ paddingTop: isSessionDialog ? 18 : undefined }}>
            <Text style={{
              color: isSessionDialog ? colors.textMuted : '#4b5563',
              lineHeight: 22,
              textAlign: isSessionDialog ? 'center' : undefined,
            }}>{config?.message}</Text>
            {isSessionDialog && actionError ? (
              <Text
                accessibilityRole="alert"
                style={{
                  marginTop: 14,
                  paddingVertical: 9,
                  paddingHorizontal: 11,
                  borderWidth: 1,
                  borderColor: '#fecaca',
                  borderRadius: 8,
                  backgroundColor: '#fff7f7',
                  color: '#991b1b',
                  fontSize: 12,
                  lineHeight: 18,
                  textAlign: 'left',
                }}
              >
                {actionError}
              </Text>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions style={{
            paddingHorizontal: 20,
            paddingBottom: 20,
            gap: 10,
            justifyContent: isSessionDialog ? 'center' : undefined,
          }}>
            {(config?.actions || []).map((action) => {
              const isPending = submittingAction === action.label;
              return (
                <Button
                  key={action.label}
                  mode={action.mode || 'text'}
                  buttonColor={action.mode === 'contained' ? accentColor : undefined}
                  textColor={action.mode === 'contained' ? '#fff' : accentColor}
                  disabled={Boolean(submittingAction)}
                  loading={isPending}
                  onPress={async () => {
                    if (!isSessionDialog) {
                      closeDialog();
                      await action.onPress?.();
                      return;
                    }
                    if (!action.onPress) {
                      closeDialog();
                      return;
                    }
                    setActionError('');
                    setSubmittingAction(action.label);
                    try {
                      await action.onPress();
                      setConfig(null);
                    } catch {
                      setActionError('Could not log out. Please check your connection and try again.');
                    } finally {
                      setSubmittingAction(null);
                    }
                  }}
                  style={{
                    flex: isSessionDialog ? 1 : undefined,
                    maxWidth: isSessionDialog ? 140 : undefined,
                    borderRadius: isSessionDialog ? 8 : 12,
                    borderColor: isSessionDialog
                      ? action.mode === 'contained' ? colors.primary : '#b8c7c1'
                      : undefined,
                  }}
                  contentStyle={isSessionDialog ? { minHeight: 40 } : undefined}
                  labelStyle={isSessionDialog ? { fontSize: 14, fontWeight: '700' } : undefined}
                >
                  {isPending ? action.pendingLabel || action.label : action.label}
                </Button>
              );
            })}
          </Dialog.Actions>
        </Dialog>
      </Portal>;
    },
    [actionError, config, submittingAction]
  );

  return { showDialog, closeDialog, dialog };
}
