import { useMemo, useState } from "react";
import { Dialog, Portal, Text, Button } from "react-native-paper";

type DialogAction = {
  label: string;
  onPress?: () => void | Promise<void>;
  mode?: "text" | "contained" | "outlined";
};

type DialogTone = "default" | "success" | "danger" | "warning";

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
    () => (
      <Portal>
        <Dialog
          visible={!!config}
          onDismiss={closeDialog}
          style={{
            borderRadius: 22,
            backgroundColor: "#fffaf9",
            borderWidth: 1,
            borderColor: "#fecaca",
          }}
        >
          <Dialog.Title style={{ color: toneColors[config?.tone || "default"], fontWeight: "800" }}>
            {config?.title}
          </Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: "#4b5563", lineHeight: 22 }}>{config?.message}</Text>
          </Dialog.Content>
          <Dialog.Actions style={{ paddingHorizontal: 20, paddingBottom: 18, gap: 8 }}>
            {(config?.actions || []).map((action) => (
              <Button
                key={action.label}
                mode={action.mode || "text"}
                buttonColor={action.mode === "contained" ? toneColors[config?.tone || "default"] : undefined}
                textColor={action.mode === "contained" ? "#fff" : toneColors[config?.tone || "default"]}
                onPress={async () => {
                  closeDialog();
                  await action.onPress?.();
                }}
                style={{ borderRadius: 12 }}
              >
                {action.label}
              </Button>
            ))}
          </Dialog.Actions>
        </Dialog>
      </Portal>
    ),
    [config]
  );

  return { showDialog, closeDialog, dialog };
}
