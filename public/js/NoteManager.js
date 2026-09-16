/**
 * NoteManager - Handles note CRUD operations and measurements
 */
import { eventBus } from './EventBus.js';
import { store, DEFAULTS } from './Store.js';
import { imageStore } from './ImageStore.js';

export class NoteManager {
    constructor() {
        // Create an offscreen canvas for text measurement
        this._measureCanvas = document.createElement('canvas');
        this._measureCtx = this._measureCanvas.getContext('2d');
        this._linkMetadataCache = new Map();
        
        this._setupEventListeners();
    }

    _setupEventListeners() {
        eventBus.on('note:create', (x, y, text, groupId) => {
            const note = this.addNote(x, y, text, groupId);
            eventBus.emit('note:edit', note);
        });

        eventBus.on('note:createImage', async (x, y, imageData, groupId) => {
            const note = await this.addImageNote(x, y, imageData, groupId);
            if (note) {
                store.setSelection('note', [note.id]);
            }
        });

        eventBus.on('note:added', (note) => this.updateLinkPreview(note, false));
        eventBus.on('state:loaded', () => this.refreshLinkPreviews());
        
        eventBus.on('note:updateStyle', (key, value) => this.updateNoteStyle(key, value));
        eventBus.on('note:toggleBoolean', (key) => this.toggleNoteBoolean(key));
        eventBus.on('note:fitToContent', () => this.fitNotesToContent());
        eventBus.on('selection:delete', () => this.handleDelete());
    }

    /**
     * Add a new note
     */
    addNote(x, y, text = "", groupId = null) {
        if (!groupId) {
            const hitGroup = this.findGroupAtPoint(x, y);
            if (hitGroup) groupId = hitGroup.id;
        }
        // Snap to grid if enabled
        if (store.grid.enabled) {
            x = store.snapToGrid(x);
            y = store.snapToGrid(y);
        }
        
        const note = {
            id: store.generateId(),
            x: x, 
            y: y, 
            w: 100, 
            h: 50,
            text: text,
            fixedWidth: false,
            groupId: groupId,
            relX: 0,
            relY: 0,
            style: { ...DEFAULTS.note },
            link: null,
            type: 'text'
        };

        if (note.groupId) {
            const group = store.getGroupById(note.groupId);
            if (group) {
                note.relX = note.x - group.x;
                note.relY = note.y - group.y;
            } else {
                note.groupId = null;
            }
        }
        
        const dims = this.measureNote(note);
        note.w = dims.w;
        note.h = dims.h;
        
        store.addNote(note);
        if (note.groupId) {
            const group = store.getGroupById(note.groupId);
            if (group) {
                eventBus.emit('group:updateSize', group);
            }
        }
        eventBus.emit('ui:updateEmptyState');
        eventBus.emit('data:changed');
        
        return note;
    }

    async addImageNote(x, y, imageData, groupId = null) {
        if (!imageData || !imageData.file) return null;

        if (!groupId) {
            const hitGroup = this.findGroupAtPoint(x, y);
            if (hitGroup) groupId = hitGroup.id;
        }
        if (store.grid.enabled) {
            x = store.snapToGrid(x);
            y = store.snapToGrid(y);
        }

        await imageStore.init();
        const saved = await imageStore.saveImage(imageData.file);
        if (!saved) return null;
        const dims = this.getImageNoteSize(imageData.width, imageData.height);
        const note = {
            id: store.generateId(),
            x: x,
            y: y,
            w: dims.w,
            h: dims.h,
            text: '',
            fixedWidth: true,
            groupId: groupId,
            relX: 0,
            relY: 0,
            style: { ...DEFAULTS.note },
            link: null,
            type: 'image',
            image: {
                id: saved.id,
                src: saved.src,
                width: imageData.width || dims.w,
                height: imageData.height || dims.h,
                name: imageData.name || ''
            }
        };

        if (note.groupId) {
            const group = store.getGroupById(note.groupId);
            if (group) {
                note.relX = note.x - group.x;
                note.relY = note.y - group.y;
            } else {
                note.groupId = null;
            }
        }

        store.addNote(note);
        if (note.groupId) {
            const group = store.getGroupById(note.groupId);
            if (group) {
                eventBus.emit('group:updateSize', group);
            }
        }
        eventBus.emit('ui:updateEmptyState');
        eventBus.emit('data:changed');

        return note;
    }

