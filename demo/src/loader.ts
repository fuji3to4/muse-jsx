// Dynamically load Muse or Athena demo based on URL/query or selector
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'athena';

// Import chosen module early so its DOMContentLoaded handler attaches
if (mode === 'muse') {
    import('./main.ts');
} else {
    import('./main_athena.ts');
}

// Setup the select control once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('device-mode') as HTMLSelectElement | null;
    if (select) {
        select.value = mode;
        select.addEventListener('change', () => {
            const next = select.value;
            const url = new URL(location.href);
            url.searchParams.set('mode', next);
            // Reload to reinitialize the chosen module cleanly
            location.href = url.toString();
        });
    }
});
