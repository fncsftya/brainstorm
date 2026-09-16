/**
 * Main entry point for the Brainstorm application
 */
import { App } from './App.js';

// Initialize the application when DOM is ready
const app = new App();

// Expose app globally for HTML onclick handlers
window.app = app;
