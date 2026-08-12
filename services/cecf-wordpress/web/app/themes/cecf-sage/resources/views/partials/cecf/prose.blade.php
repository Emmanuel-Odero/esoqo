<section class="sec" @if (! empty($data['anchor'])) id="{{ $data['anchor'] }}" @endif>
  <div class="wrap">
    @if (! empty($data['kicker']))
      <p class="kick">{{ $data['kicker'] }}</p>
    @endif
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif
    @foreach ($data['body'] ?? [] as $paragraph)
      <p class="lead">{!! \App\Support\Markdown::inline($paragraph) !!}</p>
    @endforeach
  </div>
</section>
