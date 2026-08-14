<div class="wrap" style="margin:8px auto 28px">
  <a class="btn {{ \App\Support\ButtonStyle::cssClass($data['style'] ?? null) }}"
     href="{{ \App\Support\PageUrl::resolve($data['page'] ?? '') }}">
    @if (! empty($data['icon']))<x-icon :name="$data['icon']" size="16" />@endif
    {{ $data['label'] ?? '' }}
  </a>
</div>
