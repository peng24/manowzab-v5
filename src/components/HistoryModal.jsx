import React, { useState, useEffect, useMemo } from 'react';
import './HistoryModal.css';
import { createPortal } from 'react-dom';
import { useHistory } from '../hooks/useHistory';
import Swal from "sweetalert2";

const HistoryModal = ({ onClose }) => {
  const history = useHistory();
  const [selectedId, setSelectedId] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState({ owner: "", price: 0 });

  useEffect(() => {
    history.fetchHistoryList();
  }, []);

  const selectLive = async (item) => {
    setSelectedId(item.videoId);
    setSelectedItem({ ...item });
    setSearchQuery("");
    setIsDetailsLoading(true);
    const { orders, stockSize } = await history.fetchHistoryDetails(item.videoId);
    setSelectedItem(prev => ({ ...prev, orders, stockSize }));
    setIsDetailsLoading(false);
  };

  const ordersList = useMemo(() => {
    if (!selectedItem?.orders) return [];
    return Object.keys(selectedItem.orders).map(key => ({ stockId: key, ...selectedItem.orders[key] }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [selectedItem]);

  const filteredOrders = useMemo(() => {
    if (!searchQuery) return ordersList;
    const q = searchQuery.toLowerCase();
    return ordersList.filter(o => o.stockId.toString().includes(q) || (o.owner && o.owner.toLowerCase().includes(q)));
  }, [ordersList, searchQuery]);

  const customerNames = useMemo(() => {
    if (!selectedItem?.orders) return [];
    return [...new Set(Object.values(selectedItem.orders).map(o => o.owner).filter(Boolean))].sort();
  }, [selectedItem]);

  const allGridItems = useMemo(() => {
    if (!selectedItem) return [];
    const size = selectedItem.stockSize || 70;
    const orders = selectedItem.orders || {};
    const items = Array.from({ length: size }, (_, i) => ({ id: i + 1, ...orders[i + 1], isEmpty: !orders[i + 1]?.owner }));
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(it => it.id.toString().includes(q) || (it.owner && it.owner.toLowerCase().includes(q)));
  }, [selectedItem, searchQuery]);

  const totalRevenue = useMemo(() => filteredOrders.reduce((sum, o) => sum + (o.price || 0), 0), [filteredOrders]);

  const formatDate = (ts) => ts ? new Date(ts).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "-";
  const formatCurrency = (val) => new Intl.NumberFormat('th-TH').format(val);

  const handleDelete = async () => {
    const result = await Swal.fire({ title: "ยืนยันการลบ?", text: `ต้องการลบประวัติ "${selectedItem.title}" และแชททั้งหมด?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "ลบข้อมูล", cancelButtonText: "ยกเลิก" });
    if (result.isConfirmed) { await history.deleteHistory(selectedId); setSelectedId(null); setSelectedItem(null); Swal.fire("เรียบร้อย", "ลบข้อมูลสำเร็จแล้ว", "success"); }
  };

  const exportCSV = () => {
    if (filteredOrders.length === 0) { Swal.fire("ไม่มีข้อมูล", "ไม่พบรายการสั่งซื้อ", "warning"); return; }
    let csv = "\uFEFFDate,Time,Stock ID,Customer Name,Price,Source\n";
    const ds = formatDate(selectedItem.timestamp).split(' ')[0];
    filteredOrders.forEach(o => csv += `"${ds}","${formatTime(o.timestamp)}",${o.stockId},"${o.owner?.replace(/"/g, '""') || ""}",${o.price || 0},"${o.method || 'unknown'}"\n`);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = `sales_history_${selectedId}.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const openEditModal = (item) => { setEditingItem({ ...item }); setEditForm({ owner: item.owner || "", price: item.price || 0 }); setIsEditModalOpen(true); };
  const closeEditModal = () => { setIsEditModalOpen(false); setEditingItem(null); };

  const saveEdit = async () => {
    if (!editingItem) return;
    const upd = { owner: editForm.owner, price: editForm.price, uid: editingItem.uid || 'manual-' + Date.now(), method: editingItem.method || 'manual-edit' };
    const orders = { ...selectedItem.orders, [editingItem.id]: { ...upd, timestamp: editingItem.timestamp || Date.now() } };
    setSelectedItem({ ...selectedItem, orders });
    await history.updateHistoryItem(selectedId, editingItem.id, upd);
    closeEditModal();
  };

  const removeReservation = async (sid, owner) => {
    const result = await Swal.fire({ title: "ลบชื่อคนจอง?", text: `ยกเลิกจอง "${owner}" จากรายการที่ ${sid}?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#f59e0b", confirmButtonText: "ลบชื่อ", cancelButtonText: "ยกเลิก" });
    if (result.isConfirmed) {
      const orders = { ...selectedItem.orders };
      if (orders[sid]) { delete orders[sid].owner; delete orders[sid].uid; }
      setSelectedItem({ ...selectedItem, orders });
      await history.updateHistoryItem(selectedId, sid, { owner: null, uid: null, method: 'manual-remove', removedAt: Date.now() });
      if (isEditModalOpen) closeEditModal();
    }
  };

  return (
    <div className="dashboard-overlay" onClick={onClose}>
      <div className="history-modal-container" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><i className="fa-solid fa-clock-rotate-left"></i> ประวัติการขาย (History)</h2>
          <button className="btn-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="modal-body">
          <div className="sidebar">
            <div className="sidebar-header"><span>รายการย้อนหลัง</span><div className="flex gap-1">
              <button className="btn-icon-sm" onClick={() => history.recalculateAllHistory()} title="คำนวณยอดใหม่"><i className="fa-solid fa-wrench"></i></button>
              <button className="btn-icon-sm" onClick={() => history.fetchHistoryList()} title="รีเฟรช"><i className="fa-solid fa-rotate-right"></i></button>
            </div></div>
            <div className="sidebar-list">
              {history.isLoading ? <div className="text-center p-10 text-muted"><i className="fa-solid fa-spinner fa-spin"></i> กำลังโหลด...</div> : (
                history.historyList.map(item => (
                  <div key={item.videoId} className={`sidebar-item ${selectedId === item.videoId ? 'active' : ''}`} onClick={() => selectLive(item)}>
                    <div className="item-title">{item.title || "ไม่มีชื่อ"}</div>
                    <div className="item-date"><i className="fa-regular fa-calendar"></i> {formatDate(item.timestamp)}</div>
                    <div className="item-meta">ยอด: {formatCurrency(item.totalSales || 0)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="main-content">
            {!selectedItem ? <div className="empty-state"><i className="fa-solid fa-arrow-left"></i><p>เลือกรายการทางซ้ายเพื่อดูรายละเอียด</p></div> : (
              <div className="content-wrapper">
                <div className="stats-bar">
                  {isDetailsLoading ? <div className="flex items-center justify-center p-4 w-full text-muted"><i className="fa-solid fa-spinner fa-spin mr-2"></i> กำลังโหลดข้อมูล...</div> : (
                    <>
                      <div className="stat-box"><div className="stat-label">ยอดขายรวม</div><div className="stat-value text-success">{formatCurrency(totalRevenue)}</div></div>
                      <div className="stat-box"><div className="stat-label">จำนวนสินค้า</div><div className="stat-value">{filteredOrders.length} ชิ้น</div></div>
                      <div className="stat-actions"><button className="btn btn-danger" onClick={handleDelete}><i className="fa-solid fa-trash"></i> ลบ</button><button className="btn btn-success" onClick={exportCSV}><i className="fa-solid fa-file-csv"></i> Export CSV</button></div>
                    </>
                  )}
                </div>
                <div className="controls-bar">
                  <div className="search-wrapper"><i className="fa-solid fa-magnifying-glass search-icon"></i><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} type="text" className="search-input" placeholder="ค้นหาชื่อลูกค้า, รหัสสินค้า..." /></div>
                  <div className="view-toggles flex gap-2 ml-4">
                    <button className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('list')}><i className="fa-solid fa-list"></i></button>
                    <button className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('grid')}><i className="fa-solid fa-th"></i></button>
                    {viewMode === 'grid' && <button className="btn btn-sm btn-outline" onClick={() => setIsFullscreen(!isFullscreen)}><i className="fa-solid fa-expand"></i></button>}
                  </div>
                </div>
                {viewMode === 'list' ? (
                  <div className="table-container">
                    <table className="data-table">
                      <thead><tr><th width="80">ลำดับ</th><th width="100">รหัส</th><th>ลูกค้า</th><th width="120" className="text-right">ราคา</th><th width="100" className="text-center">ช่องทาง</th><th width="120">เวลา</th><th width="120" className="text-center">จัดการ</th></tr></thead>
                      <tbody>
                        {filteredOrders.length === 0 ? <tr><td colSpan="7" className="text-center py-20 text-muted">ไม่พบข้อมูลคำสั่งซื้อ</td></tr> : (
                          filteredOrders.map((order, i) => (
                            <tr key={order.stockId} className="hover:bg-slate-700">
                              <td className="text-muted">#{i + 1}</td><td className="font-bold">{order.stockId}</td>
                              <td><div className="customer-name">{order.owner}</div><div className="customer-uid text-sm text-muted">{order.uid}</div></td>
                              <td className="text-right font-mono">{formatCurrency(order.price || 0)}</td>
                              <td className="text-center"><span className={`badge ${order.method === 'manual-force' ? 'badge-warn' : 'badge-info'}`}>{order.method || 'System'}</span></td>
                              <td className="text-sm text-muted">{formatTime(order.timestamp)}</td>
                              <td className="text-center"><div className="action-btns">
                                <button className="btn-action btn-action-edit" onClick={() => openEditModal({ id: order.stockId, ...order })}><i className="fa-solid fa-pen"></i></button>
                                <button className="btn-action btn-action-delete" onClick={() => removeReservation(order.stockId, order.owner)}><i className="fa-solid fa-user-xmark"></i></button>
                              </div></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={`grid-container ${isFullscreen ? 'fullscreen-grid' : ''}`}>
                    {isFullscreen && <div className="fullscreen-header"><h2>รายการขาย {selectedItem.title}</h2><button className="btn btn-danger" onClick={() => setIsFullscreen(false)}><i className="fa-solid fa-compress"></i> ออก</button></div>}
                    <div className="grid-content">
                      {allGridItems.map(it => (
                        <div key={it.id} className={`grid-item ${it.isEmpty ? 'empty' : 'sold'}`} onClick={() => openEditModal(it)}>
                          <div className="item-num">{it.id}</div><div className="item-status">{it.isEmpty ? '-ว่าง-' : it.owner}</div>
                          {!it.isEmpty && it.price && <div className="item-price">{it.price}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000]" onClick={closeEditModal}>
          <div className="edit-modal-box" onClick={e => e.stopPropagation()}>
            <div className="edit-modal-header"><h3><i className="fa-solid fa-pen-to-square"></i> รายการที่ {editingItem?.id}</h3><span className={`reservation-badge ${editingItem?.owner ? 'badge-reserved' : 'badge-empty'}`}>{editingItem?.owner ? '🟢 จองแล้ว' : '⚪ ว่าง'}</span></div>
            <div className="space-y-4">
              <div><label className="block text-slate-400 text-sm mb-1">ชื่อคนจอง</label><input value={editForm.owner} onChange={e => setEditForm({ ...editForm, owner: e.target.value })} type="text" className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 text-white" list="customer-suggestions" /><datalist id="customer-suggestions">{customerNames.map(n => <option key={n} value={n} />)}</datalist></div>
              <div><label className="block text-slate-400 text-sm mb-1">ราคา</label><input value={editForm.price} onChange={e => setEditForm({ ...editForm, price: parseInt(e.target.value) || 0 })} type="number" className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 text-white" /></div>
            </div>
            <div className="edit-modal-actions">
              <div className="edit-modal-actions-left">{editingItem?.owner && <button className="btn btn-warning" onClick={() => removeReservation(editingItem.id, editingItem.owner)}><i className="fa-solid fa-user-xmark"></i> ลบชื่อคนจอง</button>}<button className="btn btn-danger" onClick={() => { Swal.fire({ title: "ล้างรายการนี้?", text: `ต้องการเคลียร์รายการที่ ${editingItem.id}?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "ล้างเลย" }).then(r => { if (r.isConfirmed) { const orders = { ...selectedItem.orders }; delete orders[editingItem.id]; setSelectedItem({ ...selectedItem, orders }); history.updateHistoryItem(selectedId, editingItem.id, null); closeEditModal(); } }); }}><i className="fa-solid fa-eraser"></i> ล้างทั้งหมด</button></div>
              <div className="edit-modal-actions-right"><button className="btn btn-outline" onClick={closeEditModal}>ยกเลิก</button><button className="btn btn-success" onClick={saveEdit}><i className={editingItem?.owner ? 'fa-solid fa-save' : 'fa-solid fa-plus'}></i> {editingItem?.owner ? 'บันทึก' : 'จองให้'}</button></div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default HistoryModal;
