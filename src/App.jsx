import React, { useEffect, useRef, useState } from 'react';
import { useSystemStore } from './stores/systemStore';
import { useStockStore } from './stores/stockStore';
import { useNicknameStore } from './stores/nicknameStore';
import { useChatStore } from './stores/chatStore';
import { ref as dbRef, onValue, onDisconnect, set } from "firebase/database";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { db, auth } from "./services/firebase";
import { useAwayMode } from "./hooks/useAwayMode";
import { useAutoCleanup } from "./hooks/useAutoCleanup";
import { ttsService } from "./services/TextToSpeech";
import { useGlobal } from './context/GlobalContext';
import './App.css';

import Header from "./components/Header";
import StockGrid from "./components/StockGrid";
import ChatPanel from "./components/ChatPanel";
import Dashboard from "./components/Dashboard";
import HistoryModal from "./components/HistoryModal";
import ShippingManager from "./components/ShippingManager";
import PhoneticManager from "./components/PhoneticManager";
import NoteEditor from "./components/NoteEditor";
import NoteBanner from "./components/NoteBanner";
import UpdatePrompt from "./components/UpdatePrompt";

const App = () => {
  const systemStore = useSystemStore();
  const stockStore = useStockStore();
  const nicknameStore = useNicknameStore();
  const chatStore = useChatStore();
  const { modals, closeModal } = useGlobal();

  const { awayTimer, closeAwayMode, initAwayListener } = useAwayMode();
  const { initAutoCleanup } = useAutoCleanup();

  const [isDbConnected, setIsDbConnected] = useState(false);
  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false);

  useEffect(() => {
    if (!systemStore.isSoundOn) {
      console.log("🔇 Sound turned OFF - Silencing immediately.");
      ttsService.reset();
    }
  }, [systemStore.isSoundOn]);

  useEffect(() => {
    const cleanupFns = [];

    const unsubNick = nicknameStore.initNicknameListener();
    if (unsubNick) cleanupFns.push(unsubNick);

    const unsubStock = stockStore.connectToStock("demo");
    if (unsubStock) cleanupFns.push(unsubStock);

    const unsubAway = initAwayListener();
    if (unsubAway) cleanupFns.push(unsubAway);

    initAutoCleanup().then(c => c && cleanupFns.push(c));

    const unsubHost = systemStore.initHostListener();
    if (unsubHost) cleanupFns.push(unsubHost);

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setIsUserAuthenticated(!!user);
      console.log(`✅ Auth state: ${user ? 'auth' : 'no-auth'}`);
    });
    cleanupFns.push(unsubAuth);

    const connectedRef = dbRef(db, ".info/connected");
    const unsubConnected = onValue(connectedRef, (snap) => {
      const isOnline = snap.val() === true;
      setIsDbConnected(isOnline);
      useSystemStore.setState({ statusDb: isOnline ? "ok" : "err" });
      if (isOnline) console.log("✅ Firebase Connected");
    });
    cleanupFns.push(unsubConnected);

    const unsubActiveVideo = onValue(dbRef(db, "system/activeVideo"), (snap) => {
      const vid = snap.val();
      if (vid && vid !== "demo") {
        useSystemStore.setState({ currentVideoId: vid });
        stockStore.connectToStock(vid);
      }
    });
    cleanupFns.push(unsubActiveVideo);

    return () => cleanupFns.forEach(fn => fn && fn());
  }, []);

  useEffect(() => {
    if (isDbConnected && isUserAuthenticated) {
      const myConnectionRef = dbRef(db, `presence/${systemStore.myDeviceId}`);
      set(myConnectionRef, {
        online: true,
        lastSeen: Date.now(),
        ttsKey: systemStore.activeKeyIndex,
      }).then(() => {
        systemStore.assignOptimalTtsKey();
      }).catch(err => console.error("Presence error:", err));

      onDisconnect(myConnectionRef).remove();
      console.log("✅ Presence setup complete");
    }
  }, [isDbConnected, isUserAuthenticated]);

  return (
    <div className="app-container">
      <UpdatePrompt />
      <div className="app-layout">
        <div className="left-column">
          <Header />
          {systemStore.isAway && (
            <div className="away-banner">
              <div className="away-content">
                <div className="away-icon">🌙</div>
                <div className="away-text">
                  <div className="away-title">แอดมินพาลูกนอน</div>
                  <div className="away-subtitle">กรุณารอสักครู่ หรือส่งข้อความทักทายไว้ค่ะ</div>
                </div>
                <span className="away-timer">{awayTimer}</span>
                <button className="away-btn" onClick={closeAwayMode}>
                  <i className="fa-solid fa-check"></i> ลูกหลับแล้ว
                </button>
              </div>
            </div>
          )}
          <div className="main-container">
            <StockGrid />
            {modals.dashboard && <Dashboard onClose={() => closeModal('dashboard')} />}
            {modals.history && <HistoryModal onClose={() => closeModal('history')} />}
            {modals.shippingManager && <ShippingManager onClose={() => closeModal('shippingManager')} />}
            {modals.phoneticManager && <PhoneticManager onClose={() => closeModal('phoneticManager')} />}
            {modals.noteEditor && <NoteEditor onClose={() => closeModal('noteEditor')} />}
          </div>
          <NoteBanner />
        </div>
        <ChatPanel />
      </div>
    </div>
  );
};

export default App;
