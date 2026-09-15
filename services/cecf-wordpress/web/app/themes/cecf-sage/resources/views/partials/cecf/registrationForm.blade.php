{{--
  The real registration wizard — individual, group and business, all
  three, branching from one shared "who's joining" first step. Backed by
  App\Providers\CecfRegistrationServiceProvider's `cecf/v1` REST routes
  (resources/js/registration.js does the actual driving). Every field
  name here matches packages/domain/src/cecf-ingest.ts's cecfIngestSchema
  on the esoqo side, so nothing is renamed in transit.

  Interaction logic lives in code (registration.js), not here — this
  partial is markup and copy only, following the same split the rest of
  this theme's partials use. All steps for all three branches are
  rendered up front and toggled via the .fstep/.fstep.on + data-for
  attributes; nothing is templated client-side.
--}}
@php
  $counties = get_option(\App\Providers\CecfContentServiceProvider::SETTINGS_OPTION, [])['counties'] ?? [];
@endphp
<section class="sec">
  <div class="wrap narrow">
    <div class="callout" data-role="resume-banner" hidden>
      <p data-role="resume-message">{{ __('You have a registration in progress on this device.', 'cecf-sage') }}</p>
      <div class="fnav" style="margin:0;padding:0;border:0">
        <button type="button" class="btn btn-o" data-role="resume-start-over">{{ __('Start over', 'cecf-sage') }}</button>
        <button type="button" class="btn btn-p" data-role="resume-continue">{{ __('Continue where I left off', 'cecf-sage') }}</button>
      </div>
    </div>

    <form id="cecf-reg" class="fcard" novalidate
      data-start-url="{{ home_url('/wp-json/cecf/v1/registration/start') }}"
      data-documents-url-tpl="{{ home_url('/wp-json/cecf/v1/registration/:id/documents') }}"
      data-complete-url-tpl="{{ home_url('/wp-json/cecf/v1/registration/:id/complete') }}"
      data-pay-later-url-tpl="{{ home_url('/wp-json/cecf/v1/registration/:id/pay-later') }}"
      data-declare-payment-url-tpl="{{ home_url('/wp-json/cecf/v1/registration/:id/declare-payment') }}"
      data-progress-url-tpl="{{ home_url('/wp-json/cecf/v1/registration/:id/progress') }}"
      data-mpesa-initiate-url="{{ home_url('/wp-json/cecf/v1/payments/mpesa/initiate') }}"
      data-pesapal-initiate-url="{{ home_url('/wp-json/cecf/v1/payments/pesapal/initiate') }}"
      data-status-url-tpl="{{ home_url('/wp-json/cecf/v1/payments/:id/status') }}"
      data-groups-search-url="{{ home_url('/wp-json/cecf/v1/groups/search') }}"
      data-return-url="{{ home_url('/apply/?paid=1') }}"
    >
      <div class="fprog" role="progressbar" aria-label="{{ __('Registration progress', 'cecf-sage') }}"></div>
      <p class="fstep-label" data-role="step-label"></p>
      <p class="ferr" data-role="error" hidden></p>

      {{-- ── step: who's registering ───────────────────────────── --}}
      <fieldset class="fstep on" data-step="who">
        <h2 class="fh">{{ __('Who are you registering?', 'cecf-sage') }}</h2>
        <p class="fs">{{ __('This decides which questions come next.', 'cecf-sage') }}</p>
        <div class="opts" role="group" aria-label="{{ __('Who is joining', 'cecf-sage') }}">
          <button type="button" class="opt" data-who="me" aria-pressed="false">
            <span><x-icon name="people" size="18" /></span>
            <span><b>{{ __('Myself', 'cecf-sage') }}</b><i>{{ __('A trader, farmer, rider, fundi or anyone working on their own', 'cecf-sage') }}</i></span>
          </button>
          <button type="button" class="opt" data-who="group" aria-pressed="false">
            <span><x-icon name="cooperative" size="18" /></span>
            <span><b>{{ __('A group', 'cecf-sage') }}</b><i>{{ __('Chama, table banking group, CBO, faith-based group, cooperative or SACCO', 'cecf-sage') }}</i></span>
          </button>
          <button type="button" class="opt" data-who="biz" aria-pressed="false">
            <span><x-icon name="government-building" size="18" /></span>
            <span><b>{{ __('A business', 'cecf-sage') }}</b><i>{{ __('Registered or not — either is fine', 'cecf-sage') }}</i></span>
          </button>
        </div>
      </fieldset>

      {{-- ── group: about the group ────────────────────────────── --}}
      <fieldset class="fstep" data-step="group-info" data-for="group">
        <h2 class="fh">{{ __('About the group', 'cecf-sage') }}</h2>
        <p class="fs">{{ __('The official name if you have one, and what people actually call it.', 'cecf-sage') }}</p>
        <div class="fld">
          <label for="orgName">{{ __('Group name', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <input id="orgName" name="orgName" type="text" placeholder="{{ __('e.g. Tumaini Ladies Welfare Group', 'cecf-sage') }}" required>
        </div>
        <div class="fld">
          <label for="orgKnownAs">{{ __('What people call it', 'cecf-sage') }}</label>
          <input id="orgKnownAs" name="orgKnownAs" type="text" placeholder="{{ __('e.g. Tumaini Ladies', 'cecf-sage') }}">
        </div>
        <div class="fld">
          <label for="orgKind">{{ __('What kind of group is this?', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <select id="orgKind" name="orgKind" required>
            <option value="CHAMA">{{ __('Chama or self-help group', 'cecf-sage') }}</option>
            <option value="TABLE_BANKING">{{ __('Table banking group', 'cecf-sage') }}</option>
            <option value="CBO">{{ __('Community-based organisation', 'cecf-sage') }}</option>
            <option value="FBO">{{ __('Faith-based organisation', 'cecf-sage') }}</option>
            <option value="COOPERATIVE">{{ __('Cooperative or producer group', 'cecf-sage') }}</option>
            <option value="SACCO">{{ __('SACCO', 'cecf-sage') }}</option>
            <option value="WELFARE_GROUP">{{ __('Welfare group', 'cecf-sage') }}</option>
            <option value="OTHER">{{ __('Something else', 'cecf-sage') }}</option>
          </select>
        </div>
        <div class="fld">
          <label class="lgl">{{ __('Is the group already registered?', 'cecf-sage') }}</label>
          <div class="opts tight" role="group" data-role="group-registered">
            <button type="button" class="opt" data-value="yes" aria-pressed="false"><b>{{ __('Yes, we have a certificate', 'cecf-sage') }}</b></button>
            <button type="button" class="opt" data-value="no" aria-pressed="false"><b>{{ __('No, not yet', 'cecf-sage') }}</b><i>{{ __('Most groups start here', 'cecf-sage') }}</i></button>
            <button type="button" class="opt" data-value="started" aria-pressed="false"><b>{{ __('We started but got stuck', 'cecf-sage') }}</b></button>
          </div>
        </div>
        <div class="fld" data-role="group-regno-wrap" hidden>
          <label for="registrationNoGroup">{{ __('Registration number', 'cecf-sage') }}</label>
          <input id="registrationNoGroup" name="registrationNoGroup" type="text" placeholder="CG/2024/00000">
        </div>
        <div class="fld">
          <label for="orgSubCounty">{{ __('Sub-county, ward or market', 'cecf-sage') }}</label>
          <input id="orgSubCounty" name="orgSubCounty" type="text" placeholder="{{ __('e.g. Kamukunji, Gikomba', 'cecf-sage') }}">
        </div>
        <div class="fld">
          <label for="memberCount">{{ __('Roughly how many members?', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <input id="memberCount" name="memberCount" type="number" min="1" placeholder="22" required>
          <p class="hint">{{ __('An estimate is fine — this decides the total registration fee (KES 500 per member).', 'cecf-sage') }}</p>
        </div>
      </fieldset>

      {{-- ── business: about the business ──────────────────────── --}}
      <fieldset class="fstep" data-step="biz-info" data-for="biz">
        <h2 class="fh">{{ __('About the business', 'cecf-sage') }}</h2>
        <p class="fs">{{ __('Registered or not, either is fine — this just tells us where you stand.', 'cecf-sage') }}</p>
        <div class="fld">
          <label for="bizName">{{ __('Business name', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <input id="bizName" name="bizName" type="text" required>
        </div>
        <div class="fld">
          <label for="bizSector">{{ __('What the business does', 'cecf-sage') }}</label>
          <input id="bizSector" name="bizSector" type="text" placeholder="{{ __('e.g. hardware retail, tailoring, boda transport', 'cecf-sage') }}">
        </div>
        <div class="fld">
          <label for="bizType">{{ __('Type of business', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <select id="bizType" name="bizType" required>
            <option value="SOLE_PROPRIETORSHIP">{{ __('Sole proprietorship', 'cecf-sage') }}</option>
            <option value="PARTNERSHIP">{{ __('Partnership', 'cecf-sage') }}</option>
            <option value="LIMITED_COMPANY">{{ __('Limited company', 'cecf-sage') }}</option>
            <option value="COOPERATIVE">{{ __('Cooperative', 'cecf-sage') }}</option>
            <option value="SELF_HELP_ENTERPRISE">{{ __('Self-help group enterprise', 'cecf-sage') }}</option>
            <option value="OTHER">{{ __('Something else', 'cecf-sage') }}</option>
          </select>
        </div>
        <div class="fld">
          <label class="lgl">{{ __('Is the business already registered?', 'cecf-sage') }}</label>
          <div class="opts tight" role="group" data-role="biz-registered">
            <button type="button" class="opt" data-value="yes" aria-pressed="false"><b>{{ __('Yes, it has a certificate', 'cecf-sage') }}</b></button>
            <button type="button" class="opt" data-value="no" aria-pressed="false"><b>{{ __('No, not yet', 'cecf-sage') }}</b></button>
          </div>
        </div>
        <div class="fld" data-role="biz-regno-wrap" hidden>
          <label for="registrationNoBiz">{{ __('Registration/certificate number', 'cecf-sage') }}</label>
          <input id="registrationNoBiz" name="registrationNoBiz" type="text">
        </div>
      </fieldset>

      {{-- ── group/business: documents ─────────────────────────── --}}
      <fieldset class="fstep" data-step="documents" data-for="group,biz">
        <h2 class="fh">{{ __('Any documents to attach?', 'cecf-sage') }}</h2>
        <p class="fs">{{ __('Optional — a certificate, member list or similar. You can skip this and add it later.', 'cecf-sage') }}</p>
        <div class="fld">
          <label for="docKind">{{ __('What kind of document?', 'cecf-sage') }}</label>
          <select id="docKind" name="docKind">
            <option value="REGISTRATION_CERT">{{ __('Registration certificate', 'cecf-sage') }}</option>
            <option value="GROUP_CONSTITUTION">{{ __('Group constitution or rules', 'cecf-sage') }}</option>
            <option value="MEMBER_LIST">{{ __('Member list', 'cecf-sage') }}</option>
            <option value="KRA_PIN">{{ __('KRA PIN certificate', 'cecf-sage') }}</option>
            <option value="PHOTO">{{ __('Photograph', 'cecf-sage') }}</option>
            <option value="OTHER">{{ __('Something else', 'cecf-sage') }}</option>
          </select>
        </div>
        <div class="fld">
          <label for="docFile">{{ __('Choose a file', 'cecf-sage') }}</label>
          <input id="docFile" name="docFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg">
          <p class="hint">{{ __('PDF, Word, Excel or an image, up to 10 MB.', 'cecf-sage') }}</p>
        </div>
        <button type="button" class="btn btn-o" data-role="add-document">{{ __('Add another document', 'cecf-sage') }}</button>
        <ul class="opts tight" data-role="document-list" style="margin-top:14px"></ul>
      </fieldset>

      {{-- ── group: fee coverage ───────────────────────────────── --}}
      <fieldset class="fstep" data-step="fee-coverage" data-for="group">
        <h2 class="fh">{{ __('How is the KES 500 registration fee paid?', 'cecf-sage') }}</h2>
        <p class="fs">{{ __('KES 500 per member. Either the group pays it as one amount now, or each member covers their own — later, from their own Esoqo account.', 'cecf-sage') }}</p>
        <div class="opts" role="group" data-role="fee-coverage">
          <button type="button" class="opt" data-value="group" aria-pressed="false">
            <span><b>{{ __('The group pays as a team', 'cecf-sage') }}</b><i data-role="team-total">{{ __('One payment now, for every member', 'cecf-sage') }}</i></span>
          </button>
          <button type="button" class="opt" data-value="self" aria-pressed="false">
            <span><b>{{ __('Each member covers their own', 'cecf-sage') }}</b><i>{{ __('You pay nothing now — members settle KES 500 each from their own Esoqo account when they join', 'cecf-sage') }}</i></span>
          </button>
        </div>
      </fieldset>

      {{-- ── payment (me / biz / group-team) ───────────────────── --}}
      <fieldset class="fstep" data-step="payment" data-for="me,biz,group">
        <h2 class="fh">{{ __('Registration fee', 'cecf-sage') }}</h2>
        <p class="fs" data-role="payment-suggestion-line">{{ __('KES 500 suggested — you can pay a different amount.', 'cecf-sage') }}</p>
        <div class="fld">
          <label for="paymentAmount">{{ __('Amount to pay (KES)', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <input id="paymentAmount" name="paymentAmount" type="number" min="1" step="1">
        </div>
        <div class="opts" role="group" data-role="payment-method">
          <button type="button" class="opt" data-value="MPESA" aria-pressed="false">
            <span><b>{{ __('Pay with M-Pesa', 'cecf-sage') }}</b><i>{{ __('An STK prompt is sent to your phone', 'cecf-sage') }}</i></span>
          </button>
          <button type="button" class="opt" data-value="CARD" aria-pressed="false">
            <span><b>{{ __('Pay by card', 'cecf-sage') }}</b><i>{{ __('You are taken to a secure card payment page', 'cecf-sage') }}</i></span>
          </button>
          <button type="button" class="opt" data-value="LATER" aria-pressed="false">
            <span><b>{{ __('Pay later', 'cecf-sage') }}</b><i>{{ __('Register now, settle the fee afterwards', 'cecf-sage') }}</i></span>
          </button>
        </div>
        <div class="fld" data-role="mpesa-number-wrap" hidden>
          <label for="mpesaNumber">{{ __('M-Pesa number to receive the prompt', 'cecf-sage') }}</label>
          <input id="mpesaNumber" name="mpesaNumber" type="tel" placeholder="07XX XXX XXX" inputmode="tel">
        </div>
        <button type="button" class="btn btn-p" data-role="pay-mpesa" hidden style="margin-top:8px">
          {{ __('Send M-Pesa prompt', 'cecf-sage') }}
        </button>
        <button type="button" class="btn btn-p" data-role="pay-card" hidden style="margin-top:8px">
          {{ __('Continue to card payment', 'cecf-sage') }}
        </button>
        <p class="hint" data-role="payment-status" hidden></p>
      </fieldset>

      {{-- ── your own details (everyone) ───────────────────────── --}}
      <fieldset class="fstep" data-step="you" data-for="me,group,biz">
        <h2 class="fh" data-role="you-heading">{{ __('Your details', 'cecf-sage') }}</h2>
        <p class="fs" data-role="you-sub">{{ __('One person we can reach.', 'cecf-sage') }}</p>
        <div class="fld" data-role="your-role-wrap" hidden>
          <label for="registrantRole">{{ __('Your role in the group', 'cecf-sage') }}</label>
          <select id="registrantRole" name="registrantRole">
            <option value="CHAIRPERSON">{{ __('Chairperson', 'cecf-sage') }}</option>
            <option value="TREASURER">{{ __('Treasurer', 'cecf-sage') }}</option>
            <option value="SECRETARY">{{ __('Secretary', 'cecf-sage') }}</option>
            <option value="MEMBER">{{ __('Member', 'cecf-sage') }}</option>
          </select>
        </div>
        <div class="fld">
          <label for="officialName">{{ __('Full name', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <input id="officialName" name="officialName" type="text" placeholder="{{ __('As written on your ID', 'cecf-sage') }}" required>
        </div>
        <div class="fld">
          <label for="knownAs">{{ __('Name people know you by', 'cecf-sage') }}</label>
          <input id="knownAs" name="knownAs" type="text" placeholder="{{ __('e.g. Mama Njeri', 'cecf-sage') }}">
        </div>
        <div class="fld">
          <label for="msisdn">{{ __('Phone number', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <input id="msisdn" name="msisdn" type="tel" placeholder="07XX XXX XXX" inputmode="tel" required>
          <p class="hint">{{ __('We call or send an SMS. We never ask for money or a PIN, by phone or otherwise.', 'cecf-sage') }}</p>
        </div>
        <div class="fld">
          <label for="county">{{ __('County', 'cecf-sage') }} <span class="req">{{ __('Required', 'cecf-sage') }}</span></label>
          <select id="county" name="county" required>
            @foreach (($counties ?? []) as $c)
              <option value="{{ $c }}">{{ $c }}</option>
            @endforeach
          </select>
        </div>

        {{-- Individuals only — a group/business registrant is already
             answering a version of this by registering one. --}}
        <div class="fld" data-role="belongs-group-wrap" hidden>
          <label class="lgl">{{ __('Do you already belong to a group, sacco or cooperative?', 'cecf-sage') }}</label>
          <div class="opts tight" role="group" data-role="belongs-group">
            <button type="button" class="opt" data-value="yes" aria-pressed="false">
              <b>{{ __('Yes', 'cecf-sage') }}</b><i>{{ __('A chama, sacco, cooperative, welfare group or association', 'cecf-sage') }}</i>
            </button>
            <button type="button" class="opt" data-value="no" aria-pressed="false">
              <b>{{ __('No', 'cecf-sage') }}</b><i>{{ __('You can join or start one later', 'cecf-sage') }}</i>
            </button>
          </div>
          <div class="fld" data-role="group-name-wrap" style="position:relative;margin-top:12px" hidden>
            <label for="groupName">{{ __('Which group?', 'cecf-sage') }}</label>
            <input id="groupName" name="groupName" type="text" autocomplete="off"
              placeholder="{{ __('Start typing to search…', 'cecf-sage') }}">
            <input type="hidden" id="groupPartyId" name="groupPartyId">
            <ul class="opts tight" data-role="group-suggestions"
              style="position:absolute;z-index:5;top:100%;left:0;right:0;background:#fff;max-height:220px;overflow:auto;box-shadow:0 4px 14px rgba(0,0,0,.12)"
              hidden></ul>
            <p class="hint" data-role="group-name-hint">
              {{ __('Pick your group from the list if it appears — that links your record to theirs. No match yet? The name you type is saved either way.', 'cecf-sage') }}
            </p>
          </div>
        </div>
      </fieldset>

      {{-- ── group: member roster ──────────────────────────────── --}}
      <fieldset class="fstep" data-step="roster" data-for="group">
        <h2 class="fh">{{ __('Other members', 'cecf-sage') }}</h2>
        <p class="fs">{{ __('Optional — add as many as you know now. Anyone you leave out can join later from the group\'s own page.', 'cecf-sage') }}</p>
        <div class="fld">
          <label for="memberName">{{ __('Name', 'cecf-sage') }}</label>
          <input id="memberName" name="memberName" type="text">
        </div>
        <div class="fld">
          <label for="memberPhone">{{ __('Phone (optional)', 'cecf-sage') }}</label>
          <input id="memberPhone" name="memberPhone" type="tel" placeholder="07XX XXX XXX" inputmode="tel">
        </div>
        <button type="button" class="btn btn-o" data-role="add-member">{{ __('Add member', 'cecf-sage') }}</button>
        <ul class="opts tight" data-role="member-list" style="margin-top:14px"></ul>
      </fieldset>

      {{-- ── review & consent (everyone) ───────────────────────── --}}
      <fieldset class="fstep" data-step="review" data-for="me,group,biz">
        <h2 class="fh">{{ __('Review and confirm', 'cecf-sage') }}</h2>
        <div class="hint" data-role="review-summary" style="margin-bottom:16px"></div>
        <div class="consent">
          <label>
            <input type="checkbox" name="acceptedTerms" required>
            <span>{{ __('I confirm this information is correct, and I agree to CECF\'s terms of membership.', 'cecf-sage') }}</span>
          </label>
        </div>
      </fieldset>

      {{-- ── done ───────────────────────────────────────────────── --}}
      <div class="fdone" data-role="done" hidden>
        <h2 class="fh">{{ __('Welcome to CECF', 'cecf-sage') }}</h2>
        <p class="fs" data-role="done-message"></p>
        <div class="next">
          <strong>{{ __('What happens next', 'cecf-sage') }}</strong>
          <ol>
            <li>{{ __('A field officer covering your county will be in touch within five working days.', 'cecf-sage') }}</li>
            <li>{{ __('We go through what you already have, and what is missing.', 'cecf-sage') }}</li>
            <li>{{ __('Your own Esoqo tools — prices, payments, receipts — are ready as soon as you register.', 'cecf-sage') }}</li>
          </ol>
        </div>
      </div>

      <div class="fnav" data-role="nav">
        <button type="button" class="btn btn-o" data-role="back">{{ __('Back', 'cecf-sage') }}</button>
        <button type="button" class="btn btn-p" data-role="next">{{ __('Continue', 'cecf-sage') }}</button>
      </div>
    </form>
  </div>
</section>

@vite(['resources/js/registration.js'])
