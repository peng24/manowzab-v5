import { useState } from 'react';
import { ref as dbRef, get, remove, child, update } from "firebase/database";
import { db } from "../services/firebase";

export function useHistory() {
  const [historyList, setHistoryList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  async function fetchHistoryList() {
    setIsLoading(true);
    try {
      const historyRef = dbRef(db, "history");
      const snapshot = await get(historyRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const list = Object.keys(data).map((key) => ({ videoId: key, ...data[key] }));
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setHistoryList(list);
      } else {
        setHistoryList([]);
      }
    } catch (error) {
      console.error("Fetch History Error:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchHistoryDetails(videoId) {
    if (!videoId) return { orders: {}, stockSize: 70 };
    try {
      const stockRef = dbRef(db, `stock/${videoId}`);
      const sizeRef = dbRef(db, `settings/${videoId}/stockSize`);
      const [stockSnap, sizeSnap] = await Promise.all([get(stockRef), get(sizeRef)]);
      return { orders: stockSnap.exists() ? stockSnap.val() : {}, stockSize: sizeSnap.exists() ? sizeSnap.val() : 70 };
    } catch (error) {
      console.error("Fetch History Details Error:", error);
      return { orders: {}, stockSize: 70 };
    }
  }

  async function updateHistoryItem(videoId, itemId, data) {
    if (!videoId || !itemId) return;
    try {
      const itemRef = dbRef(db, `stock/${videoId}/${itemId}`);
      if (data) {
        const updateData = { ...data, updatedAt: Date.now() };
        if (!updateData.time && !updateData.updatedAt) updateData.time = Date.now();
        await update(itemRef, updateData);
      } else {
        await remove(itemRef);
      }
    } catch (error) {
      console.error("Update Item Error:", error);
      throw error;
    }
  }

  async function deleteHistory(videoId) {
    if (!videoId) return;
    try {
      await remove(child(dbRef(db, "history"), videoId));
      await remove(child(dbRef(db, "chats"), videoId));
      await fetchHistoryList();
    } catch (error) {
      console.error("Delete History Error:", error);
      throw error;
    }
  }

  async function recalculateAllHistory() {
    setIsLoading(true);
    try {
      for (const item of historyList) {
        const stockRef = dbRef(db, `stock/${item.videoId}`);
        const snap = await get(stockRef);
        if (snap.exists()) {
          const stockData = snap.val();
          let totalSales = 0;
          let totalItems = 0;
          Object.values(stockData).forEach(order => { if (order.owner && order.price) { totalSales += parseInt(order.price); totalItems++; } });
          await update(dbRef(db, `history/${item.videoId}`), { totalSales, totalItems });
        }
      }
      await fetchHistoryList();
    } catch (error) {
      console.error("Recalculate Error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }

  return { historyList, isLoading, fetchHistoryList, fetchHistoryDetails, updateHistoryItem, deleteHistory, recalculateAllHistory };
}
