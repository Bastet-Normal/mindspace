// Keep the journal as plain text with font changes at UTF-16 offsets. HTML
// from the editing surface is never written to a diary or a backup.
class JournalEditor {
    constructor(container, onChange, onFontChange) {
        const Parchment = Quill.import('parchment');
        const font = new Parchment.ClassAttributor('font', 'ql-font', {
            scope: Parchment.Scope.INLINE,
            whitelist: MindSpaceStorage.JOURNAL_FONTS
        });
        Quill.register(font, true);
        this.view = new Quill(container, {
            formats: ['font'],
            modules: {
                toolbar: false,
                uploader: { handler() {} },
                keyboard: { bindings: { journalBreak: {
                    key: 'Enter', shiftKey: null, handler: range => this.insertBreak(range)
                } } }
            }
        });
        this.container = container;
        this.onFontChange = onFontChange;
        const field = this.view.root;
        field.id = 'mood-note';
        field.setAttribute('role', 'textbox');
        field.setAttribute('aria-label', '随笔');
        field.setAttribute('aria-multiline', 'true');
        field.setAttribute('aria-describedby', 'mood-note-count');
        field.addEventListener('beforeinput', event => {
            if (!event.isComposing && event.cancelable && ['insertParagraph', 'insertLineBreak'].includes(event.inputType)) {
                const range = this.view.getSelection();
                if (range) {
                    event.preventDefault();
                    this.insertBreak(range);
                }
            }
        });
        this.view.on('selection-change', range => {
            if (range) this.showSelectionFont(range);
        });
        this.view.on('text-change', (change, previous) => {
            this.limitInsertion(change, previous);
            onChange();
        });
    }

    get baseFont() { return this.container.dataset.journalFont; }
    get length() { return this.view.getLength() - 1; } // Quill terminates its document with a newline.

    insertBreak(range) {
        if (this.length - range.length >= 12000) return;
        const font = this.activeFont || this.baseFont;
        const Delta = Quill.import('delta');
        this.view.updateContents(new Delta().retain(range.index).delete(range.length).insert('\n'), 'user');
        this.view.setSelection(range.index + 1, 0, 'silent');
        this.view.format('font', font, 'user');
        this.view.scrollSelectionIntoView();
        this.displayFont(font);
    }

    displayFont(font) {
        this.activeFont = font;
        this.onFontChange(font);
    }

    load(form, preferredFont) {
        const note = form.note || '';
        const runs = MindSpaceStorage.normalizeFontRuns(form.fontRuns, note.length);
        this.container.dataset.journalFont = runs[0]?.font ?? preferredFont;
        const ops = runs.map((run, i) => ({
            insert: note.slice(run.start, runs[i + 1]?.start ?? note.length),
            attributes: { font: run.font }
        }));
        if (!runs.length && note) ops.push({ insert: note });
        ops.push({ insert: '\n' });
        this.view.setContents(ops, 'silent');
        this.view.history.clear();
        this.displayFont(this.baseFont);
    }

    read() {
        let note = '';
        const fontRuns = [];
        for (const op of this.view.getContents(0, this.length).ops) {
            for (const part of op.insert.split(/(\n+)/)) {
                if (!part) continue;
                const previousFont = fontRuns.at(-1)?.font;
                const font = (part.startsWith('\n') ? previousFont : op.attributes?.font) || this.baseFont;
                if (previousFont !== font) fontRuns.push({ start: note.length, font });
                note += part;
            }
        }
        return { note, fontRuns };
    }

    showSelectionFont(range) {
        const { font } = this.view.getFormat(range);
        // Unmarked text belongs to the editor's original font, even if the
        // preferred font for the next diary has since changed.
        if (range.length) {
            const fonts = new Set(this.view.getContents(range.index, range.length).ops
                .filter(op => op.insert.replaceAll('\n', ''))
                .map(op => op.attributes?.font || this.baseFont));
            if (fonts.size) {
                this.displayFont(fonts.size === 1 ? [...fonts][0] : null);
                return;
            }
        }
        this.displayFont(typeof font === 'string' ? font : this.baseFont);
    }

    applyFont(font) {
        const scrollTop = this.view.root.scrollTop;
        this.view.focus({ preventScroll: true });
        if (!this.length) this.container.dataset.journalFont = font;
        this.view.history.cutoff();
        this.view.format('font', font, 'user');
        this.view.history.cutoff();
        this.view.root.scrollTop = scrollTop;
        this.displayFont(font);
    }

    limitInsertion(change, previous) {
        if (this.length <= 12000) return;
        const deleted = change.ops.reduce((count, op) => count + (op.delete || 0), 0);
        let remaining = Math.max(0, 12000 - (previous.length() - 1 - deleted));
        const Delta = Quill.import('delta');
        const correction = new Delta();
        for (const op of change.ops) {
            if (typeof op.insert === 'string') {
                let keep = Math.min(remaining, op.insert.length);
                if (keep < op.insert.length && /[\uD800-\uDBFF]/u.test(op.insert.charAt(keep - 1))) keep--;
                correction.retain(keep).delete(op.insert.length - keep);
                remaining -= keep;
            } else if (op.retain) {
                correction.retain(op.retain);
            }
        }
        if (correction.ops.some(op => op.delete)) this.view.updateContents(correction, 'silent');
    }
}
