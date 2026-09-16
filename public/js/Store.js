/**
 * Store - Centralized state management for the brainstorm app
 * 
 * Provides reactive state with change notifications via EventBus.
 * All modules read/write state through this store rather than directly
 * mutating shared objects.
 */
import { eventBus } from './EventBus.js';

/**
 * Default configuration values
 */
export const DEFAULTS = {
    note: {
        textColor: '#2d3748',
        fontSize: 18,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        borderColor: '#d1d1d1',
        borderVisible: true,
        rounded: true,
        backgroundColor: '#ffffff'
    },
    connection: {
        color: '#9ca3af',
        width: 1.5,
        dash: [5, 5],
        arrowStart: false,
        arrowEnd: false
    },
    group: {
        borderColor: '#6b7280',
        borderWidth: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
        borderRadius: 8,
        title: 'Group',
        titleColor: '#374151',
        titleSize: 14
    },
    fontFamily: '"Crimson Pro", serif',
    lineHeightRatio: 1.4,
    padding: 15
};

/**
 * Zoom levels for discrete zoom steps
 */
export const ZOOM_LEVELS = [0.10, 0.25, 0.50, 0.75, 0.85, 0.95, 1.00, 1.10, 1.25, 1.50, 2.00, 3.00];

/**
 * Store class - manages all application state
 */
export class Store {
    constructor() {
        // Core data
        this._notes = [];
        this._connections = [];
        this._groups = [];
        
        // Camera state
        this._camera = { x: 0, y: 0, zoom: 1 };
        
        // Selection state
        this._selection = { 
            type: null, 
            ids: new Set(),
            noteIds: new Set(),
            groupIds: new Set(),
            connectionIds: new Set()
        };
        
        // Grid settings
        this._grid = {
            enabled: false,
            visible: false,
            size: 50,
            color: '#e5e7eb'
        };
        
        // UI state
        this._backgroundColor = '#fcfbf9';
        this._settingsOpen = false;
        this._projectsOpen = false;
        this._helpOpen = false;
        this._confirmClearOpen = false;
        this._aiBrainstormOpen = false;
        this._minimapVisible = true;
        this._isEditing = false;
        this._editingNote = null;
        
        // Drag/interaction state
        this._dragState = null;
        this._targetNote = null;
        this._targetGroup = null;
        this._lastPointer = { x: 0, y: 0 };
        
        // Project management
        this._projects = [];
        this._currentProject = null;
        this.projectsStorageKey = 'brainstorm_projects';
        this.currentProjectKey = 'brainstorm_current_project';
        
        // Save timer for debouncing
        this._saveTimer = null;
    }

    // --- Notes ---
    get notes() { return this._notes; }
    set notes(value) {
        this._notes = value;
        eventBus.emit('notes:changed', this._notes);
    }

    addNote(note) {
        this._notes.push(note);
        eventBus.emit('note:added', note);
        eventBus.emit('notes:changed', this._notes);
    }

    updateNote(id, updates) {
        const note = this._notes.find(n => n.id === id);
        if (note) {
            Object.assign(note, updates);
            eventBus.emit('note:updated', note);
            eventBus.emit('notes:changed', this._notes);
        }
        return note;
    }

    removeNote(id) {
        const index = this._notes.findIndex(n => n.id === id);
        if (index !== -1) {
            const removed = this._notes.splice(index, 1)[0];
            eventBus.emit('note:removed', removed);
            eventBus.emit('notes:changed', this._notes);
            return removed;
        }
        return null;
    }

    getNoteById(id) {
        return this._notes.find(n => n.id === id);
    }

    // --- Connections ---
    get connections() { return this._connections; }
    set connections(value) {
        this._connections = value;
        eventBus.emit('connections:changed', this._connections);
    }

    addConnection(connection) {
        this._connections.push(connection);
        eventBus.emit('connection:added', connection);
        eventBus.emit('connections:changed', this._connections);
    }

    removeConnection(id) {
        const index = this._connections.findIndex(c => c.id === id);
        if (index !== -1) {
            const removed = this._connections.splice(index, 1)[0];
            eventBus.emit('connection:removed', removed);
            eventBus.emit('connections:changed', this._connections);
            return removed;
        }
        return null;
    }

