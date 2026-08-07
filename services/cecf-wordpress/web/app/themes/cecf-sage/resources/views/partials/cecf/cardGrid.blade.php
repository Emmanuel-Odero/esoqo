@php($columns = $data['columns'] ?? 3)
@php($isMissionVision = ($data['variant'] ?? null) === 'missionVision')

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

    @if ($isMissionVision)
      <div class="mv">
        @foreach ($data['items'] ?? [] as $item)
          <div class="mvcard">
            <span class="cb {{ $item['color'] ?? 'teal' }}">
              <x-icon :name="$item['icon'] ?? 'target'" />
            </span>
            <h3>{{ $item['title'] ?? '' }}</h3>
            <p class="lead">{!! \App\Support\Markdown::inline($item['body'] ?? '') !!}</p>
          </div>
        @endforeach
      </div>
    @else
      <div class="cards{{ $columns }}">
        @foreach ($data['items'] ?? [] as $item)
          @php($href = ! empty($item['page']) ? \App\Support\PageUrl::resolve($item['page']) : null)
          @php($tag = $href ? 'a' : 'div')
          <{{ $tag }} class="{{ $href ? 'pcard' : 'card' }}" @if ($href) href="{{ $href }}" @endif>
            <span class="cb {{ $item['color'] ?? 'teal' }}">
              <x-icon :name="$item['icon'] ?? 'target'" />
            </span>
            <h3>{{ $item['title'] ?? '' }}</h3>
            @foreach ($item['mono'] ?? [] as $line)
              <p class="mono">{{ $line }}</p>
            @endforeach
            <p>{!! \App\Support\Markdown::inline($item['body'] ?? '') !!}</p>
            @if ($href)
              <span class="more">
                <x-icon name="arrow-right" size="16" />
                {{ __('Read more', 'cecf-sage') }}
              </span>
            @endif
          </{{ $tag }}>
        @endforeach
      </div>
    @endif
  </div>
</section>
