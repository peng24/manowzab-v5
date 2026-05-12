import { ref as dbRef, get, remove } from "firebase/database";
import { db } from "../services/firebase";

export function useAutoCleanup() {
  const initAutoCleanup = async () => {
    try {
      const historyRef = dbRef(db, "history");
      const snapshot = await get(historyRef);
      if (!snapshot.exists()) return null;
      const historyData = snapshot.val();
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const videosToDelete = Object.keys(historyData).filter(vid => historyData[vid].timestamp < thirtyDaysAgo);
      if (videosToDelete.length === 0) return null;
      console.log(`🧹 Auto-Cleanup: Found ${videosToDelete.length} videos older than 30 days.`);
      for (const vid of videosToDelete) {
        await remove(dbRef(db, `chats/${vid}`));
        console.log(`✅ Cleaned up chats for: ${vid}`);
      }
    } catch (e) {
      console.warn("⚠️ Auto-Cleanup failed:", e);
    }
    return null;
  };
  return { initAutoCleanup };
}