    findConnection(fromId, toId) {
        return this._connections.find(c =>
            (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
        );
    }

    getConnectionById(id) {
        return this._connections.find(c => c.id === id);
    }

    // --- Groups ---
    get groups() { return this._groups; }
    set groups(value) {
        this._groups = value;
        eventBus.emit('groups:changed', this._groups);
    }

    addGroup(group) {
        this._groups.push(group);
        eventBus.emit('group:added', group);
        eventBus.emit('groups:changed', this._groups);
    }

    updateGroup(id, updates) {
        const group = this._groups.find(g => g.id === id);
        if (group) {
            Object.assign(group, updates);
            eventBus.emit('group:updated', group);
            eventBus.emit('groups:changed', this._groups);
        }
        return group;
    }

    removeGroup(id) {
        const index = this._groups.findIndex(g => g.id === id);
        if (index !== -1) {
            const removed = this._groups.splice(index, 1)[0];
            eventBus.emit('group:removed', removed);
            eventBus.emit('groups:changed', this._groups);
            return removed;
        }
        return null;
    }

    getGroupById(id) {
        return this._groups.find(g => g.id === id);
    }

    getNotesInGroup(groupId) {
        return this._notes.filter(n => n.groupId === groupId);
    }

    // --- Camera ---
    get camera() { return this._camera; }
    set camera(value) {
        this._camera = value;
        eventBus.emit('camera:changed', this._camera);
    }

    updateCamera(updates) {
        Object.assign(this._camera, updates);
        eventBus.emit('camera:changed', this._camera);
    }

    // --- Selection ---
    get selection() { return this._selection; }
    set selection(value) {
        this._selection = value;
        eventBus.emit('selection:changed', this._selection);
    }

    setSelection(type, ids) {
        const nextIds = ids instanceof Set ? new Set(ids) : new Set(ids);
        this._selection.type = type;
        this._selection.ids = nextIds;
        this._selection.noteIds = new Set();
        this._selection.groupIds = new Set();
        this._selection.connectionIds = new Set();

        if (type === 'note') this._selection.noteIds = nextIds;
        if (type === 'group') this._selection.groupIds = nextIds;
        if (type === 'connection') this._selection.connectionIds = nextIds;
        eventBus.emit('selection:changed', this._selection);
    }

    setMixedSelection(noteIds, groupIds) {
        const nextNotes = noteIds instanceof Set ? new Set(noteIds) : new Set(noteIds);
        const nextGroups = groupIds instanceof Set ? new Set(groupIds) : new Set(groupIds);
        this._selection.type = 'mixed';
        this._selection.noteIds = nextNotes;
        this._selection.groupIds = nextGroups;
        this._selection.connectionIds = new Set();
        this._selection.ids = new Set([...nextNotes, ...nextGroups]);
        eventBus.emit('selection:changed', this._selection);
    }

    clearSelection() {
        this._selection.type = null;
        this._selection.ids.clear();
        this._selection.noteIds.clear();
        this._selection.groupIds.clear();
        this._selection.connectionIds.clear();
        eventBus.emit('selection:changed', this._selection);
    }

    addToSelection(id, itemType = null) {
        if (this._selection.type === 'mixed' && itemType) {
            if (itemType === 'note') this._selection.noteIds.add(id);
            if (itemType === 'group') this._selection.groupIds.add(id);
            this._selection.ids.add(id);
        } else {
            this._selection.ids.add(id);
            if (this._selection.type === 'note') this._selection.noteIds.add(id);
            if (this._selection.type === 'group') this._selection.groupIds.add(id);
            if (this._selection.type === 'connection') this._selection.connectionIds.add(id);
        }
        eventBus.emit('selection:changed', this._selection);
    }

    removeFromSelection(id, itemType = null) {
        if (this._selection.type === 'mixed' && itemType) {
            if (itemType === 'note') this._selection.noteIds.delete(id);
            if (itemType === 'group') this._selection.groupIds.delete(id);
            this._selection.ids.delete(id);
            if (this._selection.noteIds.size === 0 && this._selection.groupIds.size === 0) {
                this._selection.type = null;
            }
        } else {
            this._selection.ids.delete(id);
            if (this._selection.type === 'note') this._selection.noteIds.delete(id);
            if (this._selection.type === 'group') this._selection.groupIds.delete(id);
            if (this._selection.type === 'connection') this._selection.connectionIds.delete(id);
            if (this._selection.ids.size === 0) {
                this._selection.type = null;
            }
        }
        eventBus.emit('selection:changed', this._selection);
    }

    isSelected(id, itemType = null) {
        if (this._selection.type === 'mixed' && itemType) {
            if (itemType === 'note') return this._selection.noteIds.has(id);
            if (itemType === 'group') return this._selection.groupIds.has(id);
            return false;
        }
        return this._selection.ids.has(id);
    }

    // --- Grid ---
    get grid() { return this._grid; }
    set grid(value) {
        this._grid = value;
        eventBus.emit('grid:changed', this._grid);
    }

    updateGrid(updates) {
        Object.assign(this._grid, updates);
        eventBus.emit('grid:changed', this._grid);
    }

    snapToGrid(value) {
        if (!this._grid.enabled) return value;
        return Math.round(value / this._grid.size) * this._grid.size;
    }

    // --- Background ---
    get backgroundColor() { return this._backgroundColor; }
    set backgroundColor(value) {
        this._backgroundColor = value;
        eventBus.emit('backgroundColor:changed', this._backgroundColor);
    }

    // --- UI State ---
    get settingsOpen() { return this._settingsOpen; }
    set settingsOpen(value) {
        this._settingsOpen = value;
        eventBus.emit('ui:settingsOpen', this._settingsOpen);
    }

    get projectsOpen() { return this._projectsOpen; }
    set projectsOpen(value) {
        this._projectsOpen = value;
        eventBus.emit('ui:projectsOpen', this._projectsOpen);
    }

    get helpOpen() { return this._helpOpen; }
    set helpOpen(value) {
        this._helpOpen = value;
        eventBus.emit('ui:helpOpen', this._helpOpen);
    }

    get confirmClearOpen() { return this._confirmClearOpen; }
    set confirmClearOpen(value) {
        this._confirmClearOpen = value;
        eventBus.emit('ui:confirmClearOpen', this._confirmClearOpen);
    }

    get aiBrainstormOpen() { return this._aiBrainstormOpen; }
    set aiBrainstormOpen(value) {
        this._aiBrainstormOpen = value;
        eventBus.emit('ui:aiBrainstormOpen', this._aiBrainstormOpen);
    }

    get minimapVisible() { return this._minimapVisible; }
    set minimapVisible(value) {
        this._minimapVisible = value;
        eventBus.emit('ui:minimapVisible', this._minimapVisible);
    }

    get isEditing() { return this._isEditing; }
    set isEditing(value) {
        this._isEditing = value;
        eventBus.emit('editing:changed', this._isEditing);
    }

    get editingNote() { return this._editingNote; }
    set editingNote(value) {
        this._editingNote = value;
        eventBus.emit('editingNote:changed', this._editingNote);
    }

    // --- Drag State ---
    get dragState() { return this._dragState; }
    set dragState(value) {
        this._dragState = value;
        eventBus.emit('dragState:changed', this._dragState);
    }

    get targetNote() { return this._targetNote; }
    set targetNote(value) {
        this._targetNote = value;
    }

    get targetGroup() { return this._targetGroup; }
    set targetGroup(value) {
        this._targetGroup = value;
    }

    get lastPointer() { return this._lastPointer; }
    set lastPointer(value) {
        this._lastPointer = value;
    }

    // --- Projects ---
    get projects() { return this._projects; }
    set projects(value) {
        this._projects = value;
        eventBus.emit('projects:changed', this._projects);
    }

    get currentProject() { return this._currentProject; }
    set currentProject(value) {
        this._currentProject = value;
        eventBus.emit('currentProject:changed', this._currentProject);
    }

    // --- Utility ---
    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    /**
     * Get complete state snapshot for saving
     */
    getStateSnapshot() {
        return {
            version: 3,
            timestamp: Date.now(),
            camera: { ...this._camera },
            notes: this._notes.map(n => {
                if (n.type === 'image') {
                    return {
                        ...n,
                        style: { ...n.style },
                        image: n.image ? {
                            id: n.image.id || null,
                            width: n.image.width || n.w,
                            height: n.image.height || n.h,
                            name: n.image.name || ''
                        } : null
                    };
                }
                return { ...n, style: { ...n.style } };
            }),
            connections: this._connections.map(c => ({ ...c, style: { ...c.style } })),
            groups: this._groups.map(g => ({ ...g, style: { ...g.style } })),
            grid: { ...this._grid },
            backgroundColor: this._backgroundColor
        };
    }

    /**
     * Load state from snapshot
     */
    loadStateSnapshot(data) {
        const loadedNotes = (data.notes || []).map(note => {
            const normalized = { ...note };
            normalized.type = normalized.type || (normalized.image ? 'image' : 'text');
            normalized.style = normalized.style ? { ...normalized.style } : { ...DEFAULTS.note };
            if (normalized.type === 'image') {
                normalized.image = normalized.image ? { ...normalized.image } : { id: null, width: normalized.w, height: normalized.h, name: '' };
                if (!normalized.image.src) normalized.image.src = '';
                normalized.text = normalized.text || '';
                normalized.fixedWidth = true;
            }
            return normalized;
        });
        this._notes = loadedNotes;
        this._connections = data.connections || [];
        this._groups = data.groups || [];
        this._camera = data.camera || { x: 0, y: 0, zoom: 1 };
        this._grid = { ...this._grid, ...data.grid };
        this._backgroundColor = data.backgroundColor || '#fcfbf9';
        this._selection = { 
            type: null, 
            ids: new Set(),
            noteIds: new Set(),
            groupIds: new Set(),
            connectionIds: new Set()
        };
        this._dragState = null;
        this._isEditing = false;
        this._editingNote = null;
        this._settingsOpen = false;
        this._projectsOpen = false;
        this._helpOpen = false;
        this._confirmClearOpen = false;
        this._aiBrainstormOpen = false;
        this._lastPointer = { x: 0, y: 0 };
        
        eventBus.emit('state:loaded', data);
    }

    /**
     * Clear all data
     */
    clear() {
        this._notes = [];
        this._connections = [];
        this._groups = [];
        this._camera = { x: 0, y: 0, zoom: 1 };
        this._selection = { 
            type: null, 
            ids: new Set(),
            noteIds: new Set(),
            groupIds: new Set(),
            connectionIds: new Set()
        };
        this._dragState = null;
        this._isEditing = false;
        this._editingNote = null;
        this._settingsOpen = false;
        this._projectsOpen = false;
        this._helpOpen = false;
        this._confirmClearOpen = false;
        this._aiBrainstormOpen = false;
        this._lastPointer = { x: 0, y: 0 };
        
        eventBus.emit('state:cleared');
    }
}

// Singleton instance
export const store = new Store();
