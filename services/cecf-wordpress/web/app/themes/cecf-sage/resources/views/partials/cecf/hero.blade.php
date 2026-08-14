@php($url = \App\Support\Media::illustrationUrl($data['illustration'] ?? ''))

<section class="hero">
  <div class="wrap">
    <div class="hero-g">
      <div>
        @if (! empty($data['kicker']))
          <p class="kick">{{ $data['kicker'] }}</p>
        @endif
        <h1>{{ $data['heading'] ?? '' }}</h1>
        @if (! empty($data['lead']))
          <p class="lead big">{!! \App\Support\Markdown::inline($data['lead']) !!}</p>
        @endif

        @if (! empty($data['ctas']))
          <div class="row">
            @foreach ($data['ctas'] as $cta)
              <a class="btn {{ \App\Support\ButtonStyle::cssClass($cta['style'] ?? null) }}"
                 href="{{ \App\Support\PageUrl::resolve($cta['page'] ?? '') }}">
                @if (! empty($cta['icon']))<x-icon :name="$cta['icon']" size="16" />@endif
                {{ $cta['label'] ?? '' }}
              </a>
            @endforeach
          </div>
        @endif

        @if (! empty($data['facts']))
          <div class="herofacts">
            @foreach ($data['facts'] as $fact)
              <span>{{ $fact }}</span>
            @endforeach
          </div>
        @endif
      </div>

      <div>
        @if ($url)
          <figure class="ilwrap">
            <img class="il" src="{{ $url }}" alt="">
          </figure>
        @endif
      </div>
    </div>
  </div>
</section>
