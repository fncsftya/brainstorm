/**
 * AuthManager - Handles login state and auth UI updates
 */
export class AuthManager {
    constructor() {
        this.user = null;
        this.signInButton = document.getElementById('auth-signin');
        this.userContainer = document.getElementById('auth-user');
        this.avatar = document.getElementById('auth-avatar');
        this.name = document.getElementById('auth-name');
        this.email = document.getElementById('auth-email');
        this.logoutButton = document.getElementById('auth-logout');
        this.toolsMenu = document.getElementById('menu-tools-container');

        this._bindEvents();
        this.refresh();
    }

    _bindEvents() {
        if (this.signInButton) {
            this.signInButton.addEventListener('click', () => this.signIn());
        }
        if (this.logoutButton) {
            this.logoutButton.addEventListener('click', () => this.signOut());
        }
    }

    signIn() {
        const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.href = `/api/auth/google/login?redirect=${encodeURIComponent(redirect)}`;
    }

    async signOut() {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            // Ignore network errors during sign out; UI will reset anyway.
        }
        this.user = null;
        this.renderSignedOut();
    }

    async refresh() {
        try {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            if (!response.ok) {
                this.user = null;
                this.renderSignedOut();
                return;
            }
            const user = await response.json();
            this.user = user;
            this.renderSignedIn(user);
        } catch (error) {
            this.user = null;
            this.renderSignedOut();
        }
    }

    renderSignedIn(user) {
        if (this.signInButton) this.signInButton.classList.add('hidden');
        if (this.userContainer) this.userContainer.classList.remove('hidden');
        if (this.avatar) this.avatar.src = user.avatarUrl || '';
        if (this.name) this.name.textContent = user.name || 'Signed in';
        if (this.email) this.email.textContent = user.email || '';
        this.updatePremiumUI(!!user.premium);
    }

    renderSignedOut() {
        if (this.signInButton) this.signInButton.classList.remove('hidden');
        if (this.userContainer) this.userContainer.classList.add('hidden');
        if (this.avatar) this.avatar.src = '';
        if (this.name) this.name.textContent = '';
        if (this.email) this.email.textContent = '';
        this.updatePremiumUI(false);
    }

    updatePremiumUI(isPremium) {
        if (!this.toolsMenu) return;
        if (isPremium) {
            this.toolsMenu.classList.remove('hidden');
        } else {
            this.toolsMenu.classList.add('hidden');
        }
    }
}
