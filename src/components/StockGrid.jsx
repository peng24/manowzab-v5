import React, { useState, useEffect, useRef, useMemo } from 'react';
import './StockGrid.css';
import { useStockStore } from '../stores/stockStore';
import { useAudio } from '../hooks/useAudio';
import { useGlobal } from '../context/GlobalContext';
import { ref as dbRef, onValue, update } from "firebase/database";
import { db } from "../services/firebase";
import Swal from "sweetalert2";
import { motion, AnimatePresence } from 'framer-motion';
import QueueModal from './QueueModal';

const StockGrid = () => {
  const stockStore = useStockStore();
  const { playSfx, queueAudio } = useAudio();
  const { openModal } = useGlobal();
  const gridContainerRef = useRef(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [newOrders, setNewOrders] = useState(new Set());
  const [deliveryCustomers, setDeliveryCustomers] = useState([]);
  const [localStockSize, setLocalStockSize] = useState(stockStore.stockSize || 100);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [animatedSoldCount, setAnimatedSoldCount] = useState(0);
  const [animatedPercentage, setAnimatedPercentage] = useState(0);
  const [isPulsingPercent, setIsPulsingPercent] = useState(false);

  // Pull-to-Refresh State
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullThreshold = 80;
  const touchStartY = useRef(0);
  const canPull = useRef(false);

  useEffect(() => {
    const unsubDelivery = onValue(dbRef(db, "delivery_customers"), (snapshot) => {
      setDeliveryCustomers(Object.values(snapshot.val() || {}));
    });
    return () => unsubDelivery();
  }, []);

  useEffect(() => {
    setLocalStockSize(stockStore.stockSize);
  }, [stockStore.stockSize]);

  const soldCount = useMemo(() => 
    Object.values(stockStore.stockData).filter((item) => item.owner).length
  , [stockStore.stockData]);

  const soldPercentage = useMemo(() => {
    if (stockStore.stockSize === 0) return 0;
    return Math.round((soldCount / stockStore.stockSize) * 100);
  }, [soldCount, stockStore.stockSize]);

  useEffect(() => {
    let frame;
    const animate = (from, to, setter) => {
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min((now - start) / 500, 1);
        const value = Math.round(from + (to - from) * (1 - Math.pow(1 - progress, 4)));
        setter(value);
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    animate(animatedSoldCount, soldCount, setAnimatedSoldCount);
    return () => cancelAnimationFrame(frame);
  }, [soldCount]);

  useEffect(() => {
    let frame;
    const animate = (from, to, setter) => {
      setIsPulsingPercent(true);
      setTimeout(() => setIsPulsingPercent(false), 600);
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min((now - start) / 500, 1);
        const value = Math.round(from + (to - from) * (1 - Math.pow(1 - progress, 4)));
        setter(value);
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    animate(animatedPercentage, soldPercentage, setAnimatedPercentage);
    return () => cancelAnimationFrame(frame);
  }, [soldPercentage]);

  const percentColorClass = useMemo(() => {
    if (soldPercentage <= 20) return 'pct-low';
    if (soldPercentage <= 50) return 'pct-medium';
    if (soldPercentage <= 80) return 'pct-high';
    return 'pct-complete';
  }, [soldPercentage]);

  const motivationalText = useMemo(() => {
    if (soldPercentage === 0) return "✌️ เริ่มต้นกันเลย!";
    if (soldPercentage <= 20) return "✌️ เริ่มต้นกันเลย!";
    if (soldPercentage <= 50) return "🔥 ไฟเริ่มติดแล้ว!";
    if (soldPercentage <= 80) return "🚀 ยอดพุ่งมาอแม่!";
    if (soldPercentage < 100) return "💎 จะหมดแล้ว!";
    return "🎉 ปังปุริเย่ หมดเกลี้ยง!";
  }, [soldPercentage]);

  const progressBarColor = useMemo(() => {
    if (soldPercentage <= 30) return "linear-gradient(90deg, #ff6b35 0%, #ff4500 100%)";
    if (soldPercentage <= 60) return "linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)";
    return "linear-gradient(90deg, #10b981 0%, #059669 100%)";
  }, [soldPercentage]);

  const todayDeliveryCount = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return deliveryCustomers.filter(c => {
      if (c.status === 'done' || !c.deliveryDate) return false;
      const target = new Date(c.deliveryDate); target.setHours(0, 0, 0, 0);
      return target.getTime() <= today.getTime();
    }).length;
  }, [deliveryCustomers]);

  const deliveryStrip = useMemo(() => {
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const formatThaiDate = (ds) => { if(!ds) return ""; const d = new Date(ds); return `${d.getDate()} ${thaiMonths[d.getMonth()]}`; };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    
    return deliveryCustomers
      .filter(c => c.status !== 'done')
      .map(c => {
        const target = new Date(c.deliveryDate); target.setHours(0, 0, 0, 0);
        const days = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
        let urgency, info, tooltip;
        if (!c.deliveryDate) { urgency = 'none'; info = ''; tooltip = `${c.name}: ยังไม่กำหนดวันส่ง (${c.itemCount || 0} ชิ้น)`; }
        else if (days < 0) { urgency = 'overdue'; info = `เลย ${Math.abs(days)} วัน!`; tooltip = `${c.name}: เลยกำหนด ${Math.abs(days)} วัน (${c.itemCount || 0} ชิ้น)`; }
        else if (days === 0) { urgency = 'today'; info = 'วันนี้!'; tooltip = `${c.name}: ส่งวันนี้ (${c.itemCount || 0} ชิ้น)`; }
        else if (days === 1) { urgency = 'soon'; info = 'พรุ่งนี้'; tooltip = `${c.name}: พรุ่งนี้ (${c.itemCount || 0} ชิ้น)`; }
        else if (days <= 3) { urgency = 'soon'; info = `อีก ${days} วัน`; tooltip = `${c.name}: ${formatThaiDate(c.deliveryDate)} (${c.itemCount || 0} ชิ้น)`; }
        else { urgency = 'later'; info = formatThaiDate(c.deliveryDate); tooltip = `${c.name}: ${formatThaiDate(c.deliveryDate)} (${c.itemCount || 0} ชิ้น)`; }
        return { id: c.uid || c.name, name: c.name, urgency, info, days, tooltip };
      })
      .sort((a, b) => a.days - b.days);
  }, [deliveryCustomers]);

  const saveStockSize = () => {
    const newSize = parseInt(localStockSize);
    if (!newSize || newSize < 1) {
      Swal.fire({ icon: "error", title: "ข้อมูลไม่ถูกต้อง", text: "จำนวนรายการต้องมากกว่า 0", toast: true, position: "top-end", showConfirmButton: false, timer: 2000 });
      return;
    }
    stockStore.updateStockSize(newSize);
    Swal.fire({ icon: "success", title: "บันทึกแล้ว", text: `จำนวนรายการ: ${newSize}`, toast: true, position: "top-end", showConfirmButton: false, timer: 1500 });
  };

  const getStockItem = (num) => stockStore.stockData[num] || {};

  const handleTouchStart = (e) => {
    const el = gridContainerRef.current;
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
      if (delta > 10) e.preventDefault();
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling || isRefreshing) return;
    setIsPulling(false);
    if (pullDistance >= pullThreshold) {
      setIsRefreshing(true);
      playSfx();
      setTimeout(() => { setIsRefreshing(false); setPullDistance(0); }, 500);
    } else {
      setPullDistance(0);
    }
    canPull.current = false;
  };

  const openQueueModal = (id) => {
    setEditingId(id);
    setShowQueueModal(true);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.005
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.8, y: 10 },
    show: { opacity: 1, scale: 1, y: 0 }
  };

  return (
    <div className="stock-panel">
      <div className="stock-header">
        <div className="header-main-row">
          <div className="stock-input-group">
            รายการ:
            <input
              type="number"
              value={localStockSize}
              onChange={(e) => setLocalStockSize(e.target.value)}
              onBlur={saveStockSize}
              className="edit-input"
              style={{ width: '60px', textAlign: 'center', fontSize: '1em', fontWeight: 'bold' }}
            />
          </div>

          <div className="stock-stats">
            <span className="stats-label">ขายแล้ว:</span>
            <span className="stat-sold">{animatedSoldCount}</span>
            <span style={{ opacity: 0.5, fontSize: '0.85em' }}>/{stockStore.stockSize}</span>
            <motion.div 
              animate={isPulsingPercent ? { scale: [1, 1.2, 1], boxShadow: ["0 0 0px var(--success)", "0 0 20px var(--success)", "0 0 0px var(--success)"] } : {}}
              className={`sale-percent-badge ${percentColorClass}`}
            >
              {animatedPercentage}%
            </motion.div>
            <span className="motivational-badge">{motivationalText}</span>
          </div>

          <div className="delivery-strip">
            <motion.div 
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.9 }}
              className="shipping-mgr-icon" 
              onClick={() => openModal('shippingManager')} 
              title="รายการจัดส่ง" 
              style={{ cursor: 'pointer' }}
            >
              <span className="box-emoji">📦</span>
              {todayDeliveryCount > 0 && <span className="delivery-badge">{todayDeliveryCount}</span>}
            </motion.div>
            <div className="ds-scroll">
              {deliveryStrip.map(c => (
                <motion.span 
                  layoutId={c.id}
                  key={c.id} 
                  className={`ds-pill ds-${c.urgency}`} 
                  title={c.tooltip}
                >
                  {c.name}
                  {c.info && <span className="ds-info"> {c.info}</span>}
                </motion.span>
              ))}
            </div>
          </div>
        </div>

        <div className="mini-progress-track">
          <motion.div 
            className="mini-progress-fill" 
            initial={{ width: 0 }}
            animate={{ width: soldPercentage + '%' }}
            transition={{ type: "spring", stiffness: 50, damping: 20 }}
            style={{ background: progressBarColor }}
          >
            <div className="mini-shimmer"></div>
          </motion.div>
        </div>
      </div>

      <div className={`pull-indicator ${isPulling ? 'pulling' : ''} ${isRefreshing ? 'refreshing' : ''}`} style={{ height: pullDistance + 'px' }}>
        <i className={`fa-solid fa-sync ${isRefreshing ? 'spinning' : ''}`}></i>
        <span>{pullDistance > pullThreshold ? 'ปล่อยเพื่อรีเฟรช' : 'ดึงลงเพื่อรีเฟรช'}</span>
      </div>

      <motion.div 
        className="stock-grid" 
        ref={gridContainerRef} 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        onTouchStart={handleTouchStart} 
        onTouchMove={handleTouchMove} 
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence mode="popLayout">
          {Array.from({ length: stockStore.stockSize }, (_, i) => i + 1).map(i => {
            const item = getStockItem(i);
            return (
              <motion.div
                key={i}
                layout
                variants={itemVariants}
                whileHover={{ scale: 1.05, zIndex: 10, backgroundColor: "var(--bg-hover)" }}
                whileTap={{ scale: 0.95 }}
                className={`stock-item ${item.owner ? 'sold' : ''} ${newOrders.has(i) ? 'new-order' : ''} ${highlightedId === i ? 'highlight' : ''}`}
                onClick={() => openQueueModal(i)}
                id={`stock-${i}`}
              >
                <div className="stock-num">{i}</div>
                <div className={`stock-status ${!item.owner ? 'empty' : ''}`}>
                  {item.owner || "ว่าง"}
                </div>
                {item.price && <div className="stock-price">{item.price} บาท</div>}
                {item.queue?.length > 0 && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="queue-badge"
                  >
                    +{item.queue.length}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {showQueueModal && (
        <QueueModal
          id={editingId}
          onClose={() => setShowQueueModal(false)}
          onNavigate={(newId) => setEditingId(newId)}
        />
      )}
    </div>
  );
};

export default StockGrid;
