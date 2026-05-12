import { create } from 'zustand';
import { db } from '../services/firebase';
import { triggerCelebration } from "../utils/celebration";
import {
  ref as dbRef,
  onValue,
  set,
  update,
  remove,
  runTransaction,
} from "firebase/database";
import { useSystemStore } from "./systemStore";

export const useStockStore = create((set, get) => ({
  stockData: {},
  stockSize: parseInt(localStorage.getItem('lastStockSize')) || 50,
  milestones: { fifty: false, eighty: false, hundred: false },
  currentUnsubscribe: null,

  connectToStock: (videoId) => {
    const { currentUnsubscribe } = get();
    if (currentUnsubscribe) {
      currentUnsubscribe();
    }

    set({ milestones: { fifty: false, eighty: false, hundred: false } });

    const stockRef = dbRef(db, `stock/${videoId}`);

    let isInitialLoad = true;
    const unsubStock = onValue(stockRef, (snapshot) => {
      const val = snapshot.val() || {};
      set({ stockData: val });

      if (videoId && videoId !== "demo") {
        let totalSales = 0;
        let totalItems = 0;

        Object.values(val).forEach((item) => {
          if (item.owner && item.price) {
            totalSales += parseInt(item.price);
            totalItems++;
          } else if (item.owner) {
            totalItems++;
          }
        });

        const { stockSize, milestones } = get();
        const currentSize = stockSize > 0 ? stockSize : 70;
        const percentage = (totalItems / currentSize) * 100;

        if (!isInitialLoad) {
          if (percentage >= 50 && !milestones.fifty) {
            triggerCelebration(50);
            set((state) => ({ milestones: { ...state.milestones, fifty: true } }));
          }
          if (percentage >= 80 && !milestones.eighty) {
            triggerCelebration(80);
            set((state) => ({ milestones: { ...state.milestones, eighty: true } }));
          }
          if (percentage >= 100 && !milestones.hundred) {
            triggerCelebration(100);
            set((state) => ({ milestones: { ...state.milestones, hundred: true } }));
          }
        } else {
          const newMilestones = { ...milestones };
          if (percentage >= 50) newMilestones.fifty = true;
          if (percentage >= 80) newMilestones.eighty = true;
          if (percentage >= 100) newMilestones.hundred = true;
          set({ milestones: newMilestones });
        }

        const historyRef = dbRef(db, `history/${videoId}`);
        update(historyRef, {
          totalSales: totalSales,
          totalItems: totalItems,
          lastUpdated: Date.now(),
        }).catch((err) => console.error("History Sync Error:", err));
      }

      isInitialLoad = false;
    });

    const sizeRef = dbRef(db, `settings/${videoId}/stockSize`);
    const unsubSize = onValue(sizeRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        set({ stockSize: val });
        localStorage.setItem('lastStockSize', val);
      }
    });

    const cleanup = () => {
      unsubStock();
      unsubSize();
    };
    set({ currentUnsubscribe: cleanup });

    return cleanup;
  },

  processOrder: async (num, owner, uid, source = "manual", price = null, method = "manual") => {
    const systemStore = useSystemStore.getState();
    const itemRef = dbRef(db, `stock/${systemStore.currentVideoId}/${num}`);

    try {
      let action = "unknown";

      await runTransaction(itemRef, (currentData) => {
        if (currentData === null) {
          action = "claimed";
          return {
            owner,
            uid,
            time: Date.now(),
            queue: [],
            source: method,
            price: price || null,
          };
        } else if (!currentData.owner) {
          action = "claimed";
          currentData.owner = owner;
          currentData.uid = uid;
          currentData.time = Date.now();
          currentData.source = method;
          if (price) currentData.price = price;
          if (!currentData.queue) currentData.queue = [];
          return currentData;
        } else {
          if (currentData.owner === owner) {
            action = "already_owned";
            return;
          }
          const queue = currentData.queue || [];
          if (queue.find((q) => q.owner === owner)) {
            action = "already_queued";
            return;
          }
          action = "queued";
          queue.push({ owner, uid, time: Date.now() });
          currentData.queue = queue;
          return currentData;
        }
      });

      return { success: true, action, error: null };
    } catch (e) {
      console.error("Transaction failed: ", e);
      return { success: false, action: "error", error: e.message };
    }
  },

  processCancel: async (num) => {
    const systemStore = useSystemStore.getState();
    const itemRef = dbRef(db, `stock/${systemStore.currentVideoId}/${num}`);
    let previousOwner = null;
    let nextOwner = null;

    try {
      await runTransaction(itemRef, (currentData) => {
        if (!currentData) return null;

        previousOwner = currentData.owner;

        if (currentData.queue && currentData.queue.length > 0) {
          const next = currentData.queue[0];
          const nextQ = currentData.queue.slice(1);
          nextOwner = next.owner;

          return {
            ...currentData,
            owner: next.owner,
            uid: next.uid,
            time: Date.now(),
            queue: nextQ,
            source: "queue",
          };
        } else {
          return null;
        }
      });

      return { success: true, previousOwner, nextOwner, error: null };
    } catch (e) {
      console.error("Cancel failed: ", e);
      return {
        success: false,
        previousOwner,
        nextOwner: null,
        error: e.message,
      };
    }
  },

  clearAllStock: () => {
    const systemStore = useSystemStore.getState();
    remove(dbRef(db, `stock/${systemStore.currentVideoId}`));
    set({ milestones: { fifty: false, eighty: false, hundred: false } });
  },

  updateStockPrice: (num, price) => {
    const systemStore = useSystemStore.getState();
    const path = `stock/${systemStore.currentVideoId}/${num}/price`;
    return update(dbRef(db), { [path]: price });
  },

  updateStockSize: (newSize) => {
    const systemStore = useSystemStore.getState();
    if (!systemStore.currentVideoId) return;
    const sizeRef = dbRef(
      db,
      `settings/${systemStore.currentVideoId}/stockSize`,
    );
    set(sizeRef, newSize);
    localStorage.setItem('lastStockSize', newSize);
    set({ stockSize: newSize });
  },

  updateItemData: async (num, newData) => {
    const systemStore = useSystemStore.getState();
    if (!systemStore.currentVideoId) return;
    await update(
      dbRef(db, `stock/${systemStore.currentVideoId}/${num}`),
      newData,
    );
  }
}));
