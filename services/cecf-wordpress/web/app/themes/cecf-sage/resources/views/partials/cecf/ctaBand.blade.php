<section class="band">
  <div class="wrap">
    <div class="band-g">
      <div>
        <h2>{{ $data['heading'] ?? '' }}</h2>
        <p>{!! \App\Support\Markdown::inline($data['body'] ?? '') !!}</p>
      </div>
      <div class="row">
        @foreach ($data['ctas'] ?? [] as $cta)
          <a class="btn {{ \App\Support\ButtonStyle::cssClass($cta['style'] ?? null) }}"
             href="{{ \App\Support\PageUrl::resolve($cta['page'] ?? '') }}">
            @if (! empty($cta['icon']))<x-icon :name="$cta['icon']" size="16" />@endif
            {{ $cta['label'] ?? '' }}
          </a>
        @endforeach
      </div>
    </div>
  </div>
</section>
