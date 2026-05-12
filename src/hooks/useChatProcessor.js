import { useStockStore } from "../stores/stockStore";
import { useChatStore } from "../stores/chatStore";
import { useSystemStore } from "../stores/systemStore";
import { useNicknameStore } from "../stores/nicknameStore";
import { useAudio } from "./useAudio";
import { ref as dbRef, onValue, update, push, get } from "firebase/database";
import { db } from "../services/firebase";
import { extractMessageRuns } from "../services/YouTubeLiveChat";
import Swal from "sweetalert2";
import { logger } from "../utils/logger";

const multiBuyRegex = /^(?:F|f|cf|CF|รับ|เอา|เิา)?\s*(\d+(?:[\s,_]+\d+)+)(?:\s+(.*))?$/i;
const adminProxyNumFirstRegex = /^(\d+)\s+([ก-๙a-zA-Z].*)$/;
const adminProxyNameFirstRegex = /^([ก-๙a-zA-Z][^]*?)\s+(\d+)$/;
const shippingRegex = /โอน|ส่ง|สลิป|ยอด|ที่อยู่|ปลายทาง|พร้อม/;
const questionRegex = /อก|เอว|สะโพก|ยาว|ราคา|เท่าไหร่|เท่าไร|ทไหร่|กี่บาท|แบบไหน|ผ้า|สี|ตำหนิ|ไหม|มั้ย|ป่าว|ขอดู|รีวิว|ว่าง|เหลือ|ยังอยู่|ไซส์|ใหม่|หรอ|ปะ|ยังไง/;
const pureNumberRegex = /^\s*(\d+)\s*$/;
const explicitBuyRegex = /(?:(?:F|f|cf|CF|รับ|เอา|เิา)\s*(?:ค่ะ|ครับ|จ้า|นะ|คะ)?\s*(\d+))|(?:(\d+)\s*(?:ค่ะ|ครับ|จ้า|นะ|คะ)?\s*(?:F|f|cf|CF|รับ|เอา|เิา))/i;
const numberWithPoliteRegex = /^.{0,10}?(\d+)\s*(?:ค่ะ|ครับ|จ้า|จ้ะ|พี่|ป้า|น้า|อา|แม่|น้อง|ออเดอร์|\/\/)/;
const dashBuyRegex = /^([^-]+)\s*[-]\s*(\d+)$/;
const customerNameNumRegex = /^([ก-๙a-zA-Z][ก-๙a-zA-Z\s]{1,}?)\s+(\d+)$/;
const cancelRegex = /(?:^|\s)(?:(?:cc|cancel|ยกเลิก|ยกเลิ|ไม่เอา|หลุด|ผ่าน|ขอผ่าน|เปลี่ยนใจ)\s*[-]?\s*(\d+)|(\d+)\s+[\s\S]*?(?:cc|cancel|ยกเลิก|ยกเลิ|ไม่เอา|หลุด|ผ่าน|ขอผ่าน|เปลี่ยนใจ)|(\d+)\s*(?:cc|cancel|ยกเลิก|ยกเลิ|ไม่เอา|หลุด|ผ่าน|ขอผ่าน|เปลี่ยนใจ))/i;

function thaiToArabic(text) { return text.replace(/[๐-๙]/g, (ch) => ch.charCodeAt(0) - 0x0e50); }

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.addEventListener("mouseenter", Swal.stopTimer);
    toast.addEventListener("mouseleave", Swal.resumeTimer);
  },
});

const processingLocks = new Set();
const warnedNewCustomers = new Set();

