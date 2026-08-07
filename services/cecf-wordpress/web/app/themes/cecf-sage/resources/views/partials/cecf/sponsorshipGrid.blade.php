<section class="sec">
  <div class="wrap">
    @if (! empty($data['kicker']))
      <p class="kick">{{ $data['kicker'] }}</p>
    @endif
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif
    <div class="spons mt-l">
      @foreach ($data['items'] ?? [] as $item)
        <div class="sp">
          <span class="cb {{ $item['color'] ?? 'teal' }}">
            <x-icon :name="$item['icon'] ?? 'target'" />
          </span>
          <h3>{{ $item['title'] ?? '' }}</h3>
          <p>{!! \App\Support\Markdown::inline($item['body'] ?? '') !!}</p>
          @if (! empty($item['measure']))
            <span class="spm">{{ $item['measure'] }}</span>
          @endif
        </div>
      @endforeach
    </div>
  </div>
</section>
