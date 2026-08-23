@php($columns = $cecfSettings['footerColumns'] ?? [])

<footer>
  <div class="wrap">
    <div class="fg">
      <div>
        <div class="flogo">
          <span class="mark">
            <img src="{{ Vite::asset('resources/images/cecf-logo-transparent-removebg-preview.png') }}" alt="" width="50" height="50" />
          </span>
          <span>
            <b>{{ $cecfSettings['orgName'] ?? $siteName }}</b>
            <span>{{ $cecfSettings['locationLine'] ?? '' }}</span>
          </span>
        </div>
        <p style="max-width:34ch">{{ $cecfSettings['footer']['blurb'] ?? '' }}</p>
        @if (! empty($cecfSettings['phoneDisplay']))
          <p class="mono" style="color:#fff;margin-top:12px">{{ $cecfSettings['phoneDisplay'] }}</p>
        @endif
      </div>

      @foreach ($columns as $column)
        @continue(empty($column['heading']))
        <div>
          <h4>{{ $column['heading'] }}</h4>
          @foreach ($column['links'] ?? [] as $link)
            @continue(empty($link['label']))
            <a href="{{ \App\Support\PageUrl::resolve($link['page']) }}">{{ $link['label'] }}</a>
          @endforeach
        </div>
      @endforeach
    </div>

    <div class="fb">
      <span>{{ $cecfSettings['footer']['bottomLeft'] ?? '' }}</span>
      <span class="mono">{{ $cecfSettings['footer']['bottomRight'] ?? '' }}</span>
    </div>
  </div>
</footer>
