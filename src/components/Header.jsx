import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSystemStore } from '../stores/systemStore';
import { useChatStore } from '../stores/chatStore';
import { useStockStore } from '../stores/stockStore';
import { useYouTube } from '../hooks/useYouTube';
import { useAudio } from '../hooks/useAudio';
import { useChatProcessor } from '../hooks/useChatProcessor';
import { useGlobal } from '../context/GlobalContext';
import { ref as dbRef, onValue, set } from "firebase/database";
import { db } from "../services/firebase";
import Swal from "sweetalert2";
import { motion, AnimatePresence } from 'framer-motion';

const DEBUG_MODE = false;
const logger = {
  log: (...args) => { if (DEBUG_MODE) console.log(...args); },
  warn: (...args) => { if (DEBUG_MODE) console.warn(...args); },
  error: (...args) => { console.error(...args); },
};

const Header = () => {
  const systemStore = useSystemStore();
  const chatStore = useChatStore();
  const stockStore = useStockStore();
  const { connectVideo, disconnect } = useYouTube();
  const { queueAudio } = useAudio();
  const { processMessage } = useChatProcessor();
  const { openModal } = useGlobal();

  const [videoId, setVideoId] = useState(localStorage.getItem("lastVideoId") || "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [shippingData, setShippingData] = useState({});
  const simIntervalId = useRef(null);
  const dropdownContainerRef = useRef(null);

  useEffect(() => {
    const unsubShipping = onValue(dbRef(db, "shipping"), (snapshot) => {
      setShippingData(snapshot.val() || {});
    });

    const handleClickOutside = (event) => {
      if (dropdownContainerRef.current && !dropdownContainerRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      unsubShipping();
      document.removeEventListener("mousedown", handleClickOutside);
      if (simIntervalId.current) clearInterval(simIntervalId.current);
      if (videoId) localStorage.setItem("lastVideoId", videoId);
    };
  }, [videoId]);

  useEffect(() => {
    if (systemStore.currentVideoId && systemStore.currentVideoId !== "demo" && systemStore.currentVideoId !== videoId) {
      setVideoId(systemStore.currentVideoId);
    }
  }, [systemStore.currentVideoId]);

  const getStatusTitle = (type) => {
    const status = type === 'db' ? systemStore.statusDb : type === 'api' ? systemStore.statusApi : systemStore.statusChat;
    if (status === "ok") return "เชื่อมต่อปกติ";
    if (status === "warn") return "มีปัญหาบางส่วน";
    if (status === "err") return "การเชื่อมต่อขัดข้อง";
    if (status === "working") return "กำลังทำงาน...";
    return "รอการเชื่อมต่อ";
  };

  const toggleDropdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDropdown(!showDropdown);
  };

  const extractVideoId = (input) => {
    if (!input) return "";
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|live\/|shorts\/)([^#&?]*).*/;
    const match = input.match(regExp);
    return match && match[2].length === 11 ? match[2] : input;
  };

  const handleToggleConnection = async () => {
    if (systemStore.isConnected) {
      disconnect();
      queueAudio(null, "", "หยุดการเชื่อมต่อ");
      return;
    }

    const cleanId = extractVideoId(videoId);
    if (cleanId !== videoId) setVideoId(cleanId);

    if (!cleanId.trim()) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "ใส่ Video ID ก่อน",
        timer: 2000,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
      });
      return;
    }

    setIsConnecting(true);
    useSystemStore.setState({ isConnected: true, currentVideoId: cleanId });
    stockStore.connectToStock(cleanId);

    set(dbRef(db, "system/activeVideo"), cleanId).catch((err) => console.error("Sync Error:", err));

    try {
      const success = await connectVideo(cleanId);
      if (success) {
        useSystemStore.setState({ statusChat: "ok" });
        queueAudio(null, "", "เชื่อมต่อสำเร็จ กำลังอ่านคอมเมนต์");
        Swal.fire({
          icon: "success",
          title: "เชื่อมต่อสำเร็จ",
          text: "กำลังอ่านคอมเมนต์จาก YouTube Live",
          timer: 2000,
          toast: true,
          position: "top-end",
          showConfirmButton: false,
        });
      } else {
        useSystemStore.setState({ statusChat: "warn" });
        Swal.fire({
          icon: "info",
          title: "เชื่อมต่อวิดีโอแล้ว",
          text: "ไม่พบห้องแชทสด (อาจเป็นคลิปย้อนหลัง)",
          timer: 3000,
          toast: true,
          position: "top-end",
          showConfirmButton: false,
        });
      }
    } catch (error) {
      logger.error("Connection error:", error);
      useSystemStore.setState({ isConnected: false, statusApi: "err", statusChat: "err" });
      Swal.fire({
        icon: "error",
        title: "เชื่อมต่อไม่สำเร็จ",
        text: error.message,
        timer: 3000,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDownloadCSV = () => {
    if (chatStore.fullChatLog.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "ไม่มีข้อมูล",
        text: "ยังไม่มีข้อความแชทเข้ามา",
        timer: 2000,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
      });
      setShowDropdown(false);
      return;
    }
    chatStore.downloadChatCSV(systemStore.currentVideoId);
    Swal.fire({
      icon: "success",
      title: "บันทึกแล้ว",
      text: "ดาวน์โหลด CSV สำเร็จ",
      timer: 1500,
      toast: true,
      position: "top-end",
      showConfirmButton: false,
    });
    setShowDropdown(false);
  };

  const handleTestVoice = () => {
    queueAudio(null, "", "ทดสอบเสียง หนึ่ง สอง สาม สี่ ห้า");
    setShowDropdown(false);
  };

  const handleToggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        logger.error("Fullscreen error:", err);
      });
    } else {
      document.exitFullscreen();
    }
    setShowDropdown(false);
  };

  const handleToggleAwayMode = () => {
    const currentState = systemStore.isAway;
    const awayRef = dbRef(db, "system/awayMode");
    if (!currentState) {
      set(awayRef, {
        isAway: true,
        startTime: Date.now(),
        deviceId: systemStore.myDeviceId,
      }).then(() => {
        Swal.fire({
          icon: "info",
          title: "โหมดพาลูกนอน",
          text: "ระบบจะซิงค์ไปทุกเครื่อง",
          timer: 2000,
          toast: true,
          position: "top-end",
          showConfirmButton: false,
        });
      });
    } else {
      set(awayRef, {
        isAway: false,
        startTime: null,
        closedBy: systemStore.myDeviceId,
      });
    }
    setShowDropdown(false);
  };

  const handleToggleSimulation = async () => {
    setIsSimulating(!isSimulating);
    if (!isSimulating) {
      Swal.fire({
        icon: "info",
        title: "เริ่มจำลองแชท",
        text: "กำลังจำลองข้อความแชท...",
        timer: 1500,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
      });
      simIntervalId.current = setInterval(() => {
        const rNum = Math.floor(Math.random() * stockStore.stockSize) + 1;
        const actions = [`F${rNum}`, `${rNum}`, `รับ ${rNum}`, `เอา ${rNum}`, `CF${rNum}`];
        const randomAction = actions[Math.floor(Math.random() * actions.length)];
        processMessage({
          id: "sim-" + Date.now(),
          snippet: { displayMessage: randomAction, publishedAt: new Date().toISOString() },
          authorDetails: { channelId: "sim-" + Math.random().toString(36).substr(2, 9), displayName: "SimUser" + Math.floor(Math.random() * 100), profileImageUrl: "" },
        });
      }, 2000);
    } else {
      if (simIntervalId.current) {
        clearInterval(simIntervalId.current);
        simIntervalId.current = null;
      }
      Swal.fire({ icon: "success", title: "หยุดจำลองแล้ว", timer: 1500, toast: true, position: "top-end", showConfirmButton: false });
    }
    setShowDropdown(false);
  };

  const handleForceUpdate = () => {
    Swal.fire({
      title: "บังคับอัปเดต?",
      text: "ระบบจะโหลดหน้าเว็บใหม่",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "ใช่, อัปเดต",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#00e676",
    }).then((result) => {
      if (result.isConfirmed) {
        localStorage.removeItem("app_version");
        window.location.reload();
      }
    });
    setShowDropdown(false);
  };

  const handleToggleTtsMode = () => {
    const newMode = !systemStore.useOnlineTts;
    useSystemStore.setState({ useOnlineTts: newMode });
    const modeName = newMode ? "Google Cloud TTS" : "Native TTS";
    queueAudio(null, "", `เปลี่ยนเป็น ${modeName}`);
  };

  return (
    <div className="header">
      <div className="header-controls">
        <div className="status-cluster">
          <motion.span 
            animate={systemStore.statusDb === 'err' ? { opacity: [0.4, 1, 0.4] } : { opacity: 1 }}
            transition={{ repeat: Infinity, duration: 1 }}
            className={`status-item ${systemStore.statusDb}`} 
            title={getStatusTitle('db')}
          >
            <i className="fa-solid fa-database"></i>
          </motion.span>
          <motion.span 
            animate={systemStore.statusApi === 'working' ? { rotate: 360 } : {}}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            className={`status-item ${systemStore.statusApi}`} 
            title={getStatusTitle('api')}
          >
            <i className="fa-brands fa-youtube"></i>
          </motion.span>
          <motion.span 
            animate={systemStore.statusChat === 'flash' ? { scale: [1, 1.5, 1], filter: ["brightness(1)", "brightness(2)", "brightness(1)"] } : {}}
            className={`status-item ${systemStore.statusChat}`} 
            title={getStatusTitle('chat')}
          >
            <i className="fa-solid fa-comments"></i>
          </motion.span>
          <span className="key-indicator" title={`กำลังใช้ API Key #${systemStore.currentKeyIndex + 1}`}>
            <i className="fa-solid fa-key"></i> {systemStore.currentKeyIndex + 1}
          </span>
          <motion.span 
            whileHover={{ scale: 1.1 }}
            className="version-badge" 
            style={{ cursor: 'pointer', marginLeft: '5px' }}
          >
            {systemStore.version}
          </motion.span>
        </div>

        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="btn btn-dark" onClick={() => openModal('history')}>🕒</motion.button>

        <input
          type="text"
          value={videoId}
          onChange={(e) => setVideoId(e.target.value)}
          className="input-id"
          placeholder="Video ID"
          onKeyUp={(e) => e.key === 'Enter' && handleToggleConnection()}
        />

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={`btn ${systemStore.isConnected ? 'btn-dark' : 'btn-primary'}`}
          onClick={handleToggleConnection}
          disabled={isConnecting}
        >
          {systemStore.isConnected ? "DISCONNECT" : isConnecting ? "..." : "CONNECT"}
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="btn"
          style={{
            background: systemStore.useOnlineTts
              ? 'linear-gradient(135deg, #00C6FF 0%, #0072FF 100%)'
              : 'linear-gradient(135deg, #4B5563 0%, #374151 100%)',
            boxShadow: systemStore.useOnlineTts ? '0 4px 15px rgba(0, 114, 255, 0.4)' : 'none',
            border: 'none',
            color: 'white',
            position: 'relative',
          }}
          onClick={handleToggleTtsMode}
          title={systemStore.useOnlineTts ? `Google Cloud TTS - Key #${systemStore.activeKeyIndex} Active` : 'Native TTS (Offline)'}
        >
          <i className={systemStore.useOnlineTts ? 'fa-solid fa-cloud' : 'fa-solid fa-robot'} style={{ fontSize: '1.1em', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}></i>
          {systemStore.useOnlineTts && <span style={{ marginLeft: '6px', fontSize: '1.1em', fontWeight: 'bold', fontFamily: 'monospace', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}>{systemStore.activeKeyIndex}</span>}
        </motion.button>

        <div className="dropdown" ref={dropdownContainerRef}>
          <motion.button 
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            className="btn btn-sim" 
            onClick={toggleDropdown}
          >
            ⚡ Tools <i className="fa-solid fa-caret-down"></i>
          </motion.button>
          <AnimatePresence>
            {showDropdown && (
              <motion.div 
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="dropdown-content" 
                onClick={() => setShowDropdown(false)}
              >
                <a onClick={handleDownloadCSV} className="menu-csv"><i className="fa-solid fa-file-csv"></i> บันทึกแชท (CSV)</a>
                <a onClick={handleTestVoice} className="menu-voice"><i className="fa-solid fa-volume-high"></i> ทดสอบเสียง</a>
                <a onClick={handleToggleFullScreen} className="menu-screen"><i className="fa-solid fa-expand"></i> เต็มจอ</a>
                <a onClick={handleToggleAwayMode} className="menu-away"><i className="fa-solid fa-moon"></i> โหมดพาลูกนอน</a>
                <a onClick={handleToggleSimulation} className="menu-sim">
                  <i className={isSimulating ? 'fa-solid fa-stop' : 'fa-solid fa-bolt'}></i>
                  {isSimulating ? "หยุดจำลอง" : "เริ่มจำลองแชท"}
                </a>
                <a href="https://peng24.github.io/manowzab-sales/" target="_blank" className="menu-sales"><i className="fa-solid fa-chart-line"></i> ยอดขาย</a>
                <a onClick={() => { openModal('noteEditor'); setShowDropdown(false); }} className="menu-note"><i className="fa-solid fa-note-sticky"></i> จัดการ Note</a>
                <a onClick={handleForceUpdate} className="menu-update"><i className="fa-solid fa-rotate"></i> บังคับอัปเดต</a>
                <a onClick={() => { openModal('phoneticManager'); setShowDropdown(false); }} className="menu-phonetic"><i className="fa-solid fa-volume-high"></i> จัดการคำอ่าน (TTS)</a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="header-info">
        <motion.div 
          animate={systemStore.isConnected ? { scale: [1, 1.2, 1] } : {}}
          transition={{ repeat: Infinity, duration: 2 }}
          className={`status-dot ${systemStore.isConnected ? 'online' : ''}`}
        ></motion.div>
        <div className="live-viewers">👀 {systemStore.viewerCount.toLocaleString()}</div>
        <div className="live-title">{systemStore.liveTitle}</div>
      </div>
    </div>
  );
};

export default Header;
