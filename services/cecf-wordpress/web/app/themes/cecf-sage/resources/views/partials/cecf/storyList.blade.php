{{--
  Every current photo `ref` is a PLACEHOLDER-* marker (see database/content/
  media/photos/PLACEHOLDERS.md) — same `.ph.fallback` gradient treatment
  twoColumn.blade.php uses for the same reason, not a broken <img>.
--}}
<section class="sec">
  <div class="wrap">
    <div class="stories mt-l">
      @foreach ($data['items'] ?? [] as $story)
        <article class="story{{ ! empty($story['reverse']) ? ' rev' : '' }}">
          <figure class="ph fallback"></figure>
          <div>
            @if (! empty($story['tag']))
              <span class="stag">{{ $story['tag'] }}</span>
            @endif
            <h3>{{ $story['title'] ?? '' }}</h3>
            @foreach ($story['body'] ?? [] as $paragraph)
              <p class="lead">{!! \App\Support\Markdown::inline($paragraph) !!}</p>
            @endforeach
            @if (! empty($story['quote']))
              <p class="quote">
                <x-icon name="quote" />
                {!! \App\Support\Markdown::inline($story['quote']) !!}
              </p>
            @endif
          </div>
        </article>
      @endforeach
    </div>
  </div>
</section>
