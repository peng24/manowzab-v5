import React, { useState, useEffect, useRef, useMemo } from 'react';
import './ThaiDatePicker.css';
import { createPortal } from 'react-dom';

const ThaiDatePicker = ({ modelValue, onChange, position = 'bottom-left', children }) => {
  const containerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [displayYear, setDisplayYear] = useState(currentYear + 543);
  const [popupStyle, setPopupStyle] = useState({});

  const thaiMonthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const weekdays = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  const updatePosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let top = rect.bottom;
    let left = rect.left;

    if (position.includes('right')) left = rect.right - 260;
    else if (position.includes('center')) left = rect.left + (rect.width / 2) - 130;
    if (position.includes('top')) top = rect.top - 310;

    if (top + 310 > window.innerHeight) top = Math.max(10, rect.top - 310);
    if (left < 0) left = 10;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 270;

    setPopupStyle({ position: 'fixed', top: `${top + 4}px`, left: `${left}px`, zIndex: 999999 });
  };

  useEffect(() => {
    setDisplayYear(currentYear + 543);
  }, [currentYear]);

  useEffect(() => {
    if (isOpen) {
      if (modelValue?.includes('-')) {
        const [y, m] = modelValue.split('-').map(Number);
        setCurrentYear(y);
        setCurrentMonth(m - 1);
      } else {
        const d = new Date();
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
      }
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
    } else {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    }
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, modelValue, position]);

  useEffect(() => {
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target) && !e.target.closest('.td-popup')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, []);

  const blankDays = useMemo(() => new Date(currentYear, currentMonth, 1).getDay(), [currentYear, currentMonth]);
  const daysInMonth = useMemo(() => new Date(currentYear, currentMonth + 1, 0).getDate(), [currentYear, currentMonth]);

  const isSelected = (d) => {
    if (!modelValue) return false;
    const [y, m, day] = modelValue.split('-').map(Number);
    return y === currentYear && m - 1 === currentMonth && day === d;
  };

  const isToday = (d) => {
    const now = new Date();
    return now.getFullYear() === currentYear && now.getMonth() === currentMonth && now.getDate() === d;
  };

  const prevMonth = () => { if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); } else setCurrentMonth(currentMonth - 1); };
  const nextMonth = () => { if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); } else setCurrentMonth(currentMonth + 1); };

  const selectDate = (d) => {
    const val = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div className="thai-datepicker-container" ref={containerRef}>
      <div className="trigger-wrap" onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}>
        {children || <button type="button" className="fallback-btn">📅</button>}
      </div>
      {isOpen && createPortal(
        <div className="td-popup" style={popupStyle} onClick={e => e.stopPropagation()}>
          <div className="td-header">
            <button type="button" className="td-btn" onClick={prevMonth}>&lt;</button>
            <div className="td-month-year">
              <select value={currentMonth} onChange={e => setCurrentMonth(parseInt(e.target.value))} className="td-select">
                {thaiMonthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <input type="number" value={displayYear} onChange={e => { const y = parseInt(e.target.value); setDisplayYear(y); if(y >= 2500) setCurrentYear(y - 543); }} className="td-year-input" />
            </div>
            <button type="button" className="td-btn" onClick={nextMonth}>&gt;</button>
          </div>
          <div className="td-grid-days">
            {weekdays.map(w => <div key={w} className="td-weekday">{w}</div>)}
            {Array.from({ length: blankDays }).map((_, i) => <div key={'blk' + i} className="td-day empty"></div>)}
            {Array.from({ length: daysInMonth }).map((_, i) => (
              <button key={i + 1} type="button" className={`td-day-btn ${isSelected(i + 1) ? 'selected' : ''} ${isToday(i + 1) ? 'today' : ''}`} onClick={() => selectDate(i + 1)}>
                {i + 1}
              </button>
            ))}
          </div>
          <div className="td-footer">
            <button type="button" className="td-footer-btn clear" onClick={() => { onChange(null); setIsOpen(false); }}>ล้าง</button>
            <button type="button" className="td-footer-btn today" onClick={() => { const now = new Date(); selectDate(now.getDate()); }}>วันนี้</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ThaiDatePicker;
