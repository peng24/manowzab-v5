import { useState, useRef, useEffect } from 'react';
import { useSystemStore } from "../stores/systemStore";
import { ref as dbRef, set } from "firebase/database";
import { db } from "../services/firebase";
import { YouTubeLiveChat } from "../services/YouTubeLiveChat";
import { useAudio } from "./useAudio";
import { useChatProcessor } from "./useChatProcessor";
import { CONSTANTS } from "../config/constants";

const rawKeys = "AIzaSyAVzYQN51V-kITnyJWGy8IVSktitxrVD8g,AIzaSyBlnw6tpETYu61XSNqd7zXt25Fv_vmbWJU,AIzaSyAX3dwUqBFeCBjjZixVnlcBz56gAfNWzs0,AIzaSyAxjRAs01mpt-NxQiR3yStr6Q-57EiQq64,AIzaSyDDFimNW1OAMm8sOI0xFdKLv2Gk4SzxlFw,AIzaSyCR9yuYfig6jJIhVoWUZGKzY5hkT3DpJmM";
const API_KEYS = rawKeys
  .split(",")
  .map((k) => k.trim())
  .filter((k) => k);

if (API_KEYS.length === 0) {
  throw new Error("Missing YouTube API Keys");
}

const STORAGE_KEY = "ytApiKeyIndex";
function getNextKeyIndex() {
  const lastIndex = parseInt(localStorage.getItem(STORAGE_KEY) || "0");
  const nextIndex = (lastIndex + 1) % API_KEYS.length;
  localStorage.setItem(STORAGE_KEY, String(nextIndex));
  console.log(
    `🔑 Round-Robin: เริ่มจาก Key #${nextIndex + 1}/${API_KEYS.length} (ครั้งก่อนใช้ #${lastIndex + 1})`,
  );
  return nextIndex;
}

function saveKeyIndex(index) {
  localStorage.setItem(STORAGE_KEY, String(index));
}

