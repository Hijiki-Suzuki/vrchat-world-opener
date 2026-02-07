// VRC World Opener - Content Script
// X（Twitter）のポストからVRChatワールド名を検出してリンク化する

'use strict';

(function () {
    // ============================================================================
    // 定数定義
    // ============================================================================

    /** 処理済みマーカー属性名 */
    const PROCESSED_ATTR = 'data-vrchat-world-linker-processed';

    /** VRChat WebサイトURL */
    const VRCHAT_WEB_BASE = 'https://vrchat.com/home';

    /** ボタン状態リセットまでの時間（ミリ秒） */
    const BUTTON_RESET_DELAY_MS = 2000;

    /** DOM変更検知後の処理遅延（ミリ秒） */
    const DEBOUNCE_DELAY_MS = 300;

    /** 対象ハッシュタグ（小文字） */
    const TARGET_HASHTAG = '#vrchat_world紹介';

    /** ストレージキー */
    const STORAGE_KEYS = {
        EXTENSION_ENABLED: 'extensionEnabled',
        SHOW_OPEN_BTN: 'showOpenBtn',
        SHOW_SEARCH_BTN: 'showSearchBtn'
    };

    /** メッセージアクション */
    const ACTIONS = {
        SEARCH_WORLD: 'searchWorld',

        UPDATE_SETTINGS: 'updateSettings'
    };

    /** DOM セレクタ（X/Twitterの仕様変更時はここを修正） */
    const SELECTORS = {
        TWEET: '[data-testid="tweet"]',
        TWEET_TEXT: '[data-testid="tweetText"]',
        ACTION_BAR: '[role="group"]',
        VRCHAT_WORLD_LINK: 'a[href*="vrchat.com/home/world/"]'
    };

    /** ボタンテキスト */
    const BUTTON_TEXT = {
        DEFAULT: '🔗 ワールドを開く',
        LOADING: '🔄 取得中...',
        SUCCESS: '✅ 開きました',
        AUTH_REQUIRED: '⚠️ ログインが必要',
        NOT_FOUND: '❌ 取得に失敗しました',
        SEARCH_ONLY: '🔍 ワールド名で検索'
    };

    /** ワールド名検出パターン */
    const WORLD_PATTERNS = [
        // World: 形式（コロン前後スペース有無対応）
        /World\s*[:：]\s*(.+?)(?:\s*$|\s*#|\n|<)/i,

        // 括弧形式（各種括弧対応）
        /World\s*[『「【\(（](.+?)[』」】\)）]/i,

        // 絵文字形式（地球絵文字バリエーション）- uフラグでサロゲートペア対応
        /(?:🌐|🌍|🌎|🌏|🗺️)\s*(.+?)(?:\s*$|\s*#|\r?\n|\r|<)/u,

        // 日本語表記（コロン形式）
        /ワールド(?:名)?\s*[:：]\s*(.+?)(?:\s*$|\s*#|\n|<)/,

        // 日本語表記（スペース区切り形式）- 「ワールド名　◯◯」や「ワールド　◯◯」
        /ワールド(?:名)?[\s　]+(.+?)(?:\s*$|\s*#|\n|<)/,

        // World name形式
        /World\s*name\s*[:：]\s*(.+?)(?:\s*$|\s*#|\n|<)/i,

        // 「ワールド名 + 改行 + By 作者名」形式（絵文字がテキストから消える場合の対応）
        /^(.+?)\n+By\s/im,

        // 「ワールド名 + 改行 + Author 作者名」形式
        /^(.+?)\n+Author\s*[:：]?\s/im,
    ];

    // ============================================================================
    // 状態管理
    // ============================================================================

    /** 拡張機能の有効/無効状態 */
    let isExtensionEnabled = true;

    /* ボタン表示設定 */
    let showOpenBtn = true;
    let showSearchBtn = true;

    /** デバウンス用タイマーID */
    let debounceTimerId = null;

    // ============================================================================
    // ユーティリティ関数
    // ============================================================================

    /**
     * 要素からテキストを取得する（img要素のalt属性=絵文字も含める）
     * @param {Element} element - 対象要素
     * @returns {string} テキスト内容
     */
    function getTextWithEmoji(element) {
        if (!element) {
            return '';
        }

        let result = '';

        /**
         * ノードを再帰的に走査してテキストを収集
         * @param {Node} node - 対象ノード
         */
        function traverse(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                result += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // img要素の場合はalt属性を取得（絵文字が入っている）
                if (node.tagName === 'IMG' && node.alt) {
                    result += node.alt;
                }
                // 子要素を再帰的に処理
                for (const child of node.childNodes) {
                    traverse(child);
                }
            }
        }

        traverse(element);
        return result;
    }

    /**
     * ワールド名を抽出する
     * @param {string} text - 解析対象テキスト
     * @returns {string|null} ワールド名、見つからない場合はnull
     */
    function extractWorldName(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }

        for (const pattern of WORLD_PATTERNS) {
            const match = text.match(pattern);
            if (match && match[1]) {
                let worldName = match[1].trim();

                // 末尾のハッシュタグや改行を除去
                worldName = worldName.replace(/\s*#.*$/, '').trim();

                // 末尾の括弧類を除去（重複対策）
                worldName = worldName.replace(/[』」】\)）]+$/, '').trim();

                // 絵文字と壊れたサロゲートペアを除去
                worldName = worldName.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
                worldName = worldName.replace(/[\uD800-\uDFFF]/g, '').trim();

                if (worldName.length > 0) {
                    return worldName;
                }
            }
        }
        return null;
    }

    /**
     * URLからワールドIDを抽出する
     * @param {string} url - 対象URL
     * @returns {string|null} ワールドID
     */
    function extractWorldIdFromUrl(url) {
        if (!url) return null;
        // vrchat.com/home/world/wrld_xxxx 形式
        let match = url.match(/vrchat\.com\/home\/world\/(wrld_[a-f0-9-]{36})/i);
        if (match) return match[1];

        // vrchat.com/home/launch?worldId=wrld_xxxx 形式
        match = url.match(/[?&]worldId=(wrld_[a-f0-9-]{36})/i);
        return match ? match[1] : null;
    }

    /**
     * 安全にURLエンコードする（不正なUnicode文字を除去）
     * @param {string} str - エンコード対象文字列
     * @returns {string} エンコードされた文字列
     */
    function safeEncodeURIComponent(str) {
        if (!str) {
            return '';
        }

        try {
            // サロゲートペアが壊れた文字を除去
            const sanitized = str.replace(/[\uD800-\uDFFF]/g, '');
            return encodeURIComponent(sanitized);
        } catch {
            // それでもエラーの場合は、ASCII以外を除去
            return encodeURIComponent(str.replace(/[^\x00-\x7F]/g, ''));
        }
    }

    // ============================================================================
    // UI関連
    // ============================================================================

    /**
     * VRChatリンクボタンを作成する
     * @param {string} worldName - ワールド名
     * @returns {HTMLButtonElement} 作成されたボタン要素
     */
    function createLinkButton(worldName) {
        const button = document.createElement('button');
        button.className = 'vrchat-world-link-btn';
        button.textContent = BUTTON_TEXT.DEFAULT;
        button.title = `"${worldName}" をVRChatで検索`;
        button.setAttribute('aria-label', `${worldName} のワールドページを開く`);

        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 既にワールドIDが特定されている場合（既存URLからの検出）
            // ボタン作成時にdataset.worldIdがセットされている、または第2引数で渡す設計にするが
            // datasetで判定するのがシンプル
            if (button.dataset.worldId) {
                window.open(`${VRCHAT_WEB_BASE}/world/${button.dataset.worldId}`, '_blank', 'noopener');
                button.textContent = BUTTON_TEXT.SUCCESS;
                setTimeout(() => {
                    button.textContent = BUTTON_TEXT.DEFAULT;
                }, BUTTON_RESET_DELAY_MS);
                return;
            }

            button.disabled = true;
            button.textContent = BUTTON_TEXT.LOADING;

            try {
                // Background scriptにワールド検索を依頼
                const response = await chrome.runtime.sendMessage({
                    action: ACTIONS.SEARCH_WORLD,
                    worldName: worldName
                });

                if (response && response.success && response.worldId) {
                    // 直接ワールドページを開く
                    window.open(`${VRCHAT_WEB_BASE}/world/${response.worldId}`, '_blank', 'noopener');
                    button.textContent = BUTTON_TEXT.SUCCESS;
                } else if (response && response.needsAuth) {
                    // 認証が必要
                    button.textContent = BUTTON_TEXT.AUTH_REQUIRED;
                    alert('VRChatへのログインが必要です。拡張機能のポップアップからログインしてください。');
                } else {
                    // ワールドが見つからない場合はエラーメッセージを表示
                    button.textContent = BUTTON_TEXT.NOT_FOUND;
                }
            } catch (error) {
                // エラー時もエラーメッセージを表示
                console.warn('ワールド検索失敗:', error);
                button.textContent = BUTTON_TEXT.NOT_FOUND;
            }

            // ボタンを元に戻す
            setTimeout(() => {
                button.disabled = false;
                button.textContent = BUTTON_TEXT.DEFAULT;
            }, BUTTON_RESET_DELAY_MS);
        });

        return button;
    }

    /**
     * 検索ページを直接開くボタンを作成する
     * @param {string} worldName - ワールド名
     * @returns {HTMLButtonElement} 作成されたボタン要素
     */
    function createSearchButton(worldName) {
        const button = document.createElement('button');
        button.className = 'vrchat-world-link-btn search-only-btn';
        button.textContent = BUTTON_TEXT.SEARCH_ONLY;
        button.title = `"${worldName}" をVRChatの検索ページで開く`;
        button.setAttribute('aria-label', `${worldName} の検索ページを開く`);

        // スタイル調整（メインボタンと区別する場合、またはmargin）
        button.style.marginLeft = '8px';

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSearchPage(worldName);
        });

        return button;
    }

    /**
     * VRChat検索ページを開く
     * @param {string} worldName - 検索するワールド名
     */
    function openSearchPage(worldName) {
        window.open(
            `${VRCHAT_WEB_BASE}/search/worlds/${safeEncodeURIComponent(worldName)}`,
            '_blank',
            'noopener'
        );
    }

    // ============================================================================
    // ツイート処理
    // ============================================================================

    /**
     * 単一のポストを処理する
     * @param {Element} tweetElement - ポスト要素
     */
    function processTweet(tweetElement) {
        if (!tweetElement || tweetElement.hasAttribute(PROCESSED_ATTR)) {
            return;
        }
        tweetElement.setAttribute(PROCESSED_ATTR, 'true');

        // ポストのテキストを取得
        const tweetTextElement = tweetElement.querySelector(SELECTORS.TWEET_TEXT);
        if (!tweetTextElement) {
            return;
        }

        // img要素のalt属性（絵文字）も含めてテキストを取得
        const tweetText = getTextWithEmoji(tweetTextElement);
        if (!tweetText) {
            return;
        }

        // #VRChat_World紹介 タグがあるかチェック（大文字小文字を無視）
        if (!tweetText.toLowerCase().includes(TARGET_HASHTAG)) {
            return;
        }

        // 1. ワールド名の抽出
        const worldName = extractWorldName(tweetText);

        // 2. ポスト内のリンクからワールドURLを探す
        const links = tweetElement.querySelectorAll('a');
        let foundWorldId = null;

        for (const link of links) {
            // href属性を確認
            const hrefId = extractWorldIdFromUrl(link.href);
            if (hrefId) {
                foundWorldId = hrefId;
                break;
            }
            // 表示テキストも確認
            const textId = extractWorldIdFromUrl(link.textContent);
            if (textId) {
                foundWorldId = textId;
                break;
            }
            // title属性も確認
            const titleId = extractWorldIdFromUrl(link.title);
            if (titleId) {
                foundWorldId = titleId;
                break;
            }
        }

        // どちらも得られなければスキップ
        if (!worldName && !foundWorldId) {
            return;
        }

        // 既にVRC World Openerのボタンがある場合はスキップ
        if (tweetElement.querySelector('.vrchat-world-link-btn')) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'vrchat-world-link-container';

        // A. 「ワールドを開く」ボタン
        if (showOpenBtn) {
            let openBtn = null;
            if (foundWorldId) {
                openBtn = createLinkButton('このワールド');
                openBtn.dataset.worldId = foundWorldId;
                openBtn.title = 'ポスト内のリンクから検出されたワールドを開く';
            } else if (worldName) {
                openBtn = createLinkButton(worldName);
            }

            if (openBtn) {
                container.appendChild(openBtn);
            }
        }

        // B. 「ワールド名で検索」ボタン
        if (showSearchBtn && worldName) {
            const searchBtn = createSearchButton(worldName);
            container.appendChild(searchBtn);
        }

        // コンテナにボタンがあれば挿入
        if (container.hasChildNodes()) {
            const actionBar = tweetElement.querySelector(SELECTORS.ACTION_BAR);
            if (actionBar && actionBar.parentNode) {
                actionBar.parentNode.insertBefore(container, actionBar);
            }
        }
    }

    /**
     * ページ内の全ポストを処理する
     */
    function processAllTweets() {
        const tweets = document.querySelectorAll(SELECTORS.TWEET);
        tweets.forEach(processTweet);
    }

    /**
     * 有効な場合のみポストを処理する
     */
    async function processAllTweetsIfEnabled() {
        try {
            const result = await chrome.storage.local.get([STORAGE_KEYS.EXTENSION_ENABLED]);
            isExtensionEnabled = result[STORAGE_KEYS.EXTENSION_ENABLED] !== false;

            if (isExtensionEnabled) {
                processAllTweets();
            }
        } catch {
            // ストレージアクセスエラーの場合はデフォルトで有効として処理
            processAllTweets();
        }
    }

    // ============================================================================
    // DOM監視
    // ============================================================================

    /**
     * DOM変更の監視を設定する
     */
    function setupObserver() {
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;

            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldProcess = true;
                    break;
                }
            }

            if (shouldProcess) {
                // デバウンス処理
                if (debounceTimerId !== null) {
                    clearTimeout(debounceTimerId);
                }
                debounceTimerId = setTimeout(processAllTweetsIfEnabled, DEBOUNCE_DELAY_MS);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // ============================================================================
    // メッセージハンドラー
    // ============================================================================

    /**
     * ポップアップからのメッセージを処理する
     */
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === ACTIONS.UPDATE_SETTINGS) {
            // 設定更新
            const settings = request.settings;
            if (settings) {
                isExtensionEnabled = settings[STORAGE_KEYS.EXTENSION_ENABLED] !== false;
                showOpenBtn = settings[STORAGE_KEYS.SHOW_OPEN_BTN] !== false;
                showSearchBtn = settings[STORAGE_KEYS.SHOW_SEARCH_BTN] !== false;

                // 既存のボタンを削除して再生成
                document.querySelectorAll('.vrchat-world-link-container').forEach(el => el.remove());
                document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => el.removeAttribute(PROCESSED_ATTR));

                if (isExtensionEnabled) {
                    processAllTweets();
                }
            }
        }

        sendResponse({ success: true });
        return true;
    });

    // ============================================================================
    // 初期化
    // ============================================================================

    /**
     * 拡張機能を初期化する
     */
    async function init() {
        try {
            // 有効/無効と設定の状態を確認
            const result = await chrome.storage.local.get([
                STORAGE_KEYS.EXTENSION_ENABLED,
                STORAGE_KEYS.SHOW_OPEN_BTN,
                STORAGE_KEYS.SHOW_SEARCH_BTN
            ]);
            isExtensionEnabled = result[STORAGE_KEYS.EXTENSION_ENABLED] !== false;
            showOpenBtn = result[STORAGE_KEYS.SHOW_OPEN_BTN] !== false;
            showSearchBtn = result[STORAGE_KEYS.SHOW_SEARCH_BTN] !== false;

            if (isExtensionEnabled) {
                processAllTweets();
            }

            setupObserver();
        } catch {
            // エラー時もオブザーバーは設定
            setupObserver();
        }
    }

    // DOMが読み込まれたら初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
