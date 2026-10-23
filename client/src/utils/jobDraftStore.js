const DB = 'oxsteed-job-drafts';
const TTL = 7 * 24 * 60 * 60 * 1000;
const versions = new Map();
const saveSequences = new Map();
const serializedFiles = new WeakMap();
const fileMetadata = new WeakMap();
function metadataFor(file) {
  // Multipart shares can expose an unknown modification date as "now" on
  // each access. Capture identity once so pagehide can match committed bytes.
  if (!fileMetadata.has(file))
    fileMetadata.set(file, {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
  return fileMetadata.get(file);
}
let activeAccount = null;
const key = (owner) => `oxsteed:job-draft:${owner}`;
function localRead(owner) {
  try {
    return JSON.parse(localStorage.getItem(key(owner)));
  } catch {
    return null;
  }
}
async function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('drafts', { keyPath: 'owner' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () =>
      reject(request.error || new Error('storage_unavailable'));
  });
}
async function transact(work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      let result;
      work(tx.objectStore('drafts'), (value) => {
        result = value;
      });
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(tx.error || new Error('storage_unavailable'));
    });
  } finally {
    db.close();
  }
}
export function setDraftAccount(value) {
  const next = value == null ? null : String(value),
    previous = activeAccount;
  activeAccount = next;
  if (previous && previous !== next) clearJobDraft(previous).catch(() => {});
  if (!next) {
    try {
      localStorage.removeItem('oxsteed:job-draft-mirror');
    } catch {}
  }
}
export async function readJobDraft(owner) {
  owner = String(owner);
  if (activeAccount !== owner) return null;
  let record;
  try {
    record = await transact((store, done) => {
      const get = store.get(owner);
      get.onsuccess = () => done(get.result);
    });
  } catch {
    /* Text fallback is scoped to this account too. */
  }
  const fallback = localRead(owner);
  if (fallback?.savedAt > (record?.savedAt || 0)) {
    // pagehide can save newer text synchronously while its IndexedDB write is
    // interrupted. Reuse committed photos only when their identity matches.
    record = {
      ...fallback,
      files:
        fallback.fileSignature &&
        fallback.fileSignature === record?.fileSignature
          ? record.files
          : [],
    };
  }
  if (
    !record ||
    record.owner !== owner ||
    record.savedAt < Date.now() - TTL ||
    activeAccount !== owner
  ) {
    if (record?.savedAt < Date.now() - TTL) await clearJobDraft(owner);
    return null;
  }
  return {
    ...record,
    files: (record.files || []).map((file) =>
      typeof file.arrayBuffer === 'function'
        ? file
        : new File([file.bytes], file.name, {
            type: file.type,
            lastModified: file.lastModified,
          }),
    ),
  };
}
export async function saveJobDraft(owner, draft) {
  owner = String(owner);
  const version = versions.get(owner) || 0;
  const sequence = (saveSequences.get(owner) || 0) + 1;
  saveSequences.set(owner, sequence);
  if (activeAccount !== owner) return { saved: false, photosSaved: false };
  const files = draft.mediaTab === 'photos' ? draft.files || [] : [];
  const supported =
    files.length <= 5 &&
    files.every(
      (file) =>
        ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
          file.type,
        ) && file.size <= 10 * 1024 * 1024,
    ) &&
    files.reduce((n, file) => n + file.size, 0) <= 50 * 1024 * 1024;
  const fileSignature = files
    .map((file) => {
      const m = metadataFor(file);
      return [m.name, m.size, m.lastModified, m.type].join(':');
    })
    .join('|');
  const record = {
    owner,
    fileSignature,
    photoCount: files.length,
    payload: draft.payload,
    wizard_step: draft.wizard_step,
    mediaTab: draft.mediaTab,
    savedAt: Date.now(),
    files: supported ? files : [],
  };
  let textSaved = false;
  try {
    localStorage.setItem(key(owner), JSON.stringify({ ...record, files: [] }));
    textSaved = true;
  } catch {}
  try {
    // Normalize file-backed inputs to structured-cloneable bytes. WebKit can
    // reject a direct File reference from a file picker even while it previews.
    const storedFiles = await Promise.all(
      (supported ? files : []).map((file) => {
        if (!serializedFiles.has(file))
          serializedFiles.set(
            file,
            file
              .arrayBuffer()
              .then((bytes) => ({ ...metadataFor(file), bytes })),
          );
        return serializedFiles.get(file);
      }),
    );
    const committed = await transact((store, done) => {
      if (
        activeAccount !== owner ||
        (versions.get(owner) || 0) !== version ||
        saveSequences.get(owner) !== sequence
      ) {
        done(false);
        return;
      }
      const existing = store.get(owner);
      existing.onsuccess = () => {
        if (
          activeAccount !== owner ||
          (versions.get(owner) || 0) !== version ||
          saveSequences.get(owner) !== sequence ||
          existing.result?.savedAt > record.savedAt
        ) {
          done(false);
          return;
        }
        store.put({ ...record, files: storedFiles });
        done(true);
      };
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          if (row.value.savedAt < Date.now() - TTL) row.delete();
          row.continue();
        }
      };
    });
    return {
      saved: Boolean(committed),
      photosSaved: Boolean(committed) && supported,
    };
  } catch {
    return { saved: textSaved, photosSaved: files.length === 0 };
  }
}
export async function clearJobDraft(owner) {
  owner = String(owner);
  versions.set(owner, (versions.get(owner) || 0) + 1);
  try {
    localStorage.removeItem(key(owner));
    localStorage.removeItem('oxsteed:job-draft-mirror');
  } catch {}
  try {
    await transact((store) => store.delete(owner));
  } catch {}
}
