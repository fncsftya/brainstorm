/**
 * AiBrainstormManager - Handles AI brainstorm modal and canvas updates
 */
import { eventBus } from './EventBus.js';
import { store, DEFAULTS } from './Store.js';

export class AiBrainstormManager {
    constructor(noteManager, connectionManager) {
        this.noteManager = noteManager;
        this.connectionManager = connectionManager;
        this.modal = document.getElementById('ai-brainstorm-modal');
        this.input = document.getElementById('ai-brainstorm-input');
        this.status = document.getElementById('ai-brainstorm-status');
        this.goButton = document.getElementById('ai-brainstorm-go');
        this.cancelButton = document.getElementById('ai-brainstorm-cancel');

        this._bindEvents();
    }

    _bindEvents() {
        if (this.goButton) {
            this.goButton.addEventListener('click', () => this.runBrainstorm());
        }
        if (this.cancelButton) {
            this.cancelButton.addEventListener('click', () => eventBus.emit('ui:closeAiBrainstorm'));
        }
        eventBus.on('ui:openAiBrainstorm', () => {
            this.setStatus('', false);
            if (this.input) this.input.focus();
        });
    }

    async runBrainstorm() {
        if (!this.input || !this.goButton) return;
        const idea = this.input.value.trim();
        if (!idea) {
            this.setStatus('Add a short idea to brainstorm.', true);
            return;
        }

        this.setLoading(true);
        this.setStatus('Thinking...', false);

        try {
            const response = await fetch('/api/tools/brainstorm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ idea })
            });

            if (!response.ok) {
                const message = response.status === 403 ? 'Premium required for AI brainstorm.' : 'AI brainstorm failed.';
                this.setStatus(message, true);
                this.setLoading(false);
                return;
            }

            const result = await response.json();
            this.applyBrainstormResult(result);
            this.input.value = '';
            this.setStatus('', false);
            eventBus.emit('ui:closeAiBrainstorm');
        } catch (error) {
            this.setStatus('Network error. Please try again.', true);
        }

