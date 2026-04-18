const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const helpers = require(path.resolve(__dirname, '..', 'src', 'renderer.helpers.js'));

function extractNamedFunctionSource(source, functionName) {
    const signature = `function ${functionName}(`;
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `Could not find ${functionName} in renderer.js`);

    const bodyStart = source.indexOf('{', start);
    assert.ok(bodyStart >= 0, `Could not find opening brace for ${functionName}`);

    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(`Could not extract full function source for ${functionName}`);
}

function createClassList(initialClasses = []) {
    const set = new Set(initialClasses);
    return {
        add(name) {
            set.add(name);
        },
        remove(name) {
            set.delete(name);
        },
        toggle(name, force) {
            if (typeof force === 'boolean') {
                if (force) set.add(name);
                else set.delete(name);
                return force;
            }
            if (set.has(name)) {
                set.delete(name);
                return false;
            }
            set.add(name);
            return true;
        },
        contains(name) {
            return set.has(name);
        }
    };
}

function createElement(initialClasses = []) {
    const element = {
        classList: createClassList(initialClasses),
        className: '',
        style: {},
        checked: false,
        disabled: false,
        dataset: {},
        children: [],
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        querySelector: () => null
    };

    let text = '';
    Object.defineProperty(element, 'textContent', {
        get() {
            return text;
        },
        set(value) {
            text = String(value ?? '');
            if (text === '') {
                this.children = [];
            }
        }
    });

    let html = '';
    Object.defineProperty(element, 'innerHTML', {
        get() {
            return html;
        },
        set(value) {
            html = String(value ?? '');
            this.children = [];
        }
    });

    return element;
}

function buildSuccessModalContext() {
    const modalTitle = createElement();
    const subtitleEl = createElement();
    const subtextEl = createElement();
    const thanksEl = createElement();
    const successModal = createElement(['hidden']);
    successModal.querySelector = (selector) => {
        if (selector === 'h2') return modalTitle;
        if (selector === '.success-subtitle') return subtitleEl;
        if (selector === '.modal-subtext') return subtextEl;
        if (selector === '.thanks') return thanksEl;
        return null;
    };

    const statsContainer = createElement();
    const btnOpenFolder = createElement();
    btnOpenFolder.disabled = true;
    const btnViewSummary = createElement(['hidden']);
    const btnNextStepsGuide = createElement(['hidden']);
    const btnRetryCorrupted = createElement(['hidden']);
    const btnOpenStagingFolder = createElement(['hidden']);
    btnOpenStagingFolder.dataset = {};
    const calls = {
        configureNextStepsGuide: []
    };

    const context = {
        successModal,
        statsContainer,
        btnOpenFolder,
        btnViewSummary,
        btnNextStepsGuide,
        btnRetryCorrupted,
        btnOpenStagingFolder,
        buildSuccessModalCopyHelper: helpers.buildSuccessModalCopy,
        buildSuccessModalRowsHelper: helpers.buildSuccessModalRows,
        configureNextStepsGuide: (stats) => {
            calls.configureNextStepsGuide.push(stats);
        },
        document: {
            createElement: () => createElement()
        }
    };

    return {
        context,
        elements: {
            successModal,
            modalTitle,
            subtitleEl,
            subtextEl,
            thanksEl,
            statsContainer,
            btnOpenFolder,
            btnViewSummary,
            btnNextStepsGuide,
            btnRetryCorrupted,
            btnOpenStagingFolder
        },
        calls
    };
}

function runShowSuccessModal(context, stats) {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const showSuccessModalSource = extractNamedFunctionSource(rendererSource, 'showSuccessModal');
    const vmContext = vm.createContext(context);
    const script = new vm.Script(`
let lastStats = null;
const buildSuccessModalCopyHelper = this.buildSuccessModalCopyHelper;
const buildSuccessModalRowsHelper = this.buildSuccessModalRowsHelper;
const configureNextStepsGuide = this.configureNextStepsGuide;
${showSuccessModalSource}
this.__showSuccessModal = showSuccessModal;
`);
    script.runInContext(vmContext);
    vmContext.__showSuccessModal(stats);
}

