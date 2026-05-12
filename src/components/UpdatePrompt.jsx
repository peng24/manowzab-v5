import React, { useState, useEffect } from 'react';
import './UpdatePrompt.css';
import { useRegisterSW } from 'virtual:pwa-register/react';

const UpdatePrompt = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  useEffect(() => {
    let timeoutId = null;
    if (needRefresh) {
      timeoutId = setTimeout(() => {
        setNeedRefresh(false);
      }, 60000);
    }
    return () => { if (timeoutId) clearTimeout(timeoutId); };
  }, [needRefresh, setNeedRefresh]);

  const handleUpdate = async () => {
    await updateServiceWorker(true);
  };

  if (!needRefresh) return null;

  return (
    <div className="pwa-toast">
      <div className="message">
        <i className="fa-solid fa-cloud-arrow-down"></i>
        <span>มีเวอร์ชันใหม่พร้อมใช้งาน</span>
      </div>
      <div className="actions">
        <button className="btn-refresh" onClick={handleUpdate}>อัปเดตเลย</button>
        <button className="btn-close" onClick={() => setNeedRefresh(false)}>
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  );
};

export default UpdatePrompt;
