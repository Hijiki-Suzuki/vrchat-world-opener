// VRC World Opener - Background Service Worker
// VRChat API との通信を担当

'use strict';

// ============================================================================
// 定数定義
// ============================================================================

/** VRChat API のベースURL */
const VRCHAT_API_BASE = 'https://api.vrchat.cloud/api/1';

/** 検索結果の取得件数 */
const SEARCH_RESULT_COUNT = 10;

/** User-Agent（VRChat API利用規約準拠） */
const USER_AGENT = 'VRCWorldOpener/0.1.1β (Chrome Extension; contact: https://github.com/Hijiki-Suzuki/vrchat-world-opener)';

/** ストレージキー */
const STORAGE_KEYS = {
    IS_AUTHENTICATED: 'isAuthenticated',
    DISPLAY_NAME: 'displayName',
    EXTENSION_ENABLED: 'extensionEnabled',
    SHOW_OPEN_BTN: 'showOpenBtn',
    SHOW_SEARCH_BTN: 'showSearchBtn'
};

/** メッセージアクション */
const ACTIONS = {
    CHECK_AUTH: 'checkAuth',
    LOGIN: 'login',
    VERIFY_2FA: 'verify2FA',
    SEARCH_WORLD: 'searchWorld',
    LOGOUT: 'logout'
};


/**
 * VRChat APIへのリクエストを送信する
 * @param {string} endpoint - APIエンドポイント
 * @param {RequestInit} options - fetchオプション
 * @returns {Promise<Response>} レスポンス
 */
