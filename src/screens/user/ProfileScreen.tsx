import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import AccountSwitcher from '@/components/AccountSwitcher';
import { KeyboardAwareScrollView } from "@/components";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/services/supabaseClient";
import { auth } from "@/services/supabaseAuth";
import { useResponsive } from "@/utils/responsive";

const defaultProfile = require("../../../assets/Male_Default_Profile.png");

type ActionRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
  showChevron?: boolean;
};

type ShopStatus = "none" | "pending" | "verified" | "live" | "offline" | "rejected";

const hasShopCenterAccess = (status: ShopStatus) =>
  status === "verified" || status === "live" || status === "offline";

const getShopStatus = (shop: { status?: string | null } | null): ShopStatus => {
  if (!shop) return "none";

  const status = String(shop.status || "pending").toLowerCase();
  if (["pending", "verified", "live", "offline", "rejected"].includes(status)) {
    return status as ShopStatus;
  }

  return "pending";
};

export default function ProfileScreen({ navigation }: any) {
  const { isDesktop } = useResponsive();
  const { logout, user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [shopStatus, setShopStatus] = useState<ShopStatus>("none");
  const [checkingShopAccess, setCheckingShopAccess] = useState(false);

  const loadProfile = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLoadingProfile(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("fullName, email, photoURL")
        .eq("id", user.uid)
        .single();
      if (error) throw error;
      setFullName(String(data.fullName || ""));
      setEmail(String(data.email || user.email || ""));
      setPhotoURL(data.photoURL || null);

      const { data: shopData, error: shopError } = await supabase
        .from("funeral_shops")
        .select("status")
        .eq("id", user.uid)
        .maybeSingle();
      if (shopError) throw shopError;
      setShopStatus(getShopStatus(shopData));
    } catch {
      setFullName(user.displayName || "");
      setEmail(user.email || "");
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadProfile();
  }, [loadProfile]));

  const handleShopCenterPress = async () => {
    if (checkingShopAccess) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Sign In Required", "Please sign in before registering or managing a shop.");
      return;
    }

    setCheckingShopAccess(true);
    try {
      const { data: shopData, error } = await supabase
        .from("funeral_shops")
        .select("*")
        .eq("id", currentUser.uid)
        .maybeSingle();
      if (error) throw error;

      const currentStatus = getShopStatus(shopData);
      setShopStatus(currentStatus);

      if (currentStatus === "none") {
        navigation.navigate("ShopInformation");
        return;
      }

      if (currentStatus === "rejected") {
        Alert.alert(
          "Registration Needs Changes",
          shopData?.rejectionReason || "Update your shop information and submit it again for admin verification.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Update Registration",
              onPress: () => navigation.navigate("ShopInformation", { draft: shopData }),
            },
          ],
        );
        return;
      }

      if (!hasShopCenterAccess(currentStatus)) {
        Alert.alert(
          "Registration Under Review",
          "Your shop registration must be verified by an administrator before you can access Shop Center.",
        );
        return;
      }

      navigation.navigate("ShopCenter");
    } catch (error) {
      console.error("Failed to check shop access:", error);
      Alert.alert("Unable to Check Shop", "Please check your connection and try again.");
    } finally {
      setCheckingShopAccess(false);
    }
  };

  const shopActionDescription =
    shopStatus === "pending"
      ? "Registration awaiting admin verification"
      : shopStatus === "rejected"
        ? "Update and resubmit your registration"
        : hasShopCenterAccess(shopStatus)
          ? "Manage your verified funeral shop"
          : "Register your funeral shop";

  const confirmLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          try {
            await logout();
          } catch {
            Alert.alert("Logout failed", "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}
    >
      <TouchableOpacity
        accessibilityRole='button'
        accessibilityLabel='Edit personal information'
        onPress={() => navigation.navigate('ManageProfile')}
        style={styles.identityCard}
      >
        <View style={styles.identityPhoto}>
          {loadingProfile ? (
            <ActivityIndicator color="#41514d" />
          ) : (
            <Image source={photoURL ? { uri: photoURL } : defaultProfile} style={styles.identityImage} resizeMode="cover" />
          )}
        </View>
        <View style={styles.identityCopy}>
          <Text numberOfLines={1} style={styles.identityName}>{fullName || "LifeCycle User"}</Text>
          <Text numberOfLines={1} style={styles.identityEmail}>{email || "No email available"}</Text>
        </View>
        <View style={styles.identityEdit}>
          <Text style={styles.identityEditText}>Edit</Text>
          <Ionicons name='chevron-forward' size={15} color='#62706b' />
        </View>
      </TouchableOpacity>

      <SettingsSection label='Services & Payments'>
        <ActionRow
          icon='storefront-outline'
          label='Shop Center'
          description={checkingShopAccess ? 'Checking shop access...' : shopActionDescription}
          onPress={() => void handleShopCenterPress()}
        />
        <ActionRow
          icon='document-text-outline'
          label='My Service Requests'
          description='Track requests sent to funeral shops'
          onPress={() => navigation.navigate('MyServiceRequests')}
        />
        <ActionRow
          icon='wallet-outline'
          label='My Payments'
          description='View your payment status and history'
          onPress={() => navigation.navigate('UserPayments')}
          last
        />
      </SettingsSection>

      <SettingsSection label='Security & Privacy'>
        <ActionRow
          icon='shield-checkmark-outline'
          label='Account Settings'
          description='Password, blocking, and account activity'
          onPress={() => navigation.navigate('AccountSecurity')}
        />
        <ActionRow
          icon='finger-print-outline'
          label='Privacy & Data'
          description='Export your data or request account deletion'
          onPress={() => navigation.navigate('PrivacyData')}
          last
        />
      </SettingsSection>

      <SettingsSection label='Preferences'>
        <ActionRow
          icon='megaphone-outline'
          label='Announcements'
          description='Read news and important LifeCycle updates'
          onPress={() => navigation.navigate('Announcements')}
        />
        <ActionRow
          icon='notifications-outline'
          label='Notification Preferences'
          description='Choose the updates and sounds you receive'
          onPress={() => navigation.navigate('NotificationPreferences')}
          last
        />
      </SettingsSection>

      <SettingsSection label='Help & Information'>
        <ActionRow icon='information-circle-outline' label='About LifeCycle' onPress={() => navigation.navigate('AboutUs')} />
        <ActionRow icon='star-outline' label='Rate & Feedback' onPress={() => navigation.navigate('AppFeedback')} />
        <ActionRow icon='help-circle-outline' label='Help Center' description='Contact LifeCycle support' onPress={() => navigation.navigate('Contact')} />
        <ActionRow icon='shield-outline' label='Privacy Policy' onPress={() => navigation.navigate('PrivacyPolicy')} />
        <ActionRow icon='document-text-outline' label='Terms of Use' onPress={() => navigation.navigate('TermsOfUse')} last />
      </SettingsSection>

      <SettingsSection label='Session'>
        <AccountSwitcher
          currentAccount={{
            id: user?.id || auth.currentUser?.uid || '',
            email: email || user?.email || '',
            fullName: fullName || user?.displayName || '',
            photoURL,
          }}
          onAddAccount={() => navigation.navigate('Login', { addAccount: true })}
          onManageAccounts={() => navigation.navigate('ManageDeviceAccounts')}
        />
        <ActionRow icon='log-out-outline' label='Log Out' onPress={confirmLogout} danger showChevron={false} last />
      </SettingsSection>
    </KeyboardAwareScrollView>
  );
}

