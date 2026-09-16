/**
 * Renderer - Handles all canvas rendering operations
 * 
 * Subscribes to state changes and re-renders as needed.
 * Separated from business logic for cleaner architecture.
 */
import { eventBus } from './EventBus.js';
import { store, DEFAULTS } from './Store.js';

export class Renderer {
    constructor(canvas, minimapCanvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.minimapCanvas = minimapCanvas;
        this.minimapCtx = minimapCanvas.getContext('2d');
        this._linkImageCache = new Map();
        this._imageCache = new Map();
        
        this._animationFrameId = null;
        this._needsRender = true;
        
        this._setupEventListeners();
    }

    _setupEventListeners() {
        // Subscribe to state changes that require re-render
        eventBus.on('notes:changed', () => this.requestRender());
        eventBus.on('connections:changed', () => this.requestRender());
        eventBus.on('groups:changed', () => this.requestRender());
        eventBus.on('camera:changed', () => this.requestRender());
        eventBus.on('selection:changed', () => this.requestRender());
        eventBus.on('grid:changed', () => this.requestRender());
        eventBus.on('backgroundColor:changed', () => this.requestRender());
        eventBus.on('state:loaded', () => this.requestRender());
        eventBus.on('state:cleared', () => this.requestRender());
        eventBus.on('dragState:changed', () => this.requestRender());
    }

    /**
     * Request a render on the next animation frame
     */
    requestRender() {
        this._needsRender = true;
    }

    /**
     * Start the render loop
     */
    startLoop() {
        const loop = () => {
            if (this._needsRender || store.dragState) {
                this.draw();
                this._needsRender = false;
            }
            this._animationFrameId = requestAnimationFrame(loop);
        };
        loop();
    }

