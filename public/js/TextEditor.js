/**
 * TextEditor - Handles text editing overlay for notes
 */
import { eventBus } from './EventBus.js';
import { store, DEFAULTS } from './Store.js';

export class TextEditor {
    constructor(editorElement, noteManager) {
        this.editor = editorElement;
        this.noteManager = noteManager;
        
        this._setupEventListeners();
    }

    _setupEventListeners() {
        eventBus.on('note:edit', (note) => this.startEditing(note));
        
        this.editor.addEventListener('blur', () => this.finishEditing());
        this.editor.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.editor.blur();
            }
        });
    }

    /**
     * Start editing a note
     */
    startEditing(note) {
        if (note.type === 'image') return;
        store.isEditing = true;
        store.editingNote = note;
        
        const style = note.style;
        const camera = store.camera;
        const screenX = note.x * camera.zoom + camera.x;
        const screenY = note.y * camera.zoom + camera.y;
        const padding = DEFAULTS.padding * camera.zoom;

        this.editor.style.display = 'block';
        this.editor.style.left = `${screenX + padding}px`;
        this.editor.style.top = `${screenY + padding}px`;
        this.editor.style.minWidth = '50px';
        this.editor.style.width = 'auto';
        this.editor.style.height = 'auto';
        this.editor.style.fontFamily = DEFAULTS.fontFamily;
        this.editor.style.fontSize = `${style.fontSize * camera.zoom}px`;
        this.editor.style.fontWeight = style.bold ? 'bold' : 'normal';
        this.editor.style.fontStyle = style.italic ? 'italic' : 'normal';
        this.editor.style.color = style.textColor;
        this.editor.style.borderColor = style.borderVisible ? style.borderColor : 'transparent';
        this.editor.value = note.text;
        this.editor.classList.remove('editor-new');

        // Visual handling for new vs existing notes
        if (note.text === "") {
            this.editor.classList.add('editor-new');
            this.editor.style.backgroundColor = style.backgroundColor;
            this.editor.style.borderRadius = style.rounded ? '8px' : '0px';
        } else {
            this.editor.style.backgroundColor = style.backgroundColor;
            this.editor.style.borderRadius = style.rounded ? '10px' : '0px';
        }

        this.editor.focus();
    }

    /**
     * Finish editing and save text
     */
    finishEditing() {
        if (!store.isEditing) return;
        
        const editingNote = store.editingNote;
        const text = this.editor.value.trim();
        
        if (text === "") {
            // Delete empty note
            store.removeNote(editingNote.id);
            // Remove any connections to this note
            const connectionsToRemove = store.connections.filter(
                c => c.from === editingNote.id || c.to === editingNote.id
            );
            connectionsToRemove.forEach(c => store.removeConnection(c.id));
            eventBus.emit('ui:updateEmptyState');
        } else {
            // Update note text and resize
            editingNote.text = text;
            this.noteManager.updateLinkPreview(editingNote, false);
            const dims = this.noteManager.measureNote(editingNote);
            editingNote.w = Math.max(editingNote.w, dims.w);
            editingNote.h = Math.max(editingNote.h, dims.h);
            if (!editingNote.fixedWidth) editingNote.w = dims.w;
            
            // Select the edited note
            store.setSelection('note', [editingNote.id]);
        }
        
        this.editor.style.display = 'none';
        this.editor.value = '';
        this.editor.classList.remove('editor-new');
        store.isEditing = false;
        store.editingNote = null;
        
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('notes:changed', store.notes);
        eventBus.emit('data:changed');
    }
}
