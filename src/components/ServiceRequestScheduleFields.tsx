import { useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { serializeDateOnly } from "@/utils/serviceRequestSchedule";

type Props = {
  wakeStartDate: Date | null;
  wakeEndDate: Date | null;
  burialTime: Date | null;
  onWakeStartDateChange: (value: Date) => void;
  onWakeEndDateChange: (value: Date) => void;
  onBurialTimeChange: (value: Date) => void;
  minimumWakeDate?: Date | null;
};

const formatDate = (value: Date | null, fallback: string) =>
  value
    ? value.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : fallback;

const formatTime = (value: Date | null) =>
  value
    ? value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    : "Select time";

export default function ServiceRequestScheduleFields({
  wakeStartDate,
  wakeEndDate,
  burialTime,
  onWakeStartDateChange,
  onWakeEndDateChange,
  onBurialTimeChange,
  minimumWakeDate,
}: Props) {
  const [activePicker, setActivePicker] = useState<"start" | "end" | "burial" | null>(null);

  const closeAndroidPicker = () => {
    if (Platform.OS !== "ios") setActivePicker(null);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Wake and burial schedule</Text>

      <Text style={styles.label}>Wake starts *</Text>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => setActivePicker(activePicker === "start" ? null : "start")}
        accessibilityRole="button"
        accessibilityLabel="Choose wake start date"
      >
        <Text style={[styles.pickerText, !wakeStartDate ? styles.placeholder : null]}>
          {formatDate(wakeStartDate, "Select date")}
        </Text>
        <Ionicons name="calendar-outline" size={18} color="#62706b" />
      </TouchableOpacity>
      {activePicker === "start" ? (
        <DateTimePicker
          value={wakeStartDate || minimumWakeDate || new Date()}
          mode="date"
          display="default"
          minimumDate={minimumWakeDate || undefined}
          onChange={(_event, selectedDate) => {
            closeAndroidPicker();
            if (!selectedDate) return;
            onWakeStartDateChange(selectedDate);
            const selectedKey = serializeDateOnly(selectedDate);
            const endKey = serializeDateOnly(wakeEndDate);
            if (selectedKey && endKey && endKey < selectedKey) onWakeEndDateChange(selectedDate);
          }}
        />
      ) : null}

      <Text style={styles.label}>Wake ends *</Text>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => setActivePicker(activePicker === "end" ? null : "end")}
        accessibilityRole="button"
        accessibilityLabel="Choose wake end date"
      >
        <Text style={[styles.pickerText, !wakeEndDate ? styles.placeholder : null]}>
          {formatDate(wakeEndDate, "Select date")}
        </Text>
        <Ionicons name="calendar-outline" size={18} color="#62706b" />
      </TouchableOpacity>
      {activePicker === "end" ? (
        <DateTimePicker
          value={wakeEndDate || wakeStartDate || minimumWakeDate || new Date()}
          mode="date"
          display="default"
          minimumDate={wakeStartDate || minimumWakeDate || undefined}
          onChange={(_event, selectedDate) => {
            closeAndroidPicker();
            if (selectedDate) onWakeEndDateChange(selectedDate);
          }}
        />
      ) : null}

      <Text style={styles.label}>Burial time *</Text>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => setActivePicker(activePicker === "burial" ? null : "burial")}
        accessibilityRole="button"
        accessibilityLabel="Choose burial time"
      >
        <Text style={[styles.pickerText, !burialTime ? styles.placeholder : null]}>{formatTime(burialTime)}</Text>
        <Ionicons name="time-outline" size={18} color="#62706b" />
      </TouchableOpacity>
      {activePicker === "burial" ? (
        <DateTimePicker
          value={burialTime || new Date()}
          mode="time"
          display="default"
          onChange={(_event, selectedTime) => {
            closeAndroidPicker();
            if (selectedTime) onBurialTimeChange(selectedTime);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 18, borderTopWidth: 1, borderTopColor: "#e5e8e3", paddingTop: 16 },
  heading: { color: "#22312d", fontSize: 15, fontWeight: "900" },
  label: { color: "#53615d", fontSize: 13, fontWeight: "800", marginBottom: 8, marginTop: 12 },
  pickerButton: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d2d7d1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pickerText: { flex: 1, color: "#263832", fontSize: 14, fontWeight: "600" },
  placeholder: { color: "#8a948f", fontWeight: "500" },
});
