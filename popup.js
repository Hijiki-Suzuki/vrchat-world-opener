// VRC World Opener - Popup Script
// 拡張機能のポップアップUI制御

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
    // ============================================================================
    // 定数定義
    // ============================================================================

    /** ストレージキー */
    const STORAGE_KEYS = {
        EXTENSION_ENABLED: 'extensionEnabled',
        SHOW_OPEN_BTN: 'showOpenBtn',
        SHOW_SEARCH_BTN: 'showSearchBtn'
    };

    /** メッセージアクション */
    const ACTIONS = {
        CHECK_AUTH: 'checkAuth',
        LOGIN: 'login',
        VERIFY_2FA: 'verify2FA',
        LOGOUT: 'logout',


        UPDATE_SETTINGS: 'updateSettings'
    };

    /** UI状態 */
    const UI_STATE = {
        LOADING: 'loading',
        LOGIN: 'login',
        TWOFA: 'twofa',
        LOGGED_IN: 'loggedIn'
    };

    /** ボタンテキスト */
    const BUTTON_TEXT = {
        LOGIN: 'ログイン',
        LOGGING_IN: 'ログイン中...',
        AUTH: '認証',
        AUTHENTICATING: '認証中...',
        LOGOUT: 'ログアウト',
        LOGGING_OUT: 'ログアウト中...'
    };

    // ============================================================================
    // DOM要素の取得
    // ============================================================================

    /** @type {HTMLElement} */
    const authStatus = document.getElementById('auth-status');
    /** @type {HTMLElement} */
    const loginForm = document.getElementById('login-form');
    /** @type {HTMLElement} */
    const twofaForm = document.getElementById('twofa-form');
    /** @type {HTMLElement} */
    const loggedIn = document.getElementById('logged-in');
    /** @type {HTMLElement} */
    const displayName = document.getElementById('display-name');
    /** @type {HTMLInputElement} */
    const enabledToggle = document.getElementById('enabled-toggle');
    /** @type {HTMLInputElement} */
    const showOpenBtnToggle = document.getElementById('show-open-btn-toggle');
    /** @type {HTMLInputElement} */
    const showSearchBtnToggle = document.getElementById('show-search-btn-toggle');

    /** @type {HTMLButtonElement} */
    const loginBtn = document.getElementById('login-btn');
    /** @type {HTMLButtonElement} */
    const logoutBtn = document.getElementById('logout-btn');
    /** @type {HTMLButtonElement} */
    const twofaBtn = document.getElementById('twofa-btn');
    /** @type {HTMLButtonElement} */
    const twofaCancelBtn = document.getElementById('twofa-cancel-btn');

    /** @type {HTMLElement} */
    const loginError = document.getElementById('login-error');
    /** @type {HTMLElement} */
    const twofaError = document.getElementById('twofa-error');

    /** @type {HTMLInputElement} */
    const usernameInput = document.getElementById('username');
    /** @type {HTMLInputElement} */
    const passwordInput = document.getElementById('password');
    /** @type {HTMLInputElement} */
    const twofaCodeInput = document.getElementById('twofa-code');

    // ============================================================================
    // 状態管理
    // ============================================================================

    /** @type {string[]|null} 2FA認証タイプ */
    let twoFactorAuthType = null;

    // ============================================================================
    // ユーティリティ関数
    // ============================================================================

    /**
     * 設定を読み込む
     */
    async function loadSettings() {
        try {
            const keys = [
                STORAGE_KEYS.EXTENSION_ENABLED,
                STORAGE_KEYS.SHOW_OPEN_BTN,
                STORAGE_KEYS.SHOW_SEARCH_BTN
            ];
            const result = await chrome.storage.local.get(keys);

            // デフォルトはtrue
            enabledToggle.checked = result[STORAGE_KEYS.EXTENSION_ENABLED] !== false;
            if (showOpenBtnToggle) showOpenBtnToggle.checked = result[STORAGE_KEYS.SHOW_OPEN_BTN] !== false;
            if (showSearchBtnToggle) showSearchBtnToggle.checked = result[STORAGE_KEYS.SHOW_SEARCH_BTN] !== false;
        } catch {
            // エラー時はデフォルトで有効
            enabledToggle.checked = true;
            if (showOpenBtnToggle) showOpenBtnToggle.checked = true;
            if (showSearchBtnToggle) showSearchBtnToggle.checked = true;
        }
    }

    /**
     * 設定を更新する
     */
    async function updateSettings() {
        const settings = {
            [STORAGE_KEYS.EXTENSION_ENABLED]: enabledToggle.checked,
            [STORAGE_KEYS.SHOW_OPEN_BTN]: showOpenBtnToggle ? showOpenBtnToggle.checked : true,
            [STORAGE_KEYS.SHOW_SEARCH_BTN]: showSearchBtnToggle ? showSearchBtnToggle.checked : true
        };

        try {
            await chrome.storage.local.set(settings);

            // 対象タブ（Twitter/X）のみにメッセージを送信
            const tabs = await chrome.tabs.query({
                url: [
                    "https://twitter.com/*",
                    "https://x.com/*"
                ]
            });

            const sendMessagePromises = tabs.map(async (tab) => {
                try {
                    if (tab.id) {
                        await chrome.tabs.sendMessage(tab.id, {
                            action: ACTIONS.UPDATE_SETTINGS,
                            settings: settings
                        });
                    }
                } catch (e) {
                    // タブが読み込み中などで受信できない場合は警告ログ
                    console.warn(`タブ(ID: ${tab.id})へのメッセージ送信に失敗:`, e);
                }
            });
            await Promise.all(sendMessagePromises);
        } catch (e) {
            console.error('設定の保存に失敗しました', e);
            // エラー時のロールバックは複雑になるため省略（再読み込みすれば戻る）
        }
    }

    /**
     * UI状態を切り替える
     * @param {string} state - 表示する状態
     */
    function showState(state) {
        const elements = [authStatus, loginForm, twofaForm, loggedIn];
        elements.forEach(el => {
            if (el) el.classList.add('hidden');
        });

        switch (state) {
            case UI_STATE.LOADING:
                authStatus?.classList.remove('hidden');
                break;
            case UI_STATE.LOGIN:
                loginForm?.classList.remove('hidden');
                break;
            case UI_STATE.TWOFA:
                twofaForm?.classList.remove('hidden');
                break;
            case UI_STATE.LOGGED_IN:
                loggedIn?.classList.remove('hidden');
                break;
        }
    }

    /**
     * エラーメッセージを表示する
     * @param {HTMLElement} element - エラー表示要素
     * @param {string} message - エラーメッセージ
     */
    function showError(element, message) {
        if (element) {
            element.textContent = message;
            element.classList.remove('hidden');
        }
    }

    /**
     * エラーメッセージを非表示にする
     * @param {HTMLElement} element - エラー表示要素
     */
    function hideError(element) {
        if (element) {
            element.classList.add('hidden');
        }
    }

    /**
     * フォームをクリアする
     */
    function clearForms() {
        if (usernameInput) usernameInput.value = '';
        if (passwordInput) passwordInput.value = '';
        if (twofaCodeInput) twofaCodeInput.value = '';
    }

    // ============================================================================
    // 認証関連
    // ============================================================================

    /**
     * 認証状態を確認する
     */
    async function checkAuth() {
        try {
            const response = await chrome.runtime.sendMessage({ action: ACTIONS.CHECK_AUTH });

            if (response && response.isAuthenticated) {
                if (displayName) {
                    displayName.textContent = response.displayName || 'ログイン中';
                }
                showState(UI_STATE.LOGGED_IN);
            } else {
                showState(UI_STATE.LOGIN);
            }
        } catch {
            showState(UI_STATE.LOGIN);
        }
    }

    /**
     * ログイン処理
     */
    async function handleLogin() {
        const username = usernameInput?.value.trim() || '';
        const password = passwordInput?.value || '';

        if (!username || !password) {
            showError(loginError, 'ユーザー名とパスワードを入力してください');
            return;
        }

        hideError(loginError);

        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = BUTTON_TEXT.LOGGING_IN;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                action: ACTIONS.LOGIN,
                username,
                password
            });

            if (response && response.success) {
                if (displayName && response.user) {
                    displayName.textContent = response.user.displayName;
                }
                showState(UI_STATE.LOGGED_IN);
            } else if (response && response.requires2FA) {
                twoFactorAuthType = response.twoFactorAuthType;
                showState(UI_STATE.TWOFA);
            } else {
                showError(loginError, response?.error || 'ログインに失敗しました');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'エラーが発生しました';
            showError(loginError, errorMessage);
        } finally {
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = BUTTON_TEXT.LOGIN;
            }
        }
    }

    /**
     * 2FA認証処理
     */
    async function handle2FA() {
        const code = twofaCodeInput?.value.trim() || '';

        if (!code) {
            showError(twofaError, '認証コードを入力してください');
            return;
        }

        hideError(twofaError);

        if (twofaBtn) {
            twofaBtn.disabled = true;
            twofaBtn.textContent = BUTTON_TEXT.AUTHENTICATING;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                action: ACTIONS.VERIFY_2FA,
                code,
                authType: twoFactorAuthType
            });

            if (response && response.success) {
                await checkAuth();
            } else {
                showError(twofaError, response?.error || '認証に失敗しました');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'エラーが発生しました';
            showError(twofaError, errorMessage);
        } finally {
            if (twofaBtn) {
                twofaBtn.disabled = false;
                twofaBtn.textContent = BUTTON_TEXT.AUTH;
            }
        }
    }

    /**
     * ログアウト処理
     */
    async function handleLogout() {
        if (logoutBtn) {
            logoutBtn.disabled = true;
            logoutBtn.textContent = BUTTON_TEXT.LOGGING_OUT;
        }

        try {
            await chrome.runtime.sendMessage({ action: ACTIONS.LOGOUT });
            showState(UI_STATE.LOGIN);
            clearForms();
        } catch {
            // ログアウトエラーは無視してUIを更新
            showState(UI_STATE.LOGIN);
        } finally {
            if (logoutBtn) {
                logoutBtn.disabled = false;
                logoutBtn.textContent = BUTTON_TEXT.LOGOUT;
            }
        }
    }

    /**
     * 2FAキャンセル処理
     */
    function handleTwofaCancel() {
        showState(UI_STATE.LOGIN);
        if (twofaCodeInput) twofaCodeInput.value = '';
        twoFactorAuthType = null;
    }

    // ============================================================================
    // イベントリスナー設定
    // ============================================================================

    // ボタンクリック
    loginBtn?.addEventListener('click', handleLogin);
    logoutBtn?.addEventListener('click', handleLogout);
    twofaBtn?.addEventListener('click', handle2FA);
    twofaCancelBtn?.addEventListener('click', handleTwofaCancel);


    // 設定変更イベント
    enabledToggle?.addEventListener('change', updateSettings);
    showOpenBtnToggle?.addEventListener('change', updateSettings);
    showSearchBtnToggle?.addEventListener('change', updateSettings);

    // Enterキーでフォーム送信
    passwordInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    twofaCodeInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handle2FA();
    });

    // ============================================================================
    // 初期化
    // ============================================================================

    await loadSettings();
    await checkAuth();
});
