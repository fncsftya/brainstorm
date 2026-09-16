/**
 * InputHandler - Handles all user input (mouse, touch, keyboard)
 * 
 * Emits semantic events for other modules to handle rather than
 * directly manipulating state.
 */
import { eventBus } from './EventBus.js';
import { store } from './Store.js';

export class InputHandler {
    constructor(canvas) {
        this.canvas = canvas;
        this.touchStartTimer = null;
        
        this._bindEvents();
    }

    _bindEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        this.canvas.addEventListener('dragenter', (e) => this.handleDragEnter(e));
        this.canvas.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.canvas.addEventListener('drop', (e) => this.handleDrop(e));
        window.addEventListener('dragenter', (e) => this.handleDragEnter(e), true);
        window.addEventListener('dragover', (e) => this.handleDragOver(e), true);
        window.addEventListener('drop', (e) => this.handleDrop(e), true);
        document.addEventListener('dragenter', (e) => this.handleDragEnter(e), true);
        document.addEventListener('dragover', (e) => this.handleDragOver(e), true);
        document.addEventListener('drop', (e) => this.handleDrop(e), true);
        
        // Keyboard events
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('paste', (e) => this.handlePaste(e));
        document.addEventListener('paste', (e) => this.handlePaste(e));
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        window.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        window.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }

    // --- Coordinate Utilities ---

    getScreenPos(e) {
        return { x: e.clientX, y: e.clientY };
    }

    getWorldPos(e) {
        const camera = store.camera;
        return {
            x: (e.clientX - camera.x) / camera.zoom,
            y: (e.clientY - camera.y) / camera.zoom
        };
    }

    // --- Hit Testing ---

    hitTestNote(x, y) {
        const notes = store.notes;
        for (let i = notes.length - 1; i >= 0; i--) {
            const n = notes[i];
            if (n.groupId) {
                const group = store.getGroupById(n.groupId);
                if (group && group.collapsed) continue;
            }
            if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
        }
        return null;
    }

    hitTestConnection(x, y) {
        const threshold = 10 / store.camera.zoom;
        const connections = store.connections;
        for (let i = connections.length - 1; i >= 0; i--) {
            const c = connections[i];
            const n1 = store.getNoteById(c.from);
            const n2 = store.getNoteById(c.to);
            if (!n1 || !n2) continue;
            const endpoint1 = this.getConnectionEndpoint(n1);
            const endpoint2 = this.getConnectionEndpoint(n2);
            if (endpoint1.collapsedGroupId && endpoint1.collapsedGroupId === endpoint2.collapsedGroupId) continue;
            const center1 = { x: endpoint1.rect.x + endpoint1.rect.w/2, y: endpoint1.rect.y + endpoint1.rect.h/2 };
            const center2 = { x: endpoint2.rect.x + endpoint2.rect.w/2, y: endpoint2.rect.y + endpoint2.rect.h/2 };
            const dist = this.distToSegment({x, y}, center1, center2);
            if (dist < threshold) return c;
        }
        return null;
    }

    hitTestGroup(x, y) {
        const groups = store.groups;
        for (let i = groups.length - 1; i >= 0; i--) {
            const g = groups[i];
            const height = g.collapsed ? this.getCollapsedGroupHeight() : g.h;
            if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + height) return g;
        }
        return null;
    }

    hitTestResizeHandle(note, x, y) {
        const handleX = note.x + note.w;
        const handleY = note.y + note.h;
        const hitRadius = 20 / store.camera.zoom;
        const dist = Math.sqrt((x - handleX) ** 2 + (y - handleY) ** 2);
        return dist <= hitRadius;
    }

    hitTestGroupResizeHandle(group, x, y) {
        if (group.collapsed) return false;
        const handleX = group.x + group.w;
        const handleY = group.y + group.h;
        const hitRadius = 20 / store.camera.zoom;
        const dist = Math.sqrt((x - handleX) ** 2 + (y - handleY) ** 2);
        return dist <= hitRadius;
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

    getGroupMinSize(group) {
        const baseMinW = 100;
        const baseMinH = 60;
        const notesInGroup = store.getNotesInGroup(group.id);
        if (notesInGroup.length === 0) {
            return { minW: baseMinW, minH: baseMinH };
        }

        let maxX = -Infinity;
        let maxY = -Infinity;
        notesInGroup.forEach(note => {
            maxX = Math.max(maxX, note.x + note.w);
            maxY = Math.max(maxY, note.y + note.h);
        });

        const padding = 20;
        const minW = Math.max(baseMinW, (maxX - group.x) + padding);
        const minH = Math.max(baseMinH, (maxY - group.y) + padding);

        return { minW, minH };
    }

    getTopLevelNoteIds(noteIds) {
        const topLevel = new Set();
        noteIds.forEach(id => {
            const note = store.getNoteById(id);
            if (note && !note.groupId) topLevel.add(id);
        });
        return topLevel;
    }

    applyMixedSelection(noteIds, groupIds) {
        if (noteIds.size === 0 && groupIds.size === 0) {
            store.clearSelection();
        } else if (groupIds.size === 0) {
            store.setSelection('note', noteIds);
        } else if (noteIds.size === 0) {
            store.setSelection('group', groupIds);
        } else {
            store.setMixedSelection(noteIds, groupIds);
        }
    }

    distToSegment(p, v, w) {
        const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 === 0) return Math.sqrt((p.x - v.x)**2 + (p.y - v.y)**2);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
        return Math.sqrt((p.x - proj.x)**2 + (p.y - proj.y)**2);
    }

    checkOverlap(n1, n2) {
        return (n1.x < n2.x + n2.w && n1.x + n1.w > n2.x && n1.y < n2.y + n2.h && n1.y + n1.h > n2.y);
    }

    checkRectOverlap(r1, r2) {
        return (r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y);
    }

    // --- Mouse Event Handlers ---

    handleMouseDown(e) {
        if (store.isEditing) return;
        const worldPos = this.getWorldPos(e);
        store.lastPointer = worldPos;
        const selection = store.selection;
        eventBus.emit('ui:closeContextMenu');

        // Middle click -> Pan
        if (e.button === 1) {
            store.dragState = { 
                mode: 'pan', 
                startX: e.clientX, 
                startY: e.clientY, 
                camX: store.camera.x, 
                camY: store.camera.y 
            };
            e.preventDefault();
            return;
        }

        // Left click
        if (e.button === 0) {
            // Check resize handles first
            if (selection.type === 'group' && selection.groupIds.size === 1) {
                const groupId = Array.from(selection.groupIds)[0];
                const group = store.getGroupById(groupId);
                if (group && !group.locked && this.hitTestGroupResizeHandle(group, worldPos.x, worldPos.y)) {
                    store.dragState = { 
                        mode: 'resize-group', 
                        group: group, 
                        startX: worldPos.x, 
                        startY: worldPos.y, 
                        startW: group.w, 
                        startH: group.h 
                    };
                    return;
                }
            }
            
            if (selection.type === 'note' && selection.noteIds.size === 1) {
                const noteId = Array.from(selection.noteIds)[0];
                const note = store.getNoteById(noteId);
                if (note && this.hitTestResizeHandle(note, worldPos.x, worldPos.y)) {
                    note.fixedWidth = true;
                    store.dragState = { 
                        mode: 'resize', 
                        note: note, 
                        startX: worldPos.x, 
                        startY: worldPos.y, 
                        startW: note.w, 
                        startH: note.h 
                    };
                    return;
                }
            }

            // Hit test order: notes, groups, connections
            const hitNote = this.hitTestNote(worldPos.x, worldPos.y);
            const hitGroup = this.hitTestGroup(worldPos.x, worldPos.y);
            const hitConn = this.hitTestConnection(worldPos.x, worldPos.y);

            if (hitNote) {
                eventBus.emit('ui:hideSettings');
                const isTopLevel = !hitNote.groupId;
                if ((e.metaKey || e.ctrlKey) && hitNote.link?.url) {
                    window.open(hitNote.link.url, '_blank', 'noopener,noreferrer');
                    if (!selection.noteIds.has(hitNote.id) || selection.type !== 'note') {
                        store.setSelection('note', [hitNote.id]);
                    }
                    return;
                }
                if (!e.shiftKey) {
                    if (selection.type === 'mixed' && selection.noteIds.has(hitNote.id)) {
                        // Keep mixed selection
                    } else if (!selection.noteIds.has(hitNote.id) || selection.type !== 'note') {
                        store.setSelection('note', [hitNote.id]);
                    }
                } else {
                    if (selection.type === 'note') {
                        if (selection.noteIds.has(hitNote.id)) {
                            store.removeFromSelection(hitNote.id, 'note');
                        } else {
                            store.addToSelection(hitNote.id, 'note');
                        }
                    } else if (selection.type === 'group' || selection.type === 'mixed') {
                        if (!isTopLevel) {
                            store.setSelection('note', [hitNote.id]);
                        } else {
                            const noteIds = selection.type === 'mixed'
                                ? new Set(selection.noteIds)
                                : new Set();
                            const groupIds = selection.type === 'mixed'
                                ? new Set(selection.groupIds)
                                : new Set(selection.groupIds);
                            if (noteIds.has(hitNote.id)) noteIds.delete(hitNote.id);
                            else noteIds.add(hitNote.id);
                            this.applyMixedSelection(noteIds, groupIds);
                        }
                    } else {
                        store.setSelection('note', [hitNote.id]);
                    }
                }

                const activeSelection = store.selection;
                if (activeSelection.type === 'mixed') {
                    store.dragState = {
                        mode: 'move-selection',
                        startX: worldPos.x,
                        startY: worldPos.y,
                        groupIds: new Set(activeSelection.groupIds),
                        noteIds: new Set(activeSelection.noteIds),
                        initialGroupPositions: store.groups
                            .filter(g => activeSelection.groupIds.has(g.id))
                            .map(g => ({ id: g.id, x: g.x, y: g.y })),
                        groupNotePositions: store.notes
                            .filter(n => activeSelection.groupIds.has(n.groupId))
                            .map(n => ({ id: n.id, x: n.x, y: n.y })),
                        freeNotePositions: store.notes
                            .filter(n => activeSelection.noteIds.has(n.id))
                            .map(n => ({ id: n.id, x: n.x, y: n.y })),
                        primaryNoteId: hitNote.id
                    };
                } else {
                    store.dragState = {
                        mode: 'move', 
                        startX: worldPos.x, 
                        startY: worldPos.y, 
                        primaryNoteId: hitNote.id,
                        initialPositions: store.notes
                            .filter(n => activeSelection.noteIds.has(n.id))
                            .map(n => ({ id: n.id, x: n.x, y: n.y })),
                        noteIds: new Set(activeSelection.noteIds)
                    };
                }
            } else if (hitGroup) {
                eventBus.emit('ui:hideSettings');
                if (!e.shiftKey) {
                    if (selection.type === 'mixed' && selection.groupIds.has(hitGroup.id)) {
                        // Keep mixed selection
                    } else if (!selection.groupIds.has(hitGroup.id) || selection.type !== 'group') {
                        store.setSelection('group', [hitGroup.id]);
                    }
                } else {
                    if (selection.type === 'group') {
                        if (selection.groupIds.has(hitGroup.id)) {
                            store.removeFromSelection(hitGroup.id, 'group');
                        } else {
                            store.addToSelection(hitGroup.id, 'group');
                        }
                    } else if (selection.type === 'note' || selection.type === 'mixed') {
                        const noteIds = selection.type === 'mixed'
                            ? new Set(selection.noteIds)
                            : this.getTopLevelNoteIds(selection.noteIds);
                        const groupIds = selection.type === 'mixed'
                            ? new Set(selection.groupIds)
                            : new Set();
                        if (groupIds.has(hitGroup.id)) groupIds.delete(hitGroup.id);
                        else groupIds.add(hitGroup.id);
                        this.applyMixedSelection(noteIds, groupIds);
                    } else {
                        store.setSelection('group', [hitGroup.id]);
                    }
                }

                const activeSelection = store.selection;
                if (!hitGroup.locked && (activeSelection.type === 'group' || activeSelection.type === 'mixed')) {
                    store.dragState = {
                        mode: activeSelection.type === 'mixed' ? 'move-selection' : 'move-group',
                        startX: worldPos.x,
                        startY: worldPos.y,
                        groupIds: new Set(activeSelection.groupIds),
                        noteIds: new Set(activeSelection.noteIds || []),
                        initialGroupPositions: store.groups
                            .filter(g => activeSelection.groupIds.has(g.id))
                            .map(g => ({ id: g.id, x: g.x, y: g.y })),
                        groupNotePositions: store.notes
                            .filter(n => activeSelection.groupIds.has(n.groupId))
                            .map(n => ({ id: n.id, x: n.x, y: n.y })),
                        freeNotePositions: store.notes
                            .filter(n => activeSelection.noteIds && activeSelection.noteIds.has(n.id))
                            .map(n => ({ id: n.id, x: n.x, y: n.y }))
                    };
                }
            } else if (hitConn) {
                eventBus.emit('ui:hideSettings');
                store.setSelection('connection', [hitConn.id]);
            } else {
                // Background click -> box select
                let baseNoteIds = new Set();
                let baseGroupIds = new Set();
                if (e.shiftKey) {
                    baseNoteIds = new Set(selection.noteIds);
                    baseGroupIds = new Set(selection.groupIds);
                } else {
                    store.clearSelection();
                }
                store.dragState = { 
                    mode: 'box-select', 
                    startX: worldPos.x, 
                    startY: worldPos.y, 
                    currX: worldPos.x, 
                    currY: worldPos.y,
                    appendSelection: e.shiftKey,
                    baseNoteIds: baseNoteIds,
                    baseGroupIds: baseGroupIds
                };
            }
        }
    }

    handleContextMenu(e) {
        if (store.isEditing) return;
        e.preventDefault();
        const screenPos = this.getScreenPos(e);
        const worldPos = this.getWorldPos(e);
        store.lastPointer = worldPos;
        eventBus.emit('ui:openContextMenu', screenPos, worldPos);
    }

    handleMouseMove(e) {
        const worldPos = this.getWorldPos(e);
        store.lastPointer = worldPos;
        const dragState = store.dragState;
        const selection = store.selection;

        // Update cursor when not dragging
        if (!dragState) {
            this.canvas.style.cursor = 'default';
            if (selection.type === 'group' && selection.groupIds.size === 1) {
                const group = store.getGroupById(Array.from(selection.groupIds)[0]);
                if (group && !group.locked && this.hitTestGroupResizeHandle(group, worldPos.x, worldPos.y)) {
                    this.canvas.style.cursor = 'nwse-resize';
                }
            } else if (selection.type === 'note' && selection.noteIds.size === 1) {
                const note = store.getNoteById(Array.from(selection.noteIds)[0]);
                if (note && this.hitTestResizeHandle(note, worldPos.x, worldPos.y)) {
                    this.canvas.style.cursor = 'nwse-resize';
                }
            }
            return;
        }

        // Handle drag modes
        if (dragState.mode === 'resize-group') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            const minSize = this.getGroupMinSize(dragState.group);
            let newW = Math.max(minSize.minW, dragState.startW + dx);
            let newH = Math.max(minSize.minH, dragState.startH + dy);
            if (store.grid.enabled) {
                newW = Math.max(minSize.minW, store.snapToGrid(newW));
                newH = Math.max(minSize.minH, store.snapToGrid(newH));
            }
            dragState.group.w = newW;
            dragState.group.h = newH;
        } else if (dragState.mode === 'move-group') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            dragState.initialGroupPositions.forEach(pos => {
                const group = store.getGroupById(pos.id);
                if (group) {
                    let newX = pos.x + dx;
                    let newY = pos.y + dy;
                    if (store.grid.enabled) {
                        newX = store.snapToGrid(newX);
                        newY = store.snapToGrid(newY);
                    }
                    group.x = newX;
                    group.y = newY;
                }
            });
            dragState.groupNotePositions.forEach(pos => {
                const note = store.getNoteById(pos.id);
                if (note && note.groupId) {
                    const group = store.getGroupById(note.groupId);
                    if (group) {
                        note.x = group.x + note.relX;
                        note.y = group.y + note.relY;
                    }
                }
            });
        } else if (dragState.mode === 'move-selection') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;

            dragState.initialGroupPositions.forEach(pos => {
                const group = store.getGroupById(pos.id);
                if (group) {
                    let newX = pos.x + dx;
                    let newY = pos.y + dy;
                    if (store.grid.enabled) {
                        newX = store.snapToGrid(newX);
                        newY = store.snapToGrid(newY);
                    }
                    group.x = newX;
                    group.y = newY;
                }
            });

            dragState.groupNotePositions.forEach(pos => {
                const note = store.getNoteById(pos.id);
                if (note && note.groupId) {
                    const group = store.getGroupById(note.groupId);
                    if (group) {
                        note.x = group.x + note.relX;
                        note.y = group.y + note.relY;
                    }
                }
            });

            dragState.freeNotePositions.forEach(pos => {
                const note = store.getNoteById(pos.id);
                if (note) {
                    let newX = pos.x + dx;
                    let newY = pos.y + dy;
                    if (store.grid.enabled) {
                        newX = store.snapToGrid(newX);
                        newY = store.snapToGrid(newY);
                    }
                    note.x = newX;
                    note.y = newY;
                }
            });
        } else if (dragState.mode === 'resize') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            let newW = Math.max(50, dragState.startW + dx);
            let newH = Math.max(30, dragState.startH + dy);
            if (store.grid.enabled) {
                newW = store.snapToGrid(newW);
                newH = store.snapToGrid(newH);
            }
            dragState.note.w = newW;
            dragState.note.h = newH;
        } else if (dragState.mode === 'move') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            const previewPositions = [];
            dragState.initialPositions.forEach(pos => {
                let newX = pos.x + dx;
                let newY = pos.y + dy;
                if (store.grid.enabled) {
                    newX = store.snapToGrid(newX);
                    newY = store.snapToGrid(newY);
                }
                previewPositions.push({ id: pos.id, x: newX, y: newY });
            });
            dragState.previewPositions = previewPositions;
            // Check for overlap targets
            store.targetNote = null;
            store.targetGroup = null;
            const primaryNote = store.getNoteById(dragState.primaryNoteId);
            const primaryPreview = previewPositions.find(pos => pos.id === dragState.primaryNoteId);
            if (primaryNote && primaryPreview) {
                const previewNote = { ...primaryNote, x: primaryPreview.x, y: primaryPreview.y };
                for (const other of store.notes) {
                    if (selection.noteIds.has(other.id)) continue;
                    if (this.checkOverlap(previewNote, other)) { 
                        store.targetNote = other; 
                        break; 
                    }
                }
                for (const group of store.groups) {
                    const noteRect = { x: previewNote.x, y: previewNote.y, w: previewNote.w, h: previewNote.h };
                    const height = group.collapsed ? this.getCollapsedGroupHeight() : group.h;
                    const groupRect = { x: group.x, y: group.y, w: group.w, h: height };
                    if (this.checkRectOverlap(noteRect, groupRect)) { 
                        store.targetGroup = group; 
                        break; 
                    }
                }
            }
        } else if (dragState.mode === 'pan') {
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;
            store.updateCamera({
                x: dragState.camX + dx,
                y: dragState.camY + dy
            });
            eventBus.emit('data:changed');
        } else if (dragState.mode === 'box-select') {
            dragState.currX = worldPos.x;
            dragState.currY = worldPos.y;
            const x = Math.min(dragState.startX, dragState.currX);
            const y = Math.min(dragState.startY, dragState.currY);
            const w = Math.abs(dragState.currX - dragState.startX);
            const h = Math.abs(dragState.currY - dragState.startY);
            const selRect = {x, y, w, h};
            const noteIds = new Set();
            const groupIds = new Set();

            store.groups.forEach(group => {
                const height = group.collapsed ? this.getCollapsedGroupHeight() : group.h;
                const groupRect = { x: group.x, y: group.y, w: group.w, h: height };
                if (this.checkRectOverlap(selRect, groupRect)) groupIds.add(group.id);
            });

            store.notes.forEach(note => {
                if (note.groupId) return;
                if (this.checkRectOverlap(selRect, note)) noteIds.add(note.id);
            });

            if (dragState.appendSelection) {
                dragState.baseNoteIds.forEach(id => noteIds.add(id));
                dragState.baseGroupIds.forEach(id => groupIds.add(id));
            }

            let finalNoteIds = noteIds;
            if (groupIds.size > 0 || (dragState.appendSelection && dragState.baseGroupIds.size > 0)) {
                finalNoteIds = this.getTopLevelNoteIds(noteIds);
            }

            this.applyMixedSelection(finalNoteIds, groupIds);
        }
        
        // Trigger re-render
        store.dragState = dragState;
    }

    handleMouseUp(e) {
        const dragState = store.dragState;
        if (!dragState) return;

        if (dragState.mode === 'move' && store.targetNote) {
            // Create connection
            eventBus.emit('connection:toggle', dragState.primaryNoteId, store.targetNote.id);
        } else if (dragState.mode === 'move') {
            const movedIds = dragState.noteIds ? Array.from(dragState.noteIds) : [dragState.primaryNoteId];
            const movedNotes = movedIds.map(id => store.getNoteById(id)).filter(Boolean);
            const previewPositions = dragState.previewPositions || [];
            const previewMap = new Map(previewPositions.map(pos => [pos.id, pos]));

            movedNotes.forEach(note => {
                const preview = previewMap.get(note.id);
                if (preview) {
                    note.x = preview.x;
                    note.y = preview.y;
                }
            });

            if (store.targetGroup) {
                let assigned = false;
                movedNotes.forEach(note => {
                    if (!note.groupId) {
                        note.groupId = store.targetGroup.id;
                        assigned = true;
                    }
                    if (note.groupId === store.targetGroup.id) {
                        note.relX = note.x - store.targetGroup.x;
                        note.relY = note.y - store.targetGroup.y;
                    }
                });
                const shouldUpdate = assigned || movedNotes.some(note => note.groupId === store.targetGroup.id);
                if (shouldUpdate) {
                    eventBus.emit('group:updateSize', store.targetGroup);
                }
            } else {
                const groupsToUpdate = new Set();
                movedNotes.forEach(note => {
                    if (!note.groupId) return;
                    const group = store.getGroupById(note.groupId);
                    if (!group) return;
                    const noteCenterX = note.x + note.w / 2;
                    const noteCenterY = note.y + note.h / 2;
                    const inGroup = noteCenterX >= group.x && noteCenterX <= group.x + group.w &&
                                   noteCenterY >= group.y && noteCenterY <= group.y + group.h;
                    if (!inGroup) {
                        note.groupId = null;
                        note.relX = 0;
                        note.relY = 0;
                        eventBus.emit('group:updateSize', group);
                    } else {
                        note.relX = note.x - group.x;
                        note.relY = note.y - group.y;
                        groupsToUpdate.add(group.id);
                    }
                });
                groupsToUpdate.forEach(groupId => {
                    const group = store.getGroupById(groupId);
                    if (group) eventBus.emit('group:updateSize', group);
                });
            }
        }

        store.dragState = null;
        store.targetNote = null;
        store.targetGroup = null;
        this.canvas.style.cursor = 'default';
        eventBus.emit('data:changed');
    }

    // --- Touch Event Handlers ---

    handleTouchStart(e) {
        e.preventDefault();
        if (e.touches.length !== 1 || store.isEditing) return;
        eventBus.emit('ui:closeContextMenu');

        const touch = e.touches[0];
        const clientX = touch.clientX;
        const clientY = touch.clientY;
        const camera = store.camera;
        const worldPos = {
            x: (clientX - camera.x) / camera.zoom,
            y: (clientY - camera.y) / camera.zoom
        };
        store.lastPointer = worldPos;

        const selection = store.selection;

        // Check resize handles
        if (selection.type === 'group' && selection.groupIds.size === 1) {
            const group = store.getGroupById(Array.from(selection.groupIds)[0]);
            if (group && !group.locked && this.hitTestGroupResizeHandle(group, worldPos.x, worldPos.y)) {
                store.dragState = {
                    mode: 'resize-group',
                    group: group,
                    startX: worldPos.x,
                    startY: worldPos.y,
                    startW: group.w,
                    startH: group.h
                };
                return;
            }
        }
        
        if (selection.type === 'note' && selection.noteIds.size === 1) {
            const note = store.getNoteById(Array.from(selection.noteIds)[0]);
            if (note && this.hitTestResizeHandle(note, worldPos.x, worldPos.y)) {
                note.fixedWidth = true;
                store.dragState = {
                    mode: 'resize',
                    note: note,
                    startX: worldPos.x,
                    startY: worldPos.y,
                    startW: note.w,
                    startH: note.h
                };
                return;
            }
        }

        const hitNote = this.hitTestNote(worldPos.x, worldPos.y);
        const hitGroup = this.hitTestGroup(worldPos.x, worldPos.y);

        if (hitNote) {
            if (!selection.noteIds.has(hitNote.id) || selection.type !== 'note') {
                store.setSelection('note', [hitNote.id]);
            }
            const activeSelection = store.selection;
            store.dragState = {
                mode: 'move', 
                startX: worldPos.x, 
                startY: worldPos.y, 
                primaryNoteId: hitNote.id,
                initialPositions: store.notes.filter(n => activeSelection.noteIds.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y })),
                noteIds: new Set(activeSelection.noteIds)
            };
        } else if (hitGroup) {
            if (!selection.groupIds.has(hitGroup.id) || selection.type !== 'group') {
                store.setSelection('group', [hitGroup.id]);
            }
            if (!hitGroup.locked) {
                const activeSelection = store.selection;
                store.dragState = {
                    mode: 'move-group', 
                    startX: worldPos.x, 
                    startY: worldPos.y,
                    groupIds: new Set(activeSelection.groupIds),
                    initialGroupPositions: store.groups.filter(g => activeSelection.groupIds.has(g.id)).map(g => ({ id: g.id, x: g.x, y: g.y })),
                    groupNotePositions: store.notes.filter(n => activeSelection.groupIds.has(n.groupId)).map(n => ({ id: n.id, x: n.x, y: n.y })),
                    freeNotePositions: []
                };
            }
        } else {
            store.clearSelection();
            store.dragState = { 
                mode: 'pan', 
                startX: clientX, 
                startY: clientY, 
                camX: camera.x, 
                camY: camera.y 
            };

            // Long press for box select
            this.touchStartTimer = setTimeout(() => {
                if (store.dragState && store.dragState.mode === 'pan') {
                    const currWorld = {
                        x: (store.dragState.startX - camera.x) / camera.zoom,
                        y: (store.dragState.startY - camera.y) / camera.zoom
                    };
                    store.dragState = {
                        mode: 'box-select',
                        startX: currWorld.x, 
                        startY: currWorld.y,
                        currX: currWorld.x, 
                        currY: currWorld.y
                    };
                }
            }, 500);
        }
    }

    handleTouchMove(e) {
        const dragState = store.dragState;
        if (!dragState) return;
        
        const touch = e.touches[0];
        const clientX = touch.clientX;
        const clientY = touch.clientY;
        const camera = store.camera;

        // Cancel long press if moved
        if (dragState.mode === 'pan' && this.touchStartTimer) {
            const dist = Math.sqrt(Math.pow(clientX - dragState.startX, 2) + Math.pow(clientY - dragState.startY, 2));
            if (dist > 10) {
                clearTimeout(this.touchStartTimer);
                this.touchStartTimer = null;
            }
        }

        const worldPos = {
            x: (clientX - camera.x) / camera.zoom,
            y: (clientY - camera.y) / camera.zoom
        };
        store.lastPointer = worldPos;

        if (dragState.mode === 'resize-group') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            const minSize = this.getGroupMinSize(dragState.group);
            let newW = Math.max(minSize.minW, dragState.startW + dx);
            let newH = Math.max(minSize.minH, dragState.startH + dy);
            if (store.grid.enabled) {
                newW = Math.max(minSize.minW, store.snapToGrid(newW));
                newH = Math.max(minSize.minH, store.snapToGrid(newH));
            }
            dragState.group.w = newW;
            dragState.group.h = newH;
        } else if (dragState.mode === 'move-group') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            dragState.initialGroupPositions.forEach(pos => {
                const group = store.getGroupById(pos.id);
                if (group) {
                    let newX = pos.x + dx;
                    let newY = pos.y + dy;
                    if (store.grid.enabled) {
                        newX = store.snapToGrid(newX);
                        newY = store.snapToGrid(newY);
                    }
                    group.x = newX;
                    group.y = newY;
                }
            });
            dragState.groupNotePositions.forEach(pos => {
                const note = store.getNoteById(pos.id);
                if (note && note.groupId) {
                    const group = store.getGroupById(note.groupId);
                    if (group) {
                        note.x = group.x + note.relX;
                        note.y = group.y + note.relY;
                    }
                }
            });
        } else if (dragState.mode === 'resize') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            let newW = Math.max(50, dragState.startW + dx);
            let newH = Math.max(30, dragState.startH + dy);
            if (store.grid.enabled) {
                newW = store.snapToGrid(newW);
                newH = store.snapToGrid(newH);
            }
            dragState.note.w = newW;
            dragState.note.h = newH;
        } else if (dragState.mode === 'pan') {
            const dx = clientX - dragState.startX;
            const dy = clientY - dragState.startY;
            store.updateCamera({
                x: dragState.camX + dx,
                y: dragState.camY + dy
            });
            eventBus.emit('data:changed');
        } else if (dragState.mode === 'box-select') {
            dragState.currX = worldPos.x;
            dragState.currY = worldPos.y;

            const x = Math.min(dragState.startX, dragState.currX);
            const y = Math.min(dragState.startY, dragState.currY);
            const w = Math.abs(dragState.currX - dragState.startX);
            const h = Math.abs(dragState.currY - dragState.startY);

            const noteIds = new Set();
            const groupIds = new Set();

            store.groups.forEach(group => {
                const height = group.collapsed ? this.getCollapsedGroupHeight() : group.h;
                const groupRect = { x: group.x, y: group.y, w: group.w, h: height };
                if (this.checkRectOverlap({x, y, w, h}, groupRect)) groupIds.add(group.id);
            });

            store.notes.forEach(note => {
                if (note.groupId) return;
                if (this.checkRectOverlap({x, y, w, h}, note)) noteIds.add(note.id);
            });

            let finalNoteIds = noteIds;
            if (groupIds.size > 0) {
                finalNoteIds = this.getTopLevelNoteIds(noteIds);
            }

            this.applyMixedSelection(finalNoteIds, groupIds);
        } else if (dragState.mode === 'move') {
            const dx = worldPos.x - dragState.startX;
            const dy = worldPos.y - dragState.startY;
            const previewPositions = [];
            dragState.initialPositions.forEach(pos => {
                let newX = pos.x + dx;
                let newY = pos.y + dy;
                if (store.grid.enabled) {
                    newX = store.snapToGrid(newX);
                    newY = store.snapToGrid(newY);
                }
                previewPositions.push({ id: pos.id, x: newX, y: newY });
            });
            dragState.previewPositions = previewPositions;

            store.targetNote = null;
            store.targetGroup = null;
            const primaryNote = store.getNoteById(dragState.primaryNoteId);
            const primaryPreview = previewPositions.find(pos => pos.id === dragState.primaryNoteId);
            if (primaryNote && primaryPreview) {
                const previewNote = { ...primaryNote, x: primaryPreview.x, y: primaryPreview.y };
                for (const other of store.notes) {
                    if (store.selection.noteIds.has(other.id)) continue;
                    if (this.checkOverlap(previewNote, other)) { 
                        store.targetNote = other; 
                        break; 
                    }
                }
                for (const group of store.groups) {
                    const noteRect = { x: previewNote.x, y: previewNote.y, w: previewNote.w, h: previewNote.h };
                    const height = group.collapsed ? this.getCollapsedGroupHeight() : group.h;
                    const groupRect = { x: group.x, y: group.y, w: group.w, h: height };
                    if (this.checkRectOverlap(noteRect, groupRect)) { 
                        store.targetGroup = group; 
                        break; 
                    }
                }
            }
        }
        
        store.dragState = dragState;
    }

    handleTouchEnd(e) {
        if (this.touchStartTimer) { 
            clearTimeout(this.touchStartTimer); 
            this.touchStartTimer = null; 
        }
        this.handleMouseUp(e);
    }

    // --- Wheel Handler ---

    handleWheel(e) {
        const camera = store.camera;
        
        if (e.ctrlKey) {
            e.preventDefault();
            const direction = e.deltaY > 0 ? 1 : -1;
            eventBus.emit('zoom:step', direction);
        } else {
            e.preventDefault();
            store.updateCamera({
                x: camera.x - e.deltaX,
                y: camera.y - e.deltaY
            });
            eventBus.emit('data:changed');
        }
    }

    // --- Double Click Handler ---

    handleDoubleClick(e) {
        const worldPos = this.getWorldPos(e);
        const hitNote = this.hitTestNote(worldPos.x, worldPos.y);
        const hitGroup = this.hitTestGroup(worldPos.x, worldPos.y);
        
        if (hitNote) {
            if (hitNote.type === 'image') return;
            eventBus.emit('note:edit', hitNote);
        } else if (hitGroup) {
            eventBus.emit('note:create', worldPos.x, worldPos.y, '', hitGroup.id);
        } else {
            eventBus.emit('note:create', worldPos.x, worldPos.y);
        }
    }

    // --- Keyboard Handler ---

    handleKeyDown(e) {
        if (store.isEditing) return;
        
        if (e.key === 'Backspace' || e.key === 'Delete') {
            eventBus.emit('selection:delete');
        }

        // Group shortcuts
        if ((e.metaKey || e.ctrlKey) && e.key === 'g' && !e.shiftKey) {
            e.preventDefault();
            const selection = store.selection;
            if (selection.type === 'note' && selection.noteIds.size > 1) {
                eventBus.emit('group:createFromSelection');
            } else if (selection.ids.size === 0) {
                eventBus.emit('group:createEmpty');
            }
        }
        
        if ((e.metaKey || e.ctrlKey) && e.key === 'g' && e.shiftKey) {
            e.preventDefault();
            if (store.selection.type === 'group') {
                eventBus.emit('group:ungroup');
            } else {
                eventBus.emit('grid:toggleVisible');
            }
        }

        if ((e.metaKey || e.ctrlKey) && e.key === ',') {
            e.preventDefault();
            eventBus.emit('ui:toggleSettings');
        }

        if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
            e.preventDefault();
            eventBus.emit('ui:toggleHelp');
        }
    }

    // --- Drag & Drop / Paste Handlers ---

    handleDragOver(e) {
        e.preventDefault();
        if (!e.dataTransfer) return;
        const types = Array.from(e.dataTransfer.types || []);
        if (types.includes('Files')) {
            e.dataTransfer.dropEffect = 'copy';
        }
    }

    handleDrop(e) {
        if (store.isEditing) return;
        e.preventDefault();
        e.stopPropagation();
        const files = this.getImageFilesFromDataTransfer(e.dataTransfer);
        if (files.length === 0) return;
        const worldPos = this.getWorldPos(e);
        store.lastPointer = worldPos;
        this.createImageNotesFromFiles(files, worldPos);
    }

    handlePaste(e) {
        if (store.isEditing) return;
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        e.preventDefault();
        const files = this.getImageFilesFromClipboard(e.clipboardData);

        if (files.length > 0) {
            const worldPos = this.getFallbackWorldPos();
            store.lastPointer = worldPos;
            this.createImageNotesFromFiles(files, worldPos);
            return;
        }

        this.readImagesFromClipboard().then((clipboardFiles) => {
            if (clipboardFiles.length === 0) return;
            const worldPos = this.getFallbackWorldPos();
            store.lastPointer = worldPos;
            this.createImageNotesFromFiles(clipboardFiles, worldPos);
        });
    }

    handleDragEnter(e) {
        e.preventDefault();
    }

    getImageFilesFromDataTransfer(dataTransfer) {
        if (!dataTransfer) return [];
        const files = Array.from(dataTransfer.files || []).filter(file => file.type.startsWith('image/'));
        if (files.length > 0) return files;
        const items = Array.from(dataTransfer.items || []);
        return items
            .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
            .map(item => item.getAsFile())
            .filter(Boolean);
    }

    getImageFilesFromClipboard(clipboardData) {
        if (!clipboardData) return [];
        const files = Array.from(clipboardData.files || []).filter(file => file.type.startsWith('image/'));
        if (files.length > 0) return files;
        const items = Array.from(clipboardData.items || []);
        return items
            .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
            .map(item => item.getAsFile())
            .filter(Boolean);
    }

    async readImagesFromClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.read) return [];
        try {
            const items = await navigator.clipboard.read();
            const files = [];
            const timestamp = Date.now();
            items.forEach((item, index) => {
                const type = item.types.find(t => t.startsWith('image/'));
                if (!type) return;
                files.push({ item, type, index, timestamp });
            });

            const resolved = await Promise.all(files.map(async entry => {
                const blob = await entry.item.getType(entry.type);
                const name = `pasted-image-${entry.timestamp}-${entry.index}.png`;
                return new File([blob], name, { type: blob.type || entry.type || 'image/png' });
            }));

            return resolved.filter(Boolean);
        } catch (err) {
            return [];
        }
    }

    getFallbackWorldPos() {
        const pointer = store.lastPointer;
        if (pointer && (pointer.x !== 0 || pointer.y !== 0)) return pointer;
        const camera = store.camera;
        return {
            x: (-camera.x + window.innerWidth / 2) / camera.zoom,
            y: (-camera.y + window.innerHeight / 2) / camera.zoom
        };
    }

    createImageNotesFromFiles(files, baseWorldPos) {
        const offsetStep = 24;
        files.forEach((file, index) => {
            const tempUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(tempUrl);
                const offset = offsetStep * index;
                eventBus.emit('note:createImage', baseWorldPos.x + offset, baseWorldPos.y + offset, {
                    file: file,
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height,
                    name: file.name || ''
                });
            };
            img.onerror = () => {
                URL.revokeObjectURL(tempUrl);
            };
            img.src = tempUrl;
        });
    }
}
