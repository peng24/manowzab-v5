import { create } from 'zustand';
import { db } from '../services/firebase'; // I'll move firebase setup to services
import { ref as dbRef, onValue, get, update } from "firebase/database";

const GOOGLE_API_KEYS = "AIzaSyBRHQqNNn8lKXic7KILkHkZRnNQ8oBFqnw,AIzaSyDulTIwtePtm9J9RNSfOuoIGaSOWOZRT3w";

export const useSystemStore = create((set, getStore) => ({
  // State
  isConnected: false,
  currentVideoId: "",
  viewerCount: 0,
  liveTitle: "รอรับกระแสข้อมูล...",
  isAway: false,
  isSoundOn: true,
  isHost: false,
  googleApiKey: GOOGLE_API_KEYS,
  useOnlineTts: true,
  activeKeyIndex: 1,
  statusDb: "err",
  statusApi: "ok",
  statusChat: "ok",
  currentKeyIndex: 0,
  myDeviceId: localStorage.getItem("device_id") || `device-${Date.now()}`,
  version: "v5.0.0", // Hardcoded for now, can be imported if needed

  // Actions
  setIsConnected: (val) => set({ isConnected: val }),
  setCurrentVideoId: (id) => set({ currentVideoId: id }),
  setViewerCount: (count) => set({ viewerCount: count }),
  setLiveTitle: (title) => set({ liveTitle: title }),
  setIsAway: (val) => set({ isAway: val }),
  setIsSoundOn: (val) => set({ isSoundOn: val }),
  setIsHost: (val) => set({ isHost: val }),
  setStatus: (type, status) => {
    if (type === "db") set({ statusDb: status });
    if (type === "api") set({ statusApi: status });
    if (type === "chat") set({ statusChat: status });
  },

  initHostListener: () => {
    const { myDeviceId, isHost } = getStore();
    const hostRef = dbRef(db, "system/hostId");
    return onValue(hostRef, (snapshot) => {
      const currentHostId = snapshot.val();
      if (currentHostId && currentHostId !== myDeviceId && isHost) {
        set({ isHost: false });
        console.log("⚠️ Host role taken by another device:", currentHostId);
      }
    });
  },

  assignOptimalTtsKey: async () => {
    try {
      const { googleApiKey, myDeviceId, activeKeyIndex, updatePresenceTtsKey } = getStore();
      const keysCount = googleApiKey.split(",").filter(k => k.trim()).length;
      if (keysCount <= 1) return;

      const presenceRef = dbRef(db, "presence");
      const snapshot = await get(presenceRef);
      if (!snapshot.exists()) return;

      const presenceData = snapshot.val();
      const keyUsage = {};
      for (let i = 1; i <= keysCount; i++) keyUsage[i] = 0;

      Object.entries(presenceData).forEach(([deviceId, device]) => {
        if (device.online && device.ttsKey && deviceId !== myDeviceId) {
           if (keyUsage[device.ttsKey] !== undefined) {
              keyUsage[device.ttsKey]++;
           }
        }
      });

      let minUsage = Infinity;
      let selectedKey = activeKeyIndex;
      for (let i = 1; i <= keysCount; i++) {
         if (keyUsage[i] < minUsage) {
            minUsage = keyUsage[i];
            selectedKey = i;
         }
      }

      if (activeKeyIndex !== selectedKey) {
        set({ activeKeyIndex: selectedKey });
        console.log(`🤖 Optimal TTS Key Assigned: Key #${selectedKey} (Usage: ${JSON.stringify(keyUsage)})`); 
        updatePresenceTtsKey();
      } else {
        console.log(`🤖 TTS Key remains #${selectedKey} (Usage: ${JSON.stringify(keyUsage)})`);
      }
    } catch(e) {
      console.warn("Failed to assign optimal TTS key", e);
    }
  },

  updatePresenceTtsKey: () => {
    const { myDeviceId, activeKeyIndex } = getStore();
    const myConnectionRef = dbRef(db, `presence/${myDeviceId}`);
    update(myConnectionRef, { ttsKey: activeKeyIndex }).catch(()=> {});
  }
}));

// Initialize Device ID if not exists
if (!localStorage.getItem("device_id")) {
  localStorage.setItem("device_id", useSystemStore.getState().myDeviceId);
}
