/**
 * ProjectManager - Handles project CRUD and persistence
 */
import { eventBus } from './EventBus.js';
import { store, ZOOM_LEVELS } from './Store.js';

export class ProjectManager {
    constructor() {
        this._saveTimer = null;
        this._setupEventListeners();
    }

    _setupEventListeners() {
        eventBus.on('data:changed', () => this.scheduleSave());
        eventBus.on('project:create', () => this.createNewProject());
        eventBus.on('project:open', (projectId) => this.openProject(projectId));
        eventBus.on('project:rename', (newName) => this.renameProject(newName));
        eventBus.on('project:delete', (projectId) => this.deleteProject(projectId));
        eventBus.on('project:export', () => this.exportProject());
        eventBus.on('project:import', () => this.importProject());
        eventBus.on('board:clear', () => this.clearBoard());
    }

    /**
     * Schedule a save operation (debounced)
     */
    scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.saveToLocalStorage(), 1000);
    }

    /**
     * Save current project to localStorage
     */
    saveToLocalStorage() {
        if (!store.currentProject) return;

        try {
            store.currentProject.data = store.getStateSnapshot();
            store.currentProject.lastModified = Date.now();
            this.saveProjectsList();
        } catch (e) {
            console.warn('Failed to save to localStorage:', e.message);
        }
    }

    /**
     * Save projects list to localStorage
     */
    saveProjectsList() {
        try {
            localStorage.setItem(store.projectsStorageKey, JSON.stringify(store.projects));
        } catch (e) {
            console.warn('Failed to save projects list:', e.message);
        }
    }

    /**
     * Load projects from localStorage
     */
    loadProjects() {
        try {
            const saved = localStorage.getItem(store.projectsStorageKey);
            if (saved) {
                const projects = JSON.parse(saved);
                if (Array.isArray(projects)) {
                    store.projects = projects;
                }
            }
        } catch (e) {
            console.warn('Failed to load projects:', e.message);
        }
    }

    /**
     * Load from localStorage on startup
     */
    loadFromLocalStorage() {
        this.loadProjects();
        
        if (store.projects.length === 0) {
            this.createNewProject();
            return;
        }
        
        let projectId = localStorage.getItem(store.currentProjectKey);
        
        if (projectId) {
            const project = store.projects.find(p => p.id === projectId);
            if (project) {
                this.openProject(projectId);
                return;
            }
        }
        
        this.openProject(store.projects[0].id);
    }

    /**
     * Normalize zoom to nearest valid level
     */
    normalizeZoom(zoom) {
        const currentIndex = ZOOM_LEVELS.findIndex(z => z >= zoom);
        if (currentIndex === -1) return ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
        if (currentIndex === 0 || Math.abs(ZOOM_LEVELS[currentIndex] - zoom) < Math.abs(ZOOM_LEVELS[currentIndex - 1] - zoom)) {
            return ZOOM_LEVELS[currentIndex];
        }
        return ZOOM_LEVELS[currentIndex - 1];
    }

    /**
     * Create a new project
     */
    createNewProject() {
        const project = {
            id: store.generateId(),
            name: `Untitled ${store.projects.length + 1}`,
            data: {
                version: 3,
                camera: { x: 0, y: 0, zoom: 1 },
                notes: [],
                connections: [],
                groups: [],
                grid: { enabled: false, visible: false, size: 50, color: '#e5e7eb' },
                backgroundColor: '#fcfbf9'
            },
            lastModified: Date.now()
        };

        store.projects = [...store.projects, project];
        this.saveProjectsList();
        this.openProject(project.id);
        eventBus.emit('ui:updateProjectsList');
    }

    /**
     * Open a project
     */
    openProject(projectId) {
        const project = store.projects.find(p => p.id === projectId);
        if (!project) return;

        store.currentProject = project;
        localStorage.setItem(store.currentProjectKey, projectId);

        const data = project.data;
        store.loadStateSnapshot(data);
        
        // Normalize zoom
        const savedCamera = data.camera || { x: 0, y: 0, zoom: 1 };
        const normalizedZoom = this.normalizeZoom(savedCamera.zoom);
        store.updateCamera({ x: savedCamera.x, y: savedCamera.y, zoom: normalizedZoom });

        document.body.style.backgroundColor = store.backgroundColor;

        eventBus.emit('ui:updateEmptyState');
        eventBus.emit('ui:updateStylePanel');
        eventBus.emit('ui:updateProjectsList');
        eventBus.emit('ui:updateZoomDisplay');
        eventBus.emit('ui:updateCurrentProjectName');
    }

    /**
     * Rename current project
     */
    renameProject(newName) {
        if (!store.currentProject) return;
        store.currentProject.name = newName || 'Untitled';
        this.saveProjectsList();
        eventBus.emit('ui:updateProjectsList');
    }

    /**
     * Delete a project
     */
    deleteProject(projectId) {
        if (store.projects.length <= 1) {
            alert('Cannot delete the only project');
            return;
        }
        
        if (!confirm('Delete this project?')) return;
        
        store.projects = store.projects.filter(p => p.id !== projectId);
        
        if (store.currentProject?.id === projectId) {
            const nextProject = store.projects[0];
            this.openProject(nextProject.id);
        } else {
            this.saveProjectsList();
            eventBus.emit('ui:updateProjectsList');
        }
    }

    /**
     * Clear the current board
     */
    clearBoard() {
        store.clear();
        eventBus.emit('ui:updateEmptyState');
        eventBus.emit('ui:updateStylePanel');
        this.scheduleSave();
    }

    /**
     * Export project to JSON file
     */
    exportProject() {
        const data = store.getStateSnapshot();
        data.version = 2; // For compatibility
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bs_${Date.now()}.bs.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Import project from JSON file
     */
    importProject() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.style.display = 'none';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (!data.notes || !data.connections) { 
                        alert("Invalid file format."); 
                        return; 
                    }
                    
                    store.loadStateSnapshot(data);
                    
                    if (data.grid) {
                        store.updateGrid(data.grid);
                        eventBus.emit('ui:updateGridIndicator');
                    }
                    if (data.backgroundColor) {
                        store.backgroundColor = data.backgroundColor;
                        document.body.style.backgroundColor = data.backgroundColor;
                    }
                    
                    eventBus.emit('ui:hideSettings');
                    eventBus.emit('ui:updateEmptyState');
                    eventBus.emit('ui:updateStylePanel');
                    this.scheduleSave();
                } catch (err) { 
                    console.error(err); 
                    alert("Error loading file: " + err.message); 
                }
            };
            reader.readAsText(file);
        };
        
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    /**
     * Format date for display
     */
    formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
        return date.toLocaleDateString();
    }
}
