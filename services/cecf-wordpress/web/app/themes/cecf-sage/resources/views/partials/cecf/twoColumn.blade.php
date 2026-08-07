@php($reverse = ! empty($data['reverse']))
@php($isDark = ($data['variant'] ?? null) === 'dark')
@php($media = $data['media'] ?? null)

<section class="sec{{ $isDark ? ' dark' : '' }}" @if (! empty($data['anchor'])) id="{{ $data['anchor'] }}" @endif>
  <div class="wrap">
    @if (! empty($data['kicker']))
      <p class="kick">{{ $data['kicker'] }}</p>
    @endif
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif

    <div class="two{{ $reverse ? ' rev' : '' }}">
      <div>
        @foreach ($data['prose'] ?? [] as $paragraph)
          {!! \App\Support\Markdown::block($paragraph) !!}
        @endforeach

        @if (! empty($data['ticks']))
          @if (! empty($data['subheading']))
            <h3 class="mt">{{ $data['subheading'] }}</h3>
          @endif
          <ul class="ticks">
            @foreach ($data['ticks'] as $tick)
              <li>{!! \App\Support\Markdown::inline($tick) !!}</li>
            @endforeach
          </ul>
        @endif

        @if (! empty($data['requirementList']))
          @if (! empty($data['subheading']))
            <h3 class="mt">{{ $data['subheading'] }}</h3>
          @endif
          <div class="reqs">
            @foreach ($data['requirementList'] as $req)
              <div class="rq {{ $req['status'] === 'optional' ? 'opt' : 'done' }}">
                <x-icon :name="$req['status'] === 'optional' ? 'info-circle' : 'check-circle'" />
                <div>
                  <strong>{{ $req['title'] ?? '' }}</strong>
                  @if (! empty($req['highlight']))
                    <span class="mono">{{ $req['highlight'] }}</span>
                  @endif
                  <span>{!! \App\Support\Markdown::inline($req['body'] ?? '') !!}</span>
                </div>
              </div>
            @endforeach
          </div>
        @endif

        @if (! empty($data['downloadList']))
          <div class="dlist">
            @foreach ($data['downloadList'] as $download)
              <div class="dl">
                <x-icon name="document" />
                <div>
                  <strong>{{ $download['title'] ?? '' }}</strong>
                  <span>{{ $download['meta'] ?? '' }}</span>
                </div>
                @if (! empty($download['tag']))
                  <span class="dltag">{{ $download['tag'] }}</span>
                @endif
              </div>
            @endforeach
          </div>
        @endif

        @if (! empty($data['callout']))
          <div class="callout">
            <p>{!! \App\Support\Markdown::inline($data['callout']) !!}</p>
          </div>
        @endif

        @if (! empty($data['secondTicksHeading']) || ! empty($data['secondTicks']))
          @if (! empty($data['secondTicksHeading']))
            <h3 class="mt-l">{{ $data['secondTicksHeading'] }}</h3>
          @endif
          <ul class="ticks">
            @foreach ($data['secondTicks'] ?? [] as $tick)
              <li>{!! \App\Support\Markdown::inline($tick) !!}</li>
            @endforeach
          </ul>
        @endif

        @if (! empty($data['fineprint']))
          <p class="fineprint">{!! \App\Support\Markdown::inline($data['fineprint']) !!}</p>
        @endif

        @if (! empty($data['cta']))
          <a class="btn {{ \App\Support\ButtonStyle::cssClass($data['cta']['style'] ?? null) }} mt"
             href="{{ \App\Support\PageUrl::resolve($data['cta']['page'] ?? '') }}">
            @if (! empty($data['cta']['icon']))<x-icon :name="$data['cta']['icon']" size="16" />@endif
            {{ $data['cta']['label'] ?? '' }}
          </a>
        @endif
      </div>

      <div>
        @if (! empty($data['secondColumnProse']))
          @foreach ($data['secondColumnProse'] as $paragraph)
            {!! \App\Support\Markdown::block($paragraph) !!}
          @endforeach
        @endif

        @if ($media)
          @if ($media['type'] === 'statGrid')
            @include('partials.cecf.statGrid', ['data' => $media])
          @elseif ($media['type'] === 'illustration')
            @php($url = \App\Support\Media::illustrationUrl($media['ref'] ?? ''))
            <figure class="ilwrap">
              @if ($url)
                <img class="il" src="{{ $url }}" alt="{{ $media['alt'] ?? '' }}">
              @endif
            </figure>
          @elseif ($media['type'] === 'photo')
            <figure class="ph fallback">
              @if (! empty($media['caption']))
                <figcaption>{{ $media['caption'] }}</figcaption>
              @endif
            </figure>
          @endif
        @endif
      </div>
    </div>
  </div>
</section>
