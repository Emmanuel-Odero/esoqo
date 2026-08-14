<section class="phead">
  <div class="wrap">
    @if (! empty($data['kicker']))
      <p class="kick">{{ $data['kicker'] }}</p>
    @endif
    <h1>{{ $data['heading'] ?? '' }}</h1>
    @if (! empty($data['lead']))
      <p class="lead">{!! \App\Support\Markdown::inline($data['lead']) !!}</p>
    @endif
  </div>
</section>
