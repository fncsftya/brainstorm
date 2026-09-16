/**
 * UIController - Handles UI panel visibility and updates
 */
import { eventBus } from './EventBus.js';
import { store, ZOOM_LEVELS, DEFAULTS } from './Store.js';

export class UIController {
    constructor() {
        this._setupEventListeners();
    }

    _setupEventListeners() {
        // UI update events
        eventBus.on('ui:updateStylePanel', () => this.updateStylePanel());
        eventBus.on('ui:updateEmptyState', () => this.updateEmptyState());
        eventBus.on('ui:updateProjectsList', () => this.updateProjectsList());
        eventBus.on('ui:updateZoomDisplay', () => this.updateZoomDisplay());
        eventBus.on('ui:updateGridIndicator', () => this.updateGridIndicator());
        eventBus.on('ui:updateCurrentProjectName', () => this.updateCurrentProjectName());
        eventBus.on('ui:updateSettingsPanel', () => this.updateSettingsPanel());
        
        // UI toggle events
        eventBus.on('ui:toggleSettings', () => this.toggleSettings());
        eventBus.on('ui:toggleProjects', () => this.toggleProjects());
        eventBus.on('ui:toggleHelp', () => this.toggleHelp());
        eventBus.on('ui:openHelp', () => this.openHelp());
        eventBus.on('ui:closeHelp', () => this.closeHelp());
        eventBus.on('ui:toggleAiBrainstorm', () => this.toggleAiBrainstorm());
        eventBus.on('ui:openAiBrainstorm', () => this.openAiBrainstorm());
        eventBus.on('ui:closeAiBrainstorm', () => this.closeAiBrainstorm());
        eventBus.on('ui:confirmClear', () => this.openClearConfirm());
        eventBus.on('ui:closeClearConfirm', () => this.closeClearConfirm());
        eventBus.on('ui:openContextMenu', (screenPos, worldPos) => this.openContextMenu(screenPos, worldPos));
        eventBus.on('ui:closeContextMenu', () => this.closeContextMenu());
        eventBus.on('ui:hideSettings', () => this.hideSettings());
        eventBus.on('ui:hideProjects', () => this.hideProjects());
        eventBus.on('ui:closeAllModals', () => this.closeAllModals());
        eventBus.on('ui:toggleMinimap', () => this.toggleMinimap());
        
        // Selection changes
        eventBus.on('selection:changed', () => this.updateStylePanel());
        eventBus.on('selection:changed', () => this.updateMenuSelectionState());
        
        // Zoom events
        eventBus.on('zoom:in', () => this.zoomIn());
        eventBus.on('zoom:out', () => this.zoomOut());
        eventBus.on('zoom:reset', () => this.zoomToDefault());
        eventBus.on('zoom:step', (direction) => this.zoomStep(direction));
        
        // Grid events
        eventBus.on('grid:toggleEnabled', () => this.toggleGridEnabled());
        eventBus.on('grid:toggleVisible', () => this.toggleGridVisible());
        eventBus.on('grid:setEnabled', (enabled) => this.setGridEnabled(enabled));
        eventBus.on('grid:setVisible', (visible) => this.setGridVisible(visible));
        eventBus.on('grid:setSize', (size) => this.setGridSize(size));
        eventBus.on('grid:setColor', (color) => this.setGridColor(color));
        
        // Background color
        eventBus.on('background:setColor', (color) => this.setBackgroundColor(color));
        
        // Camera events
        eventBus.on('camera:reset', () => this.resetCamera());
        eventBus.on('camera:centerOnContent', () => this.centerViewOnNotes());
    }