    findGroupAtPoint(x, y) {
        for (let i = store.groups.length - 1; i >= 0; i--) {
            const group = store.groups[i];
            const height = group.collapsed ? 40 : group.h;
            if (x >= group.x && x <= group.x + group.w && y >= group.y && y <= group.y + height) {
                return group;
            }
        }
        return null;
    }

    /**
     * Get word-wrapped lines for text
     */
    getWrappedLines(ctx, text, maxWidth) {
        const paragraphs = text.split('\n');
        const lines = [];
        paragraphs.forEach(paragraph => {
            if (paragraph === '') { 
                lines.push(''); 
                return; 
            }
            const words = paragraph.split(' ');
            let currentLine = words[0];
            for (let i = 1; i < words.length; i++) {
                const word = words[i];
                const width = ctx.measureText(currentLine + " " + word).width;
                if (width < maxWidth) {
                    currentLine += " " + word;
                } else { 
                    lines.push(currentLine); 
                    currentLine = word; 
                }
            }
            lines.push(currentLine);
        });
        return lines;
    }

    /**
     * Measure note dimensions based on text content
     */
    measureNote(note) {
        if (note.type === 'image') {
            return { w: note.w || 240, h: note.h || 180 };
        }
        const linkDims = this.measureLinkNote(note);
        if (linkDims) return linkDims;

        const ctx = this._measureCtx;
        const style = note.style;
        const fontStyle = style.italic ? 'italic' : 'normal';
        const fontWeight = style.bold ? 'bold' : 'normal';
        ctx.font = `${fontStyle} ${fontWeight} ${style.fontSize}px ${DEFAULTS.fontFamily}`;
        const padding = DEFAULTS.padding;
        const lineHeight = style.fontSize * DEFAULTS.lineHeightRatio;
        const baseMetrics = ctx.measureText('Mg');
        const baseLineHeight = (Number.isFinite(baseMetrics.actualBoundingBoxAscent)
            && Number.isFinite(baseMetrics.actualBoundingBoxDescent))
            ? baseMetrics.actualBoundingBoxAscent + baseMetrics.actualBoundingBoxDescent
            : style.fontSize;
        const measureLineWidth = (line) => {
            const metrics = ctx.measureText(line);
            if (Number.isFinite(metrics.actualBoundingBoxLeft) && Number.isFinite(metrics.actualBoundingBoxRight)) {
                return metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
            }
            return metrics.width;
        };

        if (note.fixedWidth) {
            const maxWidth = note.w - (padding * 2);
            const lines = this.getWrappedLines(ctx, note.text, Math.max(1, maxWidth));
            const textHeight = lines.length > 0 ? ((lines.length - 1) * lineHeight) + baseLineHeight : 0;
            return { w: note.w, h: Math.ceil(Math.max(50, textHeight + (padding * 2))) };
        } else {
            // Measure unwrapped text width
            const paragraphs = note.text.split('\n');
            let unwrappedMaxWidth = 0;
            paragraphs.forEach(para => {
                const w = measureLineWidth(para);
                if (w > unwrappedMaxWidth) unwrappedMaxWidth = w;
            });
            
            // Determine ideal max width based on text length
            const totalChars = note.text.length;
            let idealMaxWidth;
            if (totalChars < 30) {
                idealMaxWidth = 300;
            } else if (totalChars < 60) {
                idealMaxWidth = 400;
            } else if (totalChars < 120) {
                idealMaxWidth = 500;
            } else {
                idealMaxWidth = 600;
            }
            
            const wrapWidth = Math.min(unwrappedMaxWidth, idealMaxWidth);
            const lines = this.getWrappedLines(ctx, note.text, wrapWidth);
            
            let maxW = 0;
            lines.forEach(line => { 
                const w = measureLineWidth(line); 
                if (w > maxW) maxW = w; 
            });
            
            const finalWidth = lines.length > paragraphs.length ? wrapWidth : maxW;
            const textHeight = lines.length > 0 ? ((lines.length - 1) * lineHeight) + baseLineHeight : 0;
            
            return { 
                w: Math.ceil(Math.max(60, finalWidth + (padding * 2))), 
                h: Math.ceil(Math.max(50, textHeight + (padding * 2))) 
            };
        }
    }