function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.menuGroup}>{children}</View>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  description,
  onPress,
  danger = false,
  last = false,
  showChevron = true,
}: ActionRowProps) {
  const color = danger ? "#b4232c" : "#41514d";
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={[styles.actionRow, last && styles.lastRow]}>
      <View style={[styles.actionIcon, danger && styles.dangerIcon]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionLabel, danger && styles.dangerText]}>{label}</Text>
        {description ? <Text style={styles.actionDescription}>{description}</Text> : null}
      </View>
      {showChevron ? <Ionicons name="chevron-forward" size={18} color="#8a928d" /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef1ec",
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 120,
    gap: 20,
  },
  containerDesktop: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  sectionLabel: {
    color: "#62706b",
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 2,
    marginBottom: 8,
  },
  identityCard: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
  },
  identityPhoto: {
    width: 58,
    height: 58,
    borderRadius: 29,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ebf1e8",
  },
  identityImage: {
    width: "100%",
    height: "100%",
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    color: "#22312d",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
  },
  identityEmail: {
    color: "#8a928d",
    fontSize: 11,
    marginTop: 2,
  },
  identityEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: '#ebf1e8',
  },
  identityEditText: {
    color: '#41514d',
    fontSize: 11,
    fontWeight: '800',
  },
  menuGroup: {
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d6cd",
    backgroundColor: "#ffffff",
  },
  actionRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e7e5df",
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ebf1e8",
  },
  dangerIcon: {
    backgroundColor: "#fff0f0",
  },
  actionLabel: {
    color: "#22312d",
    fontSize: 14,
    fontWeight: "700",
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
  },
  actionDescription: {
    color: '#8a928d',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  dangerText: {
    color: "#b4232c",
  },
});
