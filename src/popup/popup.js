document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const settingCanvasFolder = document.getElementById('setting-canvas-folder');
    const statusText = document.getElementById('status-text');
    const statusIcon = document.getElementById('status-icon');
    const statusLoader = document.getElementById('status-loader');

    const btnShowFeedback = document.getElementById('btn-show-feedback');
    const feedbackModal = document.getElementById('feedback-modal');
    const feedbackClose = document.getElementById('feedback-close');
    const btnSendFeedback = document.getElementById('btn-send-feedback');
    const feedbackType = document.getElementById('feedback-type');
    const feedbackMessage = document.getElementById('feedback-message');
    const feedbackEmail = document.getElementById('feedback-email');
    const feedbackFormContainer = document.getElementById('feedback-form-container');
    const feedbackSuccess = document.getElementById('feedback-success');

    // --- Dashboard Status Logic ---
    async function checkCanvasStatus() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url) {
                setNotCanvas();
                return;
            }

            if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
                setNotCanvas();
                return;
            }

            // Ping the content script
            statusIcon.style.display = 'none';
            statusLoader.style.display = 'block';
            statusText.innerText = 'Checking Canvas...';

            chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
                const err = chrome.runtime.lastError;
                statusLoader.style.display = 'none';
                statusIcon.style.display = 'block';

                if (err || !response) {
                    setNotCanvas();
                } else {
                    statusIcon.classList.add('active');
                    statusIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />`;

                    const fileCount = response.fileCount || 0;
                    if (fileCount > 0) {
                        statusText.innerText = `Extension is active! Found ${fileCount} file${fileCount === 1 ? '' : 's'} on this page. Look for the 'Download All' button.`;
                    } else {
                        statusText.innerText = "Extension is active! No downloadable files found on this page. Navigate to a course modules page to find files.";
                    }
                }
            });
        } catch (e) {
            setNotCanvas();
        }
    }

    function setNotCanvas() {
        statusIcon.classList.remove('active');
        statusIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />`;
        statusText.innerText = "Please navigate to a Canvas course module or dashboard to see the downloader in action.";
    }

    checkCanvasStatus();

    // --- Settings Logic ---
    if (settingCanvasFolder) {
        chrome.storage.sync.get(['useCanvasResourcesFolder'], (res) => {
            settingCanvasFolder.checked = res.useCanvasResourcesFolder || false;
        });

        settingCanvasFolder.addEventListener('change', (e) => {
            chrome.storage.sync.set({ useCanvasResourcesFolder: e.target.checked });
        });
    }

    // --- Feedback Logic ---
    // Public submission endpoint, not an account API key. Never embed private credentials.
    const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mbddrqao';

    function showFeedbackModal() {
        if (feedbackModal) {
            feedbackModal.style.display = 'flex';
            document.body.style.minHeight = '480px';
        }
    }

    function hideFeedbackModal() {
        if (feedbackModal) {
            const content = feedbackModal.querySelector('.modal-content');
            feedbackModal.classList.add('closing');
            if (content) content.classList.add('closing');

            setTimeout(() => {
                feedbackModal.style.display = 'none';
                feedbackModal.classList.remove('closing');
                if (content) content.classList.remove('closing');
                document.body.style.minHeight = 'auto';

                if (feedbackFormContainer) feedbackFormContainer.style.display = 'flex';
                if (feedbackSuccess) feedbackSuccess.style.display = 'none';
                if (btnSendFeedback) {
                    btnSendFeedback.innerText = "Submit Feedback";
                    btnSendFeedback.disabled = false;
                }
            }, 200); // Wait for CSS animation to finish
        }
    }

    if (btnShowFeedback) btnShowFeedback.addEventListener('click', showFeedbackModal);
    if (feedbackClose) feedbackClose.addEventListener('click', hideFeedbackModal);
    if (feedbackModal) {
        feedbackModal.addEventListener('click', (e) => {
            if (e.target === feedbackModal) hideFeedbackModal();
        });
    }

    if (btnSendFeedback) {
        btnSendFeedback.addEventListener('click', async () => {
            const message = feedbackMessage.value.trim();
            if (!message) {
                alert("Please enter a message.");
                return;
            }

            const type = feedbackType.value;
            if (!feedbackEmail.checkValidity()) {
                alert('Please enter a valid email address or leave it blank.');
                return;
            }
            const email = feedbackEmail.value.trim();
            const version = chrome.runtime.getManifest().version;
            const techInfo = `\n\n-- Extension Version --\n${version}`;
            const finalBody = `[${type}]\n${message}${techInfo}`;

            const originalText = btnSendFeedback.innerText;
            btnSendFeedback.innerText = "Sending...";
            btnSendFeedback.disabled = true;

            try {
                const response = await fetch(FORMSPREE_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    credentials: 'omit',
                    body: JSON.stringify({
                        ...(email ? { email } : {}),
                        message: finalBody,
                        _subject: `Extension Feedback: ${type}`
                    })
                });

                if (response.ok) {
                    showSuccess();
                } else {
                    throw new Error('Submission failed');
                }
            } catch (err) {
                console.warn('Feedback submission failed:', err.message);
                alert('Feedback could not be confirmed as sent. Please try again or use the support form linked in the privacy policy.');
                btnSendFeedback.innerText = originalText;
                btnSendFeedback.disabled = false;
            }
        });
    }

    function showSuccess() {
        feedbackFormContainer.style.display = 'none';
        feedbackSuccess.style.display = 'block';
        feedbackMessage.value = '';
    }
});