export function useYouTube() {
  const { queueAudio } = useAudio();
  const { processMessage } = useChatProcessor();
  const [activeChatId, setActiveChatId] = useState("");
  const viewerIntervalId = useRef(null);
  const chatServiceRef = useRef(null);

  if (!chatServiceRef.current) {
    const initialKeyIndex = getNextKeyIndex();
    chatServiceRef.current = new YouTubeLiveChat(API_KEYS, initialKeyIndex);
    useSystemStore.setState({ currentKeyIndex: initialKeyIndex });
  }

  const chatService = chatServiceRef.current;

  chatService.onKeyRotate = (newIndex) => {
    useSystemStore.setState({ currentKeyIndex: newIndex });
    saveKeyIndex(newIndex);
  };

  chatService.onStatusChange = (status) => {
    useSystemStore.setState({ statusChat: status });
  };

  const smartFetch = async (url, _depth = 0) => {
    try {
      useSystemStore.setState({ statusApi: "working" });
      chatService.currentKeyIndex = useSystemStore.getState().currentKeyIndex;

      let res = await fetch(url + "&key=" + API_KEYS[chatService.currentKeyIndex]);
      let data = await res.json();

      if (data.error) {
        console.error("❌ API Error:", data.error.message);
        useSystemStore.setState({ statusApi: "warn" });

        if (_depth < API_KEYS.length - 1) {
          const nextIndex = (chatService.currentKeyIndex + 1) % API_KEYS.length;
          useSystemStore.setState({ currentKeyIndex: nextIndex });
          chatService.currentKeyIndex = nextIndex;
          saveKeyIndex(nextIndex);
          console.warn(
            `🔑 smartFetch: Rotated to key #${nextIndex + 1} (attempt ${_depth + 2}/${API_KEYS.length})`,
          );
          return smartFetch(url, _depth + 1);
        } else {
          useSystemStore.setState({ statusApi: "err" });
          throw new Error("All API keys exhausted");
        }
      }
      
      useSystemStore.setState({ statusApi: "ok" });
      return data;
    } catch (e) {
      useSystemStore.setState({ statusApi: "err" });
      throw e;
    }
  };

  const connectVideo = async (videoId) => {
    try {
      console.log("🔌 Connecting to video:", videoId);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${videoId}`;
      const data = await smartFetch(url);

      if (!data.items || data.items.length === 0) {
        throw new Error("Invalid Video ID");
      }

      const item = data.items[0];
      useSystemStore.setState({ liveTitle: item.snippet.title });

      if (videoId && videoId !== "demo") {
        set(dbRef(db, `history/${videoId}`), {
          title: item.snippet.title,
          timestamp: Date.now(),
        }).catch((error) => console.error("Error saving history:", error));
      }

      const { useChatStore } = await import("../stores/chatStore");
      if (item.liveStreamingDetails?.actualStartTime) {
        useChatStore.setState({ streamStartTime: new Date(item.liveStreamingDetails.actualStartTime).getTime() });
      } else {
        useChatStore.setState({ streamStartTime: Date.now() });
      }

      if (item.liveStreamingDetails?.activeLiveChatId) {
        const chatId = item.liveStreamingDetails.activeLiveChatId;
        setActiveChatId(chatId);
        
        chatService.liveChatId = chatId;
        chatService.startPolling(videoId, async (msg) => {
           console.log("🔍🔍🔍 RAW YouTube API Message:", JSON.stringify(msg, null, 2));
           useSystemStore.setState({ statusChat: "flash" });
           setTimeout(() => {
             const currentStatus = useSystemStore.getState().statusChat;
             if (currentStatus === "flash") useSystemStore.setState({ statusChat: "ok" });
           }, 200);
           await processMessage(msg);
        });

        updateViewerCount(videoId);
        viewerIntervalId.current = setInterval(
          () => updateViewerCount(videoId),
          CONSTANTS.YOUTUBE.VIEWER_POLL_INTERVAL_MS,
        );

        queueAudio(null, "", `การเชื่อมต่อสำเร็จ กำลังอ่านแชดสดจาก ${item.snippet.title}`);
        return true;
      } else {
        return false;
      }
    } catch (e) {
      console.error("❌ Connect video error:", e);
      useSystemStore.setState({ statusApi: "err" });
      return false;
    }
  };

  const updateViewerCount = async (videoId) => {
    try {
      useSystemStore.setState({ statusApi: "working" });
      const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}`;       
      const data = await smartFetch(url);
      const details = data.items?.[0]?.liveStreamingDetails;

      if (details) {
        if (details.concurrentViewers) {
          useSystemStore.setState({ viewerCount: parseInt(details.concurrentViewers) });
        }

        if (details.actualEndTime) {
          if (viewerIntervalId.current) {
            clearInterval(viewerIntervalId.current);
            viewerIntervalId.current = null;
            queueAudio(null, "", "ไลฟ์จบแล้ว");
            setTimeout(() => {
              if (useSystemStore.getState().isConnected) {
                queueAudio(null, "", "กำลังตัดการเชื่อมต่อครับ"); 
                disconnect();
              }
            }, CONSTANTS.YOUTUBE.DISCONNECT_DELAY_MS);
          }
        }
      }
      useSystemStore.setState({ statusApi: "ok" });
    } catch (e) {
      console.error("❌ Viewer Count Error:", e);
      useSystemStore.setState({ statusApi: "err" });
    }
  };

  const disconnect = () => {
    useSystemStore.setState({ isConnected: false });
    chatService.stopPolling();
    if (viewerIntervalId.current) {
      clearInterval(viewerIntervalId.current);
      viewerIntervalId.current = null;
    }
    setActiveChatId("");
  };

  useEffect(() => {
    return () => disconnect();
  }, []);

  return {
    activeChatId,
    connectVideo,
    disconnect,
  };
}
