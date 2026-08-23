<section class="phead">
  <div class="wrap">
    @if (! empty($data['kicker']))
      <p class="kick">{{ $data['kicker'] }}</p>
    @endif
    <h1>{{ $data['heading'] ?? '' }}</h1>
    @if (! empty($data['lead']))
      {{-- Real HTML now, not markdown-lite -- edited via RichText in the
      block editor's canvas (resources/js/blocks/layouts.jsx), which is
      why this is `lead` raw rather than through Markdown::inline() like
      every field below still not migrated to RichText. --}}
      <p class="lead">{!! $data['lead'] !!}</p>
    @endif
  </div>
</section>
