import React, { useState, useEffect, useMemo, useRef } from 'react';
import './PhoneticManager.css';
import { useStockStore } from '../stores/stockStore';
import { useNicknameStore } from '../stores/nicknameStore';

import { ref as dbRef, onValue, update, remove } from "firebase/database";
import { db } from "../services/firebase";
import { ttsService } from "../services/TextToSpeech";
import Swal from "sweetalert2";

const TITLE_PREFIXES = ["คุณ", "พี่", "น้อง", "เฮีย", "เจ๊", "ป้า", "น้า", "อา", "ลุง", "ตา", "ยาย", "แม่", "พ่อ", "ดร.", "หมอ", "ครู", "ซ้อ", "เสี่ย"];

const PhoneticManager = ({ onClose }) => {
  const stockStore = useStockStore();
  const nicknameStore = useNicknameStore();

  const [formUid, setFormUid] = useState("");
  const [formNick, setFormNick] = useState("");
  const [formPhonetic, setFormPhonetic] = useState("");
  const [editingUid, setEditingUid] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [nicknamesData, setNicknamesData] = useState({});

  useEffect(() => {
    return onValue(dbRef(db, "nicknames"), (snapshot) => {
      setNicknamesData(snapshot.val() || {});
    });
  }, []);

  const allCustomers = useMemo(() => {
    const customers = {};
    Object.values(stockStore.stockData).forEach(item => {
      if (item?.uid && item?.owner) customers[item.uid] = { uid: item.uid, name: item.owner };
    });
    return Object.values(customers);
  }, [stockStore.stockData]);

  const filteredCustomers = useMemo(() => {
    const query = formUid.toLowerCase();
    return allCustomers.filter(c => c.name.toLowerCase().includes(query) || c.uid.toLowerCase().includes(query)).slice(0, 10);
  }, [allCustomers, formUid]);

  const nicknamesList = useMemo(() => {
    return Object.entries(nicknamesData).map(([uid, data]) => {
      if (typeof data === "object") return { uid, nick: data.nick || "", phonetic: data.phonetic || "" };
      return { uid, nick: data, phonetic: "" };
    });
  }, [nicknamesData]);

  const filteredNicknames = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return nicknamesList.filter(it => it.nick.toLowerCase().includes(query) || it.uid.toLowerCase().includes(query) || it.phonetic?.toLowerCase().includes(query));
  }, [nicknamesList, searchQuery]);

  const applyTitlePrefix = (name) => {
    if (!name) return "";
    return TITLE_PREFIXES.some(t => name.startsWith(t)) ? name : "คุณ" + name;
  };

  const previewVoice = (text) => ttsService.speak("ทดสอบเสียง", applyTitlePrefix(text));

  const savePhonetic = async () => {
    if (!formUid || !formNick) return;
    const uid = formUid.trim();
    const nick = formNick.trim();
    const phonetic = formPhonetic.trim() || null;
    try {
      await update(dbRef(db, `nicknames/${uid}`), { nick, phonetic });
      Swal.fire({ icon: "success", title: editingUid ? "อัปเดตสำเร็จ!" : "บันทึกสำเร็จ!", timer: 2000, showConfirmButton: false, background: "#1e1e1e", color: "#fff" });
      resetForm();
    } catch (e) { Swal.fire({ icon: "error", title: "บันทึกไม่สำเร็จ", text: e.message, background: "#1e1e1e", color: "#fff" }); }
  };

  const resetForm = () => { setEditingUid(null); setFormUid(""); setFormNick(""); setFormPhonetic(""); setShowSuggestions(false); setActiveSuggestionIndex(-1); };

  const editItem = (item) => { setEditingUid(item.uid); setFormUid(item.uid); setFormNick(item.nick); setFormPhonetic(item.phonetic || ""); setShowSuggestions(false); };

  const deleteItem = (uid, name) => {
    Swal.fire({ title: "ลบคำอ่าน?", text: `ลบคำอ่านของ "${name || uid}" ออกจากระบบ`, icon: "warning", showCancelButton: true, confirmButtonColor: "#d32f2f", background: "#1e1e1e", color: "#fff" })
      .then(async (r) => { if (r.isConfirmed) { await remove(dbRef(db, `nicknames/${uid}`)); if (editingUid === uid) resetForm(); } });
  };

  return (
    <div className="dashboard-overlay" onClick={onClose}>
      <div className="phonetic-modal" onClick={e => e.stopPropagation()}>
        <div className="phonetic-header"><div className="phonetic-title"><i className="fa-solid fa-volume-high"></i> จัดการคำอ่าน (Phonetic)</div><button className="btn btn-dark" onClick={onClose}><i className="fa-solid fa-times"></i></button></div>
        <div className="phonetic-form">
          <div className="form-title"><i className="fa-solid fa-user-pen"></i> {editingUid ? 'แก้ไขคำอ่าน' : 'เพิ่มคำอ่านใหม่'}</div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label"><i className="fa-solid fa-fingerprint"></i> UID ลูกค้า</label>
              <div className="autocomplete-wrapper">
                <input className="form-input" value={formUid} onChange={e => { setFormUid(e.target.value); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} disabled={!!editingUid} placeholder="พิมพ์ UID หรือเลือกจากรายชื่อ..." />
                {showSuggestions && filteredCustomers.length > 0 && !editingUid && (
                  <div className="phonetic-autocomplete">
                    {filteredCustomers.map((c, i) => (
                      <div key={c.uid} className={`phonetic-autocomplete-item ${activeSuggestionIndex === i ? 'active' : ''}`} onMouseDown={() => { setFormUid(c.uid); setFormNick(c.name); setShowSuggestions(false); if(nicknamesData[c.uid]?.phonetic) setFormPhonetic(nicknamesData[c.uid].phonetic); }}>
                        <div className="suggestion-name">{c.name}</div><div className="suggestion-uid">{c.uid.substring(0, 16)}...</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="form-group"><label className="form-label"><i className="fa-solid fa-tag"></i> ชื่อที่แสดงบนหน้าจอ (nick)</label><input className="form-input" value={formNick} onChange={e => setFormNick(e.target.value)} placeholder="เช่น ปอ, คุณนิด..." /></div>
            <div className="form-group"><label className="form-label"><i className="fa-solid fa-microphone"></i> คำอ่านสำหรับ TTS (phonetic)</label><input className="form-input phonetic-input" value={formPhonetic} onChange={e => setFormPhonetic(e.target.value)} placeholder="เช่น คุณปอร์, คุณนิดดี้..." /></div>
          </div>
          <div className="form-actions">
            <button className="btn-phonetic-save" onClick={savePhonetic} disabled={!formUid || !formNick}><i className={editingUid ? 'fa-solid fa-check' : 'fa-solid fa-plus'}></i> {editingUid ? 'อัปเดต' : 'บันทึก'}</button>
            <button className="btn-phonetic-preview" onClick={() => previewVoice(formPhonetic || formNick)} disabled={!formNick}><i className="fa-solid fa-headphones"></i> ฟังเสียง</button>
            {editingUid && <button className="btn-phonetic-cancel" onClick={resetForm}><i className="fa-solid fa-rotate-left"></i> ยกเลิก</button>}
          </div>
        </div>
        <div className="phonetic-search"><div className="search-wrapper"><i className="fa-solid fa-search search-icon"></i><input className="search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="ค้นหาชื่อ, UID..." /></div><div className="phonetic-count"><i className="fa-solid fa-users"></i> {filteredNicknames.length} รายการ</div></div>
        <div className="phonetic-list">
          {filteredNicknames.length === 0 ? <div className="phonetic-empty"><i className="fa-solid fa-ghost"></i><div>ยังไม่มีรายการคำอ่าน</div></div> : (
            filteredNicknames.map(item => (
              <div key={item.uid} className={`phonetic-item ${editingUid === item.uid ? 'phonetic-item--editing' : ''}`}>
                <div className="phonetic-item-main"><div className="phonetic-item-nick"><span className="nick-label">{item.nick}</span>{item.phonetic && <span className="phonetic-badge"><i className="fa-solid fa-volume-low"></i> {item.phonetic}</span>}</div><div className="phonetic-item-uid"><i className="fa-solid fa-fingerprint"></i> {item.uid}</div></div>
                <div className="phonetic-item-actions"><button className="btn-action btn-listen" onClick={() => previewVoice(item.phonetic || item.nick)}><i className="fa-solid fa-play"></i></button><button className="btn-action btn-edit" onClick={() => editItem(item)}><i className="fa-solid fa-pen"></i></button><button className="btn-action btn-delete" onClick={() => deleteItem(item.uid, item.nick)}><i className="fa-solid fa-trash"></i></button></div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PhoneticManager;
