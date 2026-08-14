<div class="wrap" style="margin:8px auto 28px">
  <div class="row" style="margin-top:0">
    @foreach ($data['items'] ?? [] as $item)
      <a class="btn {{ \App\Support\ButtonStyle::cssClass($item['style'] ?? null) }}"
         href="{{ \App\Support\PageUrl::resolve($item['page'] ?? '') }}">
        @if (! empty($item['icon']))<x-icon :name="$item['icon']" size="16" />@endif
        {{ $item['label'] ?? '' }}
      </a>
    @endforeach
  </div>
</div>
