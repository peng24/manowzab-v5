import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStockStore } from '../stores/stockStore';
import { useAudio } from '../hooks/useAudio';
import { ref as dbRef, update } from "firebase/database";
import { db } from "../services/firebase";
import Swal from "sweetalert2";

const QueueModal = ({ id, onClose, onNavigate }) => {
  const stockStore = useStockStore();
  const { playSfx, queueAudio } = useAudio();
  const [editingPrice, setEditingPrice] = useState(0);
  const [tempQueue, setTempQueue] = useState([]);
  const priceInputRef = useRef(null);
  const queueInputRefs = useRef({});
  const [activeAutocompleteIdx, setActiveAutocompleteIdx] = useState(null);
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState(-1);

  useEffect(() => {
    const item = stockStore.stockData[id] || {};
    setEditingPrice(item.price || 0);
    const queue = [];
    if (item.owner) {
      queue.push({ owner: item.owner, uid: item.uid || "manual", time: item.time, source: item.source });
    }
    if (item.queue) {
      queue.push(...JSON.parse(JSON.stringify(item.queue)));
    }
    setTempQueue(queue);
    setTimeout(() => priceInputRef.current?.focus(), 100);
  }, [id, stockStore.stockData]);

  const uniqueBuyerNames = useMemo(() => {
    const names = new Set();
    Object.values(stockStore.stockData).forEach(item => { if (item.owner) names.add(item.owner); });
    return Array.from(names).sort();
  }, [stockStore.stockData]);

  const filteredSuggestions = useMemo(() => {
    if (activeAutocompleteIdx === null) return [];
    const person = tempQueue[activeAutocompleteIdx];
    if (!person) return [];
    const query = (person.owner || "").trim().toLowerCase();
    if (!query) return uniqueBuyerNames.slice(0, 10);
    return uniqueBuyerNames.filter(name => name.toLowerCase().includes(query) && name.toLowerCase() !== query).slice(0, 10);
  }, [activeAutocompleteIdx, tempQueue, uniqueBuyerNames]);

  const handleSave = async (preventClose = false) => {
    const currentDbItem = stockStore.stockData[id] || {};
    const newOwnerName = tempQueue.length > 0 ? tempQueue[0].owner : null;
    const oldOwnerName = currentDbItem.owner;

    let newData = null;
    if (tempQueue.length > 0) {
      const [first, ...rest] = tempQueue;
      newData = {
        owner: first.owner,
        uid: first.uid,
        time: first.time || Date.now(),
        source: first.source || "manual",
        price: editingPrice > 0 ? editingPrice : null,
        queue: rest,
      };
    }

    if (oldOwnerName && !newOwnerName) {
      playSfx();
      queueAudio(null, "", `ยกเลิกรายการที่ ${id} ค่ะ`);
    } else if (oldOwnerName && newOwnerName && oldOwnerName !== newOwnerName) {
      playSfx();
      if (currentDbItem.uid !== (newData?.uid)) {
        queueAudio(null, "", `${oldOwnerName} หลุดจอง ${newOwnerName}`);
      }
    }

    if (newData) {
      await stockStore.updateItemData(id, newData);
    } else {
      await stockStore.updateItemData(id, { price: editingPrice > 0 ? editingPrice : null, owner: null, uid: null, queue: null, time: null, source: null });
    }

    if (!preventClose) {
      onClose();
      Swal.fire({ icon: "success", title: "บันทึกแล้ว", toast: true, position: "top-end", showConfirmButton: false, timer: 1500 });
    }
  };

  const handleNavigate = async (direction) => {
    await handleSave(true);
    const nextId = direction === 'prev' ? Math.max(1, id - 1) : Math.min(stockStore.stockSize, id + 1);
    if (nextId !== id) onNavigate(nextId);
  };

  const clearItemData = () => {
    Swal.fire({
      title: 'ล้างข้อมูลรายการนี้?',
      text: 'ราคาและรายชื่อจะถูกล้างทั้งหมด',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'ล้างเลย',
      background: '#1e1e1e',
      color: '#fff',
    }).then((result) => {
      if (result.isConfirmed) {
        setEditingPrice(0);
        setTempQueue([]);
      }
    });
  };

  const selectSuggestion = (name, index) => {
    const newQueue = [...tempQueue];
    newQueue[index].owner = name;
    setTempQueue(newQueue);
    setActiveAutocompleteIdx(null);
    setHighlightedSuggestionIdx(-1);
  };

  return createPortal(
    <div className="queue-modal-overlay" onClick={onClose}>
      <div className="queue-modal" onClick={e => e.stopPropagation()}>
        <div className="queue-header">
          <h3 className="text-success"><i className="fa-solid fa-list-ol"></i> รายการที่ {id}</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-dark btn-sm" onClick={() => handleNavigate('prev')}><i className="fa-solid fa-chevron-left"></i></button>
            <button className="btn btn-dark btn-sm" onClick={() => handleNavigate('next')}><i className="fa-solid fa-chevron-right"></i></button>
            <button className="btn btn-danger btn-sm" onClick={clearItemData}><i className="fa-solid fa-eraser"></i> ล้าง</button>
            <button className="btn btn-dark" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div className="queue-body">
          <div className="price-input-section">
            <label className="price-label"><i className="fa-solid fa-tag"></i> ราคา</label>
            <div className="price-input-row">
              <input
                type="number"
                value={editingPrice}
                onChange={e => setEditingPrice(e.target.value)}
                ref={priceInputRef}
                className="price-input-field"
                placeholder="0"
                onKeyUp={e => e.key === 'Enter' && handleSave()}
              />
              <span className="price-unit">บาท</span>
            </div>
          </div>
          <div className="queue-list">
            {tempQueue.length === 0 ? (
              <div className="queue-empty-state"><i className="fa-solid fa-inbox"></i> ไม่มีรายการจอง</div>
            ) : (
              tempQueue.map((person, index) => (
                <div key={index} className={`queue-item ${index === 0 ? 'queue-item--owner' : 'queue-item--backup'}`}>
                  <span className="queue-rank">#{index + 1}</span>
                  <div className="autocomplete-wrapper" style={{ flex: 1 }}>
                    <input
                      type="text"
                      value={person.owner}
                      onChange={e => {
                        const newQueue = [...tempQueue];
                        newQueue[index].owner = e.target.value;
                        setTempQueue(newQueue);
                        setActiveAutocompleteIdx(index);
                      }}
                      onFocus={() => setActiveAutocompleteIdx(index)}
                      onBlur={() => setTimeout(() => setActiveAutocompleteIdx(null), 150)}
                      className="queue-input"
                      placeholder="ชื่อผู้จอง"
                    />
                    {activeAutocompleteIdx === index && filteredSuggestions.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {filteredSuggestions.map((s, si) => (
                          <div key={s} className="autocomplete-item" onClick={() => selectSuggestion(s, index)}>{s}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="btn-remove" onClick={() => setTempQueue(tempQueue.filter((_, i) => i !== index))}>×</button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="queue-footer">
          <button className="btn btn-dark" onClick={() => setTempQueue([...tempQueue, { owner: "", uid: "manual-" + Date.now(), time: Date.now(), source: "manual" }])}>
            <i className="fa-solid fa-plus"></i> เพิ่มชื่อ
          </button>
          <button className="btn btn-success" onClick={() => handleSave()}>
            <i className="fa-solid fa-save"></i> บันทึกการแก้ไข
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QueueModal;
