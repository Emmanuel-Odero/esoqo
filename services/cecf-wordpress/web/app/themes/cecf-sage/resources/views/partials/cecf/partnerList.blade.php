<section class="sec">
  <div class="wrap">
    @if (! empty($data['kicker']))
      <p class="kick">{{ $data['kicker'] }}</p>
    @endif
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif
    @if (! empty($data['lead']))
      <p class="lead">{!! \App\Support\Markdown::inline($data['lead']) !!}</p>
    @endif

    <div class="plist">
      @foreach ($data['items'] ?? [] as $item)
        <div class="pr">
          <span class="cb sm">
            <x-icon :name="$item['icon'] ?? 'government-building'" size="17" />
          </span>
          <div>
            <strong>{{ $item['name'] ?? '' }}</strong>
            <span>{{ $item['role'] ?? '' }}</span>
          </div>
        </div>
      @endforeach
    </div>

    @if (! empty($data['cta']))
      <a class="btn {{ \App\Support\ButtonStyle::cssClass($data['cta']['style'] ?? null) }} mt"
         href="{{ \App\Support\PageUrl::resolve($data['cta']['page'] ?? '') }}">
        @if (! empty($data['cta']['icon']))<x-icon :name="$data['cta']['icon']" size="16" />@endif
        {{ $data['cta']['label'] ?? '' }}
      </a>
    @endif
  </div>
</section>
