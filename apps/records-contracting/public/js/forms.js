// Edit forms open in one side drawer (a native modal dialog). The drawer keeps the
// typed input when a save fails, explains revision conflicts, and reuses the same
// retry key when an unchanged request is sent again after a connection problem.

import { h, notice, containDialogFocus, announce } from './dom.js';
import { createRetryKey } from './api.js';

let dialog = null;
// Unsaved input stays in this tab only. No agency data or mock state is written
// to browser storage. A draft carries its original revision and retry receipt.
const drafts = new Map();

function ensureDialog() {
  if (!dialog) {
    dialog = h('dialog', { class: 'drawer', 'aria-labelledby': 'drawer-title' });
    containDialogFocus(dialog);
    document.body.append(dialog);
  }
  return dialog;
}

const isEmpty = value => value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);

// Builds one field. Returns the row element, a value reader, and the element to focus.
function buildField(spec, formId, tools) {
  const id = `${formId}-${spec.name}`;
  const errorId = `${id}-error`;
  const hintId = spec.hint ? `${id}-hint` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');
  const error = h('p', { class: 'field-error', id: errorId, hidden: true });
  const hint = spec.hint && h('p', { class: 'hint', id: hintId }, spec.hint);
  const requiredMark = spec.required ? null : h('span', { class: 'optional' }, ' (optional)');
  let row, read, focusTarget, invalidTargets;

  let write = () => {};

  if (spec.type === 'static') {
    row = h('div', { class: 'field' }, h('p', { class: 'label' }, spec.label), h('p', null, spec.value));
    read = () => undefined;
    invalidTargets = [];
  } else if (spec.type === 'file') {
    // A file picker that hands the chosen file to the form, which can fill other fields from it.
    const input = h('input', { type: 'file', id, accept: spec.accept, 'aria-describedby': describedBy });
    input.addEventListener('change', () => { if (input.files[0]) spec.onFile(input.files[0], tools); });
    row = h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, spec.label, requiredMark), input, hint, error);
    read = () => undefined;
    focusTarget = input;
    invalidTargets = [input];
  } else if (spec.type === 'radio' || spec.type === 'checks') {
    const inputType = spec.type === 'radio' ? 'radio' : 'checkbox';
    const inputs = spec.options.map((option, index) => {
      const optionId = `${id}-${index}`;
      const checked = spec.type === 'radio' ? option.value === spec.value : (spec.value || []).includes(option.value);
      const input = h('input', { type: inputType, name: id, id: optionId, value: option.value, checked });
      return { input, node: h('div', { class: 'choice' }, input, h('label', { for: optionId }, option.label, option.hint && h('span', { class: 'hint' }, option.hint))) };
    });
    row = h('fieldset', { class: 'field', 'aria-describedby': describedBy },
      h('legend', { class: 'label' }, spec.label, spec.type === 'checks' ? requiredMark : null),
      inputs.map(entry => entry.node), hint, error);
    read = () => spec.type === 'radio'
      ? inputs.find(entry => entry.input.checked)?.input.value ?? ''
      : inputs.filter(entry => entry.input.checked).map(entry => entry.input.value);
    focusTarget = inputs[0]?.input;
    invalidTargets = [];
  } else if (spec.type === 'checkbox') {
    const input = h('input', { type: 'checkbox', id, checked: Boolean(spec.value), 'aria-describedby': describedBy });
    row = h('div', { class: 'field' }, h('div', { class: 'choice' }, input, h('label', { for: id }, spec.label)), hint, error);
    read = () => input.checked;
    focusTarget = input;
    invalidTargets = [input];
  } else {
    let input;
    if (spec.type === 'textarea') {
      input = h('textarea', { id, rows: spec.rows || 3, maxlength: spec.maxlength, 'aria-describedby': describedBy });
      input.value = spec.value ?? '';
    } else if (spec.type === 'select') {
      input = h('select', { id, 'aria-describedby': describedBy },
        spec.options.map(option => h('option', { value: option.value }, option.label)));
      input.value = spec.value ?? spec.options[0]?.value ?? '';
    } else {
      input = h('input', { id, type: spec.type || 'text', maxlength: spec.maxlength, min: spec.min, max: spec.max, autocomplete: 'off', 'aria-describedby': describedBy });
      input.value = spec.value ?? '';
    }
    if (spec.required) input.setAttribute('aria-required', 'true');
    row = h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, spec.label, requiredMark), input, hint, error);
    read = () => {
      if (spec.type === 'number') return input.value.trim() === '' ? null : Number(input.value);
      // `raw` fields (a document's text) are kept byte for byte, so the stored hash matches the original file.
      return spec.type === 'date' || spec.type === 'select' || spec.raw ? input.value : input.value.trim();
    };
    write = value => { input.value = value; };
    focusTarget = input;
    invalidTargets = [input];
  }

  const setError = message => {
    error.textContent = message || '';
    error.hidden = !message;
    row.classList.toggle('has-error', Boolean(message));
    for (const target of invalidTargets) {
      if (message) target.setAttribute('aria-invalid', 'true');
      else target.removeAttribute('aria-invalid');
    }
  };
  return { spec, row, read, write, focusTarget, setError };
}

