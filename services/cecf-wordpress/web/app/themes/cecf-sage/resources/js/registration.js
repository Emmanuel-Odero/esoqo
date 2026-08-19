/**
 * Registration wizard controller — drives partials/cecf/
 * registrationForm.blade.php. Vanilla JS, matching app.js's own style
 * (no framework, no build-time templating): every step's markup already
 * exists in the DOM (rendered by Blade), this just shows/hides `.fstep`
 * elements, validates, and calls this site's own `cecf/v1` REST routes
 * (App\Providers\CecfRegistrationServiceProvider), which proxy to
 * esoko's services/core.
 *
 * State lives in one object rather than re-reading the DOM everywhere,
 * because several answers (who's joining, fee coverage, payment method,
 * uploaded documents, the member roster) aren't plain form fields with
 * a name attribute — they're `.opt` pressable cards and dynamically
 * built lists.
 */
(function () {
  const form = document.getElementById('cecf-reg');
  if (!form) return;

  const KES_PER_PERSON = 500;

  /** @type {{
   *   who: string|null, step: number,
   *   registrationId: string|null,
   *   groupRegistered: string|null, bizRegistered: string|null,
   *   feeCoverage: string|null, paymentMethod: string|null,
   *   paymentDone: boolean,
   *   documents: Array<{kind:string,title:string,originalName:string,mimeType:string,base64:string}>,
   *   members: Array<{officialName:string,msisdn?:string}>,
   * }}
   */
  const state = {
    who: null, step: 0, registrationId: null,
    groupRegistered: null, bizRegistered: null,
    feeCoverage: null, paymentMethod: null, paymentDone: false,
    documents: [], members: [],
  };

  // "you" comes right after the group/business's own details and before
  // documents/payment — not after — because /start (which creates
  // registrationId) needs the registrant's name/phone/county, and every
  // later step (document upload, payment attach) needs registrationId
  // to already exist.
  const SEQUENCES = {
    me: ['who', 'you', 'payment', 'review'],
    biz: ['who', 'biz-info', 'you', 'documents', 'payment', 'review'],
    // 'payment' only appears for a group when feeCoverage === 'group' —
    // filtered in currentSequence() below, since it isn't known until
    // the fee-coverage step is answered.
    group: ['who', 'group-info', 'you', 'documents', 'fee-coverage', 'payment', 'roster', 'review'],
  };

  function currentSequence() {
    if (!state.who) return ['who'];
    const seq = SEQUENCES[state.who].slice();
    if (state.who === 'group' && state.feeCoverage === 'self') {
      return seq.filter((s) => s !== 'payment');
    }
    return seq;
  }

  function stepEl(name) {
    return form.querySelector(`.fstep[data-step="${name}"]`);
  }

  function errEl() { return form.querySelector('[data-role="error"]'); }
  function showError(msg) {
    const el = errEl();
    el.textContent = msg;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function clearError() {
    const el = errEl();
    el.hidden = true;
    el.textContent = '';
  }

  function render() {
    const seq = currentSequence();
    const name = seq[state.step];

    form.querySelectorAll('.fstep').forEach((el) => el.classList.remove('on'));
    const done = form.querySelector('[data-role="done"]');
    done.hidden = true;
    form.querySelector('[data-role="nav"]').hidden = false;

    if (name) {
      const el = stepEl(name);
      if (el) el.classList.add('on');
    }

    // Progress bar — one segment per step in the current sequence.
    const prog = form.querySelector('.fprog');
    prog.innerHTML = '';
    seq.forEach((_, i) => {
      const span = document.createElement('span');
      if (i <= state.step) span.className = 'on';
      prog.appendChild(span);
    });
    form.querySelector('[data-role="step-label"]').textContent =
      `Step ${state.step + 1} of ${seq.length}`;

    form.querySelector('[data-role="back"]').hidden = state.step === 0;
    const nextBtn = form.querySelector('[data-role="next"]');
    nextBtn.textContent = name === 'review' ? 'Submit registration' : 'Continue';

    if (name === 'you') updateYouCopy();
    if (name === 'payment') updatePaymentCopy();
    if (name === 'review') updateReviewSummary();

    clearError();
  }

  function updateYouCopy() {
    const heading = form.querySelector('[data-role="you-heading"]');
    const sub = form.querySelector('[data-role="you-sub"]');
    const roleWrap = form.querySelector('[data-role="your-role-wrap"]');
    if (state.who === 'group') {
      heading.textContent = 'You, registering the group';
      sub.textContent = 'One person we can reach — usually the chairperson or treasurer.';
      roleWrap.hidden = false;
    } else if (state.who === 'biz') {
      heading.textContent = 'Contact person';
      sub.textContent = 'Registered as the business’s contact.';
      roleWrap.hidden = true;
    } else {
      heading.textContent = 'Your details';
      sub.textContent = 'A personal membership — your own record.';
      roleWrap.hidden = true;
    }
  }

  /** The suggested default — KES 500/member for a group, KES 500
   *  otherwise. Only a starting point: the registrant can change the
   *  actual amount in the "Amount to pay" field before paying. */
  function suggestedAmountKes() {
    if (state.who === 'group') {
      const n = Number(form.elements.memberCount?.value || 1);
      return Math.max(1, n) * KES_PER_PERSON;
    }
    return KES_PER_PERSON;
  }

  /** What's actually about to be charged — the editable amount field,
   *  never the suggestion, once the payment step has been reached. */
  function feeAmountKes() {
    const entered = Number(form.elements.paymentAmount?.value);
    return entered > 0 ? entered : suggestedAmountKes();
  }

  function updatePaymentCopy() {
    const line = form.querySelector('[data-role="payment-suggestion-line"]');
    const suggestion = suggestedAmountKes();
    line.textContent = state.who === 'group'
      ? `KES ${suggestion.toLocaleString()} suggested for the whole group (KES ${KES_PER_PERSON} × ${form.elements.memberCount.value || 1} members) — you can pay a different amount.`
      : `KES ${suggestion.toLocaleString()} suggested — you can pay a different amount.`;

    // Only prefill once — re-rendering this step (e.g. going Back then
    // Continue again) must never clobber an amount the registrant
    // already typed themselves.
    const amountField = form.elements.paymentAmount;
    if (!amountField.value) amountField.value = String(suggestion);
  }

  function updateReviewSummary() {
    const box = form.querySelector('[data-role="review-summary"]');
    const rows = [];
    if (state.who === 'group') {
      rows.push(`<strong>${escapeHtml(form.elements.orgName?.value || '')}</strong> — ${form.elements.memberCount?.value || '?'} members`);
      rows.push(state.feeCoverage === 'self' ? 'Each member pays their own fee' : `Group pays KES ${feeAmountKes().toLocaleString()} together`);
    } else if (state.who === 'biz') {
      rows.push(`<strong>${escapeHtml(form.elements.bizName?.value || '')}</strong>`);
    }
    rows.push(`${escapeHtml(form.elements.officialName?.value || '')} · ${escapeHtml(form.elements.msisdn?.value || '')}`);
    if (state.who !== 'group' || state.feeCoverage !== 'self') {
      rows.push(state.paymentDone
        ? 'Payment confirmed'
        : (state.paymentMethod === 'LATER' || !state.paymentMethod ? 'Fee to be paid later' : 'Payment declared'));
    }
    if (state.documents.length) rows.push(`${state.documents.length} document(s) attached`);
    if (state.members.length) rows.push(`${state.members.length} other member(s) added`);
    box.innerHTML = rows.map((r) => `<div>${r}</div>`).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── validation per step ─────────────────────────────────────── */

  function validateStep(name) {
    if (name === 'who' && !state.who) return 'Choose who you are registering.';
    if (name === 'group-info') {
      if (!form.elements.orgName.value.trim()) return 'Enter the group’s name.';
      if (!state.groupRegistered) return 'Let us know if the group is already registered.';
      if (!form.elements.memberCount.value || Number(form.elements.memberCount.value) < 1) return 'Enter roughly how many members.';
    }
    if (name === 'biz-info') {
      if (!form.elements.bizName.value.trim()) return 'Enter the business name.';
      if (!state.bizRegistered) return 'Let us know if the business is already registered.';
    }
    if (name === 'fee-coverage' && !state.feeCoverage) return 'Choose how the fee is paid.';
    if (name === 'payment' && !state.paymentMethod) return 'Choose a payment option.';
    if (name === 'payment' && state.paymentMethod !== 'LATER' && !(Number(form.elements.paymentAmount.value) > 0)) {
      return 'Enter an amount to pay.';
    }
    // Paying is its own explicit action now (the "Send M-Pesa prompt" /
    // "Continue to card payment" buttons), not something Continue does
    // silently on your behalf — so Continue past this step is blocked
    // until that's actually happened, same as any other required field.
    if (name === 'payment' && state.paymentMethod === 'MPESA' && !state.paymentDone) {
      return 'Send the M-Pesa prompt before continuing, or choose "Pay later" instead.';
    }
    if (name === 'payment' && state.paymentMethod === 'CARD' && !state.paymentDone) {
      return 'Use "Continue to card payment" to pay, or choose "Pay later" instead.';
    }
    if (name === 'you') {
      if (!form.elements.officialName.value.trim()) return 'Enter your full name.';
      if (!form.elements.msisdn.value.trim()) return 'Enter your phone number.';
      if (!form.elements.county.value) return 'Choose your county.';
    }
    if (name === 'review' && !form.elements.acceptedTerms.checked) return 'Accept the terms to continue.';
    return null;
  }

  /* ── API calls ────────────────────────────────────────────────── */

  async function api(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || 'Something went wrong. Try again in a moment.');
    }
    return data;
  }

  function normaliseMsisdn(raw) {
    let digits = (raw || '').replace(/\D/g, '');
    if (digits.startsWith('254')) digits = digits.slice(3);
    else if (digits.startsWith('0')) digits = digits.slice(1);
    return `+254${digits.slice(0, 9)}`;
  }

  function buildStartPayload() {
    const registrant = {
      officialName: form.elements.officialName.value.trim(),
      knownAs: form.elements.knownAs.value.trim() || undefined,
      msisdn: normaliseMsisdn(form.elements.msisdn.value),
      msisdnVerified: false,
      county: form.elements.county.value,
    };

    if (state.who === 'group') {
      return {
        joiningAs: 'group',
        registrant,
        registrantRole: form.elements.registrantRole.value || 'CHAIRPERSON',
        orgName: form.elements.orgName.value.trim(),
        orgKnownAs: form.elements.orgKnownAs.value.trim() || undefined,
        orgKind: form.elements.orgKind.value,
        orgSubCounty: form.elements.orgSubCounty.value.trim() || undefined,
        isRegistered: state.groupRegistered,
        registrationNo: form.elements.registrationNoGroup.value.trim() || undefined,
        memberCount: Number(form.elements.memberCount.value),
        feeCoverage: state.feeCoverage,
      };
    }
    if (state.who === 'biz') {
      return {
        joiningAs: 'biz',
        registrant,
        bizName: form.elements.bizName.value.trim(),
        bizSector: form.elements.bizSector.value.trim() || undefined,
        bizType: form.elements.bizType.value,
        bizIsRegistered: state.bizRegistered,
        registrationNo: form.elements.registrationNoBiz.value.trim() || undefined,
        bizIntendsToRegister: state.bizRegistered === 'no' ? 'yes' : undefined,
      };
    }
    return { joiningAs: 'me', registrant };
  }

  function urlFor(tplAttr, id) {
    return form.dataset[tplAttr].replace(':id', id);
  }

  /* ── payment ──────────────────────────────────────────────────── */

  async function runPayment() {
    if (state.paymentDone) return true;
    const amountKes = feeAmountKes();

    if (state.paymentMethod === 'LATER') {
      await api(urlFor('payLaterUrlTpl', state.registrationId));
      state.paymentDone = true;
      return true;
    }

    if (state.paymentMethod === 'MPESA') {
      const statusEl = form.querySelector('[data-role="payment-status"]');
      statusEl.hidden = false;
      statusEl.textContent = 'Sending the M-Pesa prompt — check your phone…';
      await api(form.dataset.mpesaInitiateUrl, {
        registrationId: state.registrationId,
        msisdn: normaliseMsisdn(form.elements.mpesaNumber.value),
        amountKes,
      });
      statusEl.textContent = 'Waiting for confirmation…';
      const confirmed = await pollPaymentStatus();
      statusEl.textContent = confirmed ? 'Payment confirmed.' : 'Not confirmed yet — you can continue, we’ll follow up.';
      state.paymentDone = true;
      return true;
    }

    if (state.paymentMethod === 'CARD') {
      const res = await api(form.dataset.pesapalInitiateUrl, {
        registrationId: state.registrationId,
        amountKes,
        returnUrl: form.dataset.returnUrl,
      });
      if (res.redirectUrl) {
        // The browser is about to leave for Pesapal's hosted page and
        // come back on a fresh page load (returnUrl, ?paid=1) — the
        // in-memory `state` object won't survive that round trip, so
        // save just enough of it to finish the job on return. See
        // resumeAfterCardPayment() below.
        sessionStorage.setItem('cecfReg', JSON.stringify({
          registrationId: state.registrationId, who: state.who, members: state.members,
        }));
        window.location.href = res.redirectUrl;
        return false; // navigating away — nothing further to do here
      }
      return true;
    }

    return true;
  }

  /**
   * Runs once, at load, if the browser just came back from a Pesapal
   * card payment (?paid=1 — see form.dataset.returnUrl). Skips straight
   * to /complete with whatever was saved before the redirect; the actual
   * payment confirmation already happened server-side (esoko's
   * /webhooks/pesapal/ipn), this is just finishing the registration.
   */
  async function resumeAfterCardPayment() {
    if (new URLSearchParams(window.location.search).get('paid') !== '1') return false;
    const saved = sessionStorage.getItem('cecfReg');
    if (!saved) return false;

    let data;
    try { data = JSON.parse(saved); } catch (e) { return false; }
    if (!data.registrationId) return false;

    sessionStorage.removeItem('cecfReg');
    state.registrationId = data.registrationId;
    state.who = data.who;
    state.members = data.members || [];
    state.paymentDone = true;

    try {
      await api(urlFor('completeUrlTpl', state.registrationId), { members: state.members });
      finish();
    } catch (e) {
      showError(`We took your payment, but couldn't finish the registration automatically (${e.message}). Call 0709 000 000 and we'll complete it for you.`);
    }
    return true;
  }

  async function pollPaymentStatus() {
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const res = await fetch(urlFor('statusUrlTpl', state.registrationId));
        const data = await res.json();
        if (data.status === 'CONFIRMED') return true;
      } catch (e) { /* keep polling */ }
    }
    return false;
  }

  /* ── documents ────────────────────────────────────────────────── */

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  form.querySelector('[data-role="add-document"]')?.addEventListener('click', async () => {
    const fileInput = form.elements.docFile;
    const file = fileInput.files[0];
    if (!file) { showError('Choose a file first.'); return; }
    if (file.size > 10 * 1024 * 1024) { showError('That file is larger than 10 MB.'); return; }
    clearError();
    const base64 = await fileToBase64(file);
    state.documents.push({
      kind: form.elements.docKind.value,
      title: file.name,
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64,
    });
    fileInput.value = '';
    renderList('document-list', state.documents.map((d) => d.title));
  });

  form.querySelector('[data-role="add-member"]')?.addEventListener('click', () => {
    const name = form.elements.memberName.value.trim();
    if (!name) { showError('Enter the member’s name.'); return; }
    clearError();
    state.members.push({
      officialName: name,
      msisdn: form.elements.memberPhone.value.trim() ? normaliseMsisdn(form.elements.memberPhone.value) : undefined,
    });
    form.elements.memberName.value = '';
    form.elements.memberPhone.value = '';
    renderList('member-list', state.members.map((m) => m.officialName));
  });

  function renderList(role, labels) {
    const ul = form.querySelector(`[data-role="${role}"]`);
    ul.innerHTML = labels.map((l) => `<li class="opt" style="cursor:default"><b>${escapeHtml(l)}</b></li>`).join('');
  }

  /* ── `.opt` pressable cards (generic) ────────────────────────── */

  form.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt[data-value]');
    if (!btn) return;
    const group = btn.closest('[role="group"]');
    group.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');

    const role = group.dataset.role;
    const value = btn.dataset.value;
    if (role === 'group-registered') {
      state.groupRegistered = value;
      form.querySelector('[data-role="group-regno-wrap"]').hidden = value !== 'yes';
    } else if (role === 'biz-registered') {
      state.bizRegistered = value;
      form.querySelector('[data-role="biz-regno-wrap"]').hidden = value !== 'yes';
    } else if (role === 'fee-coverage') {
      state.feeCoverage = value;
    } else if (role === 'payment-method') {
      state.paymentMethod = value;
      state.paymentDone = false; // switching method invalidates whatever was paid/declared before
      form.querySelector('[data-role="mpesa-number-wrap"]').hidden = value !== 'MPESA';
      form.querySelector('[data-role="pay-mpesa"]').hidden = value !== 'MPESA';
      form.querySelector('[data-role="pay-card"]').hidden = value !== 'CARD';
      const statusEl = form.querySelector('[data-role="payment-status"]');
      statusEl.hidden = true;
      statusEl.textContent = '';
    }
  });

  /** Fires the actual payment for whichever method is currently
   *  selected — called from the method-specific "Pay" buttons below,
   *  not from Continue. Shared validation (a usable amount) plus a
   *  method-specific check (a phone number, for M-Pesa) before
   *  runPayment() does the real work. */
  async function payNow(payButton) {
    if (!(feeAmountKes() > 0)) { showError('Enter an amount to pay.'); return; }
    if (state.paymentMethod === 'MPESA' && !form.elements.mpesaNumber.value.trim()) {
      showError('Enter the M-Pesa number to receive the prompt.');
      return;
    }
    clearError();
    payButton.disabled = true;
    try {
      await runPayment();
    } catch (e) {
      showError(e.message);
    } finally {
      payButton.disabled = false;
    }
  }

  form.querySelector('[data-role="pay-mpesa"]').addEventListener('click', (e) => payNow(e.currentTarget));
  form.querySelector('[data-role="pay-card"]').addEventListener('click', (e) => payNow(e.currentTarget));

  form.querySelectorAll('[data-who]').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.querySelectorAll('[data-who]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      state.who = btn.dataset.who;
      state.step = 0;
      goNext(); // "who" is a single-purpose step — picking a card advances immediately
    });
  });

  /* ── navigation ───────────────────────────────────────────────── */

  async function goNext() {
    const seq = currentSequence();
    const name = seq[state.step];
    const err = validateStep(name);
    if (err) { showError(err); return; }
    clearError();

    const nextBtn = form.querySelector('[data-role="next"]');
    nextBtn.disabled = true;
    try {
      if (name === 'who' || name === 'group-info' || name === 'biz-info') {
        // Nothing to send yet — the registration row is created once a
        // name exists, right after (step "you"), same reasoning
        // apps/app/join's actionStart follows: no empty shell rows for
        // a tab closed before typing anything.
      } else if (name === 'you' && !state.registrationId) {
        const started = await api(form.dataset.startUrl, buildStartPayload());
        state.registrationId = started.registrationId;
      } else if (name === 'documents' && state.documents.length) {
        await api(urlFor('documentsUrlTpl', state.registrationId), { documents: state.documents });
      } else if (name === 'payment') {
        const proceed = await runPayment();
        if (!proceed) return; // navigated away (card payment)
      } else if (name === 'review') {
        await api(urlFor('completeUrlTpl', state.registrationId), { members: state.members });
        finish();
        return;
      }

      if (state.step < seq.length - 1) {
        state.step += 1;
        render();
      }
    } catch (e) {
      showError(e.message);
    } finally {
      nextBtn.disabled = false;
    }
  }

  function finish() {
    form.querySelectorAll('.fstep').forEach((el) => el.classList.remove('on'));
    form.querySelector('[data-role="nav"]').hidden = true;
    const done = form.querySelector('[data-role="done"]');
    done.hidden = false;
    form.querySelector('[data-role="done-message"]').textContent =
      state.who === 'group'
        ? 'Your group’s registration is in.'
        : state.who === 'biz'
          ? 'Your business’s registration is in.'
          : 'Your registration is in.';
    done.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  form.querySelector('[data-role="back"]').addEventListener('click', () => {
    if (state.step > 0) {
      state.step -= 1;
      render();
    }
  });

  form.querySelector('[data-role="next"]').addEventListener('click', (e) => {
    e.preventDefault();
    goNext();
  });

  form.addEventListener('submit', (e) => e.preventDefault());

  resumeAfterCardPayment().then((resumed) => {
    if (!resumed) render();
  });
})();
