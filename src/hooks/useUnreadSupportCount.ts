import { useState, useEffect } from "react";
import { collection, query, where, onSnapshot } from "@/services/supabaseDbCompat";
import { auth, db } from "../services/supabaseAuth";

export function useUnreadSupportCount() {
  const [unreadCount, setUnreadCount] = useState(0);
  const userId = auth.currentUser?.uid;

  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", userId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let count = 0;
      snapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        if (data.hiddenFor?.includes(userId)) return;
        if (data.unreadFor?.includes(userId)) {
          count++;
          return;
        }
        const lastMessage = data.lastMessage;
        if (
          lastMessage &&
          lastMessage.senderId !== userId &&
          (!lastMessage.readBy || !lastMessage.readBy.includes(userId))
        ) {
          count++;
        }
      });
      setUnreadCount(count);
    });

    return unsubscribe;
  }, [userId]);

  return unreadCount;
}
