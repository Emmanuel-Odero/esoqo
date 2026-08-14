<div class="wrap" style="margin:28px auto">
  @if (! empty($data['heading']))
    <h3 class="mt-l">{{ $data['heading'] }}</h3>
  @endif
  <div class="callout">
    <p>{!! \App\Support\Markdown::inline($data['body'] ?? '') !!}</p>
  </div>
</div>
