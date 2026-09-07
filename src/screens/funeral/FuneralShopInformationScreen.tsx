import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Button as PaperButton } from "react-native-paper";
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
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.stepLabel}>Step 1 of 2</Text>
            <Text style={styles.title}>Shop Information</Text>
            <Text style={styles.subtitle}>Customers will see these details.</Text>

            <Text style={styles.label}>Shop Name *</Text>
            <TextInput style={styles.input} value={shopName} onChangeText={setShopName} />

            <Text style={styles.label}>Shop Address *</Text>
            <TextInput style={[styles.input, styles.multilineInput]} value={shopAddress} onChangeText={setShopAddress} multiline />

            <Text style={styles.label}>Phone Number *</Text>
            <TextInput style={styles.input} value={shopPhoneNumber} onChangeText={setShopPhoneNumber} keyboardType="phone-pad" />

            <PaperButton mode="contained" buttonColor="#5a6b64" onPress={handleNext} style={styles.primaryButton}>
              Next
            </PaperButton>
          </Card.Content>
        </Card>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  card: {
    borderRadius: 14,
  },
  stepLabel: {
    color: "#75807b",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
  },
  title: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 8,
  },
  subtitle: {
    color: "#66746f",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  label: {
    color: "#4c5b57",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd2cb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#ffffff",
    color: "#22312d",
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  primaryButton: {
    marginTop: 20,
    borderRadius: 10,
  },
});
