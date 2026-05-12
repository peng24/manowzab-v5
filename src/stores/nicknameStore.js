import { create } from 'zustand';
import { db } from '../services/firebase';
import { ref as dbRef, onValue } from "firebase/database";
import { logger } from "../utils/logger";

const SPECIAL_NAMES_TTS = {
  "รุ่งนภา ชม.": "คุณรุ่งนภา เชียงใหม่",
  "รุ่งนภา ชม": "คุณรุ่งนภา เชียงใหม่",
  "อัจฉรา จิน": "คุณอัจฉรา จินดาธรรม",
  "จิราพร เต": "คุณจิราพร เตชาทวีวรรณ"
};

export const useNicknameStore = create((set, get) => ({
  nicknames: {},

  initNicknameListener: () => {
    return onValue(dbRef(db, "nicknames"), (snapshot) => {
      const data = snapshot.val() || {};
      set({ nicknames: data });
      logger.debug("📌 Nicknames updated:", Object.keys(data).length);
    });
  },

  getNickname: (uid, realName) => {
    const { nicknames } = get();
    if (nicknames[uid]) {
      return typeof nicknames[uid] === "object"
        ? nicknames[uid].nick
        : nicknames[uid];
    }
    return realName;
  },

  getPhoneticName: (uid, displayName) => {
    const { nicknames } = get();
    if (SPECIAL_NAMES_TTS[displayName]) {
      return SPECIAL_NAMES_TTS[displayName];
    }

    let nameToRead = displayName;
    if (nicknames[uid]?.phonetic) {
      nameToRead = nicknames[uid].phonetic;
    }

    const emojiRegex = /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF]|\uD83F[\uDC00-\uDFFF]|[\u2000-\u26FF])/g;
    nameToRead = nameToRead.replace(emojiRegex, "").trim();

    if (nameToRead) {
      const titles = ["คุณ", "พี่", "น้อง", "เฮีย", "เจ๊", "ป้า", "น้า", "อา", "ลุง", "ตา", "ยาย", "แม่", "พ่อ", "ดร.", "หมอ", "ครู", "ซ้อ", "เสี่ย"];
      const hasTitle = titles.some(t => nameToRead.startsWith(t));

      if (!hasTitle) {
        nameToRead = "คุณ" + nameToRead;
      }
    }

    return nameToRead;
  }
}));
