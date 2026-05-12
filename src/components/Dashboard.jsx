import React, { useState, useEffect, useMemo } from 'react';
import './Dashboard.css';
import { useStockStore } from '../stores/stockStore';
import { useSystemStore } from '../stores/systemStore';
import { useChatStore } from '../stores/chatStore';
import { ref as dbRef, onValue, update, push, get } from "firebase/database";
import { db } from "../services/firebase";
import Swal from "sweetalert2";

const Dashboard = ({ onClose }) => {
  const stockStore = useStockStore();
  const systemStore = useSystemStore();
  const chatStore = useChatStore();

  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [shippingData, setShippingData] = useState({});
  const [savedNames, setSavedNames] = useState({});

  // Chat History State
  const [selectedChatUid, setSelectedChatUid] = useState(null);
  const [selectedChatUser, setSelectedChatUser] = useState({});
  const [userChatHistory, setUserChatHistory] = useState([]);

  useEffect(() => {
    const unsubShipping = onValue(dbRef(db, "shipping"), (snapshot) => {
      setShippingData(snapshot.val() || {});
    });
    const unsubNames = onValue(dbRef(db, "nicknames"), (snapshot) => {
      setSavedNames(snapshot.val() || {});
    });
    return () => { unsubShipping(); unsubNames(); };
  }, []);

  const customerOrders = useMemo(() => {
    const orders = {};
    Object.keys(stockStore.stockData).forEach((num) => {
      const item = stockStore.stockData[num];
      if (item?.uid) {
        if (!orders[item.uid]) {
          orders[item.uid] = { name: item.owner, uid: item.uid, items: [], totalPrice: 0 };
        }
        const price = item.price ? parseInt(item.price) : 0;
        orders[item.uid].items.push({ num, price });
        orders[item.uid].totalPrice += price;
      }
    });
    return orders;
  }, [stockStore.stockData]);

  const shippingList = useMemo(() => {
    const currentShipping = shippingData[systemStore.currentVideoId] || {};
    return Object.keys(customerOrders)
      .filter((uid) => currentShipping[uid]?.ready)
      .map((uid) => {
        const order = customerOrders[uid];
        const itemsText = order.items.map((i) => `#${i.num}${i.price > 0 ? `(${i.price})` : ""}`).join(", ");
        return {
          uid,
          name: savedNames[uid]?.nick || order.name,
          editableName: savedNames[uid]?.nick || order.name,
          itemsText,
          totalPrice: order.totalPrice,
        };
      });
  }, [customerOrders, shippingData, systemStore.currentVideoId, savedNames]);

  const notReadyCustomers = useMemo(() => {
    const currentShipping = shippingData[systemStore.currentVideoId] || {};
    return Object.keys(customerOrders)
      .filter((uid) => !currentShipping[uid]?.ready)
      .map((uid) => ({
        uid,
        name: savedNames[uid]?.nick || customerOrders[uid].name,
        itemCount: customerOrders[uid].items.length,
      }));
  }, [customerOrders, shippingData, systemStore.currentVideoId, savedNames]);

  const totalCF = Object.values(stockStore.stockData).filter(item => item?.owner).length;
  const totalItems = stockStore.stockSize || 0;
  const percentage = totalItems === 0 ? 0 : (totalCF / totalItems) * 100;

  const motivationalEmoji = useMemo(() => {
    if (percentage === 0 || percentage <= 20) return "✌️";
    if (percentage <= 50) return "🔥";
    if (percentage <= 80) return "🚀";
    return "💰";
  }, [percentage]);

  const percentageColorClass = useMemo(() => {
    if (percentage <= 20) return "color-low";
    if (percentage <= 50) return "color-medium";
    if (percentage <= 80) return "color-high";
    return "color-complete";
  }, [percentage]);

  const recalcItemCount = async (uid) => {
    const sessionsSnap = await get(dbRef(db, `delivery_customers/${uid}/sessions`));
    const sessions = sessionsSnap.val() || {};
    const totalCount = Object.values(sessions).reduce((sum, s) => sum + (s.count || 0), 0);
    const totalPrice = Object.values(sessions).reduce((sum, s) => sum + (s.totalPrice || 0), 0);
    await update(dbRef(db, `delivery_customers/${uid}`), { itemCount: totalCount, totalPrice: totalPrice, updatedAt: Date.now() });
  };

  const syncCustomerToDelivery = async (uid, name, order, videoId) => {
    const sessionData = { count: order.items.length, totalPrice: order.totalPrice };
    const customerRef = dbRef(db, `delivery_customers/${uid}`);
    const snap = await get(customerRef);
    const existing = snap.val();
    if (!existing) {
      await update(customerRef, { name, deliveryDate: null, note: "", status: "pending", createdAt: Date.now(), updatedAt: Date.now() });
    } else {
      const updates = { name, updatedAt: Date.now() };
      if (existing.status === "done") updates.status = "pending";
      await update(customerRef, updates);
    }
    await update(dbRef(db, `delivery_customers/${uid}/sessions/${videoId}`), sessionData);
    await recalcItemCount(uid);
  };

  const addToShipping = async () => {
    if (!selectedCustomer) return;
    const uid = selectedCustomer;
    const order = customerOrders[uid];
    const videoId = systemStore.currentVideoId;
    const customerName = savedNames[uid]?.nick || order.name;
    await update(dbRef(db, `shipping/${videoId}/${uid}`), { ready: true, timestamp: Date.now() });
    await syncCustomerToDelivery(uid, customerName, order, videoId);
    Swal.fire({ icon: "success", title: "เพิ่มลงรายการส่งของ + Sync แล้ว", text: `${customerName}: ${order.items.length} รายการ`, timer: 1500, showConfirmButton: false });
    setSelectedCustomer("");
  };

  const syncAllToDelivery = async () => {
    const videoId = systemStore.currentVideoId;
    if (!videoId || shippingList.length === 0) return;
    for (const item of shippingList) {
      const order = customerOrders[item.uid];
      if (order) await syncCustomerToDelivery(item.uid, item.name, order, videoId);
    }
    Swal.fire({ icon: "success", title: "📦 Sync เสร็จ!", text: `Sync ${shippingList.length} คน ไป Shipping Manager แล้ว`, timer: 2000, showConfirmButton: false });
  };

  const removeFromShipping = (uid) => {
    Swal.fire({ title: "ลบออกจากรายการ?", text: "คุณต้องการลบลูกค้าคนนี้ออกจากรายการส่งของหรือไม่?", icon: "warning", showCancelButton: true, confirmButtonText: "ลบ", cancelButtonText: "ยกเลิก", confirmButtonColor: "#d32f2f" }).then((result) => {
      if (result.isConfirmed) {
        update(dbRef(db, `shipping/${systemStore.currentVideoId}/${uid}`), { ready: null }).then(() => {
          Swal.fire({ icon: "success", title: "ลบออกจากรายการแล้ว", timer: 1500, showConfirmButton: false });
        });
      }
    });
  };

  const openChatHistory = async (uid, item) => {
    setSelectedChatUid(uid);
    const found = chatStore.messages.find((m) => m.uid === uid);
    setSelectedChatUser({ name: item.name, avatar: found?.avatar });
    const historyRef = dbRef(db, `shipping/${systemStore.currentVideoId}/${uid}/history`);
    const snapshot = await get(historyRef);
    setUserChatHistory(snapshot.exists() ? Object.values(snapshot.val()).sort((a, b) => a.timestamp - b.timestamp) : []);
    setTimeout(() => { const body = document.getElementById("history-body"); if (body) body.scrollTop = body.scrollHeight; }, 100);
  };

  return (
    <div className="dashboard-overlay" onClick={onClose}>
      <div className="dashboard-content" onClick={e => e.stopPropagation()}>
        <div className="dashboard-header">
          <div className="dash-title">🚚 คิวจัดส่ง (รอบปัจจุบัน)</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-shipping-mgr" onClick={syncAllToDelivery}>📦 Sync All</button>
            <button className="btn btn-dark" onClick={onClose}>ปิด</button>
          </div>
        </div>

        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-value-row">
              <span className="stat-label-inline">ขายแล้ว:</span>
              <span className="main-number">{totalCF}/{totalItems}</span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: percentage + '%' }}><div className="shimmer"></div></div>
              </div>
              <div className={`percent-text ${percentageColorClass}`}>
                {Math.round(percentage)}% {motivationalEmoji}
              </div>
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table className="shipping-table">
            <thead>
              <tr><th>ลำดับ</th><th>ลูกค้า (แก้ไขได้)</th><th>รายการ</th><th>แชท</th><th>ราคารวม</th><th>จัดการ</th></tr>
            </thead>
            <tbody>
              {notReadyCustomers.length > 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '10px', background: '#2a2a2a' }}>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
                      <i className="fa-solid fa-user-plus"></i>
                      <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} style={{ padding: '5px', borderRadius: '4px', background: '#444', color: '#fff' }}>
                        <option value="">-- เลือกลูกค้าเพื่อส่งของ --</option>
                        {notReadyCustomers.map(c => <option key={c.uid} value={c.uid}>{c.name} ({c.itemCount} รายการ)</option>)}
                      </select>
                      <button className="btn btn-success" onClick={addToShipping} disabled={!selectedCustomer}>เพิ่ม</button>
                    </div>
                  </td>
                </tr>
              )}
              {shippingList.length === 0 && notReadyCustomers.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', color: '#888', padding: '20px' }}>ยังไม่มีรายการที่แจ้งพร้อมส่ง</td></tr>
              ) : (
                shippingList.map((item, index) => (
                  <tr key={item.uid}>
                    <td>{index + 1}</td>
                    <td><input className="edit-input" value={item.editableName} onChange={e => update(dbRef(db, `nicknames/${item.uid}`), { nick: e.target.value.trim() })} /></td>
                    <td style={{ fontSize: '0.9em' }}>{item.itemsText}</td>
                    <td style={{ textAlign: 'center' }}><button className="btn-icon-chat" onClick={() => openChatHistory(item.uid, item)}><i className="fa-solid fa-comments"></i></button></td>
                    <td style={{ color: '#ffd700', fontWeight: 'bold' }}>฿{item.totalPrice.toLocaleString()}</td>
                    <td style={{ textAlign: 'center' }}><button className="btn btn-dark" style={{ background: '#d32f2f' }} onClick={() => removeFromShipping(item.uid)}><i className="fa-solid fa-trash"></i></button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedChatUid && (
        <div className="chat-history-modal" onClick={() => setSelectedChatUid(null)}>
          <div className="chat-history-content" onClick={e => e.stopPropagation()}>
            <div className="chat-history-header">
              <div className="user-info">
                <img src={selectedChatUser.avatar || 'https://www.gstatic.com/youtube/img/creator/avatars/sample_avatar.png'} className="avatar-small" />
                <div><h3>{selectedChatUser.name}</h3><div className="sub-text">ประวัติแชทแจ้งโอน/ส่งของ</div></div>
              </div>
              <button className="btn-close" onClick={() => setSelectedChatUid(null)}><i className="fa-solid fa-times"></i></button>
            </div>
            <div className="chat-history-body" id="history-body">
              {userChatHistory.length === 0 ? <div style={{ textAlign: 'center', color: '#555', marginTop: '50px' }}>- ไม่มีประวัติแชท -</div> : (
                userChatHistory.map((msg, i) => (
                  <div key={i} className="chat-bubble-row">
                    <div className="chat-bubble-time">{new Date(msg.timestamp).toLocaleTimeString("th-TH")}</div>
                    <div className="chat-bubble-text">{msg.text}</div>
                  </div>
                ))
              )}
            </div>
            <div className="chat-history-footer">
              <button className="btn-sync-chat" onClick={() => {
                const memoryMsgs = chatStore.messages.filter(m => m.uid === selectedChatUid);
                let count = 0;
                memoryMsgs.forEach(memMsg => {
                  if (!userChatHistory.some(h => h.text === memMsg.text && Math.abs(h.timestamp - memMsg.timestamp) < 5000)) {
                    push(dbRef(db, `shipping/${systemStore.currentVideoId}/${selectedChatUid}/history`), { text: memMsg.text, timestamp: memMsg.timestamp, type: "user" });
                    count++;
                  }
                });
                if (count > 0) { openChatHistory(selectedChatUid, selectedChatUser); Swal.fire("Success", `Sync เพิ่ม ${count} ข้อความ`, "success"); }
                else { Swal.fire("Up to date", "ไม่มีข้อความใหม่ให้ Sync", "info"); }
              }}><i className="fa-solid fa-rotate"></i> ดึงข้อความย้อนหลัง (Sync)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
