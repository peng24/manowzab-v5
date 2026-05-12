import React, { useState, useEffect, useRef, useMemo } from 'react';
import './ChatPanel.css';
import { useChatStore } from '../stores/chatStore';
import { useStockStore } from '../stores/stockStore';
import { useSystemStore } from '../stores/systemStore';
import { useAudio } from '../hooks/useAudio';
import { ref as dbRef, update } from "firebase/database";
import { db } from "../services/firebase";
import Swal from "sweetalert2";
import { motion, AnimatePresence } from 'framer-motion';

const ChatPanel = () => {
  const chatStore = useChatStore();
  const stockStore = useStockStore();
  const systemStore = useSystemStore();
  const { resetVoice, playSfx } = useAudio();

  const chatViewportRef = useRef(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(200);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const autoScrollTimer = useRef(null);

  // Pull-to-Refresh State
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullThreshold = 80;
  const touchStartY = useRef(0);
  const canPull = useRef(false);

  const visibleMessages = useMemo(() => {
    const total = chatStore.messages.length;
    const start = Math.max(0, total - displayLimit);
    return chatStore.messages.slice(start);
  }, [chatStore.messages, displayLimit]);

  const hasMoreMessages = chatStore.messages.length > displayLimit;

  const getIntentBadge = (type) => {
    switch (type) {
      case "buy": return { icon: "🛍️", label: "เอฟ", class: "badge-buy" };
      case "cancel": return { icon: "😢", label: "ยกเลิก", class: "badge-cancel" };
      case "shipping": return { icon: "📦", label: "ส่ง", class: "badge-shipping" };
      case "question": return { icon: "💬", label: "ถาม", class: "badge-question" };
      default: return null;
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  };

  const scrollToBottom = (behavior = "smooth") => {
    const el = chatViewportRef.current;
    if (el) {
      setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight + 1000, behavior });
      }, 100);
      setShowScrollButton(false);
      setIsUserScrolling(false);
      clearAutoScrollTimer();
    }
  };

  const clearAutoScrollTimer = () => {
    if (autoScrollTimer.current) {
      clearTimeout(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  };

  const startAutoScrollTimer = () => {
    clearAutoScrollTimer();
    autoScrollTimer.current = setTimeout(() => {
      scrollToBottom();
    }, 15000);
  };

  const handleScroll = () => {
    const el = chatViewportRef.current;
    if (!el) return;

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNowScrolling = distanceToBottom > 100;
    
    if (isNowScrolling && !isUserScrolling) {
      startAutoScrollTimer();
    } else if (!isNowScrolling) {
      clearAutoScrollTimer();
    }

    setIsUserScrolling(isNowScrolling);
    setShowScrollButton(isNowScrolling);
  };

  const loadMoreMessages = () => {
    const el = chatViewportRef.current;
    if (!el) return;
    const oldScrollHeight = el.scrollHeight;
    setDisplayLimit(prev => prev + 200);
    setTimeout(() => {
      const newScrollHeight = el.scrollHeight;
      el.scrollTop += (newScrollHeight - oldScrollHeight);
    }, 0);
  };

  useEffect(() => {
    if (!isUserScrolling) {
      scrollToBottom();
    }
  }, [chatStore.messages.length]);

  useEffect(() => {
    if (systemStore.currentVideoId) {
      chatStore.syncFromFirebase(systemStore.currentVideoId);
    }
  }, [systemStore.currentVideoId]);

  const editNickname = async (chat) => {
    const { value: newNick } = await Swal.fire({
      title: "แก้ไขชื่อเล่น",
      input: "text",
      inputLabel: `ชื่อจริง: ${chat.realName}`,
      inputValue: chat.displayName,
      showCancelButton: true,
      confirmButtonText: "บันทึก",
      cancelButtonText: "ยกเลิก",
    });

    if (newNick && newNick.trim() !== "") {
      const updates = {};
      updates[`nicknames/${chat.uid}`] = {
        nick: newNick.trim(),
        realName: chat.realName,
        updatedAt: Date.now(),
      };

      update(dbRef(db), updates).then(() => {
        Swal.fire({ icon: "success", title: "บันทึกแล้ว", toast: true, position: "top-end", showConfirmButton: false, timer: 1500 });
      }).catch(err => {
        console.error(err);
        Swal.fire("Error", "บันทึกไม่สำเร็จ", "error");
      });
    }
  };

  const forceProcess = async (chat) => {
    const { value: formValues } = await Swal.fire({
      title: "บังคับตัดสต็อก",
      html:
        `<input id="swal-input1" class="swal2-input" placeholder="รหัสสินค้า (เช่น 1)" value="">` +
        `<input id="swal-input2" class="swal2-input" placeholder="ราคา (ไม่ใส่ก็ได้)" value="">`,
      focusConfirm: false,
      showCancelButton: true,
      preConfirm: () => [
        document.getElementById("swal-input1").value,
        document.getElementById("swal-input2").value,
      ],
    });

    if (formValues) {
      const [num, price] = formValues;
      if (!num) return;

      await stockStore.processOrder(parseInt(num), chat.displayName, chat.uid, "manual-force", price ? parseInt(price) : null, "manual");
      Swal.fire("เรียบร้อย", `ตัดสต็อกเบอร์ ${num} ให้ ${chat.displayName} แล้ว`, "success");
    }
  };

  const handleTouchStart = (e) => {
    const el = chatViewportRef.current;
    if (!el) return;
    canPull.current = el.scrollTop === 0;
    if (canPull.current) touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e) => {
    if (!canPull.current || isRefreshing) return;
    const touchY = e.touches[0].clientY;
    const delta = touchY - touchStartY.current;
    if (delta > 0) {
      setIsPulling(true);
      setPullDistance(Math.min(delta * 0.5, 120));
      if (delta > 20) e.preventDefault();
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling || isRefreshing) return;
    setIsPulling(false);
    if (pullDistance >= pullThreshold) {
      setIsRefreshing(true);
      if (systemStore.currentVideoId) {
        await chatStore.syncFromFirebase(systemStore.currentVideoId);
      }
      scrollToBottom();
      playSfx();
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      }, 500);
    } else {
      setPullDistance(0);
    }
    canPull.current = false;
  };

  return (
    <div className="chat-panel">
      <div className="tools-bar">
        <h3 style={{ color: '#fff', margin: 0, fontSize: '1.1em' }}>
          <i className="fa-solid fa-comments"></i> Live Chat
        </h3>
        <div className="chat-controls">
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={`btn-tool ${!systemStore.isSoundOn ? 'muted' : ''}`} 
            onClick={() => useSystemStore.setState({ isSoundOn: !systemStore.isSoundOn })}
          >
            <i className={systemStore.isSoundOn ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark'}></i>
            {systemStore.isSoundOn ? "เสียง: เปิด" : "เสียง: ปิด"}
          </motion.button>
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="btn-tool" 
            onClick={() => { resetVoice(); Swal.fire({ icon: "success", title: "หยุดเสียงแล้ว", toast: true, position: "top-end", showConfirmButton: false, timer: 1000 }); }}
          >
            <i className="fa-solid fa-stop"></i> หยุดเสียง
          </motion.button>
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="btn-tool btn-csv" 
            onClick={() => {
              if (chatStore.fullChatLog.length === 0) { Swal.fire({ icon: "warning", title: "ไม่มีข้อมูล", text: "ยังไม่มีข้อความให้บันทึก", timer: 1500 }); return; }
              chatStore.downloadChatCSV(systemStore.currentVideoId || "chat-log");
              Swal.fire({ icon: "success", title: "บันทึกแล้ว", timer: 1500, showConfirmButton: false });
            }}
          >
            <i className="fa-solid fa-file-csv"></i> CSV
          </motion.button>
        </div>
      </div>

      <motion.div 
        className={`pull-indicator ${isPulling ? 'pulling' : ''} ${isRefreshing ? 'refreshing' : ''}`} 
        animate={{ height: pullDistance }}
      >
        <i className={`fa-solid fa-sync ${isRefreshing ? 'spinning' : ''}`}></i>
        <span>{isRefreshing ? 'กำลังโหลด...' : pullDistance > pullThreshold ? 'ปล่อยเพื่อรีเฟรช' : 'ดึงลงเพื่อรีเฟรช'}</span>
      </motion.div>

      <div id="chat-viewport" ref={chatViewportRef} onScroll={handleScroll} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        {hasMoreMessages && (
          <button className="load-more-btn" onClick={loadMoreMessages}>
            ⬆️ โหลดข้อความเก่าเพิ่ม ({chatStore.messages.length - displayLimit} ข้อความ)
          </button>
        )}

        <div id="chat-list">
          <AnimatePresence initial={false} mode="popLayout">
            {visibleMessages.map((chat) => (
              <motion.div
                key={chat.id}
                layout
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                className={`chat-row ${chat.isAdmin ? 'admin' : ''} ${chat.type || ''}`}
              >
                <motion.div className="avatar-container" whileHover={{ scale: 1.2 }}>
                  <img src={chat.avatar} className="avatar" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                  <div className="avatar-fallback" style={{ backgroundColor: chat.color }}>
                    {chat.displayName?.[0] || "?"}
                  </div>
                </motion.div>

                <div className="chat-bubble-container">
                  <div className="chat-meta">
                    <span className="chat-time">{formatTime(chat.timestamp)}</span>
                    <motion.span 
                      whileHover={{ scale: 1.05, filter: "brightness(1.2)" }}
                      className="chat-name" 
                      style={{ backgroundColor: chat.color }} 
                      onClick={() => editNickname(chat)}
                    >
                      {chat.displayName}
                    </motion.span>
                    {getIntentBadge(chat.type) && (
                      <motion.span 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className={`status-badge ${getIntentBadge(chat.type).class}`}
                      >
                        {getIntentBadge(chat.type).icon} {getIntentBadge(chat.type).label}
                      </motion.span>
                    )}
                    {chat.realName !== chat.displayName && <span className="real-name">({chat.realName})</span>}
                  </div>

                  <motion.div 
                    className="chat-bubble"
                    whileHover={{ x: 5 }}
                  >
                    <div className="chat-text">
                      {chat.messageRuns && chat.messageRuns.length > 0 ? (
                        chat.messageRuns.map((run, idx) => (
                          <React.Fragment key={idx}>
                            {run.text && <span>{run.text}</span>}
                            {run.emoji && run.emoji.image && (
                              <motion.img
                                whileHover={{ scale: 1.5, rotate: 10 }}
                                src={run.emoji.image.thumbnails?.[0]?.url || run.emoji.image.url}
                                alt={run.emoji.emojiId || 'emoji'}
                                className="emoji-image"
                                loading="lazy"
                              />
                            )}
                          </React.Fragment>
                        ))
                      ) : (
                        chat.text
                      )}
                    </div>
                    <div className="force-process-btn">
                      <button onClick={() => forceProcess(chat)} className="btn-mini">
                        <i className="fa-solid fa-bolt"></i>
                      </button>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showScrollButton && (
          <motion.button 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="new-msg-btn" 
            onClick={() => scrollToBottom()}
          >
            ข้อความใหม่ ⬇
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatPanel;
