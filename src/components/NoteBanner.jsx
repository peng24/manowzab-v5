import React, { useState, useEffect, useMemo } from 'react';
import './NoteBanner.css';
import { ref as dbRef, onValue } from "firebase/database";
import { db } from "../services/firebase";
import { motion, AnimatePresence } from 'framer-motion';

const NoteBanner = () => {
  const [allNotes, setAllNotes] = useState({});
  const [collapsedNotes, setCollapsedNotes] = useState({});
  const DISMISSED_KEY = "manowzab_dismissed_notes";

  const getDismissedIds = () => { try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"); } catch { return []; } };
  const saveDismissedIds = (ids) => localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));

  useEffect(() => {
    return onValue(dbRef(db, "notes"), (snapshot) => {
      setAllNotes(snapshot.val() || {});
    });
  }, []);

  const visibleNotes = useMemo(() => {
    const dismissed = getDismissedIds();
    return Object.entries(allNotes)
      .filter(([id, note]) => note.active && !dismissed.includes(id))
      .map(([id, note]) => ({ id, ...note }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 5);
  }, [allNotes]);

  const toggleCollapse = (id) => setCollapsedNotes(prev => ({ ...prev, [id]: !prev[id] }));

  const dismissNote = (id) => {
    const dismissed = getDismissedIds();
    if (!dismissed.includes(id)) { dismissed.push(id); saveDismissedIds(dismissed); }
    setAllNotes({ ...allNotes }); // Force update
  };

  return (
    <div className="note-banner-container">
      <AnimatePresence>
        {visibleNotes.map(note => (
          <motion.div
            key={note.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`note-banner ${collapsedNotes[note.id] ? 'collapsed' : ''}`}
            style={{ '--note-color': note.color || '#3b82f6' }}
          >
            <div className="note-bar" onClick={() => toggleCollapse(note.id)}>
              <span className={`note-preview ${!collapsedNotes[note.id] ? 'note-full' : ''}`}>
                {collapsedNotes[note.id] ? (note.text.length > 40 ? note.text.substring(0, 40) + "..." : note.text) : note.text}
              </span>
              <div className="note-actions">
                <button className="note-action-btn" onClick={e => { e.stopPropagation(); toggleCollapse(note.id); }}><i className={collapsedNotes[note.id] ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'}></i></button>
                <button className="note-action-btn note-dismiss" onClick={e => { e.stopPropagation(); dismissNote(note.id); }}><i className="fa-solid fa-xmark"></i></button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default NoteBanner;