    measureLinkNote(note) {
        const url = note.link?.url || this.normalizeLink(note.text);
        if (!url) return null;

        const minWidth = 260;
        const minHeight = 180;
        if (note.fixedWidth) {
            return {
                w: note.w,
                h: note.h
            };
        }

        return { 
            w: Math.max(minWidth, note.w || 0), 
            h: Math.max(minHeight, note.h || 0) 
        };
    }

    normalizeLink(text) {
        const trimmed = text.trim();
        if (!trimmed || /\s/.test(trimmed)) return null;
        if (!this.isLikelyUrl(trimmed)) return null;

        try {
            const url = new URL(trimmed);
            if (!['http:', 'https:'].includes(url.protocol)) return null;
            return url.href;
        } catch (e) {
            return null;
        }
    }

    isLikelyUrl(text) {
        const hasScheme = /^https?:\/\//i.test(text);
        if (!hasScheme) return false;
        let candidate;
        try {
            candidate = new URL(text);
        } catch (e) {
            return false;
        }

        const hostname = candidate.hostname;
        if (hostname === 'localhost') return true;
        if (!this.isValidHostname(hostname)) return false;

        const hostFromRaw = (hasScheme ? text.slice(text.indexOf('//') + 2) : text).split(/[/?#]/)[0];
        if (!hostFromRaw || hostFromRaw.endsWith('.')) return false;
        if (/[),;:]$/.test(hostFromRaw)) return false;

        return true;
    }

    isValidHostname(hostname) {
        const labels = hostname.split('.');
        if (labels.length < 2) return false;
        const tld = labels[labels.length - 1];
        if (tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) return false;
        return labels.every(label => (
            /^[A-Za-z0-9-]+$/.test(label)
            && !label.startsWith('-')
            && !label.endsWith('-')
        ));
    }


    updateLinkPreview(note, emitChange = true) {
        if (!note) return false;

        const url = this.normalizeLink(note.text);
        if (!url) {
            if (note.link) {
                note.link = null;
                if (emitChange) {
                    eventBus.emit('notes:changed', store.notes);
                    eventBus.emit('data:changed');
                }
                return true;
            }
            return false;
        }

        const hostname = new URL(url).hostname;
        const needsRefresh = !note.link || note.link.url !== url;
        const shouldFetch = needsRefresh || note.link?.isLoading;

        if (needsRefresh) {
            note.link = {
                url: url,
                title: hostname,
                hostname: hostname,
                imageUrl: null,
                isLoading: true
            };
        } else if (note.link) {
            note.link.isLoading = shouldFetch;
        }

        if (emitChange && needsRefresh) {
            eventBus.emit('notes:changed', store.notes);
            eventBus.emit('data:changed');
        }

        if (shouldFetch) {
            this.fetchLinkMetadata(note, url);
        }

        return needsRefresh;
    }

    refreshLinkPreviews() {
        let didChange = false;
        store.notes.forEach(note => {
            const changed = this.updateLinkPreview(note, false);
            if (changed) didChange = true;
        });

        if (didChange) {
            eventBus.emit('notes:changed', store.notes);
            eventBus.emit('data:changed');
        }
    }

    async fetchLinkMetadata(note, url) {
        const cached = this._linkMetadataCache.get(url);
        if (cached) {
            const data = await cached;
            if (!data) {
                this._linkMetadataCache.delete(url);
            }
            this.applyLinkMetadata(note, url, data);
            return;
        }

        const fetchPromise = this.loadLinkMetadata(url);
        this._linkMetadataCache.set(url, fetchPromise);

        const data = await fetchPromise;
        if (!data) {
            this._linkMetadataCache.delete(url);
        }
        this.applyLinkMetadata(note, url, data);
    }

    applyLinkMetadata(note, url, data) {
        const current = store.getNoteById(note.id);
        if (!current || !current.link || current.link.url !== url) return;

        current.link.isLoading = false;
        if (data) {
            current.link.title = data.title || current.link.title;
            current.link.imageUrl = data.imageUrl || current.link.imageUrl;
            current.link.hostname = data.hostname || current.link.hostname;
        }

        eventBus.emit('notes:changed', store.notes);
        eventBus.emit('data:changed');
    }

    async loadLinkMetadata(url) {
        try {
            const response = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
            if (!response.ok) throw new Error('Metadata fetch failed');
            const data = await response.json();
            if (!data || (!data.title && !data.imageUrl && !data.hostname)) return null;
            return {
                title: data.title || '',
                hostname: data.hostname || '',
                imageUrl: data.imageUrl || null
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Update style property on selected notes
     */
    updateNoteStyle(key, value) {
        const selection = store.selection;
        if (selection.type !== 'note') return;
        
        selection.noteIds.forEach(id => {
            const note = store.getNoteById(id);
            if (note) {
                note.style[key] = value;
                if (['fontSize', 'bold', 'italic'].includes(key)) {
                    const dims = this.measureNote(note);
                    if (note.fixedWidth) {
                        note.h = dims.h;
                    } else {
                        note.w = dims.w;
                        note.h = dims.h;
                    }
                }
            }
        });
        
        eventBus.emit('notes:changed', store.notes);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Toggle boolean style property on first selected note
     */
    toggleNoteBoolean(key) {
        const selection = store.selection;
        if (selection.type !== 'note') return;
        
        const id = Array.from(selection.noteIds)[0];
        const note = store.getNoteById(id);
        if (note) {
            this.updateNoteStyle(key, !note.style[key]);
        }
    }

    /**
     * Handle delete for notes
     */
    handleDelete() {
        const selection = store.selection;
        if (selection.type !== 'note' || selection.noteIds.size === 0) return;
        
        // Remove connections involving deleted notes
        const connectionsToRemove = store.connections.filter(c => 
            selection.noteIds.has(c.from) || selection.noteIds.has(c.to)
        );
        connectionsToRemove.forEach(c => store.removeConnection(c.id));
        
        // Remove notes
        selection.noteIds.forEach(id => store.removeNote(id));
        
        store.clearSelection();
        eventBus.emit('ui:updateEmptyState');
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Fit selected notes to their content
     */
    fitNotesToContent() {
        const selection = store.selection;
        if (selection.type !== 'note' || selection.noteIds.size === 0) return;

        const groupsToUpdate = new Set();
        selection.noteIds.forEach(id => {
            const note = store.getNoteById(id);
            if (!note) return;
            note.fixedWidth = false;
            const dims = this.measureNote(note);
            note.w = dims.w;
            note.h = dims.h;
            if (note.groupId) groupsToUpdate.add(note.groupId);
        });

        groupsToUpdate.forEach(groupId => {
            const group = store.getGroupById(groupId);
            if (group) eventBus.emit('group:updateSize', group);
        });

        eventBus.emit('notes:changed', store.notes);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Snap a note to grid
     */
    snapNoteToGrid(note) {
        note.x = Math.round(note.x / store.grid.size) * store.grid.size;
        note.y = Math.round(note.y / store.grid.size) * store.grid.size;
    }

    /**
     * Snap all notes to grid
     */
    snapAllNotesToGrid() {
        store.notes.forEach(note => this.snapNoteToGrid(note));
        eventBus.emit('notes:changed', store.notes);
        eventBus.emit('data:changed');
    }

    getImageNoteSize(width, height) {
        const maxW = 360;
        const maxH = 280;
        const minW = 120;
        const minH = 90;
        const safeW = Math.max(1, width || 0);
        const safeH = Math.max(1, height || 0);
        const maxScale = Math.min(maxW / safeW, maxH / safeH);
        let scale = Math.min(1, maxScale);
        const minScale = Math.max(minW / safeW, minH / safeH);
        if (minScale > 1) {
            scale = Math.min(Math.max(scale, minScale), maxScale);
        }
        const w = Math.round(safeW * scale);
        const h = Math.round(safeH * scale);
        return { w, h };
    }
}
