import React, { useState, useEffect, useMemo } from 'react';
import './NoteEditor.css';
import { ref as dbRef, onValue, push, update, remove } from "firebase/database";
import { db } from "../services/firebase";
import { useSystemStore } from "../stores/systemStore";
import Swal from "sweetalert2";

const NoteEditor = ({ onClose }) => {
  const systemStore = useSystemStore();
  const [newNoteText, setNewNoteText] = useState("");
  const [selectedColor, setSelectedColor] = useState("#3b82f6");
  const [allNotes, setAllNotes] = useState({});

  const colorPalette = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#ffffff"];

  useEffect(() => {
    return onValue(dbRef(db, "notes"), (snapshot) => {
      setAllNotes(snapshot.val() || {});
    });
  }, []);

  const activeNotes = useMemo(() => {
    return Object.entries(allNotes).filter(([, note]) => note.active).map(([id, note]) => ({ id, ...note })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [allNotes]);

  const createNote = async () => {
    const text = newNoteText.trim(); if (!text) return;
    await push(dbRef(db, "notes"), { text, color: selectedColor, active: true, createdAt: Date.now(), createdBy: systemStore.myDeviceId });
    setNewNoteText("");
    Swal.fire({ icon: "success", title: "สร้าง Note แล้ว", text: `"${text.substring(0, 30)}..."`, timer: 1500, showConfirmButton: false, toast: true, position: "top-end" });
  };

  const deleteNote = (id) => {
    Swal.fire({ title: "ลบ Note?", text: "ลบถาวร ไม่สามารถกู้คืนได้", icon: "warning", showCancelButton: true, confirmButtonText: "ลบ", cancelButtonText: "ยกเลิก", confirmButtonColor: "#d32f2f" })
      .then(async (r) => { if (r.isConfirmed) { await remove(dbRef(db, `notes/${id}`)); Swal.fire({ icon: "success", title: "ลบ Note แล้ว", timer: 1200, showConfirmButton: false }); } });
  };

  return (
    <div className="note-editor-overlay" onClick={onClose}>
      <div className="note-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="note-editor-header"><h3><i className="fa-solid fa-note-sticky"></i> จัดการ Note</h3><button className="btn-close-editor" onClick={onClose}><i className="fa-solid fa-xmark"></i></button></div>
        <div className="note-form">
          <textarea value={newNoteText} onChange={e => setNewNoteText(e.target.value)} className="note-textarea" placeholder="พิมพ์ข้อความ Note..." rows="3" maxLength="200" />
          <div className="note-form-row">
            <div className="color-picker-row"><span className="color-label">สี:</span><div className="color-palette">{colorPalette.map(c => <button key={c} className={`color-swatch ${selectedColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setSelectedColor(c)} />)}</div></div>
            <button className="btn btn-create-note" onClick={createNote} disabled={!newNoteText.trim()}><i className="fa-solid fa-plus"></i> สร้าง Note</button>
          </div>
        </div>
        <div className="note-list-section">
          <h4 className="note-list-title">📋 Note ที่แสดงอยู่</h4>
          {activeNotes.length === 0 ? <div className="note-empty">ยังไม่มี Note</div> : activeNotes.map(n => (
            <div key={n.id} className="note-list-item">
              <span className="note-list-dot" style={{ background: n.color || '#3b82f6' }} />
              <span className="note-list-text">{n.text}</span>
              <div className="note-list-actions">
                <button className="note-list-btn note-list-deactivate" onClick={() => update(dbRef(db, `notes/${n.id}`), { active: false })}><i className="fa-solid fa-eye-slash"></i></button>
                <button className="note-list-btn note-list-delete" onClick={() => deleteNote(n.id)}><i className="fa-solid fa-trash"></i></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NoteEditor;