function builtInError(spec, value) {
  const name = spec.shortLabel || spec.label;
  if (spec.required && isEmpty(value)) return `${name} is required.`;
  if (typeof value === 'string' && value) {
    if (spec.minlength && value.length < spec.minlength) return `${name} needs at least ${spec.minlength} characters. It has ${value.length}.`;
    if (spec.maxlength && value.length > spec.maxlength) return `${name} can have at most ${spec.maxlength} characters.`;
  }
  if (spec.type === 'number' && value !== null) {
    if (!Number.isInteger(value)) return `${name} must be a whole number.`;
    if (spec.min !== undefined && value < spec.min) return `${name} must be at least ${spec.min}.`;
    if (spec.max !== undefined && value > spec.max) return `${name} must be at most ${spec.max}.`;
  }
  return null;
}

// Standard rationale field. The server requires 10 to 2000 characters on audited changes.
export function noteField(label = 'Reason for this change', hint = 'Saved with the change in the audit trail. At least 10 characters.') {
  return { name: 'note', type: 'textarea', label, hint, required: true, minlength: 10, maxlength: 2000, rows: 3 };
}

/*
  config:
    title, intro            heading and optional lead text or node
    fields                  field specs: { name, label, type, value, options, required, hint, when, validate, ... }
    submitLabel             label of the save button
    validate(values)        optional cross-field check, returns { fieldName: message } or null
    submit(values, keyFor)  performs the request; keyFor(body) returns the retry key for that body
    onConflict(error)       reloads the data behind the drawer after a revision conflict
    onSuccess(result)       runs after the drawer closes
    waitFor()               optional: returns a reload still in progress (or nothing). The form opens once it ends.
    subject                 optional: what the saved revision belongs to in save messages (default "case"), such as "budget".
    draftHint               optional: replaces the default sentence about where unsaved input is kept.
*/
// Shown when a save succeeded but the reload after it failed. It stays on screen until dismissed or until
// a later save reloads normally, so a connection message that appears afterwards cannot hide it.
let savedNotice = null;
function showSavedNotice() {
  if (!savedNotice) {
    savedNotice = h('div', { class: 'save-status', id: 'save-status', role: 'status' });
    const shell = document.getElementById('shell');
    if (shell) shell.before(savedNotice); else document.body.prepend(savedNotice);
  }
  savedNotice.replaceChildren(
    h('p', null, h('strong', null, 'Saved. '), 'The page could not load the result afterwards, so it may show older values. Do not save the same change again.'),
    h('button', { type: 'button', class: 'button button-small', onclick: () => window.location.reload() }, 'Reload page'),
    h('button', { type: 'button', class: 'button button-small button-quiet', onclick: hideSavedNotice }, 'Dismiss'));
  savedNotice.hidden = false;
}
function hideSavedNotice() {
  if (savedNotice) savedNotice.hidden = true;
}

