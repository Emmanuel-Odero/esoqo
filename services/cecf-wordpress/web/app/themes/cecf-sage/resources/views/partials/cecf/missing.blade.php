{{--
  Fallback for any `SectionTypes` value that doesn't have a partial yet
  (table, eventList, newsList, storyList, downloadList, sponsorshipGrid,
  partnerList, stepList, requirementList, registrationForm — see
  docs/content-seeding-plan.md's pass-3 scope). Deliberately visible
  rather than silently blank, so a partially-built page reads as
  "in progress", not broken.
--}}
<section class="sec">
  <div class="wrap">
    <div class="note">
      <x-icon name="info-circle" />
      <p>
        <strong>{{ $label }}</strong> —
        {{ __('this section type isn\'t rendered yet.', 'cecf-sage') }}
      </p>
    </div>
  </div>
</section>