    /**
     * Stop the render loop
     */
    stopLoop() {
        if (this._animationFrameId) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }
    }

    /**
     * Resize canvas to match window dimensions
     */
    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.requestRender();
    }

    /**
     * Main draw function
     */
    draw() {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const camera = store.camera;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        ctx.fillStyle = store.backgroundColor;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

        ctx.save();
        ctx.translate(camera.x, camera.y);
        ctx.scale(camera.zoom, camera.zoom);

        this.drawGrid(ctx);

        // Draw groups
        store.groups.forEach(group => this.drawGroup(ctx, group, false));

        // Draw connections above groups
        store.connections.forEach(conn => {
            const n1 = store.getNoteById(conn.from);
            const n2 = store.getNoteById(conn.to);
            if (!n1 || !n2) return;
            const endpoint1 = this.getConnectionEndpoint(n1);
            const endpoint2 = this.getConnectionEndpoint(n2);
            if (endpoint1.collapsedGroupId && endpoint1.collapsedGroupId === endpoint2.collapsedGroupId) return;
            this.drawConnectionLine(ctx, conn, endpoint1.rect, endpoint2.rect, false);
        });

        // Draw notes inside groups
        store.groups.forEach(group => {
            if (group.collapsed) return;
            const notesInGroup = store.getNotesInGroup(group.id);
            notesInGroup.forEach(note => this.drawNote(ctx, note, false));
        });

        // Draw ungrouped notes
        store.notes.filter(n => !n.groupId).forEach(note => this.drawNote(ctx, note, false));

        const dragState = store.dragState;

        // Draw ghost notes while dragging
        if (dragState && dragState.mode === 'move' && dragState.previewPositions) {
            this.drawGhostNotes(ctx, dragState.previewPositions);
        }

        // Draw box selection
        if (dragState && dragState.mode === 'box-select') {
            const x = Math.min(dragState.startX, dragState.currX);
            const y = Math.min(dragState.startY, dragState.currY);
            const w = Math.abs(dragState.currX - dragState.startX);
            const h = Math.abs(dragState.currY - dragState.startY);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
        }

        ctx.restore();

        this.drawMinimap();
    }

    /**
     * Draw the grid
     */
    drawGrid(ctx) {
        const grid = store.grid;
        if (!grid.visible) return;
        
        const camera = store.camera;
        const gridSize = grid.size;
        const width = window.innerWidth / camera.zoom;
        const height = window.innerHeight / camera.zoom;
        
        const startX = Math.floor(-camera.x / camera.zoom / gridSize) * gridSize;
        const startY = Math.floor(-camera.y / camera.zoom / gridSize) * gridSize;
        const endX = startX + width + gridSize * 2;
        const endY = startY + height + gridSize * 2;
        
        ctx.beginPath();
        ctx.strokeStyle = grid.color;
        ctx.lineWidth = 1 / camera.zoom;
        
        for (let x = startX; x <= endX; x += gridSize) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        
        for (let y = startY; y <= endY; y += gridSize) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        
        ctx.stroke();
    }

    /**
     * Draw a group
     */
    drawGroup(ctx, group, isExport) {
        const selection = store.selection;
        const isSelected = !isExport && (selection.type === 'group' || selection.type === 'mixed') && selection.groupIds.has(group.id);
        const style = group.style;

        if (isExport || !group.collapsed) {
            ctx.fillStyle = style.backgroundColor;
            const r = style.borderRadius;
            this.roundRect(ctx, group.x, group.y, group.w, group.h, r, true, false);

            ctx.strokeStyle = isSelected ? '#3b82f6' : style.borderColor;
            ctx.lineWidth = isSelected ? 3 : style.borderWidth;
            this.roundRect(ctx, group.x, group.y, group.w, group.h, r, false, true);

            if (!group.collapsed) {
                ctx.fillStyle = style.titleColor;
                ctx.font = `bold ${style.titleSize}px 'Inter', sans-serif`;
                ctx.textBaseline = 'top';
                ctx.fillText(group.title, group.x + 10, group.y + 8);
            }
        } else {
            ctx.fillStyle = style.backgroundColor;
            const r = style.borderRadius;
            const collapsedHeight = this.getCollapsedGroupHeight();
            this.roundRect(ctx, group.x, group.y, group.w, collapsedHeight, r, true, false);

            ctx.strokeStyle = isSelected ? '#3b82f6' : style.borderColor;
            ctx.lineWidth = isSelected ? 3 : style.borderWidth;
            this.roundRect(ctx, group.x, group.y, group.w, collapsedHeight, r, false, true);

            ctx.fillStyle = style.titleColor;
            ctx.font = `bold ${style.titleSize}px 'Inter', sans-serif`;
            ctx.textBaseline = 'top';
            const notesCount = store.getNotesInGroup(group.id).length;
            ctx.fillText(`${group.title} (${notesCount})`, group.x + 10, group.y + 12);

            ctx.fillStyle = '#6b7280';
            ctx.font = '12px "Inter", sans-serif';
            ctx.fillText('▶', group.x + group.w - 25, group.y + 14);
        }

        // Resize handle
        if (isSelected && !isExport && !group.locked && !group.collapsed && selection.groupIds.size === 1) {
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath();
            ctx.arc(group.x + group.w, group.y + group.h, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Lock icon
        if (group.locked) {
            ctx.fillStyle = '#6b7280';
            ctx.font = '14px "Inter", sans-serif';
            ctx.fillText('🔒', group.x + group.w - 30, group.y + 8);
        }

    }

    getCollapsedGroupHeight() {
        return 40;
    }

    getCollapsedGroupAnchorRect(group) {
        const height = this.getCollapsedGroupHeight();
        const size = 18;
        const anchorX = group.x + group.w - 20;
        const anchorY = group.y + height / 2;
        return {
            x: anchorX - size / 2,
            y: anchorY - size / 2,
            w: size,
            h: size
        };
    }

    getConnectionEndpoint(note) {
        if (note.groupId) {
            const group = store.getGroupById(note.groupId);
            if (group && group.collapsed) {
                return { rect: this.getCollapsedGroupAnchorRect(group), collapsedGroupId: group.id };
            }
        }
        return { rect: note, collapsedGroupId: null };
    }

    /**
     * Draw a note
     */
    drawNote(ctx, note, isExport) {
        const selection = store.selection;
        const isSelected = !isExport && (selection.type === 'note' || selection.type === 'mixed') && selection.noteIds.has(note.id);
        const isTarget = !isExport && store.targetNote && store.targetNote.id === note.id;
        const isEditing = !isExport && store.isEditing && store.editingNote && store.editingNote.id === note.id;
        const style = note.style;

        if (isEditing && note.text === "") return;

        // Shadow
        if (!isEditing) {
            ctx.fillStyle = 'rgba(0,0,0,0.08)';
            const r = style.rounded ? 6 : 0;
            this.roundRect(ctx, note.x + 3, note.y + 3, note.w, note.h, r, true, false);
        }

        // Target glow
        if (isTarget) {
            ctx.save();
            ctx.shadowColor = '#3b82f6';
            ctx.shadowBlur = 15;
            ctx.fillStyle = '#ffffff';
            const r = style.rounded ? 6 : 0;
            this.roundRect(ctx, note.x, note.y, note.w, note.h, r, true, false);
            ctx.restore();
        }

        // Note body
        ctx.fillStyle = style.backgroundColor;
        const r = style.rounded ? 6 : 0;
        
        if (style.borderVisible) {
            ctx.strokeStyle = isSelected ? '#3b82f6' : (isTarget ? '#3b82f6' : style.borderColor);
            ctx.lineWidth = (isSelected || isTarget) ? 2 : 1;
        } else {
            ctx.strokeStyle = (isSelected || isTarget) ? '#3b82f6' : 'transparent';
            ctx.lineWidth = (isSelected || isTarget) ? 2 : 0;
        }

        if (note.link?.url) {
            ctx.setLineDash([6, 4]);
        } else {
            ctx.setLineDash([]);
        }
        this.roundRect(ctx, note.x, note.y, note.w, note.h, r, true, ctx.lineWidth > 0);
        ctx.setLineDash([]);

        // Resize handle
        if (isSelected && !isExport && !isEditing && selection.noteIds.size === 1) {
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath();
            ctx.arc(note.x + note.w, note.y + note.h, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Text / Link Preview
        if (!isEditing) {
            if (note.type === 'image') {
                this.drawImageNote(ctx, note);
            } else if (note.link?.url) {
                this.drawLinkPreview(ctx, note);
            } else {
                ctx.fillStyle = style.textColor;
                const fontStyle = style.italic ? 'italic' : 'normal';
                const fontWeight = style.bold ? 'bold' : 'normal';
                ctx.font = `${fontStyle} ${fontWeight} ${style.fontSize}px ${DEFAULTS.fontFamily}`;
                ctx.textBaseline = 'top';
                
                const maxWidth = note.w - (DEFAULTS.padding * 2);
                const lines = this.getWrappedLines(ctx, note.text, maxWidth);
                const lineHeight = style.fontSize * DEFAULTS.lineHeightRatio;
                const startX = note.x + DEFAULTS.padding;
                const startY = note.y + DEFAULTS.padding;

                lines.forEach((line, i) => {
                    const y = startY + (i * lineHeight);
                    ctx.fillText(line, startX, y);
                    const lineWidth = ctx.measureText(line).width;
                    if (style.underline) ctx.fillRect(startX, y + lineHeight * 0.85, lineWidth, Math.max(1, style.fontSize/15));
                    if (style.strike) ctx.fillRect(startX, y + lineHeight * 0.5, lineWidth, Math.max(1, style.fontSize/15));
                });
            }
        }
    }

    drawLinkPreview(ctx, note) {
        const padding = DEFAULTS.padding;
        const style = note.style;
        const title = note.link.title || note.link.url;
        let domain = note.link.hostname;
        if (!domain) {
            try {
                domain = new URL(note.link.url).hostname;
            } catch (e) {
                domain = note.link.url;
            }
        }
        const maxWidth = note.w - (padding * 2);
        const imageEntry = note.link?.imageUrl ? this.getLinkImageEntry(note.link.imageUrl) : null;
        const imageHeight = this.getLinkImageHeight(note, imageEntry);
        const imageX = note.x;
        const imageY = note.y;
        const imageW = note.w;
        const imageH = imageHeight;
        const radius = style.rounded ? 6 : 0;

        if (imageH > 0) {
            ctx.save();
            this.roundRectTop(ctx, imageX, imageY, imageW, imageH, radius);
            ctx.clip();
            this.drawLinkImage(ctx, imageEntry, imageX, imageY, imageW, imageH);
            ctx.restore();

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(imageX, imageY + imageH);
            ctx.lineTo(imageX + imageW, imageY + imageH);
            ctx.stroke();
        }

        const textX = note.x + padding;
        const textY = note.y + (imageH > 0 ? imageH : padding) + padding;
        const titleSize = Math.min(style.fontSize, 18);
        const metaSize = Math.max(10, Math.round(titleSize * 0.75));
        const titleLineHeight = titleSize * 1.25;

        ctx.fillStyle = style.textColor;
        ctx.font = `bold ${titleSize}px ${DEFAULTS.fontFamily}`;
        ctx.textBaseline = 'top';
        const titleLines = this.getClampedLines(ctx, title, maxWidth, 2);
        titleLines.forEach((line, index) => {
            ctx.fillText(line, textX, textY + index * titleLineHeight);
        });

        const metaY = textY + titleLines.length * titleLineHeight + Math.max(4, titleSize * 0.3);
        ctx.fillStyle = '#6b7280';
        ctx.font = `normal ${metaSize}px ${DEFAULTS.fontFamily}`;
        const metaText = this.truncateLine(ctx, domain, maxWidth);
        ctx.fillText(metaText, textX, metaY);
    }

    drawImageNote(ctx, note) {
        const src = note.image?.src;
        const padding = Math.min(10, Math.max(4, Math.round(Math.min(note.w, note.h) * 0.06)));
        const imageX = note.x + padding;
        const imageY = note.y + padding;
        const imageW = Math.max(0, note.w - padding * 2);
        const imageH = Math.max(0, note.h - padding * 2);
        const radius = note.style.rounded ? Math.max(0, Math.min(8, Math.round(Math.min(imageW, imageH) * 0.08))) : 0;
        const entry = this.getImageEntry(src);

        if (imageW <= 0 || imageH <= 0) return;

        ctx.save();
        if (radius > 0) {
            this.roundRect(ctx, imageX, imageY, imageW, imageH, radius, false, false);
            ctx.clip();
        }

        if (!entry || entry.status !== 'loaded') {
            this.drawImagePlaceholder(ctx, imageX, imageY, imageW, imageH);
        } else {
            this.drawImageContain(ctx, entry.img, imageX, imageY, imageW, imageH);
        }
        ctx.restore();
    }

    getLinkImageHeight(note, imageEntry) {
        if (!note.link?.imageUrl) return 0;
        if (imageEntry && imageEntry.status === 'error') return 0;
        const minTextHeight = Math.max(44, note.style.fontSize * 2.2);
        const maxImageHeight = Math.max(0, note.h - minTextHeight);
        return Math.min(note.h * 0.55, maxImageHeight);
    }

    drawLinkImage(ctx, entry, x, y, w, h) {
        if (!entry || entry.status !== 'loaded') {
            this.drawLinkPlaceholder(ctx, x, y, w, h);
            return;
        }

        this.drawImageCover(ctx, entry.img, x, y, w, h);
    }

    getLinkImageEntry(imageUrl) {
        if (!imageUrl) return null;
        const cached = this._linkImageCache.get(imageUrl);
        if (cached) return cached;

        const entry = { img: new Image(), status: 'loading' };
        entry.img.crossOrigin = 'anonymous';
        entry.img.onload = () => {
            entry.status = 'loaded';
            this.requestRender();
        };
        entry.img.onerror = () => {
            entry.status = 'error';
            this.requestRender();
        };
        entry.img.src = imageUrl;
        this._linkImageCache.set(imageUrl, entry);
        return entry;
    }

    drawImageCover(ctx, img, x, y, w, h) {
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const targetRatio = w / h;
        let drawW = w;
        let drawH = h;
        let drawX = x;
        let drawY = y;

        if (imgRatio > targetRatio) {
            drawH = h;
            drawW = h * imgRatio;
            drawX = x - (drawW - w) / 2;
        } else {
            drawW = w;
            drawH = w / imgRatio;
            drawY = y - (drawH - h) / 2;
        }

        ctx.drawImage(img, drawX, drawY, drawW, drawH);
    }

    drawLinkPlaceholder(ctx, x, y, w, h) {
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.moveTo(x + w, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
        ctx.fillStyle = '#9ca3af';
        ctx.font = 'bold 12px "Inter", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText('LINK', x + 8, y + 8);
    }

    drawImageContain(ctx, img, x, y, w, h) {
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const targetRatio = w / h;
        let drawW = w;
        let drawH = h;
        let drawX = x;
        let drawY = y;

        if (imgRatio > targetRatio) {
            drawW = w;
            drawH = w / imgRatio;
            drawY = y + (h - drawH) / 2;
        } else {
            drawH = h;
            drawW = h * imgRatio;
            drawX = x + (w - drawW) / 2;
        }

        ctx.drawImage(img, drawX, drawY, drawW, drawH);
    }

    drawImagePlaceholder(ctx, x, y, w, h) {
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.moveTo(x + w, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
        ctx.fillStyle = '#9ca3af';
        ctx.font = 'bold 12px "Inter", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText('IMAGE', x + 8, y + 8);
    }

    getImageEntry(src) {
        if (!src) return null;
        const cached = this._imageCache.get(src);
        if (cached) return cached;

        const entry = { img: new Image(), status: 'loading' };
        entry.img.onload = () => {
            entry.status = 'loaded';
            this.requestRender();
        };
        entry.img.onerror = () => {
            entry.status = 'error';
            this.requestRender();
        };
        entry.img.src = src;
        this._imageCache.set(src, entry);
        return entry;
    }

    getClampedLines(ctx, text, maxWidth, maxLines) {
        const lines = this.getWrappedLines(ctx, text, maxWidth);
        if (lines.length <= maxLines) return lines;
        const clipped = lines.slice(0, maxLines);
        clipped[maxLines - 1] = this.truncateLine(ctx, clipped[maxLines - 1], maxWidth);
        return clipped;
    }

    truncateLine(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        const ellipsis = '...';
        let truncated = text;
        while (truncated.length > 0 && ctx.measureText(truncated + ellipsis).width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return truncated.length > 0 ? truncated + ellipsis : ellipsis;
    }

    roundRectTop(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /**
     * Draw a connection line between two notes
     */
    drawConnectionLine(ctx, conn, n1, n2, isExport) {
        const selection = store.selection;
        const isSelected = !isExport && selection.type === 'connection' && selection.connectionIds.has(conn.id);
        const style = conn.style;
        const c1 = { x: n1.x + n1.w/2, y: n1.y + n1.h/2 };
        const c2 = { x: n2.x + n2.w/2, y: n2.y + n2.h/2 };
        const p1 = this.getRectIntersection(n1, c2); 
        const p2 = this.getRectIntersection(n2, c1);
        const start = p1 || c1;
        const end = p2 || c2;

        ctx.beginPath();
        ctx.strokeStyle = isSelected ? '#3b82f6' : style.color;
        ctx.lineWidth = isSelected ? style.width + 1 : style.width;
        ctx.setLineDash(style.dash || []);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (style.arrowStart && p1) this.drawArrowHead(ctx, end, start, isSelected ? '#3b82f6' : style.color);
        if (style.arrowEnd && p2) this.drawArrowHead(ctx, start, end, isSelected ? '#3b82f6' : style.color);

        if (conn.label && conn.label.trim()) {
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            this.drawConnectionLabel(ctx, conn.label.trim(), midX, midY, isSelected);
        }
    }

    drawConnectionLabel(ctx, text, x, y, isSelected) {
        const fontSize = 12;
        ctx.save();
        ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const paddingX = 8;
        const paddingY = 4;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const boxX = x - boxWidth / 2;
        const boxY = y - boxHeight / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = isSelected ? '#3b82f6' : 'rgba(15, 23, 42, 0.15)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, boxX, boxY, boxWidth, boxHeight, 10, true, true);
        ctx.fillStyle = '#111827';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y + 0.5);
        ctx.restore();
    }

    drawGhostNotes(ctx, previewPositions) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        previewPositions.forEach(pos => {
            const note = store.getNoteById(pos.id);
            if (!note) return;
            const ghost = { ...note, x: pos.x, y: pos.y };
            this.drawNote(ctx, ghost, true);
        });
        ctx.restore();
    }

    /**
     * Draw an arrow head
     */
    drawArrowHead(ctx, from, to, color) {
        const headLength = 10; 
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const angle = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - headLength * Math.cos(angle - Math.PI / 6), to.y - headLength * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(to.x - headLength * Math.cos(angle + Math.PI / 6), to.y - headLength * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Calculate intersection point of line from rect center to target
     */
    getRectIntersection(rect, targetPoint) {
        const cx = rect.x + rect.w/2;
        const cy = rect.y + rect.h/2;
        const dx = targetPoint.x - cx;
        const dy = targetPoint.y - cy;
        if (dx === 0 && dy === 0) return null;
        const slope = Math.abs(dy / dx);
        const rectSlope = rect.h / rect.w;
        if (slope < rectSlope) {
            const x = dx > 0 ? rect.x + rect.w : rect.x;
            const y = cy + (x - cx) * (dy/dx);
            return {x, y};
        } else {
            const y = dy > 0 ? rect.y + rect.h : rect.y;
            const x = cx + (y - cy) * (dx/dy);
            return {x, y};
        }
    }

    /**
     * Draw rounded rectangle
     */
    roundRect(ctx, x, y, w, h, r, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    /**
     * Word wrap text into lines
     */
    getWrappedLines(ctx, text, maxWidth) {
        const paragraphs = text.split('\n');
        const lines = [];
        paragraphs.forEach(paragraph => {
            if (paragraph === '') { lines.push(''); return; }
            const words = paragraph.split(' ');
            let currentLine = words[0];
            for (let i = 1; i < words.length; i++) {
                const word = words[i];
                const width = ctx.measureText(currentLine + " " + word).width;
                if (width < maxWidth) currentLine += " " + word;
                else { lines.push(currentLine); currentLine = word; }
            }
            lines.push(currentLine);
        });
        return lines;
    }

    /**
     * Draw the minimap
     */
    drawMinimap() {
        if (!store.minimapVisible) return;
        const ctx = this.minimapCtx;
        const canvas = this.minimapCanvas;
        const size = 150;
        canvas.width = size;
        canvas.height = size;

        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = store.backgroundColor;
        ctx.fillRect(0, 0, size, size);

        if (store.notes.length === 0) return;

        const bbox = this.calculateBoundingBox();
        const padding = 50;
        const contentWidth = bbox.maxX - bbox.minX + padding * 2;
        const contentHeight = bbox.maxY - bbox.minY + padding * 2;

        const scaleX = size / contentWidth;
        const scaleY = size / contentHeight;
        const scale = Math.min(scaleX, scaleY);

        const offsetX = (size - contentWidth * scale) / 2;
        const offsetY = (size - contentHeight * scale) / 2;

        const worldToMinimap = (wx, wy) => ({
            x: (wx - bbox.minX + padding) * scale + offsetX,
            y: (wy - bbox.minY + padding) * scale + offsetY
        });

        ctx.save();
        ctx.fillStyle = store.backgroundColor;
        ctx.fillRect(0, 0, size, size);

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 1 / scale;

        // Draw groups
        store.groups.forEach(group => {
            const pos = worldToMinimap(group.x, group.y);
            const w = group.w * scale;
            const h = group.h * scale;
            ctx.fillStyle = 'rgba(156, 163, 175, 0.3)';
            ctx.fillRect(pos.x, pos.y, w, h);
            ctx.strokeRect(pos.x, pos.y, w, h);
        });

        // Draw notes
        store.notes.forEach(note => {
            const pos = worldToMinimap(note.x, note.y);
            const w = note.w * scale;
            const h = note.h * scale;
            ctx.fillStyle = note.style.backgroundColor === '#ffffff' ? '#f8fafc' : note.style.backgroundColor;
            ctx.fillRect(pos.x, pos.y, w, h);
            ctx.strokeRect(pos.x, pos.y, w, h);
        });

        // Draw connections
        store.connections.forEach(conn => {
            const n1 = store.getNoteById(conn.from);
            const n2 = store.getNoteById(conn.to);
            if (!n1 || !n2) return;
            const endpoint1 = this.getConnectionEndpoint(n1);
            const endpoint2 = this.getConnectionEndpoint(n2);
            if (endpoint1.collapsedGroupId && endpoint1.collapsedGroupId === endpoint2.collapsedGroupId) return;

            const p1 = worldToMinimap(
                endpoint1.rect.x + endpoint1.rect.w / 2,
                endpoint1.rect.y + endpoint1.rect.h / 2
            );
            const p2 = worldToMinimap(
                endpoint2.rect.x + endpoint2.rect.w / 2,
                endpoint2.rect.y + endpoint2.rect.h / 2
            );
            ctx.strokeStyle = conn.style.color;
            ctx.lineWidth = conn.style.width * scale;
            ctx.setLineDash(conn.style.dash ? conn.style.dash.map(d => d * scale) : []);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        // Draw camera viewport
        const camera = store.camera;
        const camWorldX = -camera.x / camera.zoom;
        const camWorldY = -camera.y / camera.zoom;
        const camWorldW = window.innerWidth / camera.zoom;
        const camWorldH = window.innerHeight / camera.zoom;

        const camMinimapPos = worldToMinimap(camWorldX, camWorldY);
        const camMinimapW = camWorldW * scale;
        const camMinimapH = camWorldH * scale;

        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(camMinimapPos.x, camMinimapPos.y, camMinimapW, camMinimapH);

        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.fillRect(camMinimapPos.x, camMinimapPos.y, camMinimapW, camMinimapH);

        ctx.restore();
    }

    /**
     * Calculate bounding box of all content
     */
    calculateBoundingBox() {
        if (store.notes.length === 0 && store.groups.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        store.notes.forEach(note => {
            minX = Math.min(minX, note.x);
            minY = Math.min(minY, note.y);
            maxX = Math.max(maxX, note.x + note.w);
            maxY = Math.max(maxY, note.y + note.h);
        });
        
        store.groups.forEach(group => {
            minX = Math.min(minX, group.x);
            minY = Math.min(minY, group.y);
            maxX = Math.max(maxX, group.x + group.w);
            maxY = Math.max(maxY, group.y + group.h);
        });

        const camera = store.camera;
        const camWorldX = -camera.x / camera.zoom;
        const camWorldY = -camera.y / camera.zoom;
        const camWorldW = window.innerWidth / camera.zoom;
        const camWorldH = window.innerHeight / camera.zoom;

        minX = Math.min(minX, camWorldX);
        minY = Math.min(minY, camWorldY);
        maxX = Math.max(maxX, camWorldX + camWorldW);
        maxY = Math.max(maxY, camWorldY + camWorldH);

        return { minX, minY, maxX, maxY };
    }

    /**
     * Export canvas to PNG
     */
    exportImage() {
        if (store.notes.length === 0 && store.groups.length === 0) { 
            alert("Nothing to export!"); 
            return; 
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        store.notes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.w);
            maxY = Math.max(maxY, n.y + n.h);
        });
        store.groups.forEach(g => {
            minX = Math.min(minX, g.x);
            minY = Math.min(minY, g.y);
            maxX = Math.max(maxX, g.x + g.w);
            maxY = Math.max(maxY, g.y + g.h);
        });
        
        const padding = 50;
        const width = (maxX - minX) + (padding * 2);
        const height = (maxY - minY) + (padding * 2);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tCtx = tempCanvas.getContext('2d');
        
        tCtx.fillStyle = store.backgroundColor;
        tCtx.fillRect(0, 0, width, height);
        tCtx.save();
        tCtx.translate(-minX + padding, -minY + padding);
        
        store.groups.forEach(group => this.drawGroup(tCtx, group, true));

        store.connections.forEach(conn => {
            const n1 = store.getNoteById(conn.from);
            const n2 = store.getNoteById(conn.to);
            if (!n1 || !n2) return;
            const endpoint1 = this.getConnectionEndpoint(n1);
            const endpoint2 = this.getConnectionEndpoint(n2);
            if (endpoint1.collapsedGroupId && endpoint1.collapsedGroupId === endpoint2.collapsedGroupId) return;
            this.drawConnectionLine(tCtx, conn, endpoint1.rect, endpoint2.rect, true);
        });
        
        store.groups.forEach(group => {
            if (group.collapsed) return;
            const notesInGroup = store.getNotesInGroup(group.id);
            notesInGroup.forEach(note => this.drawNote(tCtx, note, true));
        });
        store.notes.filter(n => !n.groupId).forEach(note => this.drawNote(tCtx, note, true));
        
        tCtx.restore();
        
        const link = document.createElement('a');
        link.download = `bs_export_${Date.now()}.png`;
        link.href = tempCanvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
