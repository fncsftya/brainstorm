/**
 * GroupManager - Handles group CRUD operations
 */
import { eventBus } from './EventBus.js';
import { store, DEFAULTS } from './Store.js';

export class GroupManager {
    constructor() {
        this._setupEventListeners();
    }

    _setupEventListeners() {
        eventBus.on('group:createFromSelection', () => this.createGroupFromSelection());
        eventBus.on('group:createEmpty', (x, y) => this.createEmptyGroup(x, y));
        eventBus.on('group:ungroup', () => this.ungroupSelection());
        eventBus.on('group:updateSize', (group) => this.updateGroupSize(group));
        eventBus.on('group:updateStyle', (key, value) => this.updateGroupStyle(key, value));
        eventBus.on('group:updateTitle', (value) => this.updateGroupTitle(value));
        eventBus.on('group:toggleCollapse', (groupId) => this.toggleGroupCollapse(groupId));
        eventBus.on('group:toggleLock', (groupId) => this.toggleGroupLock(groupId));
        eventBus.on('selection:delete', () => this.handleDelete());
    }

    /**
     * Add a new group
     */
    addGroup(x, y, w, h, title = null) {
        if (store.grid.enabled) {
            x = store.snapToGrid(x);
            y = store.snapToGrid(y);
            w = store.snapToGrid(w);
            h = store.snapToGrid(h);
        }
        
        const group = {
            id: store.generateId(),
            x: x, 
            y: y, 
            w: w, 
            h: h,
            title: title || 'Group',
            collapsed: false,
            locked: false,
            style: { ...DEFAULTS.group }
        };
        
        store.addGroup(group);
        eventBus.emit('data:changed');
        
        return group;
    }

    /**
     * Delete a group
     */
    deleteGroup(groupId, deleteNotes = false) {
        if (deleteNotes) {
            const notesInGroup = store.getNotesInGroup(groupId);
            // Remove connections to notes in group
            notesInGroup.forEach(note => {
                const connections = store.connections.filter(c => c.from === note.id || c.to === note.id);
                connections.forEach(c => store.removeConnection(c.id));
            });
            // Remove notes
            notesInGroup.forEach(note => store.removeNote(note.id));
        } else {
            // Just unassign notes from group
            store.notes.forEach(n => {
                if (n.groupId === groupId) n.groupId = null;
            });
        }
        
        store.removeGroup(groupId);
        eventBus.emit('data:changed');
    }

    /**
     * Create a group from selected notes
     */
    createGroupFromSelection() {
        const selection = store.selection;
        if (selection.type !== 'note' || selection.noteIds.size === 0) return;
        
        const selectedNotes = store.notes.filter(n => selection.noteIds.has(n.id));
        if (selectedNotes.length === 0) return;
        
        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectedNotes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.w);
            maxY = Math.max(maxY, n.y + n.h);
        });
        
        const padding = 20;
        const group = this.addGroup(
            minX - padding, 
            minY - padding, 
            maxX - minX + padding * 2, 
            maxY - minY + padding * 2
        );
        
        // Assign notes to group
        selectedNotes.forEach(n => {
            n.groupId = group.id;
            n.relX = n.x - group.x;
            n.relY = n.y - group.y;
        });
        
        // Select the new group
        store.setSelection('group', [group.id]);
        
        eventBus.emit('notes:changed', store.notes);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Create an empty group at a point
     */
    createEmptyGroup(x = null, y = null) {
        const position = this.getDefaultGroupPosition(x, y);
        const width = 260;
        const height = 160;
        const group = this.addGroup(
            position.x - width / 2,
            position.y - height / 2,
            width,
            height
        );
        store.setSelection('group', [group.id]);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    getDefaultGroupPosition(x, y) {
        if (typeof x === 'number' && typeof y === 'number') {
            return { x, y };
        }
        if (store.lastPointer) {
            return { x: store.lastPointer.x, y: store.lastPointer.y };
        }
        const camera = store.camera;
        return {
            x: (-camera.x + window.innerWidth / 2) / camera.zoom,
            y: (-camera.y + window.innerHeight / 2) / camera.zoom
        };
    }

    /**
     * Ungroup selected groups
     */
    ungroupSelection() {
        const selection = store.selection;
        if (selection.type !== 'group' || selection.groupIds.size === 0) return;
        
        selection.groupIds.forEach(groupId => {
            store.notes.forEach(n => {
                if (n.groupId === groupId) n.groupId = null;
            });
            store.removeGroup(groupId);
        });
        
        store.clearSelection();
        eventBus.emit('notes:changed', store.notes);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Toggle group collapsed state
     */
    toggleGroupCollapse(groupId) {
        const group = store.getGroupById(groupId);
        if (group) {
            group.collapsed = !group.collapsed;
            eventBus.emit('groups:changed', store.groups);
            eventBus.emit('data:changed');
        }
    }

    /**
     * Toggle group locked state
     */
    toggleGroupLock(groupId) {
        const group = store.getGroupById(groupId);
        if (group) {
            group.locked = !group.locked;
            eventBus.emit('groups:changed', store.groups);
            eventBus.emit('data:changed');
        }
    }

    /**
     * Update group size to fit notes
     */
    updateGroupSize(group) {
        const notesInGroup = store.getNotesInGroup(group.id);
        if (notesInGroup.length === 0) return;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        notesInGroup.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.w);
            maxY = Math.max(maxY, n.y + n.h);
        });
        
        const padding = 20;
        group.x = Math.min(group.x, minX - padding);
        group.y = Math.min(group.y, minY - padding);
        group.w = Math.max(group.w, maxX - minX + padding * 2);
        group.h = Math.max(group.h, maxY - minY + padding * 2);
        
        eventBus.emit('data:changed');
    }

    /**
     * Update style property on selected groups
     */
    updateGroupStyle(key, value) {
        const selection = store.selection;
        if (selection.type !== 'group') return;
        
        selection.groupIds.forEach(id => {
            const group = store.getGroupById(id);
            if (group) {
                group.style[key] = value;
            }
        });
        
        eventBus.emit('groups:changed', store.groups);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Update group title
     */
    updateGroupTitle(value) {
        const selection = store.selection;
        if (selection.type !== 'group') return;
        
        const firstId = Array.from(selection.groupIds)[0];
        const group = store.getGroupById(firstId);
        if (group) {
            group.title = value;
            eventBus.emit('groups:changed', store.groups);
            eventBus.emit('data:changed');
        }
    }

    /**
     * Handle delete for groups
     */
    handleDelete() {
        const selection = store.selection;
        if (selection.type !== 'group' || selection.groupIds.size === 0) return;
        
        selection.groupIds.forEach(id => {
            // Just unassign notes, don't delete them
            store.notes.forEach(n => {
                if (n.groupId === id) n.groupId = null;
            });
            store.removeGroup(id);
        });
        
        store.clearSelection();
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }
}
