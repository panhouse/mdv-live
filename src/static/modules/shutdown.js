/**
 * MDV - Shutdown Manager
 * Pure move from app.js (Stage 3b). No logic changes.
 */
import { elements } from './dom.js';
import { MDVApi } from '../lib/apiClient.js';

export const ShutdownManager = {
    async shutdown() {
        elements.statusText.textContent = 'Stopping...';
        // Connection failure is expected when server stops
        MDVApi.shutdown().catch(() => {});
    },

    init() {
        elements.shutdownBtn.addEventListener('click', () => this.shutdown());
    }
};
