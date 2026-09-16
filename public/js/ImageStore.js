/**
 * ImageStore - Persists image blobs in IndexedDB and hydrates notes.
 */
import { eventBus } from './EventBus.js';
import { store } from './Store.js';

const DB_NAME = 'brainstorm_images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

export class ImageStore {
    constructor() {
        this._dbPromise = null;
        this._objectUrls = new Map();
        this._hydrating = false;

        eventBus.on('note:removed', (note) => this.cleanupNote(note));
        eventBus.on('state:loaded', () => {
            this.revokeAllUrls();
            this.hydrateNotes();
        });
        eventBus.on('state:cleared', () => this.revokeAllUrls());
    }

    init() {
        if (this._dbPromise) return this._dbPromise;
        if (!window.indexedDB) return Promise.resolve(null);
        this._dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this._dbPromise;
    }

    async saveImage(file) {
        if (!file) return null;
        const db = await this.init();
        if (!db) return null;
        const id = store.generateId();
        await this.put(id, file);
        const src = this.createObjectUrl(id, file);
        return { id, src, type: file.type || 'image/png', size: file.size || 0 };
    }

    async getImage(id) {
        if (!id) return null;
        const db = await this.init();
        if (!db) return null;
        const blob = await this.get(id);
        if (!blob) return null;
        const src = this.createObjectUrl(id, blob);
        return { id, src, blob };
    }

    async deleteImage(id) {
        if (!id) return;
        const db = await this.init();
        if (!db) return;
        await this.del(id);
        this.revokeUrl(id);
    }

    async hydrateNotes() {
        if (this._hydrating) return;
        this._hydrating = true;
        await this.init();
        const imageNotes = store.notes.filter(note => note.type === 'image' && note.image);
        if (imageNotes.length === 0) {
            this._hydrating = false;
            return;
        }

        let didChange = false;
        for (const note of imageNotes) {
            if (note.image?.src && note.image?.id) continue;
            if (note.image?.src && !note.image?.id) {
                const migrated = await this.migrateDataUrlNote(note);
                if (migrated) didChange = true;
                continue;
            }
            if (!note.image?.id) continue;
            const entry = await this.getImage(note.image.id);
            if (!entry) continue;
            note.image.src = entry.src;
            didChange = true;
        }

        this._hydrating = false;
        if (didChange) {
            eventBus.emit('notes:changed', store.notes);
            eventBus.emit('data:changed');
        }
    }

    cleanupNote(note) {
        if (!note || note.type !== 'image') return;
        const id = note.image?.id;
        if (!id) return;
        this.deleteImage(id);
    }

    revokeAllUrls() {
        this._objectUrls.forEach((url) => URL.revokeObjectURL(url));
        this._objectUrls.clear();
    }

    revokeUrl(id) {
        const url = this._objectUrls.get(id);
        if (url) {
            URL.revokeObjectURL(url);
            this._objectUrls.delete(id);
        }
    }

    createObjectUrl(id, blob) {
        if (this._objectUrls.has(id)) return this._objectUrls.get(id);
        const url = URL.createObjectURL(blob);
        this._objectUrls.set(id, url);
        return url;
    }

    async put(id, blob) {
        const db = await this.init();
        if (!db) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(blob, id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    async get(id) {
        const db = await this.init();
        if (!db) return null;
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async del(id) {
        const db = await this.init();
        if (!db) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    async migrateDataUrlNote(note) {
        const src = note.image?.src;
        if (!src) return false;
        if (!src.startsWith('data:')) return false;
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            const name = note.image?.name || `image-${Date.now()}.png`;
            const file = new File([blob], name, { type: blob.type || 'image/png' });
            const saved = await this.saveImage(file);
            if (!saved) return false;
            note.image.id = saved.id;
            note.image.src = saved.src;
            return true;
        } catch (e) {
            return false;
        }
    }
}

export const imageStore = new ImageStore();
