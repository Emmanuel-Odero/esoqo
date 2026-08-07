<div class="wrap" style="margin:28px auto">
  @if (! empty($data['heading']))
    <h2 class="mt">{{ $data['heading'] }}</h2>
  @endif
  @include('partials.cecf.items.requirements', ['items' => $data['items'] ?? []])
</div>
