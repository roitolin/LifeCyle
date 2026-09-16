import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button as PaperButton } from "react-native-paper";
import { KeyboardAwareScrollView } from "@/components";
import { sanitizePlainText } from "@/utils/inputSecurity";

const SHOP_NAME_MAX = 120;
const SHOP_ADDRESS_MAX = 220;
const SHOP_PHONE_MAX = 24;

export default function FuneralShopInformationScreen({ navigation, route }: any) {
  const existingDraft = route.params?.draft || {};
  const [shopName, setShopName] = useState(existingDraft.shopName || "");
  const [shopAddress, setShopAddress] = useState(existingDraft.shopAddress || "");
  const [shopPhoneNumber, setShopPhoneNumber] = useState(existingDraft.shopPhoneNumber || "");

  const handleNext = () => {
    const safeShopName = sanitizePlainText(shopName, SHOP_NAME_MAX);
    const safeShopAddress = sanitizePlainText(shopAddress, SHOP_ADDRESS_MAX);
    const safeShopPhoneNumber = sanitizePlainText(shopPhoneNumber, SHOP_PHONE_MAX);

    if (!safeShopName || !safeShopAddress || !safeShopPhoneNumber) {
      Alert.alert("Missing fields", "Please complete Shop name, Shop address, and phone number.");
      return;
    }

    navigation.navigate("BusinessInformation", {
      draft: {
        ...existingDraft,
        shopName: safeShopName,
        shopAddress: safeShopAddress,
        shopPhoneNumber: safeShopPhoneNumber,
      },
    });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.pageContent}>
          <View style={styles.stepRow}>
            <Text style={styles.stepLabel}>SHOP REGISTRATION</Text>
            <Text style={styles.stepCount}>1 of 2</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={styles.progressHalf} />
          </View>

          <View style={styles.heading}>
            <Text style={styles.title}>Shop information</Text>
            <Text style={styles.subtitle}>Enter the public details customers will use to identify and contact your shop.</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Shop name <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={shopName}
                onChangeText={setShopName}
                placeholder="Enter the registered shop name"
                placeholderTextColor="#8b948f"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Shop address <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={shopAddress}
                onChangeText={setShopAddress}
                placeholder="Enter the complete shop address"
                placeholderTextColor="#8b948f"
                multiline
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Phone number <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={shopPhoneNumber}
                onChangeText={setShopPhoneNumber}
                placeholder="Enter a customer contact number"
                placeholderTextColor="#8b948f"
                keyboardType="phone-pad"
              />
            </View>
          </View>

          <PaperButton
            mode="contained"
            buttonColor="#405b52"
            onPress={handleNext}
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
            labelStyle={styles.primaryButtonLabel}
          >
            Next
          </PaperButton>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f7f8f5",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 48,
  },
  pageContent: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepLabel: {
    color: "#5c6f68",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  stepCount: {
    color: "#b6463d",
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 3,
    marginTop: 10,
    overflow: "hidden",
    borderRadius: 2,
    backgroundColor: "#dce2dd",
  },
  progressHalf: {
    width: "50%",
    height: "100%",
    backgroundColor: "#405b52",
  },
  heading: {
    marginTop: 34,
    marginBottom: 28,
  },
  title: {
    color: "#1f2d29",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  subtitle: {
    maxWidth: 520,
    marginTop: 9,
    color: "#66736e",
    fontSize: 15,
    lineHeight: 22,
  },
  form: {
    gap: 20,
  },
  field: {
    gap: 8,
  },
  label: {
    color: "#30433d",
    fontSize: 14,
    fontWeight: "700",
  },
  required: {
    color: "#b6463d",
  },
  input: {
    borderWidth: 1,
    borderColor: "#c7d0ca",
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 15,
    paddingVertical: 13,
    backgroundColor: "#ffffff",
    color: "#1f2d29",
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 108,
    textAlignVertical: "top",
  },
  primaryButton: {
    marginTop: 32,
    borderRadius: 12,
  },
  primaryButtonContent: {
    minHeight: 52,
  },
  primaryButtonLabel: {
    fontSize: 15,
    fontWeight: "800",
  },
});
