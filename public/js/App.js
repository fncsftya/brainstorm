/**
 * App - Main application orchestrator
 * 
 * This is a thin coordinator that initializes all modules
 * and connects them together. Business logic lives in the
 * individual modules.
 */
import { eventBus } from './EventBus.js';
import { store } from './Store.js';
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { NoteManager } from './NoteManager.js';
import { ConnectionManager } from './ConnectionManager.js';
import { GroupManager } from './GroupManager.js';
import { ProjectManager } from './ProjectManager.js';
import { UIController } from './UIController.js';
import { TextEditor } from './TextEditor.js';
import { AuthManager } from './AuthManager.js';
import { AiBrainstormManager } from './AiBrainstormManager.js';

export class App {
    constructor() {
        // Get DOM elements
        this.canvas = document.getElementById('app-canvas');
        this.editor = document.getElementById('text-editor');
        this.minimapCanvas = document.getElementById('minimap-canvas');
        
        // Initialize modules
        this.renderer = new Renderer(this.canvas, this.minimapCanvas);
        this.inputHandler = new InputHandler(this.canvas);
        this.noteManager = new NoteManager();
        this.connectionManager = new ConnectionManager();
        this.groupManager = new GroupManager();
        this.projectManager = new ProjectManager();
        this.uiController = new UIController();
        this.textEditor = new TextEditor(this.editor, this.noteManager);
        this.authManager = new AuthManager();
        this.aiBrainstormManager = new AiBrainstormManager(this.noteManager, this.connectionManager);
        
        this.init();
    }

    init() {
        this.detectMobile();
        
        // Set up resize handler
        this.renderer.resize();
        window.addEventListener('resize', () => this.renderer.resize());
        
        // Set up minimap click handler
        this.minimapCanvas.addEventListener('click', (e) => {
            e.stopPropagation();
            eventBus.emit('camera:centerOnContent');
        });
        this.minimapCanvas.addEventListener('dblclick', (e) => e.stopPropagation());
        this.minimapCanvas.addEventListener('mousedown', (e) => e.stopPropagation());
        
        // Initialize UI
        this.uiController.initPalette();
        this.uiController.initMenu();
        this.uiController.initContextMenu();
        
        // Load data
        this.projectManager.loadFromLocalStorage();
        
        // Update UI
        this.uiController.updateZoomDisplay();
        this.uiController.updateEmptyState();
        
        // Start render loop
        this.renderer.startLoop();
        
        // Wait for fonts to load before rendering
        document.fonts.ready.then(() => {
            this.renderer.requestRender();
        });
    }

    detectMobile() {
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isMobile) {
            document.getElementById('empty-text-desktop').classList.add('hidden');
            document.getElementById('empty-text-mobile').classList.remove('hidden');
        }
    }

    // --- Public API for HTML onclick handlers ---
    // These methods delegate to the appropriate module via events

    // Note operations
    deleteSelection() {
        eventBus.emit('selection:delete');
    }

    updateNoteStyle(key, value) {
        eventBus.emit('note:updateStyle', key, value);
    }

    toggleNoteBoolean(key) {
        eventBus.emit('note:toggleBoolean', key);
    }

    fitNotesToContent() {
        eventBus.emit('note:fitToContent');
    }

    // Connection operations
    updateConnectionStyle(key, value) {
        eventBus.emit('connection:updateStyle', key, value);
    }

    updateConnectionLabel(value) {
        eventBus.emit('connection:updateLabel', value);
    }

    // Group operations
    createGroupFromSelection() {
        eventBus.emit('group:createFromSelection');
    }

    ungroupSelection() {
        eventBus.emit('group:ungroup');
    }

    updateGroupStyle(key, value) {
        eventBus.emit('group:updateStyle', key, value);
    }

    updateGroupTitle(value) {
        eventBus.emit('group:updateTitle', value);
    }

    updateGroupCollapsed(value) {
        const selection = store.selection;
        if (selection.type !== 'group') return;
        selection.groupIds.forEach(id => eventBus.emit('group:toggleCollapse', id));
    }

    updateGroupLocked(value) {
        const selection = store.selection;
        if (selection.type !== 'group') return;
        selection.groupIds.forEach(id => eventBus.emit('group:toggleLock', id));
    }

    // Project operations
    toggleProjects() {
        eventBus.emit('ui:toggleProjects');
    }

    createNewProject() {
        eventBus.emit('project:create');
    }

    renameProject(newName) {
        eventBus.emit('project:rename', newName);
    }

    clearBoard() {
        eventBus.emit('ui:confirmClear');
    }

    confirmClearBoard() {
        eventBus.emit('board:clear');
    }

    // Settings
    toggleSettings() {
        eventBus.emit('ui:toggleSettings');
    }

    toggleHelp() {
        eventBus.emit('ui:toggleHelp');
    }

    closeHelp() {
        eventBus.emit('ui:closeHelp');
    }

    openAiBrainstorm() {
        eventBus.emit('ui:openAiBrainstorm');
    }

    closeAiBrainstorm() {
        eventBus.emit('ui:closeAiBrainstorm');
    }

    closeAllModals() {
        eventBus.emit('ui:closeAllModals');
    }

    toggleMinimap() {
        eventBus.emit('ui:toggleMinimap');
    }

    // Grid
    setGridEnabled(enabled) {
        eventBus.emit('grid:setEnabled', enabled);
    }

    setGridVisible(visible) {
        eventBus.emit('grid:setVisible', visible);
    }

    toggleGridEnabled() {
        eventBus.emit('grid:toggleEnabled');
    }

    toggleGridVisible() {
        eventBus.emit('grid:toggleVisible');
    }

    setGridSize(size) {
        eventBus.emit('grid:setSize', size);
    }

    setGridColor(color) {
        eventBus.emit('grid:setColor', color);
    }

    snapAllNotesToGrid() {
        this.noteManager.snapAllNotesToGrid();
    }

    // Background
    setBackgroundColor(color) {
        eventBus.emit('background:setColor', color);
    }

    // Camera
    resetCamera() {
        eventBus.emit('camera:reset');
    }

    // Zoom
    zoomIn() {
        eventBus.emit('zoom:in');
    }

    zoomOut() {
        eventBus.emit('zoom:out');
    }

    zoomToDefault() {
        eventBus.emit('zoom:reset');
    }

    createEmptyGroup() {
        eventBus.emit('group:createEmpty');
    }

    createNoteAtPointer() {
        const pointer = store.lastPointer;
        if (pointer && (pointer.x !== 0 || pointer.y !== 0)) {
            eventBus.emit('note:create', pointer.x, pointer.y);
            return;
        }
        const camera = store.camera;
        const centerX = (-camera.x + window.innerWidth / 2) / camera.zoom;
        const centerY = (-camera.y + window.innerHeight / 2) / camera.zoom;
        eventBus.emit('note:create', centerX, centerY);
    }

    // Export
    exportImage() {
        this.renderer.exportImage();
    }
}
