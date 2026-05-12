import { useState, useEffect, useRef } from 'react';
import { ref as dbRef, onValue, set } from "firebase/database";
import { db } from "../services/firebase";
import { useSystemStore } from "../stores/systemStore";

export function useAwayMode() {
  const systemStore = useSystemStore();
  const [awayTimer, setAwayTimer] = useState("00:00");
  const intervalId = useRef(null);

  const initAwayListener = () => {
    const awayRef = dbRef(db, "system/awayMode");
    return onValue(awayRef, (snapshot) => {
      const data = snapshot.val();
      if (data?.isAway) {
        useSystemStore.setState({ isAway: true });
        startTimer(data.startTime);
      } else {
        useSystemStore.setState({ isAway: false });
        stopTimer();
      }
    });
  };

  const startTimer = (startTime) => {
    stopTimer();
    const update = () => {
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      const m = String(Math.floor(diff / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setAwayTimer(`${m}:${s}`);
    };
    update();
    intervalId.current = setInterval(update, 1000);
  };

  const stopTimer = () => {
    if (intervalId.current) { clearInterval(intervalId.current); intervalId.current = null; }
    setAwayTimer("00:00");
  };

  const closeAwayMode = () => {
    set(dbRef(db, "system/awayMode"), { isAway: false, startTime: null, closedBy: systemStore.myDeviceId });
  };

  useEffect(() => { return () => stopTimer(); }, []);

  return { awayTimer, closeAwayMode, initAwayListener };
}