function runShowPartialSummaryModal(context, processedCount, totalCount) {
    const rendererSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const functionSource = extractNamedFunctionSource(rendererSource, 'showPartialSummaryModal');
    const vmContext = vm.createContext(context);
    const script = new vm.Script(`
let isShowingPartialSummary = false;
${functionSource}
this.__showPartialSummaryModal = showPartialSummaryModal;
`);
    script.runInContext(vmContext);
    vmContext.__showPartialSummaryModal(processedCount, totalCount);
}

function getStatRows(statsContainer) {
    return statsContainer.children
        .filter((child) => typeof child.className === 'string' && child.className.includes('stat-row'))
        .map((row) => ({
            label: row.children[0] ? row.children[0].textContent : '',
            value: row.children[1] ? row.children[1].textContent : '',
            className: row.children[1] ? row.children[1].className : ''
        }));
}

function getStatNotes(statsContainer) {
    return statsContainer.children
        .filter((child) => typeof child.className === 'string' && child.className.includes('stat-note'))
        .map((note) => note.textContent);
}

test('showSuccessModal: COMPUTER mode renders non-cloud rows/copy and retry visibility', () => {
    const { context, elements, calls } = buildSuccessModalContext();
    const stats = {
        auto_upload: false,
        success: 125,
        duplicates: 7,
        errors: 2,
        images: 60,
        videos: 65
    };

    runShowSuccessModal(context, stats);

    assert.equal(elements.modalTitle.textContent, 'Processing Complete!');
    assert.equal(elements.subtitleEl.textContent, 'Your Snapchat Memories are safely stored.');
    assert.equal(elements.subtitleEl.style.display, 'block');
    assert.equal(elements.subtextEl.textContent, 'Saved 125 new memories. We skipped 7 files that were already in your folder.');
    assert.equal(elements.subtextEl.style.display, 'block');
    assert.equal(elements.thanksEl.textContent, 'Thanks for using DateBack!');
    assert.equal(elements.thanksEl.style.display, 'block');

    const rows = getStatRows(elements.statsContainer);
    assert.deepEqual(rows.map((row) => row.label), [
        'Total Memories in Export:',
        'Images Downloaded:',
        'Videos Downloaded:',
        'Already Existed (Skipped):',
        'Corrupted/Errors:'
    ]);
    assert.deepEqual(rows.map((row) => row.value), [
        (stats.success + stats.duplicates + stats.errors).toLocaleString(),
        stats.images.toLocaleString(),
        stats.videos.toLocaleString(),
        stats.duplicates.toLocaleString(),
        stats.errors.toLocaleString()
    ]);
    const notes = getStatNotes(elements.statsContainer);
    assert.ok(notes.includes('ℹ️ Skipped 7 files that already exist in the destination folder.'));

    assert.equal(elements.successModal.classList.contains('hidden'), false);
    assert.equal(elements.btnOpenFolder.disabled, false);
    assert.equal(elements.btnViewSummary.classList.contains('hidden'), false);
    assert.equal(elements.btnNextStepsGuide.classList.contains('hidden'), false);
    assert.equal(elements.btnRetryCorrupted.classList.contains('hidden'), false);
    assert.equal(elements.btnOpenStagingFolder.classList.contains('hidden'), true);
    assert.deepEqual(calls.configureNextStepsGuide, [stats]);
});

