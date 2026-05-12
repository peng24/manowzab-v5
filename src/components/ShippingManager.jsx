import React, { useState, useEffect, useMemo, useRef } from 'react';
import './ShippingManager.css';
import { useStockStore } from '../stores/stockStore';
import { useSystemStore } from '../stores/systemStore';
import { ref as dbRef, onValue, update, remove, get } from "firebase/database";
import { db } from "../services/firebase";
import Swal from "sweetalert2";
import ThaiDatePicker from "./ThaiDatePicker";

const ShippingManager = ({ onClose }) => {
  const stockStore = useStockStore();
  const systemStore = useSystemStore();

  const [allCustomers, setAllCustomers] = useState([]);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    return onValue(dbRef(db, "delivery_customers"), (snapshot) => {
      const data = snapshot.val() || {};
      setAllCustomers(Object.keys(data).map(key => ({ id: key, ...data[key] })));
    });
  }, []);

  useEffect(() => {
    const videoId = systemStore.currentVideoId;
    if (!videoId || allCustomers.length === 0) return;
    const orders = {};
    Object.keys(stockStore.stockData).forEach(num => {
      const item = stockStore.stockData[num];
      if (item?.uid) {
        if (!orders[item.uid]) orders[item.uid] = { count: 0, totalPrice: 0 };
        orders[item.uid].count++;
        orders[item.uid].totalPrice += item.price ? parseInt(item.price) : 0;
      }
    });
    allCustomers.forEach(async (c) => {
      if (c.status === "done") return;
      const order = orders[c.id];
      if (!order) return;
      if (c.sessions?.[videoId]?.count === order.count && c.sessions?.[videoId]?.totalPrice === order.totalPrice) return;
      await update(dbRef(db, `delivery_customers/${c.id}/sessions/${videoId}`), order);
      const snap = await get(dbRef(db, `delivery_customers/${c.id}/sessions`));
      const sessions = snap.val() || {};
      const totalCount = Object.values(sessions).reduce((sum, s) => sum + (s.count || 0), 0);
      await update(dbRef(db, `delivery_customers/${c.id}`), { itemCount: totalCount, updatedAt: Date.now() });
    });
  }, [stockStore.stockData]);

  const activeCustomers = useMemo(() => allCustomers.filter(c => c.status !== "done"), [allCustomers]);
  const customers = useMemo(() => showDone ? allCustomers : activeCustomers, [showDone, allCustomers, activeCustomers]);

  const getCountdown = (ds) => {
    if (!ds) return { text: "ยังไม่กำหนด", color: "gray", days: Infinity };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(ds); target.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { text: `เลย ${Math.abs(diff)} วัน!`, color: "overdue", days: diff };
    if (diff === 0) return { text: "ส่งวันนี้!", color: "red", days: 0 };
    if (diff === 1) return { text: "พรุ่งนี้", color: "orange", days: 1 };
    return { text: `อีก ${diff} วัน`, color: diff <= 3 ? "yellow" : "green", days: diff };
  };

  const sortedCustomers = useMemo(() => [...customers].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (a.status !== "done" && b.status === "done") return -1;
    return getCountdown(a.deliveryDate).days - getCountdown(b.deliveryDate).days;
  }), [customers]);

  const stats = useMemo(() => ({
    all: activeCustomers.length,
    today: activeCustomers.filter(c => getCountdown(c.deliveryDate).days === 0).length,
    soon: activeCustomers.filter(c => { const d = getCountdown(c.deliveryDate).days; return d > 0 && d <= 3; }).length,
    items: activeCustomers.reduce((sum, c) => sum + (c.itemCount || 0), 0),
    done: allCustomers.filter(c => c.status === "done").length
  }), [activeCustomers, allCustomers]);

  const formatThaiDate = (ds) => {
    if (!ds) return "";
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const d = new Date(ds);
    return `${d.getDate()} ${thaiMonths[d.getMonth()]} ${(d.getFullYear() + 543) % 100}`;
  };

  const updateField = (id, field, value) => update(dbRef(db, `delivery_customers/${id}`), { [field]: value, updatedAt: Date.now() });

  const addManualCustomer = () => {
    let name = newName.trim(); if (!name) return;
    let targetUid = "manual-" + Date.now();
    const existing = allCustomers.find(c => c.name === name && c.status !== "done");
    if (existing) targetUid = existing.id;
    update(dbRef(db, `delivery_customers/${targetUid}`), {
      name, itemCount: existing ? existing.itemCount : 0, deliveryDate: newDate || new Date().toISOString().split('T')[0], note: existing ? existing.note : "", status: "pending", updatedAt: Date.now()
    }).then(() => { setNewName(""); setNewDate(""); Swal.fire({ icon: "success", title: `เพิ่ม "${name}" แล้ว`, toast: true, position: "top-end", timer: 1500, showConfirmButton: false }); });
  };

  return (
    <div className="dashboard-overlay" onClick={onClose}>
      <div className="sm-content" onClick={e => e.stopPropagation()}>
        <div className="sm-header"><div className="sm-title">📦 รายการจัดส่ง</div><button className="btn btn-dark" onClick={onClose}>ปิด</button></div>
        <div className="sm-stats">
          <div className="sm-stat"><span className="sm-stat-num">{stats.all}</span><span className="sm-stat-label">ทั้งหมด</span></div>
          <div className="sm-stat urgent"><span className="sm-stat-num">{stats.today}</span><span className="sm-stat-label">ส่งวันนี้</span></div>
          <div className="sm-stat warn"><span className="sm-stat-num">{stats.soon}</span><span className="sm-stat-label">1-3 วัน</span></div>
          <div className="sm-stat"><span className="sm-stat-num">{stats.items}</span><span className="sm-stat-label">สินค้ารวม</span></div>
        </div>
        <div className="sm-add-form">
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyUp={e => e.key === 'Enter' && addManualCustomer()} className="sm-input" placeholder="เพิ่มลูกค้า (ชื่อ)" />
          <ThaiDatePicker modelValue={newDate} onChange={setNewDate} position="bottom-right">
            <input value={newDate} readOnly className="sm-input sm-date" placeholder="วันส่ง" />
          </ThaiDatePicker>
          <button className="btn btn-success sm-add-btn" onClick={addManualCustomer} disabled={!newName.trim()}><i className="fa-solid fa-plus"></i> เพิ่ม</button>
        </div>
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead><tr><th>#</th><th>ชื่อลูกค้า</th><th>สินค้า</th><th>วันส่ง</th><th>นับถอยหลัง</th><th>โน้ต</th><th>จัดการ</th></tr></thead>
            <tbody>
              {sortedCustomers.map((c, i) => (
                <tr key={c.id} className={`${getCountdown(c.deliveryDate).days <= 0 && c.deliveryDate ? 'row-urgent' : ''} ${c.status === 'done' ? 'row-done' : ''}`}>
                  <td className="td-center">{i + 1}</td>
                  <td><input className="sm-edit-input" value={c.name} onChange={e => updateField(c.id, 'name', e.target.value)} /></td>
                  <td className="td-center"><span>{c.itemCount || 0} ชิ้น</span></td>
                  <td className="td-center"><ThaiDatePicker modelValue={c.deliveryDate} onChange={val => updateField(c.id, 'deliveryDate', val)} position="bottom-center"><span className={c.deliveryDate ? 'thai-date' : 'no-date'}>{c.deliveryDate ? formatThaiDate(c.deliveryDate) : 'ดด/วว/ปป'}</span></ThaiDatePicker></td>
                  <td className="td-center"><span className={`countdown-badge cd-${getCountdown(c.deliveryDate).color}`}>{getCountdown(c.deliveryDate).text}</span></td>
                  <td><input className="sm-edit-input sm-note" value={c.note || ''} onChange={e => updateField(c.id, 'note', e.target.value)} placeholder="โน้ต..." /></td>
                  <td className="td-center"><div className="action-btns">
                    {c.status !== 'done' ? <button className="action-btn done-btn" onClick={() => updateField(c.id, 'status', 'done')}>✅</button> : <button className="action-btn undo-btn" onClick={() => updateField(c.id, 'status', 'pending')}>↩️</button>}
                    <button className="action-btn del-btn" onClick={() => { Swal.fire({ title: `ลบ "${c.name}"?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#d32f2f" }).then(r => r.isConfirmed && remove(dbRef(db, `delivery_customers/${c.id}`))); }}>🗑️</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sm-footer"><label className="sm-toggle"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /><span>แสดงรายการที่เสร็จแล้ว ({stats.done})</span></label></div>
      </div>
    </div>
  );
};

export default ShippingManager;
