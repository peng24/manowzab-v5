import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStockStore } from '../stores/stockStore';
import { useAudio } from '../hooks/useAudio';
import { ref as dbRef, update } from "firebase/database";
import { db } from "../services/firebase";
import Swal from "sweetalert2";
import { motion, AnimatePresence } from 'framer-motion';

import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const SortableItem = ({ id, index, person, tempQueue, setTempQueue, setActiveAutocompleteIdx, filteredSuggestions, selectSuggestion }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: person.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`queue-item ${index === 0 ? 'queue-item--owner' : 'queue-item--backup'}`}
    >
      <div className="drag-handle" {...attributes} {...listeners}>
        <i className="fa-solid fa-grip-vertical"></i>
      </div>
      <span className={`queue-rank ${index === 0 ? 'queue-rank--owner' : ''}`}>
        #{index + 1}
      </span>
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
        {/* Local Autocomplete for this row */}
        <AnimatePresence>
          {filteredSuggestions.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="autocomplete-dropdown"
            >
              {filteredSuggestions.map((s, si) => (
                <div key={s} className="autocomplete-item" onClick={() => selectSuggestion(s, index)}>{s}</div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <button 
        className="btn-remove" 
        style={{ background: 'transparent', border: 'none', color: '#666', fontSize: '1.2em', cursor: 'pointer', padding: '0 8px' }}
        onClick={() => setTempQueue(tempQueue.filter((_, i) => i !== index))}
      >
        ×
      </button>
    </div>
  );
};

const QueueModal = ({ id, onClose, onNavigate }) => {
  const stockStore = useStockStore();
  const { playSfx, queueAudio } = useAudio();
  const [editingPrice, setEditingPrice] = useState(0);
  const [tempQueue, setTempQueue] = useState([]);
  const priceInputRef = useRef(null);
  const [activeAutocompleteIdx, setActiveAutocompleteIdx] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Press and drag 8px to start
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const item = stockStore.stockData[id] || {};
    setEditingPrice(item.price || 0);
    const queue = [];
    if (item.owner) {
      queue.push({ 
        id: item.uid || "owner-initial", 
        owner: item.owner, 
        uid: item.uid || "manual", 
        time: item.time, 
        source: item.source 
      });
    }
    if (item.queue) {
      item.queue.forEach((q, idx) => {
        queue.push({ 
          ...q, 
          id: q.uid || `queue-${idx}-${Date.now()}` 
        });
      });
    }
    setTempQueue(queue);
    setTimeout(() => priceInputRef.current?.focus(), 100);
  }, [id, stockStore.stockData]);

  const uniqueBuyerNames = useMemo(() => {
    const names = new Set();
    Object.values(stockStore.stockData).forEach(item => { if (item.owner) names.add(item.owner); });
    return Array.from(names).sort();
  }, [stockStore.stockData]);

  const getFilteredSuggestions = (index) => {
    if (activeAutocompleteIdx !== index) return [];
    const person = tempQueue[index];
    if (!person) return [];
    const query = (person.owner || "").trim().toLowerCase();
    if (!query) return uniqueBuyerNames.slice(0, 10);
    return uniqueBuyerNames.filter(name => name.toLowerCase().includes(query) && name.toLowerCase() !== query).slice(0, 10);
  };

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
        queue: rest.map(({id, ...q}) => q), // Remove the 'id' we added for dnd-kit
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
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setTempQueue((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const newArr = arrayMove(items, oldIndex, newIndex);
        
        // If the owner (first person) changed, play a subtle click sound
        if (oldIndex === 0 || newIndex === 0) {
           playSfx('success');
        }
        
        return newArr;
      });
    }
  };

  return createPortal(
    <div className="queue-modal-overlay" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="queue-modal" 
        onClick={e => e.stopPropagation()}
      >
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
          
          <div className="queue-list-container">
            <label className="price-label" style={{ marginBottom: '10px' }}>
              <i className="fa-solid fa-users"></i> ลำดับคิวจอง (ลากสลับคิวได้)
            </label>
            
            <DndContext 
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext 
                items={tempQueue.map(i => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="queue-list">
                  {tempQueue.length === 0 ? (
                    <div className="queue-empty-state"><i className="fa-solid fa-inbox"></i> ไม่มีรายการจอง</div>
                  ) : (
                    tempQueue.map((person, index) => (
                      <SortableItem 
                        key={person.id}
                        id={person.id}
                        index={index}
                        person={person}
                        tempQueue={tempQueue}
                        setTempQueue={setTempQueue}
                        setActiveAutocompleteIdx={setActiveAutocompleteIdx}
                        filteredSuggestions={getFilteredSuggestions(index)}
                        selectSuggestion={selectSuggestion}
                      />
                    ))
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>
        <div className="queue-footer">
          <button className="btn btn-dark" onClick={() => setTempQueue([...tempQueue, { id: "manual-" + Date.now(), owner: "", uid: "manual-" + Date.now(), time: Date.now(), source: "manual" }])}>
            <i className="fa-solid fa-plus"></i> เพิ่มชื่อ
          </button>
          <button className="btn btn-success" onClick={() => handleSave()}>
            <i className="fa-solid fa-save"></i> บันทึกการแก้ไข
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};

export default QueueModal;