test('showSuccessModal: CLOUD mode success renders cloud delivery rows and single cloud subtitle behavior', () => {
    const { context, elements } = buildSuccessModalContext();
    const stats = {
        auto_upload: true,
        success: 3898,
        duplicates: 7,
        errors: 0,
        images: 2015,
        videos: 1883,
        upload_confirmed_in_destination: 3898,
        upload_copied_this_run: 3837
    };

    runShowSuccessModal(context, stats);

    assert.equal(elements.modalTitle.textContent, 'Cloud Processing Complete!');
    assert.equal(elements.subtitleEl.textContent, '');
    assert.equal(elements.subtitleEl.style.display, 'none');
    assert.equal(elements.subtextEl.textContent, 'Processing and cloud delivery completed.');
    assert.equal(elements.subtextEl.style.display, 'block');

    const rows = getStatRows(elements.statsContainer);
    assert.deepEqual(rows.map((row) => row.label), [
        'Total Memories in Export:',
        'Images Downloaded:',
        'Videos Downloaded:',
        'Delivered to Cloud Folder:',
        'Copied this run:',
        'Already in Cloud Folder:',
        'Corrupted/Errors:'
    ]);
    assert.deepEqual(rows.map((row) => row.value), [
        (stats.success + stats.duplicates + stats.errors).toLocaleString(),
        stats.images.toLocaleString(),
        stats.videos.toLocaleString(),
        stats.upload_confirmed_in_destination.toLocaleString(),
        stats.upload_copied_this_run.toLocaleString(),
        (stats.upload_confirmed_in_destination - stats.upload_copied_this_run).toLocaleString(),
        stats.errors.toLocaleString()
    ]);

    const notes = getStatNotes(elements.statsContainer);
    assert.ok(notes.includes('ℹ️ Delivered: 3,837 copied + 61 already present = 3,898 total. Errors: 0.'));
    assert.equal(elements.btnRetryCorrupted.classList.contains('hidden'), true);
    assert.equal(elements.thanksEl.style.display, 'block');
});

test('showSuccessModal: CLOUD mode with errors shows warning copy and upload error row', () => {
    const { context, elements } = buildSuccessModalContext();
    const stats = {
        auto_upload: true,
        success: 998,
        duplicates: 0,
        errors: 5,
        images: 597,
        videos: 401,
        upload_confirmed_in_destination: 995,
        upload_copied_this_run: 900,
        upload_error_events: 8
    };

    runShowSuccessModal(context, stats);

    assert.equal(elements.modalTitle.textContent, 'Cloud Processing Complete!');
    assert.equal(elements.subtextEl.textContent, 'Completed with errors. You can retry corrupted files.');

    const rows = getStatRows(elements.statsContainer);
    assert.deepEqual(rows.map((row) => row.label), [
        'Total Memories in Export:',
        'Images Downloaded:',
        'Videos Downloaded:',
        'Delivered to Cloud Folder:',
        'Copied this run:',
        'Already in Cloud Folder:',
        'Upload Error Events:',
        'Corrupted/Errors:'
    ]);
    assert.equal(rows[6].value, '8');
    assert.equal(rows[7].value, '5');

    const notes = getStatNotes(elements.statsContainer);
    assert.ok(notes.includes('ℹ️ Delivery summary: 900 copied + 95 already present = 995 total. Errors: 5.'));
    assert.equal(elements.btnRetryCorrupted.classList.contains('hidden'), false);
});

test('showPartialSummaryModal: paused summary avoids completion copy and hides next steps', () => {
    const { context, elements } = buildSuccessModalContext();
    context.document.getElementById = (id) => {
        if (id === 'btn-next-steps-guide') return elements.btnNextStepsGuide;
        return null;
    };

    runShowPartialSummaryModal(context, 320, 900);

    assert.equal(elements.modalTitle.textContent, 'Progress Saved');
    assert.equal(elements.subtitleEl.textContent, 'This run is paused, not complete.');
    assert.equal(elements.subtitleEl.style.display, 'block');
    assert.equal(elements.subtextEl.textContent, 'Resume anytime to continue with the remaining memories.');
    assert.equal(elements.thanksEl.style.display, 'none');
    assert.equal(elements.btnNextStepsGuide.classList.contains('hidden'), true);
    assert.equal(elements.btnViewSummary.classList.contains('hidden'), true);
    assert.equal(elements.btnRetryCorrupted.classList.contains('hidden'), true);

    const rows = getStatRows(elements.statsContainer);
    assert.deepEqual(rows.map((row) => row.label), [
        'Files Processed:',
        'Total in Export:',
        'Remaining:'
    ]);
});
