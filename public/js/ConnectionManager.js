/**
 * ConnectionManager - Handles connection CRUD operations
 */
import { eventBus } from './EventBus.js';
import { store, DEFAULTS } from './Store.js';

export class ConnectionManager {
    constructor() {
        this._setupEventListeners();
    }

    _setupEventListeners() {
        eventBus.on('connection:toggle', (fromId, toId) => this.toggleConnection(fromId, toId));
        eventBus.on('connection:add', (fromId, toId) => this.addConnection(fromId, toId));
        eventBus.on('connection:updateStyle', (key, value) => this.updateConnectionStyle(key, value));
        eventBus.on('connection:updateLabel', (value) => this.updateConnectionLabel(value));
        eventBus.on('selection:delete', () => this.handleDelete());
    }

    /**
     * Add a connection between two notes
     */
    addConnection(fromId, toId) {
        if (fromId === toId) return null;
        
        // Check if connection already exists
        const exists = store.findConnection(fromId, toId);
        if (exists) return exists;
        
        const connection = { 
            id: store.generateId(), 
            from: fromId, 
            to: toId, 
            label: '',
            style: { ...DEFAULTS.connection } 
        };
        
        store.addConnection(connection);
        eventBus.emit('data:changed');
        
        return connection;
    }

    /**
     * Toggle connection between two notes (add if not exists, remove if exists)
     */
    toggleConnection(fromId, toId) {
        if (fromId === toId) return;
        
        const existing = store.findConnection(fromId, toId);
        if (existing) {
            store.removeConnection(existing.id);
        } else {
            this.addConnection(fromId, toId);
        }
        
        eventBus.emit('data:changed');
    }

    /**
     * Update style property on selected connections
     */
    updateConnectionStyle(key, value) {
        const selection = store.selection;
        if (selection.type !== 'connection') return;
        
        selection.connectionIds.forEach(id => {
            const conn = store.getConnectionById(id);
            if (conn) {
                conn.style[key] = value;
            }
        });
        
        eventBus.emit('connections:changed', store.connections);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Update label text on selected connections
     */
    updateConnectionLabel(value) {
        const selection = store.selection;
        if (selection.type !== 'connection') return;

        const nextValue = value.trim();
        selection.connectionIds.forEach(id => {
            const conn = store.getConnectionById(id);
            if (conn) {
                conn.label = nextValue;
            }
        });

        eventBus.emit('connections:changed', store.connections);
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }

    /**
     * Handle delete for connections
     */
    handleDelete() {
        const selection = store.selection;
        if (selection.type !== 'connection' || selection.connectionIds.size === 0) return;
        
        selection.connectionIds.forEach(id => store.removeConnection(id));
        
        store.clearSelection();
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('data:changed');
    }
}