        this.setLoading(false);
    }

    applyBrainstormResult(result) {
        if (!result || !Array.isArray(result.notes)) return;

        const notes = result.notes.filter(note => note && typeof note.text === 'string');
        if (notes.length === 0) return;

        const sizes = notes.map(note => this.measureNote(note.text));
        const connections = Array.isArray(result.connections) ? result.connections : [];
        const placements = this.placeNotes(notes, sizes, connections);
        const idMap = new Map();

        notes.forEach((note, index) => {
            const placement = placements[index];
            if (!placement) return;
            const created = this.noteManager.addNote(placement.x, placement.y, note.text);
            if (created) {
                idMap.set(note.id, created.id);
            }
        });

        if (Array.isArray(result.connections)) {
            let updatedLabels = false;
            result.connections.forEach(conn => {
                const fromId = idMap.get(conn.from);
                const toId = idMap.get(conn.to);
                if (!fromId || !toId || fromId === toId) return;
                const connection = this.connectionManager.addConnection(fromId, toId);
                if (connection && typeof conn.label === 'string' && conn.label.trim() !== '') {
                    connection.label = conn.label.trim();
                    updatedLabels = true;
                }
            });
            if (updatedLabels) {
                eventBus.emit('connections:changed', store.connections);
                eventBus.emit('data:changed');
            }
        }
    }

    measureNote(text) {
        const tempNote = {
            id: 'temp',
            x: 0,
            y: 0,
            w: 100,
            h: 50,
            text: text,
            fixedWidth: false,
            groupId: null,
            relX: 0,
            relY: 0,
            style: { ...DEFAULTS.note },
            link: null,
            type: 'text'
        };
        return this.noteManager.measureNote(tempNote);
    }

    placeNotes(notes, sizes, connections) {
        const existing = store.notes.map(note => ({
            x: note.x,
            y: note.y,
            w: note.w,
            h: note.h
        }));

        const maxWidth = sizes.reduce((max, size) => Math.max(max, size.w), 0);
        const maxHeight = sizes.reduce((max, size) => Math.max(max, size.h), 0);
        const cellW = Math.max(180, maxWidth + 40);
        const cellH = Math.max(120, maxHeight + 30);
        const base = this.getBasePosition();

        const graph = this.buildGraph(notes, connections);
        if (graph.edgeCount === 0) {
            return this.placeNotesGrid(notes, sizes, base, cellW, cellH, existing);
        }

        const layout = this.layoutGraph(notes, sizes, graph, cellW, cellH);
        const translated = this.findLayoutOffset(layout, sizes, base, cellW, cellH, existing);

        return translated;
    }

    placeNotesGrid(notes, sizes, base, cellW, cellH, existing) {
        const placements = [];
        const placedRects = [];

        notes.forEach((note, index) => {
            const size = sizes[index];
            const position = this.findOpenPosition(base, size, cellW, cellH, existing, placedRects);
            placements[index] = position;
            placedRects.push({ x: position.x, y: position.y, w: size.w, h: size.h });
        });

        return placements;
    }

    findOpenPosition(base, size, cellW, cellH, existing, placedRects) {
        let ring = 0;
        const maxRings = 200;
        while (ring <= maxRings) {
            for (let y = -ring; y <= ring; y++) {
                for (let x = -ring; x <= ring; x++) {
                    if (ring > 0 && Math.abs(x) < ring && Math.abs(y) < ring) {
                        continue;
                    }
                    const candidate = { x: base.x + x * cellW, y: base.y + y * cellH };
                    const rect = { x: candidate.x, y: candidate.y, w: size.w, h: size.h };
                    if (this.overlapsAny(rect, existing) || this.overlapsAny(rect, placedRects)) {
                        continue;
                    }
                    return candidate;
                }
            }
            ring += 1;
        }

        return { x: base.x, y: base.y };
    }

    buildGraph(notes, connections) {
        const idToIndex = new Map();
        notes.forEach((note, index) => {
            idToIndex.set(note.id, index);
        });

        const adjacency = Array.from({ length: notes.length }, () => new Set());
        let edgeCount = 0;

        connections.forEach(conn => {
            const fromIndex = idToIndex.get(conn.from);
            const toIndex = idToIndex.get(conn.to);
            if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) return;
            if (!adjacency[fromIndex].has(toIndex)) {
                adjacency[fromIndex].add(toIndex);
                adjacency[toIndex].add(fromIndex);
                edgeCount += 1;
            }
        });

        return { adjacency, edgeCount };
    }

    layoutGraph(notes, sizes, graph, cellW, cellH) {
        const components = this.findComponents(graph.adjacency);
        const positions = new Array(notes.length).fill(null);

        const componentLayouts = components.map(component => {
            const layout = this.layoutComponent(component, graph.adjacency);
            const maxLevel = Math.max(...Object.values(layout.levels));
            let maxCount = 0;
            for (let level = 0; level <= maxLevel; level++) {
                const count = layout.levelOrder[level]?.length || 0;
                if (count > maxCount) maxCount = count;
            }
            const width = Math.max(1, maxCount) * cellW;
            const height = (maxLevel + 1) * cellH;
            return { ...layout, width, height };
        });

        let offsetX = 0;
        const gap = cellW * 1.25;
        componentLayouts.forEach(component => {
            const centerX = offsetX + component.width / 2;
            component.nodes.forEach(nodeIndex => {
                const level = component.levels[nodeIndex] || 0;
                const order = component.orderIndex[nodeIndex] || 0;
                const count = component.levelOrder[level]?.length || 1;
                const x = centerX + (order - (count - 1) / 2) * cellW;
                const y = level * cellH;
                positions[nodeIndex] = { x, y };
            });
            offsetX += component.width + gap;
        });

        return positions;
    }

    layoutComponent(nodes, adjacency) {
        const nodeSet = new Set(nodes);
        const degrees = new Map();
        nodes.forEach(node => degrees.set(node, adjacency[node].size));
        const root = nodes.reduce((best, node) => {
            if (best === null) return node;
            return degrees.get(node) > degrees.get(best) ? node : best;
        }, null);

        const levels = {};
        const queue = [];
        if (root !== null && root !== undefined) {
            levels[root] = 0;
            queue.push(root);
        }

        while (queue.length) {
            const current = queue.shift();
            const level = levels[current];
            adjacency[current].forEach(next => {
                if (!nodeSet.has(next) || levels[next] !== undefined) return;
                levels[next] = level + 1;
                queue.push(next);
            });
        }

        nodes.forEach(node => {
            if (levels[node] === undefined) {
                levels[node] = 0;
            }
        });

        const maxLevel = Math.max(...nodes.map(node => levels[node]));
        const levelOrder = [];
        for (let level = 0; level <= maxLevel; level++) {
            const levelNodes = nodes.filter(node => levels[node] === level);
            levelNodes.sort((a, b) => degrees.get(b) - degrees.get(a));
            levelOrder[level] = levelNodes;
        }

        for (let pass = 0; pass < 3; pass++) {
            for (let level = 1; level <= maxLevel; level++) {
                this.sortByBarycenter(levelOrder, adjacency, level, -1);
            }
            for (let level = maxLevel - 1; level >= 0; level--) {
                this.sortByBarycenter(levelOrder, adjacency, level, 1);
            }
        }

        const orderIndex = {};
        levelOrder.forEach(levelNodes => {
            levelNodes.forEach((node, index) => {
                orderIndex[node] = index;
            });
        });

        return { nodes, levels, levelOrder, orderIndex };
    }

    sortByBarycenter(levelOrder, adjacency, level, direction) {
        const current = levelOrder[level];
        if (!current || current.length <= 1) return;
        const neighborLevel = level + direction;
        const neighborOrder = levelOrder[neighborLevel];
        if (!neighborOrder || neighborOrder.length === 0) return;
        const neighborIndex = new Map();
        neighborOrder.forEach((node, index) => neighborIndex.set(node, index));

        current.sort((a, b) => {
            const aScore = this.barycenterScore(a, adjacency, neighborIndex);
            const bScore = this.barycenterScore(b, adjacency, neighborIndex);
            return aScore - bScore;
        });
    }

    barycenterScore(node, adjacency, neighborIndex) {
        let total = 0;
        let count = 0;
        adjacency[node].forEach(neighbor => {
            if (!neighborIndex.has(neighbor)) return;
            total += neighborIndex.get(neighbor);
            count += 1;
        });
        if (count === 0) return 0;
        return total / count;
    }

    findComponents(adjacency) {
        const visited = new Set();
        const components = [];

        for (let i = 0; i < adjacency.length; i++) {
            if (visited.has(i)) continue;
            const component = [];
            const stack = [i];
            visited.add(i);
            while (stack.length) {
                const node = stack.pop();
                component.push(node);
                adjacency[node].forEach(next => {
                    if (visited.has(next)) return;
                    visited.add(next);
                    stack.push(next);
                });
            }
            components.push(component);
        }

        return components;
    }

    findLayoutOffset(layout, sizes, base, cellW, cellH, existing) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        layout.forEach((pos, index) => {
            const size = sizes[index];
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + size.w);
            maxY = Math.max(maxY, pos.y + size.h);
        });

        const layoutCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        const target = { x: base.x - layoutCenter.x, y: base.y - layoutCenter.y };

        const candidateOffsets = this.spiralOffsets(80, cellW, cellH);
        for (const offset of candidateOffsets) {
            const dx = target.x + offset.x;
            const dy = target.y + offset.y;
            if (this.layoutFits(layout, sizes, existing, dx, dy)) {
                return layout.map((pos, index) => ({
                    x: pos.x + dx,
                    y: pos.y + dy
                }));
            }
        }

        return layout.map(pos => ({ x: pos.x + target.x, y: pos.y + target.y }));
    }

    spiralOffsets(rings, cellW, cellH) {
        const offsets = [{ x: 0, y: 0 }];
        for (let ring = 1; ring <= rings; ring++) {
            for (let y = -ring; y <= ring; y++) {
                for (let x = -ring; x <= ring; x++) {
                    if (Math.abs(x) < ring && Math.abs(y) < ring) {
                        continue;
                    }
                    offsets.push({ x: x * cellW, y: y * cellH });
                }
            }
        }
        return offsets;
    }

    layoutFits(layout, sizes, existing, dx, dy) {
        for (let i = 0; i < layout.length; i++) {
            const pos = layout[i];
            if (!pos) continue;
            const rect = {
                x: pos.x + dx,
                y: pos.y + dy,
                w: sizes[i].w,
                h: sizes[i].h
            };
            if (this.overlapsAny(rect, existing)) {
                return false;
            }
        }
        return true;
    }

    overlapsAny(rect, list) {
        for (const other of list) {
            if (rect.x < other.x + other.w && rect.x + rect.w > other.x && rect.y < other.y + other.h && rect.y + rect.h > other.y) {
                return true;
            }
        }
        return false;
    }

    getBasePosition() {
        const pointer = store.lastPointer;
        if (pointer && (pointer.x !== 0 || pointer.y !== 0)) {
            return { x: pointer.x, y: pointer.y };
        }
        const camera = store.camera;
        return {
            x: (-camera.x + window.innerWidth / 2) / camera.zoom,
            y: (-camera.y + window.innerHeight / 2) / camera.zoom
        };
    }

    setStatus(message, isError) {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.toggle('text-red-500', !!isError);
        this.status.classList.toggle('text-gray-500', !isError);
    }

    setLoading(isLoading) {
        if (!this.goButton) return;
        this.goButton.disabled = isLoading;
        this.goButton.textContent = isLoading ? 'Working...' : 'Go';
    }
}