export function useChatProcessor() {
  const stockStore = useStockStore();
  const chatStore = useChatStore();
  const systemStore = useSystemStore();
  const nicknameStore = useNicknameStore();
  const { queueAudio } = useAudio();

  const stringToColor = (str) => {
    let hash = 0; for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 85%, 75%)`;
  };

  const processMessage = async (item) => {
    if (!item.snippet || !item.authorDetails) return;
    let msg = item.snippet.displayMessage || "";
    if (!msg) { 
      const runs = extractMessageRuns(item); 
      msg = runs.map(r => r.text || '').join('').trim(); 
      if (!msg) return; 
    }
    
    const normalizedMsg = thaiToArabic(msg);
    const uid = item.authorDetails.channelId;
    const realName = item.authorDetails.displayName;
    const avatar = item.authorDetails.profileImageUrl || "https://www.gstatic.com/youtube/img/creator/avatars/sample_avatar.png";

    const nicknames = nicknameStore.nicknames;
    let displayName = realName;
    let isNewCustomer = true;
    if (nicknames[uid]) {
      isNewCustomer = false;
      displayName = typeof nicknames[uid] === "object" ? nicknames[uid].nick : nicknames[uid];
    }

    const phoneticName = nicknameStore.getPhoneticName(uid, displayName);
    const isAdmin = /admin|แอดมิน/i.test(displayName) || /admin|แอดมิน/i.test(realName);
    
    let ttsMessage = msg;
    if (isNewCustomer && !isAdmin && !warnedNewCustomers.has(uid)) {
      warnedNewCustomers.add(uid);
      ttsMessage = `${msg} ... ลูกค้าใหม่ พิมพ์ชื่อ ตามด้วยรหัสเพื่อจอง ... ค่าส่ง โอน 40 ... ปลายทาง 50 ค่ะ`;
    }

    let intent = null, targetId = null, targetPrice = null, method = null, forcedOwnerName = null;

    const matchMultiBuy = normalizedMsg.match(multiBuyRegex);
    if (matchMultiBuy) {
      const itemIds = matchMultiBuy[1].split(/[\s,_]+/).map(n => parseInt(n)).filter(n => n > 0);
      const proxyName = matchMultiBuy[2]?.trim();
      if (itemIds.length > 0) {
        const maxId = Math.max(...itemIds);
        if (maxId > stockStore.stockSize) {
          const newSize = Math.ceil(maxId / 10) * 10;
          await stockStore.updateStockSize(newSize);
          logger.log(`📦 Auto-expanded stock to ${newSize} for multi-buy`);
        }
        
        let oName = displayName, oUid = uid;
        if (proxyName && isAdmin) { 
          oName = proxyName; 
          oUid = "multi-proxy-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5); 
        }
        
        for (const id of itemIds) {
          if (processingLocks.has(id)) continue;
          processingLocks.add(id);
          try { await stockStore.processOrder(id, oName, oUid, "chat", null, "multi-buy"); } finally { processingLocks.delete(id); }
        }
        
        Toast.fire({ icon: "success", title: `✅ ตัดรหัส ${itemIds.join(", ")} ให้ ${oName} แล้ว` });
        chatStore.sendMessageToFirebase(systemStore.currentVideoId, { id: item.id, text: msg, messageRuns: extractMessageRuns(item), authorName: realName, displayName, phoneticName, realName, uid, avatar, color: stringToColor(uid), isAdmin, type: "buy", detectionMethod: "multi-buy", timestamp: new Date(item.snippet.publishedAt).getTime() });
        queueAudio("success", phoneticName, `${ttsMessage} ... ทั้งหมด ${itemIds.length} รายการ`);

        // Add to new orders highlight
        const { addNewOrder } = useStockStore.getState();
        if (addNewOrder) {
          itemIds.forEach(id => addNewOrder(id));
        }
        return;
      }
    }

    const earlyMatchCancel = normalizedMsg.match(cancelRegex);
    if (earlyMatchCancel) { 
      intent = "cancel"; 
      targetId = parseInt(earlyMatchCancel[1] || earlyMatchCancel[2] || earlyMatchCancel[3]); 
      method = "regex-cancel"; 
    }
    else if (shippingRegex.test(normalizedMsg)) {
      intent = "shipping"; method = "regex-ship";
      let autoShipDate = null, autoShipName = displayName, autoShipUid = uid, isAutoShip = false;
      const shipNowMatch = normalizedMsg.match(/ส่งเลย|ส่งวันนี้/);
      const shipTmrMatch = normalizedMsg.match(/ส่งพรุ่งนี้|พรุ่งนี้ส่ง|ส่งวันพรุ่งนี้/);
      const shipDateMatch = normalizedMsg.match(/ส่ง(?:วันที่\s*)?(\d{1,2})(?:\s*)(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)?/);
      
      let mKey = shipNowMatch?.[0] || shipTmrMatch?.[0] || shipDateMatch?.[0];
      if (isAdmin && mKey) {
        let clean = normalizedMsg.replace(mKey, "").replace(/^[^\w\u0E00-\u0E7F]+|[^\w\u0E00-\u0E7F]+$/g, "").trim();
        if (clean) {
          autoShipName = clean;
          let fUid = Object.keys(nicknames).find(k => {
             const v = nicknames[k];
             const nick = typeof v === "object" ? v.nick : v;
             return nick && nick.trim() === autoShipName;
          });
          autoShipUid = fUid || "manual-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5);
        }
      }
      
      if (shipNowMatch) { isAutoShip = true; autoShipDate = new Date(); }
      else if (shipTmrMatch) { isAutoShip = true; autoShipDate = new Date(); autoShipDate.setDate(autoShipDate.getDate() + 1); }
      else if (shipDateMatch) {
        isAutoShip = true; autoShipDate = new Date(); const day = parseInt(shipDateMatch[1]); autoShipDate.setDate(day);
        const mStr = shipDateMatch[2];
        if (mStr) {
          const mS = ["มค", "กพ", "มีค", "เมย", "พค", "มิย", "กค", "สค", "อย", "ตค", "พย", "ธค"], mF = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
          let cM = mStr.replace(/\./g, ''), mI = mS.indexOf(cM); if (mI === -1) mI = mF.indexOf(cM);
          if (mI !== -1) autoShipDate.setMonth(mI);
        }
        if (autoShipDate < new Date() && (new Date().getDate() - day) > 15) autoShipDate.setMonth(autoShipDate.getMonth() + 1);
      }
      
      if (isAutoShip) {
        const ds = `${autoShipDate.getFullYear()}-${String(autoShipDate.getMonth() + 1).padStart(2, '0')}-${String(autoShipDate.getDate()).padStart(2, '0')}`;
        let tUid = autoShipUid;
        try {
          const eSnap = await get(dbRef(db, 'delivery_customers'));
          const eEntry = Object.entries(eSnap.val() || {}).find(([, v]) => v.name === autoShipName && v.status !== 'done');
          if (eEntry) tUid = eEntry[0];
        } catch (e) { logger.warn('Dedup check failed:', e); }
        
        update(dbRef(db, `delivery_customers/${tUid}`), { name: autoShipName, deliveryDate: ds, status: "pending", updatedAt: Date.now() });
        Toast.fire({ icon: "success", title: `📦 เพิ่มรอบส่งให้ ${autoShipName} แล้ว` });
      }
    } else if (questionRegex.test(normalizedMsg)) { method = "question-skip"; }
    else {
      const mP = normalizedMsg.match(pureNumberRegex), mE = normalizedMsg.match(explicitBuyRegex), mPol = normalizedMsg.match(numberWithPoliteRegex), mD = normalizedMsg.match(dashBuyRegex), mC = normalizedMsg.match(customerNameNumRegex);
      const mAN = isAdmin ? normalizedMsg.match(adminProxyNameFirstRegex) : null, mAnum = isAdmin ? normalizedMsg.match(adminProxyNumFirstRegex) : null;
      
      if (mAN) { intent = "buy"; targetId = parseInt(mAN[2]); forcedOwnerName = mAN[1].trim(); method = "admin-proxy-name-first"; }
      else if (mAnum) { intent = "buy"; targetId = parseInt(mAnum[1]); forcedOwnerName = mAnum[2].trim(); method = "admin-proxy-num-first"; }
      else if (mP) { intent = "buy"; targetId = parseInt(mP[1]); method = "regex-pure"; }
      else if (mE) { intent = "buy"; targetId = parseInt(mE[1] || mE[2]); method = "regex-explicit"; }
      else if (mPol) { intent = "buy"; targetId = parseInt(mPol[1]); method = "regex-polite"; }
      else if (mD) { intent = "buy"; targetId = parseInt(mD[2]); method = "regex-dash"; }
      else if (mC) { 
        const n = mC[1].trim(); 
        if (!questionRegex.test(n) && !shippingRegex.test(n)) { 
          intent = "buy"; targetId = parseInt(mC[2]); forcedOwnerName = n; method = "regex-customer-name"; 
        } 
      }
    }

    chatStore.sendMessageToFirebase(systemStore.currentVideoId, { id: item.id, text: msg, messageRuns: extractMessageRuns(item), authorName: realName, displayName, phoneticName, realName, uid, avatar, color: stringToColor(uid), isAdmin, type: intent, detectionMethod: method, timestamp: new Date(item.snippet.publishedAt).getTime() });

    if (intent === "buy" && targetId > 0) {
      if (targetId > stockStore.stockSize) {
        const newSize = Math.ceil(targetId / 10) * 10;
        await stockStore.updateStockSize(newSize);
        logger.log(`📦 Auto-expanded stock to ${newSize} for item ${targetId}`);
      }
      
      let oName = displayName, oUid = uid;
      if (forcedOwnerName) { 
        oName = forcedOwnerName; 
        oUid = "proxy-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5); 
      }
      else if (isAdmin) { 
        let clean = msg.replace(targetId.toString(), "").replace(/f|cf|รับ|เอา|=/gi, ""); 
        if (targetPrice) clean = clean.replace(targetPrice.toString(), ""); 
        clean = clean.replace(/^[^\w\u0E00-\u0E7F]+|[^\w\u0E00-\u0E7F]+$/g, "").trim(); 
        oName = clean || displayName; 
        oUid = "admin-proxy-" + Date.now(); 
      }
      
      if (processingLocks.has(targetId)) { 
        queueAudio("error", phoneticName, ttsMessage); 
        return; 
      }
      
      processingLocks.add(targetId);
      try {
        const res = await stockStore.processOrder(targetId, oName, oUid, "chat", targetPrice, method);
        if (res.action === "already_owned" || res.action === "already_queued" || !res.success) { 
          queueAudio("error", phoneticName, ttsMessage); 
          return; 
        }
        Toast.fire({ icon: "success", title: `✅ ตัดรหัส ${targetId} ให้ ${oName} แล้ว` });
        queueAudio("success", phoneticName, ttsMessage);
        
        // Add to new orders highlight
        const { addNewOrder } = useStockStore.getState();
        if (addNewOrder) addNewOrder(targetId);
      } finally { processingLocks.delete(targetId); }
    } else if (intent === "cancel" && targetId > 0) {
      const cI = stockStore.stockData[targetId]; 
      if (isAdmin || (cI && cI.uid === uid)) { 
        await stockStore.processCancel(targetId); 
        queueAudio("cancel", phoneticName, ttsMessage); 
      }
    } else {
      if (intent === "shipping") {
        update(dbRef(db, `shipping/${systemStore.currentVideoId}/${uid}`), { ready: true, timestamp: Date.now(), lastMessage: msg });
        push(dbRef(db, `shipping/${systemStore.currentVideoId}/${uid}/history`), { text: msg, timestamp: Date.now(), type: "user" });
      }
      queueAudio(null, phoneticName, ttsMessage);
    }
  };

  return { processMessage };
}
