import { useState, useEffect, useCallback } from "react";
import LoadingBird from '@/components/LoadingBird';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
} from "react-native";
import { Avatar, Card, Title, Divider, Button } from "react-native-paper";
import { supabase } from "@/services/supabaseClient";
import { auth } from "../../services/supabaseAuth";
import { useResponsive } from "../../utils/responsive";
import { getDefaultProfileImage } from "../../utils/defaultProfileImage";
import { ensureConversationForUsers } from "../../utils/chatHelpers";

type User = {
  id: string;
  email: string;
  fullName?: string;
  role?: string;
  disabled?: boolean;
  createdAt?: string;
  photoURL?: string;
  gender?: string;
  dateOfBirth?: string;
  contactNumber?: string;
  street?: string;
  availabilityStatus?: string;
  validIdURL?: string;
};

export default function AdminUserDetailScreen({ route, navigation }: any) {
  const { userId } = route.params;
  const fromChatConversation = Boolean(route.params?.fromChatConversation);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { isDesktop } = useResponsive();

  const loadUserAndRequests = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
      if (error) throw error;
      
      if (data) {
        setUser(data as User);
      } else {
        Alert.alert("Error", "User not found.");
        navigation.goBack();
        return;
      }

    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load user details.");
    } finally {
      setLoading(false);
    }
  }, [navigation, userId]);

  useEffect(() => {
    loadUserAndRequests();
  }, [loadUserAndRequests]);

  const callUser = () => {
    if (user?.contactNumber) {
      Linking.openURL(`tel:${user.contactNumber}`);
    } else {
      Alert.alert("No contact number", "This user has not provided a contact number.");
    }
  };

  const smsUser = () => {
    if (user?.contactNumber) {
      Linking.openURL(`sms:${user.contactNumber}`);
    } else {
      Alert.alert("No contact number", "This user has not provided a contact number.");
    }
  };

  const openValidId = async () => {
    if (!user?.validIdURL) {
      Alert.alert("No valid ID", "This user has not uploaded a valid ID.");
      return;
    }
    try {
      await Linking.openURL(user.validIdURL);
    } catch {
      Alert.alert("Error", "Unable to open valid ID.");
    }
  };

  const startConversation = async () => {
    if (!user) return;
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Error", "You must be logged in.");
      return;
    }

    const conversationId = await ensureConversationForUsers(supabase, currentUser.uid, user.id);
    navigation.navigate("Chat", {
      conversationId,
      otherUserId: user.id,
    });
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "N/A";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString();
  };

  if (loading) {
    return <LoadingBird fullScreen />;
  }

  if (!user) return null;

  return (
    <ScrollView contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}>
      {/* Profile Header */}
      <View style={styles.header}>
        {user.photoURL ? (
          <Avatar.Image size={100} source={{ uri: user.photoURL }} />
        ) : (
          <Avatar.Image size={100} source={getDefaultProfileImage(user.gender as any)} />
        )}
        <Title style={styles.name}>{user.fullName || "No name"}</Title>
        <Text style={styles.email}>{user.email}</Text>
        <Text selectable style={styles.uid}>UID: {user.id}</Text>
        <Text style={styles.role}>Role: {user.role || "user"}</Text>
        <Text style={styles.status}>
          Status: {user.disabled ? "Disabled" : "Active"}
        </Text>
      </View>

      <Divider />

      {/* Personal Information */}
      <Card style={styles.card}>
        <Card.Title title="Personal Information" />
        <Card.Content>
          <Text>Gender: {user.gender || "Not specified"}</Text>
          <Text>Date of Birth: {user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : "N/A"}</Text>
          <Text>Contact: {user.contactNumber || "Not provided"}</Text>
          <Text>Created: {formatDate(user.createdAt)}</Text>
        </Card.Content>
      </Card>

      {/* Verification Information */}
      <Card style={styles.card}>
        <Card.Title title="Verification Information" />
        <Card.Content>
          <Text>Location: {user.street || "N/A"}</Text>
          {user.validIdURL ? (
            <Button mode="outlined" onPress={openValidId} style={{ marginTop: 8 }}>
              View Valid ID
            </Button>
          ) : (
            <Text>Valid ID: Not uploaded</Text>
          )}
        </Card.Content>
      </Card>

      {/* Action Buttons */}
      <View style={styles.buttonGroup}>
        <Button mode="contained" buttonColor="#b91c1c" onPress={callUser} style={styles.actionButton} icon="phone">
          Call
        </Button>
        <Button mode="contained" buttonColor="#b91c1c" onPress={smsUser} style={styles.actionButton} icon="message-text">
          SMS
        </Button>
        {!fromChatConversation && (
          <Button mode="contained" buttonColor="#7f1d1d" onPress={startConversation} style={styles.actionButton} icon="chat">
            Chat
          </Button>
        )}
      </View>

      <Button mode="outlined" onPress={() => navigation.goBack()} style={styles.backButton}>
        Back
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { alignItems: "center", marginBottom: 20 },
  name: { fontSize: 24, marginTop: 12 },
  email: { fontSize: 16, color: "#666", marginTop: 4 },
  uid: { fontSize: 12, color: "#4f46e5", fontWeight: "700", marginTop: 3 },
  role: { fontSize: 14, color: "#888", marginTop: 2 },
  status: { fontSize: 14, color: "#d32f2f", marginTop: 2 },
  card: { marginBottom: 16 },
  requestItem: { marginBottom: 8 },
  patientName: { fontSize: 16, fontWeight: "bold" },
  date: { fontSize: 12, color: "#888", marginTop: 4 },
  buttonGroup: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 16,
    marginBottom: 8,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  backButton: { marginTop: 8 },
  containerDesktop: { maxWidth: 800, alignSelf: "center", width: "100%" },
});