let queuedForm = null;
export function openForm(config) {
  // Right after a save the page reloads the case. A form opened before that reload ends would start
  // from the revision before the save and fail with a false conflict, so it opens when the reload ends.
  const pending = config.waitFor?.();
  if (pending) {
    const queued = { ...config, waitFor: undefined, opener: config.opener || document.activeElement };
    queuedForm = queued;
    announce('Loading the saved changes before opening the form…');
    const openWhenReady = () => { if (queuedForm === queued) { queuedForm = null; openForm(queued); } };
    pending.then(openWhenReady, openWhenReady);
    return;
  }
  const drawer = ensureDialog();
  const opener = config.opener || document.activeElement;
  const saved = config.draftKey && drafts.get(config.draftKey);
  let baseRevision = saved?.revision ?? config.getRevision?.();
  const formId = `form-${Date.now()}`;
  const keyFor = saved?.keyFor || createRetryKey();
  // Lets a file field fill in or flag other fields by name.
  const tools = {
    setField: (name, value) => fields.find(field => field.spec.name === name)?.write(value),
    setError: (name, message) => fields.find(field => field.spec.name === name)?.setError(message),
  };
  const fields = config.fields.filter(Boolean).map(spec => buildField(
    saved && Object.hasOwn(saved.values, spec.name) ? { ...spec, value: saved.values[spec.name] } : spec, formId, tools));
  const submitLabel = config.submitLabel || 'Save';
  const subject = config.subject || 'case';
  let dirty = Boolean(saved);
  let busy = false;

  const messages = h('div', { class: 'form-messages', tabindex: '-1' });
  const submit = h('button', { type: 'submit', class: 'button button-primary' }, submitLabel);
  const cancel = h('button', { type: 'button', class: 'button' }, 'Cancel');
  const closeButton = h('button', { type: 'button', class: 'button button-quiet', 'aria-label': 'Close form' }, 'Close');
  const discardBar = h('div', { class: 'discard-bar', hidden: true },
    h('p', null, 'Discard what you typed?'),
    h('button', { type: 'button', class: 'button', onclick: () => { discardBar.hidden = true; } }, 'Keep editing'),
    config.draftKey && h('button', { type: 'button', class: 'button', onclick: () => { remember(); closeNow(); } }, 'Keep draft and close'),
    h('button', { type: 'button', class: 'button button-danger', onclick: () => { drafts.delete(config.draftKey); closeNow(); } }, 'Discard'));

  const form = h('form', { novalidate: true, class: 'drawer-form' },
    h('header', { class: 'drawer-head' }, h('h2', { id: 'drawer-title', tabindex: '-1' }, config.title), closeButton),
    h('div', { class: 'drawer-body' },
      config.intro && (typeof config.intro === 'string' ? h('p', { class: 'drawer-intro' }, config.intro) : config.intro),
      messages,
      config.draftKey && h('p', { class: 'hint' }, config.draftHint || 'Unsaved input is kept for this case and check while this tab remains open. Closing the browser clears it.'),
      fields.map(field => field.row)),
    h('footer', { class: 'drawer-foot' }, discardBar, h('div', { class: 'button-row' }, submit, cancel)));

  const readValues = () => {
    const values = {};
    for (const field of fields) if (!['static', 'file'].includes(field.spec.type)) values[field.spec.name] = field.read();
    return values;
  };
  function remember() {
    if (config.draftKey) drafts.set(config.draftKey, { values: readValues(), revision: baseRevision, keyFor });
  }
  function comparison(loaded = true) {
    const current = loaded && config.currentValues?.();
    const version = values => h('dl', { class: 'conflict-values' }, Object.entries(values).map(([name, value]) => {
      const spec = config.fields.find(field => field?.name === name);
      const label = spec?.label || name[0].toUpperCase() + name.slice(1);
      const display = item => spec?.options?.find(option => option.value === item)?.label || String(item ?? 'Not recorded');
      return [h('dt', null, label), h('dd', { class: 'wrap' }, Array.isArray(value) ? (value.map(display).join(', ') || 'None selected') : display(value))];
    }));
    messages.append(h('div', { class: 'conflict-comparison' },
      h('section', null, h('h3', null, 'Your unsaved version'), version(readValues())),
      h('section', null, h('h3', null, 'Latest saved version'), current ? version(current) : h('p', null, 'Latest values could not be loaded. Retry after reconnecting.'))));
  }

  // Fields with a "when" rule are shown only while the rule holds.
  const applyVisibility = () => {
    const values = readValues();
    for (const field of fields) if (field.spec.when) field.row.hidden = !field.spec.when(values);
  };

  const showMessage = (tone, title, text) => {
    messages.replaceChildren(notice(tone, title, text));
    messages.focus();
  };

  function closeNow() {
    drawer.close();
    drawer.replaceChildren();
    window.removeEventListener('hashchange', leaveRoute);
    const inspector = document.querySelector('dialog.inspector[open]');
    if (inspector && window.innerWidth < 1100 && !inspector.matches(':modal')) { inspector.close(); inspector.showModal(); }
    (document.getElementById(opener?.id) || (opener?.isConnected && opener) || document.getElementById('page-title'))?.focus();
  }
  function leaveRoute() { if (dirty) remember(); closeNow(); }
  window.addEventListener('hashchange', leaveRoute);

  function requestClose() {
    if (busy) return;
    if (dirty) {
      discardBar.hidden = false;
      discardBar.querySelector('button').focus();
    } else {
      closeNow();
    }
  }

  form.addEventListener('input', () => { dirty = true; applyVisibility(); remember(); });
  form.addEventListener('change', () => { dirty = true; applyVisibility(); remember(); });
  cancel.addEventListener('click', requestClose);
  closeButton.addEventListener('click', requestClose);
  drawer.oncancel = event => { event.preventDefault(); requestClose(); };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    messages.replaceChildren();
    discardBar.hidden = true;

    const values = readValues();
    const crossErrors = config.validate?.(values) || {};
    let firstInvalid = null;
    for (const field of fields) {
      const visible = !field.row.hidden && !['static', 'file'].includes(field.spec.type);
      const value = values[field.spec.name];
      const message = visible ? builtInError(field.spec, value) || field.spec.validate?.(value, values) || crossErrors[field.spec.name] : null;
      field.setError(message);
      if (message && !firstInvalid) firstInvalid = field;
    }
    if (crossErrors.form && !firstInvalid) {
      showMessage('error', 'Nothing to save', crossErrors.form);
      return;
    }
    if (firstInvalid) {
      (firstInvalid.focusTarget || messages).focus();
      return;
    }

    // Hidden fields are not part of the request.
    for (const field of fields) if (field.row.hidden) delete values[field.spec.name];

    busy = true;
    submit.setAttribute('aria-disabled', 'true');
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Saving…';
    try {
      const result = await config.submit(values, keyFor, baseRevision);
      drafts.delete(config.draftKey);
      closeNow();
      // A successful write must never be offered again because its refresh failed.
      try {
        await config.onSuccess?.(result);
        hideSavedNotice();
      } catch {
        showSavedNotice();
      }
    } catch (error) {
      busy = false;
      submit.removeAttribute('aria-disabled');
      submit.removeAttribute('aria-busy');
      submit.textContent = 'Retry save';
      // Four different situations, each with its own heading, so they are never mistaken for one another:
      // the request did not arrive, someone else changed the case, a rule (such as a hold) refuses it, or anything else.
      if (error.offline) {
        showMessage('error', 'Not saved: the server could not be reached.',
          `Nothing reached the ${subject}. Your input is still here. When the server answers again, press Retry save. The same request is sent again, so it cannot be applied twice.`);
      } else if (error.revisionConflict) {
        let reloaded = false;
        try { await config.onConflict?.(error); reloaded = true; } catch { /* the message below still applies */ }
        if (reloaded) baseRevision = config.getRevision?.() ?? baseRevision;
        submit.textContent = 'Save against latest';
        showMessage('warn', `Not saved: this ${subject} changed while you were editing.`,
          `Someone saved another change first, so the ${subject} is now at revision ${error.body.currentRevision}. Your input is still here. ${reloaded ? 'The page behind this form now shows the latest values.' : 'Reload the page to see the latest values.'} Check that your change still makes sense, then save again.`);
        comparison(reloaded);
      } else if (error.versionConflict) {
        let reloaded = false;
        try { await config.onConflict?.(error); reloaded = true; } catch { /* the message below still applies */ }
        if (reloaded) baseRevision = config.getRevision?.() ?? baseRevision;
        showMessage('warn', 'Not saved: the draft or its evidence changed while you were editing.',
          `${error.message} Your input is still here. ${reloaded ? 'The page behind this form now shows the latest state.' : 'Reload the page to see the latest state.'} Nothing is sent again until you choose to.`);
        comparison(reloaded);
      } else if (error.status === 409) {
        // The server refused the change: a rule such as an active hold, or a retry key reused for different content.
        // Nothing changed on the server, so there is no newer version to compare and nothing to retry as is.
        keyFor.reset();
        submit.textContent = submitLabel;
        const title = /active hold/i.test(error.message) ? 'Not saved: blocked by an active hold.'
          : /Idempotency-Key/i.test(error.message) ? 'Not saved: this request was already used for different input.'
          : /exceed the remaining budget/i.test(error.message) ? 'Not saved: this would exceed the remaining budget.'
          : 'Not saved: a rule does not allow this change.';
        showMessage('block', title, `${error.message} Saving again will not change this. Your input is still here.`);
      } else {
        showMessage('error', 'Not saved: the server did not accept this.', `${error.message} Your input is still here.`);
      }
      remember();
    }
  });

  drawer.replaceChildren(form);
  applyVisibility();
  drawer.showModal();
  document.getElementById('drawer-title').focus();
  if (saved) {
    messages.append(notice('info', 'Unsaved draft restored.', 'Review your input before saving. Its original revision is retained so a newer server change will still produce a conflict.'));
    if (baseRevision !== config.getRevision?.()) comparison();
  }
}
