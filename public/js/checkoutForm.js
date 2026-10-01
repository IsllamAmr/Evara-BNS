import { escapeHtml } from './shared.js';
import { t } from './i18n.js';

const drafts = new Map();
let activeDialog = null;

export function clearCheckoutDraft(key) {
  drafts.delete(key);
}

export function requestCheckoutDetails({ draftKey }) {
  if (activeDialog) return Promise.resolve(null);
  const draft = drafts.get(draftKey) || {};
  const dialog = document.createElement('dialog');
  dialog.className = 'checkout-dialog';
  dialog.setAttribute('aria-labelledby', 'checkout-dialog-title');
  dialog.innerHTML = `<form class="checkout-form">
    <h2 id="checkout-dialog-title">${escapeHtml(t('timesheet.checkoutTitle'))}</h2>
    <p>${escapeHtml(t('timesheet.checkoutHint'))}</p>
    <label for="checkout-work-notes">${escapeHtml(t('timesheet.notes'))} *</label>
    <textarea id="checkout-work-notes" name="work_notes" rows="6" maxlength="4000" required placeholder="${escapeHtml(t('timesheet.notesPlaceholder'))}"></textarea>
    <div class="inline-actions"><button type="button" data-cancel class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button><button type="submit" class="btn btn-primary">${escapeHtml(t('timesheet.confirmCheckout'))}</button></div>
  </form>`;
  const form = dialog.querySelector('form');
  const notes = form.elements.work_notes;
  notes.value = draft.work_notes || '';
  const saveDraft = () => drafts.set(draftKey, { work_notes: notes.value });
  const previousFocus = document.activeElement;
  document.body.append(dialog);
  activeDialog = dialog;
  return new Promise((resolve) => {
    const finish = (result) => {
      saveDraft();
      dialog.close();
      dialog.remove();
      activeDialog = null;
      previousFocus?.focus();
      resolve(result);
    };
    form.addEventListener('input', () => { notes.setCustomValidity(''); saveDraft(); });
    notes.addEventListener('invalid', () => {
      if (!notes.value.trim()) notes.setCustomValidity(t('timesheet.notesRequired'));
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    form.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      notes.setCustomValidity(notes.value.trim() ? '' : t('timesheet.notesRequired'));
      if (!form.reportValidity()) return;
      finish({ work_notes: notes.value.trim() });
    });
    dialog.showModal();
    notes.focus();
  });
}
