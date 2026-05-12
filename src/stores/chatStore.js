import { create } from 'zustand';
import { db } from '../services/firebase';
import { ref as dbRef, onChildAdded, off, push } from "firebase/database";

export const useChatStore = create((set, get) => ({
  messages: [],
  seenMessageIds: {},
  fullChatLog: [],
  streamStartTime: null,
  currentChatListener: null,
  currentVideoId: null,

  addMessage: (message) => {
    const { seenMessageIds, calculateVideoTime } = get();
    if (seenMessageIds[message.id]) {
      console.log("⚠️ Duplicate message:", message.id);
      return;
    }

    set((state) => {
      const newSeenMessageIds = { ...state.seenMessageIds, [message.id]: true };
      
      // Create new message object
      const newMsgObj = {
        id: message.id,
        author: message.authorName,
        comment: message.text,
        videoTime: get().calculateVideoTime(message.timestamp),
        messageTime: new Date(message.timestamp).toLocaleString("en-US"),
        displayName: message.displayName || message.authorName,
        realName: message.realName || message.displayName || message.authorName,
        text: message.text,
        timestamp: message.timestamp,
        // Preserve all other properties from processMessage
        ...message 
      };

      // Merge and Sort by timestamp
      const allMessages = [...state.messages, newMsgObj].sort((a, b) => a.timestamp - b.timestamp);
      
      const newFullChatLog = [
        ...state.fullChatLog,
        newMsgObj
      ].sort((a, b) => a.timestamp - b.timestamp);

      return {
        messages: allMessages,
        seenMessageIds: newSeenMessageIds,
        fullChatLog: newFullChatLog
      };
    });
  },

  calculateVideoTime: (timestamp) => {
    const { streamStartTime } = get();
    if (!streamStartTime) return "0:00";
    const diffMs = timestamp - streamStartTime;
    if (diffMs < 0) return "0:00";

    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  },

  clearChat: () => {
    set({
      messages: [],
      seenMessageIds: {},
      fullChatLog: [],
      streamStartTime: null
    });
    console.log("🗑️ Chat & Logs cleared completely");
  },

  downloadChatCSV: (videoId) => {
    const { fullChatLog } = get();
    if (fullChatLog.length === 0) {
      alert("ไม่มีข้อมูลแชท");
      return;
    }

    let csvContent = "\uFEFF\"Id\",\"Author name\",\"Comment\",\"Video time\",\"Message time\"\n";

    fullChatLog.forEach((row) => {
      const safeId = row.id ? String(row.id).replace(/"/g, '""') : "";
      const safeComment = row.comment ? String(row.comment).replace(/"/g, '""') : "";
      const safeAuthor = row.author ? String(row.author).replace(/"/g, '""') : "";
      const safeVideoTime = row.videoTime ? String(row.videoTime).replace(/"/g, '""') : "";
      const safeMessageTime = row.messageTime ? String(row.messageTime).replace(/"/g, '""') : "";

      csvContent += `"${safeId}","${safeAuthor}","${safeComment}","${safeVideoTime}","${safeMessageTime}"\n`;   
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `chat_log_${videoId}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  syncFromFirebase: (videoId) => {
    if (!videoId) {
      console.warn("⚠️ No videoId provided for chat sync");
      return;
    }

    const { currentVideoId, currentChatListener, clearChat } = get();

    if (currentVideoId && currentVideoId !== videoId) {
      console.log(`🔄 Switching video from ${currentVideoId} to ${videoId}. Clearing chat...`);
      clearChat();
    }

    if (currentChatListener && currentVideoId !== videoId) {
      console.log(`🧹 Cleaning up old chat listener for ${currentVideoId}`);
      const oldRef = dbRef(db, `chats/${currentVideoId}`);
      off(oldRef, "child_added", currentChatListener);
      set({ currentChatListener: null });
    }

    set({ currentVideoId: videoId });
    const chatRef = dbRef(db, `chats/${videoId}`);

    console.log(`🔥 Starting Firebase chat sync for: ${videoId}`);

    const listener = onChildAdded(chatRef, (snapshot) => {
      const messageData = snapshot.val();
      if (messageData) {
        get().addMessage(messageData);
      }
    });

    set({ currentChatListener: listener });

    return () => {
      console.log(`🧹 Cleaning up chat listener for ${videoId}`);
      off(chatRef, "child_added", listener);
      set({ currentChatListener: null });
    };
  },

  sendMessageToFirebase: async (videoId, messageData) => {
    if (!videoId) {
      console.warn("⚠️ Cannot send message: No videoId provided");
      return;
    }

    try {
      const chatRef = dbRef(db, `chats/${videoId}`);
      await push(chatRef, messageData);
    } catch (error) {
      console.error("❌ Error sending message to Firebase:", error);
      throw error;
    }
  }
}));