async function fetchVRChatAPI(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${VRCHAT_API_BASE}${endpoint}`;

    const defaultOptions = {
        credentials: 'include',
        headers: {
            'User-Agent': USER_AGENT,
            ...options.headers
        }
    };

    return fetch(url, { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...options.headers } });
}

// ============================================================================
// 認証関連
// ============================================================================

/**
 * 認証状態を確認する
 * @returns {Promise<{isAuthenticated: boolean, user?: object, error?: string}>} 認証状態
 */
async function checkAuthStatus() {
    try {
        const response = await fetchVRChatAPI('/auth');

        if (response.ok) {
            const data = await response.json();
            return { isAuthenticated: true, user: data };
        }
        return { isAuthenticated: false };
    } catch (error) {
        // ネットワークエラーなどの場合は未認証として扱う
        return { isAuthenticated: false, error: error.message };
    }
}

/**
 * VRChatにログインする
 * @param {string} username - ユーザー名
 * @param {string} password - パスワード
 * @returns {Promise<{success: boolean, user?: object, requires2FA?: boolean, twoFactorAuthType?: string[], error?: string}>}
 */
async function login(username, password) {
    // 入力値のバリデーション
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return { success: false, error: 'ユーザー名を入力してください' };
    }
    if (!password || typeof password !== 'string' || password.length === 0) {
        return { success: false, error: 'パスワードを入力してください' };
    }

    try {
        const authString = btoa(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`);

        const response = await fetchVRChatAPI('/auth/user', {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authString}`
            }
        });

        if (response.ok) {
            const data = await response.json();

            // 2FAが必要な場合
            if (data.requiresTwoFactorAuth) {
                return {
                    success: false,
                    requires2FA: true,
                    twoFactorAuthType: data.requiresTwoFactorAuth
                };
            }

            // 認証情報を保存（パスワードは保存しない）
            await chrome.storage.local.set({
                [STORAGE_KEYS.IS_AUTHENTICATED]: true,
                [STORAGE_KEYS.DISPLAY_NAME]: data.displayName
            });

            return { success: true, user: data };
        }

        // エラーレスポンスの解析
        let errorMessage = 'ログインに失敗しました';
        try {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorMessage;
        } catch {
            // JSONパースエラーは無視
        }
        return { success: false, error: errorMessage };
    } catch (error) {
        return { success: false, error: `ネットワークエラー: ${error.message}` };
    }
}

/**
 * 2FA認証を実行する
 * @param {string} code - 認証コード
 * @param {string[]} authType - 認証タイプの配列
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function verify2FA(code, authType) {
    // 入力値のバリデーション
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return { success: false, error: '認証コードを入力してください' };
    }
    if (!authType || !Array.isArray(authType) || authType.length === 0) {
        return { success: false, error: '認証タイプが不正です' };
    }

    try {
        const endpoint = authType.includes('totp')
            ? '/auth/twofactorauth/totp/verify'
            : '/auth/twofactorauth/emailotp/verify';

        const response = await fetchVRChatAPI(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code.trim() })
        });

        if (response.ok) {
            // 認証完了後にユーザー情報を取得
            const authStatus = await checkAuthStatus();
            if (authStatus.isAuthenticated && authStatus.user) {
                await chrome.storage.local.set({
                    [STORAGE_KEYS.IS_AUTHENTICATED]: true,
                    [STORAGE_KEYS.DISPLAY_NAME]: authStatus.user.displayName
                });
            }
            return { success: true };
        }

        // エラーレスポンスの解析
        let errorMessage = '2FA認証に失敗しました';
        try {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorMessage;
        } catch {
            // JSONパースエラーは無視
        }
        return { success: false, error: errorMessage };
    } catch (error) {
        return { success: false, error: `ネットワークエラー: ${error.message}` };
    }
}

/**
 * ログアウトする
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function logout() {
    try {
        await fetchVRChatAPI('/logout', {
            method: 'PUT'
        });

        await chrome.storage.local.remove([
            STORAGE_KEYS.IS_AUTHENTICATED,
            STORAGE_KEYS.DISPLAY_NAME
        ]);
        return { success: true };
    } catch (error) {
        return { success: false, error: `ログアウトエラー: ${error.message}` };
    }
}

// ============================================================================
// ワールド検索
// ============================================================================

/**
 * ワールドを検索する
 * @param {string} worldName - ワールド名
 * @returns {Promise<{success: boolean, worldId?: string, worldName?: string, needsAuth?: boolean, notFound?: boolean, error?: string}>}
 */
async function searchWorld(worldName) {
    // 入力値のバリデーション
    if (!worldName || typeof worldName !== 'string' || worldName.trim().length === 0) {
        return { success: false, error: 'ワールド名を入力してください' };
    }

    const trimmedName = worldName.trim();

    try {
        // 認証状態を確認
        const authStatus = await checkAuthStatus();
        if (!authStatus.isAuthenticated) {
            return { success: false, needsAuth: true };
        }

        // ワールド検索API
        const searchUrl = `/worlds?search=${encodeURIComponent(trimmedName)}&n=${SEARCH_RESULT_COUNT}&sort=relevance`;

        const response = await fetchVRChatAPI(searchUrl);

        if (response.ok) {
            const worlds = await response.json();

            if (Array.isArray(worlds) && worlds.length > 0) {
                // 最も一致するワールドを返す（完全一致を優先）
                const exactMatch = worlds.find(w =>
                    w.name && w.name.toLowerCase() === trimmedName.toLowerCase()
                );

                if (exactMatch) {
                    return { success: true, worldId: exactMatch.id, worldName: exactMatch.name };
                }

                // 完全一致がなければ最初の結果を返す
                const firstWorld = worlds[0];
                return { success: true, worldId: firstWorld.id, worldName: firstWorld.name };
            }

            return { success: false, notFound: true };
        }

        return { success: false, error: 'API リクエストに失敗しました' };
    } catch (error) {

        return { success: false, error: `検索エラー: ${error.message}` };
    }
}

// ============================================================================
// メッセージハンドラー
// ============================================================================

/**
 * メッセージを処理する
 * @param {object} request - リクエストオブジェクト
 * @returns {Promise<object>} レスポンスオブジェクト
 */
async function handleMessage(request) {
    if (!request || !request.action) {
        return { error: 'Invalid request: action is required' };
    }

    switch (request.action) {
        case ACTIONS.CHECK_AUTH: {
            const authStatus = await checkAuthStatus();
            const stored = await chrome.storage.local.get([STORAGE_KEYS.DISPLAY_NAME]);
            return {
                isAuthenticated: authStatus.isAuthenticated,
                displayName: stored[STORAGE_KEYS.DISPLAY_NAME] || authStatus.user?.displayName
            };
        }

        case ACTIONS.LOGIN:
            return login(request.username, request.password);

        case ACTIONS.VERIFY_2FA:
            return verify2FA(request.code, request.authType);

        case ACTIONS.SEARCH_WORLD:
            return searchWorld(request.worldName);

        case ACTIONS.LOGOUT:
            return logout();

        default:
            return { error: `Unknown action: ${request.action}` };
    }
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request).then(sendResponse);
    return true; // 非同期レスポンスのために必要
});