    initMenu() {
        const triggers = document.querySelectorAll('[data-menu]');
        triggers.forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const menuId = trigger.getAttribute('data-menu');
                this.toggleMenu(menuId);
            });
            trigger.addEventListener('mouseenter', () => {
                const menuId = trigger.getAttribute('data-menu');
                if (this.isAnyMenuOpen() && !this.isMenuOpen(menuId)) {
                    this.openMenu(menuId);
                }
            });
        });

        document.addEventListener('click', () => this.closeMenus());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeMenus();
                this.closeContextMenu();
                this.closeHelp();
                this.closeAiBrainstorm();
                this.closeClearConfirm();
            }
        });

        this.updateMenuSelectionState();
        this.updateMinimapMenuLabel();
    }

    initContextMenu() {
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        menu.addEventListener('click', (e) => e.stopPropagation());
        const createNoteBtn = document.getElementById('context-new-note');
        const createGroupBtn = document.getElementById('context-new-group');

        if (createNoteBtn) {
            createNoteBtn.addEventListener('click', () => {
                if (this.contextMenuWorld) {
                    eventBus.emit('note:create', this.contextMenuWorld.x, this.contextMenuWorld.y);
                }
                this.closeContextMenu();
            });
        }

        if (createGroupBtn) {
            createGroupBtn.addEventListener('click', () => {
                if (this.contextMenuWorld) {
                    eventBus.emit('group:createEmpty', this.contextMenuWorld.x, this.contextMenuWorld.y);
                } else {
                    eventBus.emit('group:createEmpty');
                }
                this.closeContextMenu();
            });
        }

        document.addEventListener('click', () => this.closeContextMenu());
    }

    toggleMenu(menuId) {
        if (this.isMenuOpen(menuId)) {
            this.closeMenus();
            return;
        }
        this.openMenu(menuId);
    }

    openMenu(menuId) {
        const menu = document.getElementById(menuId);
        if (!menu) return;
        this.closeMenus();
        menu.classList.remove('hidden');
        this.updateMenuSelectionState();
        this.updateMinimapMenuLabel();
    }

    isMenuOpen(menuId) {
        const menu = document.getElementById(menuId);
        return menu && !menu.classList.contains('hidden');
    }

    isAnyMenuOpen() {
        return !!document.querySelector('.menu-dropdown:not(.hidden)');
    }

    closeMenus() {
        document.querySelectorAll('.menu-dropdown').forEach(menu => menu.classList.add('hidden'));
    }

    // --- Style Panel ---

    updateStylePanel() {
        const panel = document.getElementById('style-panel');
        const noteInsp = document.getElementById('inspector-note');
        const connInsp = document.getElementById('inspector-connection');
        const groupInsp = document.getElementById('inspector-group');
        const label = document.getElementById('selection-label');
        const groupNotesBtn = document.getElementById('group-notes-btn');

        noteInsp.classList.add('hidden');
        connInsp.classList.add('hidden');
        if (groupInsp) groupInsp.classList.add('hidden');
        panel.classList.add('hidden');
        panel.classList.remove('flex');

        const selection = store.selection;
        if (selection.ids.size === 0) return;
        if (selection.type === 'mixed') return;

        const count = selection.ids.size;
        const isMulti = count > 1;
        const firstId = Array.from(selection.ids)[0];

        if (selection.type === 'note') {
            const note = store.getNoteById(firstId);
            if (!note) return;

            document.getElementById('style-color').value = note.style.textColor;
            const noteColorHex = document.getElementById('style-color-hex');
            if (noteColorHex) noteColorHex.value = note.style.textColor;
            document.getElementById('style-size').value = note.style.fontSize;
            document.getElementById('style-border-color').value = note.style.borderColor;
            const noteBorderHex = document.getElementById('style-border-color-hex');
            if (noteBorderHex) noteBorderHex.value = note.style.borderColor;
            document.getElementById('style-border-visible').checked = note.style.borderVisible;
            document.getElementById('style-rounded').checked = note.style.rounded;
            this.setBtnState('btn-bold', note.style.bold);
            this.setBtnState('btn-italic', note.style.italic);
            this.setBtnState('btn-underline', note.style.underline);
            this.setBtnState('btn-strike', note.style.strike);

            label.textContent = isMulti ? `${count} Notes Selected` : (note.type === 'image' ? 'Image Selected' : 'Note Selected');

            const delBtn = noteInsp.querySelector('button[onclick="app.deleteSelection()"] span');
            if (delBtn) delBtn.textContent = isMulti ? "Delete Notes" : "Delete Note";

            noteInsp.classList.remove('hidden');
            panel.classList.remove('hidden');
            panel.classList.add('flex');
            if (groupNotesBtn) {
                if (selection.noteIds.size > 1) {
                    groupNotesBtn.classList.remove('hidden');
                } else {
                    groupNotesBtn.classList.add('hidden');
                }
            }
        }
        else if (selection.type === 'connection') {
            const conn = store.getConnectionById(firstId);
            if (!conn) return;

            document.getElementById('conn-color').value = conn.style.color;
            const connHex = document.getElementById('conn-color-hex');
            if (connHex) connHex.value = conn.style.color;
            document.getElementById('conn-arrow-start').checked = conn.style.arrowStart;
            document.getElementById('conn-arrow-end').checked = conn.style.arrowEnd;
            const labelInput = document.getElementById('conn-label');
            if (labelInput) labelInput.value = conn.label || '';

            label.textContent = isMulti ? `${count} Lines Selected` : "Line Selected";

            const delBtn = connInsp.querySelector('button[onclick="app.deleteSelection()"] span');
            if (delBtn) delBtn.textContent = isMulti ? "Delete Connections" : "Delete Connection";

            connInsp.classList.remove('hidden');
            panel.classList.remove('hidden');
            panel.classList.add('flex');
        }
        else if (selection.type === 'group' && groupInsp) {
            const group = store.getGroupById(firstId);
            if (!group) return;

            document.getElementById('group-title').value = group.title;
            document.getElementById('group-border-color').value = group.style.borderColor;
            const groupBorderHex = document.getElementById('group-border-color-hex');
            if (groupBorderHex) groupBorderHex.value = group.style.borderColor;
            document.getElementById('group-bg-color').value = this.rgbaToHex(group.style.backgroundColor);
            const groupBgHex = document.getElementById('group-bg-color-hex');
            if (groupBgHex) groupBgHex.value = this.rgbaToHex(group.style.backgroundColor);
            document.getElementById('group-border-width').value = group.style.borderWidth;
            document.getElementById('group-border-radius').value = group.style.borderRadius;
            document.getElementById('group-collapsed').checked = group.collapsed;
            document.getElementById('group-locked').checked = group.locked;

            label.textContent = isMulti ? `${count} Groups Selected` : "Group Selected";

            groupInsp.classList.remove('hidden');
            panel.classList.remove('hidden');
            panel.classList.add('flex');
        }
    }

    rgbaToHex(rgba) {
        if (rgba.startsWith('#')) return rgba;
        const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
        if (!match) return '#ffffff';
        const r = parseInt(match[1]).toString(16).padStart(2, '0');
        const g = parseInt(match[2]).toString(16).padStart(2, '0');
        const b = parseInt(match[3]).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    }

    setBtnState(id, isActive) {
        const btn = document.getElementById(id);
        if (isActive) btn.classList.add('active'); 
        else btn.classList.remove('active');
    }

    // --- Empty State ---

    updateEmptyState() {
        const emptyInstructions = document.getElementById('empty-instructions');
        if (store.notes.length === 0 && store.groups.length === 0) {
            emptyInstructions.classList.remove('hidden');
        } else {
            emptyInstructions.classList.add('hidden');
        }
    }

    // --- Projects Panel ---

    toggleProjects() {
        store.projectsOpen = !store.projectsOpen;
        if (store.projectsOpen) {
            store.clearSelection();
            this.hideSettings();
            this.closeHelp();
            this.closeClearConfirm();
            this.updateProjectsList();
            this.updateCurrentProjectName();
        }
        this.updateUIState();
    }

    hideProjects() {
        store.projectsOpen = false;
        this.updateUIState();
    }

    toggleHelp() {
        store.helpOpen = !store.helpOpen;
        if (store.helpOpen) {
            store.clearSelection();
            this.hideSettings();
            this.hideProjects();
            this.closeClearConfirm();
        }
        this.updateUIState();
    }

    openHelp() {
        store.helpOpen = true;
        store.clearSelection();
        this.hideSettings();
        this.hideProjects();
        this.closeClearConfirm();
        this.updateUIState();
    }

    closeHelp() {
        store.helpOpen = false;
        this.updateUIState();
    }

    toggleAiBrainstorm() {
        store.aiBrainstormOpen = !store.aiBrainstormOpen;
        if (store.aiBrainstormOpen) {
            store.clearSelection();
            this.hideSettings();
            this.hideProjects();
            this.closeHelp();
            this.closeClearConfirm();
        }
        this.updateUIState();
    }

    openAiBrainstorm() {
        store.aiBrainstormOpen = true;
        store.clearSelection();
        this.hideSettings();
        this.hideProjects();
        this.closeHelp();
        this.closeClearConfirm();
        this.updateUIState();
    }

    closeAiBrainstorm() {
        store.aiBrainstormOpen = false;
        this.updateUIState();
    }

    openClearConfirm() {
        store.confirmClearOpen = true;
        store.clearSelection();
        this.hideSettings();
        this.hideProjects();
        this.closeHelp();
        this.updateUIState();
    }

    closeClearConfirm() {
        store.confirmClearOpen = false;
        this.updateUIState();
    }

    updateProjectsList() {
        const container = document.getElementById('projects-list');
        container.innerHTML = '';
        
        if (store.projects.length === 0) {
            container.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">No projects yet</div>';
            return;
        }
        
        store.projects.forEach(project => {
            const isCurrent = store.currentProject?.id === project.id;
            const div = document.createElement('div');
            div.className = `flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${isCurrent ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-gray-200'}`;
            
            const nameSpan = document.createElement('span');
            nameSpan.className = `flex-1 text-sm truncate ${isCurrent ? 'text-blue-700 font-medium' : 'text-gray-700'}`;
            nameSpan.textContent = project.name || 'Untitled';
            nameSpan.onclick = () => eventBus.emit('project:open', project.id);
            
            const dateSpan = document.createElement('span');
            dateSpan.className = 'text-[10px] text-gray-400';
            dateSpan.textContent = this.formatDate(project.lastModified);
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'flex gap-1';
            
            if (!isCurrent) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'text-gray-400 hover:text-red-500 p-1';
                deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>';
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    eventBus.emit('project:delete', project.id);
                };
                actionsDiv.appendChild(deleteBtn);
            }
            
            div.appendChild(nameSpan);
            div.appendChild(dateSpan);
            div.appendChild(actionsDiv);
            container.appendChild(div);
        });
    }

    updateCurrentProjectName() {
        const input = document.getElementById('current-project-name');
        if (input) {
            input.value = store.currentProject?.name || 'Untitled';
        }
    }

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

    // --- Settings Panel ---

    toggleSettings() {
        store.settingsOpen = !store.settingsOpen;
        if (store.settingsOpen) {
            store.clearSelection();
            this.hideProjects();
            this.updateSettingsPanel();
        }
        this.updateUIState();
    }

    hideSettings() {
        store.settingsOpen = false;
        this.updateUIState();
    }

    closeAllModals() {
        store.settingsOpen = false;
        store.projectsOpen = false;
        store.helpOpen = false;
        store.confirmClearOpen = false;
        store.aiBrainstormOpen = false;
        this.closeMenus();
        this.closeContextMenu();
        this.updateUIState();
    }

    updateUIState() {
        const anyModalOpen = store.settingsOpen || store.projectsOpen || store.helpOpen || store.confirmClearOpen || store.aiBrainstormOpen;
        const panel = document.getElementById('projects-panel');
        const settingsPanel = document.getElementById('settings-panel');
        const helpPanel = document.getElementById('help-modal');
        const clearPanel = document.getElementById('clear-modal');
        const aiPanel = document.getElementById('ai-brainstorm-modal');
        const backdrop = document.getElementById('modal-backdrop');
        const controls = document.getElementById('controls');
        const emptyInstructions = document.getElementById('empty-instructions');
        const helpFooter = document.getElementById('help-footer');
        const minimapContainer = document.getElementById('minimap-container');

        if (anyModalOpen) {
            this.closeMenus();
            this.closeContextMenu();
            if (store.projectsOpen) {
                panel.classList.remove('hidden');
                panel.classList.add('flex');
            } else {
                panel.classList.add('hidden');
                panel.classList.remove('flex');
            }
            if (store.settingsOpen) {
                settingsPanel.classList.remove('hidden');
                settingsPanel.classList.add('flex');
            } else {
                settingsPanel.classList.add('hidden');
                settingsPanel.classList.remove('flex');
            }
            if (store.helpOpen) {
                helpPanel.classList.remove('hidden');
                helpPanel.classList.add('flex');
            } else if (helpPanel) {
                helpPanel.classList.add('hidden');
                helpPanel.classList.remove('flex');
            }
            if (store.confirmClearOpen) {
                clearPanel.classList.remove('hidden');
                clearPanel.classList.add('flex');
            } else if (clearPanel) {
                clearPanel.classList.add('hidden');
                clearPanel.classList.remove('flex');
            }
            if (store.aiBrainstormOpen && aiPanel) {
                aiPanel.classList.remove('hidden');
                aiPanel.classList.add('flex');
            } else if (aiPanel) {
                aiPanel.classList.add('hidden');
                aiPanel.classList.remove('flex');
            }
            backdrop.classList.remove('hidden');
            controls.classList.add('hidden');
            emptyInstructions.classList.add('hidden');
            helpFooter.classList.add('hidden');
            minimapContainer.classList.add('hidden');
        } else {
            panel.classList.add('hidden');
            panel.classList.remove('flex');
            settingsPanel.classList.add('hidden');
            settingsPanel.classList.remove('flex');
            if (helpPanel) {
                helpPanel.classList.add('hidden');
                helpPanel.classList.remove('flex');
            }
            if (clearPanel) {
                clearPanel.classList.add('hidden');
                clearPanel.classList.remove('flex');
            }
            if (aiPanel) {
                aiPanel.classList.add('hidden');
                aiPanel.classList.remove('flex');
            }
            backdrop.classList.add('hidden');
            controls.classList.remove('hidden');
            this.updateEmptyState();
            helpFooter.classList.remove('hidden');
            if (store.minimapVisible) {
                minimapContainer.classList.remove('hidden');
            } else {
                minimapContainer.classList.add('hidden');
            }
        }
    }

    updateSettingsPanel() {
        document.getElementById('settings-grid-enabled').checked = store.grid.enabled;
        document.getElementById('settings-grid-visible').checked = store.grid.visible;
        document.getElementById('settings-grid-size').value = store.grid.size;
        document.getElementById('settings-grid-color').value = store.grid.color;
        const gridHex = document.getElementById('settings-grid-color-hex');
        if (gridHex) gridHex.value = store.grid.color;
        document.getElementById('settings-bg-color').value = store.backgroundColor;
        const bgHex = document.getElementById('settings-bg-color-hex');
        if (bgHex) bgHex.value = store.backgroundColor;
    }

    openContextMenu(screenPos, worldPos) {
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        this.closeMenus();
        this.contextMenuWorld = worldPos;

        const menuWidth = 200;
        const menuHeight = menu.offsetHeight || 120;
        let left = screenPos.x;
        let top = screenPos.y;
        const maxLeft = window.innerWidth - menuWidth - 12;
        const maxTop = window.innerHeight - menuHeight - 12;
        left = Math.min(left, maxLeft);
        top = Math.min(top, maxTop);

        menu.style.left = `${Math.max(12, left)}px`;
        menu.style.top = `${Math.max(12, top)}px`;
        menu.classList.remove('hidden');
    }

    closeContextMenu() {
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        menu.classList.add('hidden');
        this.contextMenuWorld = null;
    }

    // --- Grid Controls ---

    updateGridIndicator() {
        const indicator = document.getElementById('grid-indicator');
        if (!indicator) return;
        if (store.grid.enabled) {
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    }

    toggleMinimap() {
        store.minimapVisible = !store.minimapVisible;
        this.updateMinimapMenuLabel();
        this.updateUIState();
    }

    updateMinimapMenuLabel() {
        const button = document.getElementById('menu-toggle-minimap');
        if (!button) return;
        const label = button.querySelector('[data-label]') || button;
        label.textContent = store.minimapVisible ? 'Hide Minimap' : 'Show Minimap';
    }

    updateMenuSelectionState() {
        const selection = store.selection;
        const hasSelection = selection.ids.size > 0;
        const canGroup = selection.type === 'note' && selection.noteIds.size > 1;
        const canUngroup = selection.type === 'group' && selection.groupIds.size > 0;
        const canFit = selection.type === 'note' && selection.noteIds.size > 0;

        const groupBtn = document.getElementById('menu-group-selection');
        const ungroupBtn = document.getElementById('menu-ungroup-selection');
        const fitBtn = document.getElementById('menu-fit-content');

        if (groupBtn) groupBtn.disabled = !hasSelection || !canGroup;
        if (ungroupBtn) ungroupBtn.disabled = !hasSelection || !canUngroup;
        if (fitBtn) fitBtn.disabled = !hasSelection || !canFit;
    }

    toggleGridEnabled() {
        this.setGridEnabled(!store.grid.enabled);
        document.getElementById('settings-grid-enabled').checked = store.grid.enabled;
    }

    toggleGridVisible() {
        this.setGridVisible(!store.grid.visible);
        document.getElementById('settings-grid-visible').checked = store.grid.visible;
    }

    setGridEnabled(enabled) {
        store.updateGrid({ enabled });
        this.updateGridIndicator();
        eventBus.emit('data:changed');
    }

    setGridVisible(visible) {
        store.updateGrid({ visible });
        eventBus.emit('data:changed');
    }

    setGridSize(size) {
        store.updateGrid({ size: Math.max(10, Math.min(200, size)) });
        eventBus.emit('data:changed');
    }

    setGridColor(color) {
        store.updateGrid({ color });
        const gridInput = document.getElementById('settings-grid-color');
        if (gridInput) gridInput.value = color;
        const gridHex = document.getElementById('settings-grid-color-hex');
        if (gridHex) gridHex.value = color;
        eventBus.emit('data:changed');
    }

    // --- Background Color ---

    setBackgroundColor(color) {
        store.backgroundColor = color;
        document.body.style.backgroundColor = color;
        const bgInput = document.getElementById('settings-bg-color');
        if (bgInput) bgInput.value = color;
        const bgHex = document.getElementById('settings-bg-color-hex');
        if (bgHex) bgHex.value = color;
        eventBus.emit('data:changed');
    }

    // --- Zoom Controls ---

    updateZoomDisplay() {
        const display = document.getElementById('zoom-display');
        if (display) {
            display.textContent = Math.round(store.camera.zoom * 100) + '%';
        }
    }

    zoomStep(direction) {
        const camera = store.camera;
        const currentIndex = ZOOM_LEVELS.findIndex(z => z >= camera.zoom);
        let newIndex;

        if (direction > 0) {
            newIndex = currentIndex === -1 ? ZOOM_LEVELS.length - 1 : Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1);
        } else {
            newIndex = currentIndex === -1 ? ZOOM_LEVELS.length - 1 : Math.max(currentIndex - 1, 0);
        }

        store.updateCamera({ zoom: ZOOM_LEVELS[newIndex] });
        this.updateZoomDisplay();
        eventBus.emit('data:changed');
    }

    zoomIn() {
        this.zoomStep(-1);
    }

    zoomOut() {
        this.zoomStep(1);
    }

    zoomToDefault() {
        store.updateCamera({ zoom: 1.0 });
        this.updateZoomDisplay();
        eventBus.emit('data:changed');
    }

    // --- Camera Controls ---

    resetCamera() {
        store.camera = { x: 0, y: 0, zoom: 1 };
        this.updateZoomDisplay();
        eventBus.emit('data:changed');
    }

    centerViewOnNotes() {
        if (store.notes.length === 0 && store.groups.length === 0) return;

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

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        const centerX = minX + contentWidth / 2;
        const centerY = minY + contentHeight / 2;
        const padding = 100;

        const targetWidth = contentWidth + padding * 2;
        const targetHeight = contentHeight + padding * 2;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        const zoomX = screenW / targetWidth;
        const zoomY = screenH / targetHeight;
        const targetZoom = Math.min(zoomX, zoomY);

        let bestZoom = ZOOM_LEVELS[0];
        for (const zoom of ZOOM_LEVELS) {
            if (zoom <= targetZoom && zoom > bestZoom) {
                bestZoom = zoom;
            }
        }

        if (bestZoom > 1.00) {
            bestZoom = 1.00;
        }

        store.updateCamera({
            zoom: bestZoom,
            x: (screenW / 2) - (centerX * bestZoom),
            y: (screenH / 2) - (centerY * bestZoom)
        });

        this.updateZoomDisplay();
        eventBus.emit('data:changed');
    }

    // --- Color Palette ---

    initPalette() {
        const palette = [
            '#ffffff', '#f8fafc',
            '#fef2f2', '#fff7ed',
            '#fefce8', '#f0fdf4',
            '#eff6ff', '#eef2ff',
            '#faf5ff', '#fdf2f8'
        ];
        const container = document.getElementById('bg-palette');
        palette.forEach(color => {
            const div = document.createElement('div');
            div.className = 'color-swatch';
            div.style.backgroundColor = color;
            div.onclick = () => eventBus.emit('note:updateStyle', 'backgroundColor', color);
            container.appendChild(div);
        });
    }
}
