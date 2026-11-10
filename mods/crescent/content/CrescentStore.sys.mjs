// Crescent's saved data: the Archive (closed tabs) and Easels.
// Everything lives in the browser profile folder as JSON files.
// One copy of this module is shared by every window and page.

import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const ARCHIVE_FILE = "crescent-archive.json";
const EASELS_DIR = "crescent-easels";
const ARCHIVE_MAX = 3000;

function profilePath(...parts) {
  return PathUtils.join(PathUtils.profileDir, ...parts);
}

function uuid() {
  return Services.uuid.generateUUID().toString().slice(1, -1);
}

function notify(topic) {
  Services.obs.notifyObservers(null, topic);
}

// Writes a file at most once per `delay` ms, always with the latest data.
function debouncedWriter(getPath, getData, delay = 800) {
  let timer = null;
  let pending = Promise.resolve();
  const flush = () => {
    timer = null;
    pending = pending
      .then(() => IOUtils.writeJSON(getPath(), getData(), { tmpPath: getPath() + ".tmp" }))
      .catch(e => console.error("Crescent: save failed", e));
    return pending;
  };
  return {
    schedule() {
      if (!timer) {
        timer = setTimeout(flush, delay);
      }
    },
    async now() {
      if (timer) {
        clearTimeout(timer);
      }
      return flush();
    },
  };
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------
let archive = null; // { entries: [...] } newest first
let archiveLoading = null;
const archiveWriter = debouncedWriter(() => profilePath(ARCHIVE_FILE), () => archive);

async function loadArchive() {
  if (archive) {
    return archive;
  }
  archiveLoading ??= (async () => {
    try {
      const data = await IOUtils.readJSON(profilePath(ARCHIVE_FILE));
      archive = { entries: Array.isArray(data?.entries) ? data.entries : [] };
    } catch {
      archive = { entries: [] };
    }
    return archive;
  })();
  return archiveLoading;
}

// ---------------------------------------------------------------------------
// Easels
// ---------------------------------------------------------------------------
let easelIndex = null; // [{ id, title, updated, thumb }]
const indexWriter = debouncedWriter(() => profilePath(EASELS_DIR, "index.json"), () => ({ easels: easelIndex }), 300);

async function loadEaselIndex() {
  if (easelIndex) {
    return easelIndex;
  }
  await IOUtils.makeDirectory(profilePath(EASELS_DIR), { ignoreExisting: true });
  try {
    const data = await IOUtils.readJSON(profilePath(EASELS_DIR, "index.json"));
    easelIndex = Array.isArray(data?.easels) ? data.easels : [];
  } catch {
    easelIndex = [];
  }
  return easelIndex;
}

function safeId(id) {
  if (!/^[a-f0-9-]{8,40}$/.test(String(id))) {
    throw new Error("Bad easel id");
  }
  return id;
}

export const CrescentStore = {
  // ----- Archive -----
  async getArchive() {
    return (await loadArchive()).entries;
  },

  async addArchive(entry) {
    const a = await loadArchive();
    const now = Date.now();
    // The same page closing twice within a few seconds is one event
    // (Zen mirrors tabs between windows, and each copy fires a close).
    if (a.entries.some(e => e.url === entry.url && now - e.closedAt < 4000)) {
      return;
    }
    a.entries.unshift({ id: uuid(), closedAt: now, ...entry });
    if (a.entries.length > ARCHIVE_MAX) {
      a.entries.length = ARCHIVE_MAX;
    }
    archiveWriter.schedule();
    notify("crescent-archive-changed");
  },

  async removeArchive(id) {
    const a = await loadArchive();
    a.entries = a.entries.filter(e => e.id !== id);
    archiveWriter.schedule();
    notify("crescent-archive-changed");
  },

  async clearArchive() {
    const a = await loadArchive();
    a.entries = [];
    archiveWriter.schedule();
    notify("crescent-archive-changed");
  },

  // ----- Easels -----
  async listEasels() {
    const list = await loadEaselIndex();
    return [...list].sort((x, y) => y.updated - x.updated);
  },

  async createEasel(title = "Untitled Easel") {
    const list = await loadEaselIndex();
    const easel = { id: uuid(), title, created: Date.now(), updated: Date.now(), background: "dots", items: [] };
    await IOUtils.writeJSON(profilePath(EASELS_DIR, easel.id + ".json"), easel);
    list.push({ id: easel.id, title, updated: easel.updated, thumb: null });
    await indexWriter.now();
    notify("crescent-easels-changed");
    return easel;
  },

  async loadEasel(id) {
    return IOUtils.readJSON(profilePath(EASELS_DIR, safeId(id) + ".json"));
  },

  async saveEasel(easel, thumb = undefined) {
    const list = await loadEaselIndex();
    easel.updated = Date.now();
    await IOUtils.writeJSON(profilePath(EASELS_DIR, safeId(easel.id) + ".json"), easel, {
      tmpPath: profilePath(EASELS_DIR, easel.id + ".tmp"),
    });
    const row = list.find(e => e.id === easel.id);
    if (row) {
      row.title = easel.title;
      row.updated = easel.updated;
      if (thumb !== undefined) {
        row.thumb = thumb;
      }
    }
    indexWriter.schedule();
    notify("crescent-easels-changed");
  },

  async deleteEasel(id) {
    const list = await loadEaselIndex();
    easelIndex = list.filter(e => e.id !== id);
    await IOUtils.remove(profilePath(EASELS_DIR, safeId(id) + ".json"), { ignoreAbsent: true });
    await indexWriter.now();
    notify("crescent-easels-changed");
  },

  async flush() {
    await archiveWriter.now();
    await indexWriter.now();
  },
};
