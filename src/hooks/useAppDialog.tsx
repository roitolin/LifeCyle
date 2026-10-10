import { useMemo, useState } from "react";
import { View } from 'react-native';
import { Dialog, Portal, Text, Button } from "react-native-paper";
import { colors } from '@/theme';

type DialogAction = {
  label: string;
  onPress?: () => void | Promise<void>;
  mode?: "text" | "contained" | "outlined";
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

  const closeDialog = () => setConfig(null);

  const showDialog = (nextConfig: DialogConfig) => {
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
          onDismiss={closeDialog}
          style={{
            width: isSessionDialog ? '88%' : undefined,
            maxWidth: isSessionDialog ? 360 : undefined,
            alignSelf: isSessionDialog ? 'center' : undefined,
            borderRadius: isSessionDialog ? 12 : 22,
            backgroundColor: isSessionDialog ? sessionSurface.backgroundColor : '#fffaf9',
            borderWidth: 1,
            borderColor: isSessionDialog ? sessionSurface.borderColor : '#fecaca',
          }}
        >
          <Dialog.Title style={{
            color: accentColor,
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
          </Dialog.Content>
          <Dialog.Actions style={{
            paddingHorizontal: 20,
            paddingBottom: 18,
            gap: 8,
            justifyContent: isSessionDialog ? 'center' : undefined,
          }}>
            {(config?.actions || []).map((action) => (
              <Button
                key={action.label}
                mode={action.mode || 'text'}
                buttonColor={action.mode === 'contained' ? accentColor : undefined}
                textColor={action.mode === 'contained' ? '#fff' : accentColor}
                onPress={async () => {
                  closeDialog();
                  await action.onPress?.();
                }}
                style={{
                  flex: isSessionDialog ? 1 : undefined,
                  borderRadius: isSessionDialog ? 7 : 12,
                  borderColor: isSessionDialog ? colors.border : undefined,
                }}
              >
                {action.label}
              </Button>
            ))}
          </Dialog.Actions>
        </Dialog>
      </Portal>;
    },
    [config]
  );

  return { showDialog, closeDialog, dialog };
}
