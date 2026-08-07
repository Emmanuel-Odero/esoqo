@php($featured = ! empty($data['featured']))

<section class="sec">
  <div class="wrap">
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif
    <div class="events">
      @foreach ($data['items'] ?? [] as $event)
        <div class="ev{{ $featured ? ' big' : '' }}">
          <div class="evd">
            <span class="m">{{ $event['month'] ?? '' }}</span>
            <span class="d">{{ $event['day'] ?? '' }}</span>
          </div>
          <div>
            @if (! empty($event['tag']))
              <span class="evtag">{{ $event['tag'] }}</span>
            @endif
            <h3>{{ $event['title'] ?? '' }}</h3>
            <p>{!! \App\Support\Markdown::inline($event['body'] ?? '') !!}</p>
            <span class="evmeta">
              @if (! empty($event['location']))
                <span><x-icon name="map-pin" size="13" /> {{ $event['location'] }}</span>
              @endif
              @if (! empty($event['time']))
                <span><x-icon name="clock" size="13" /> {{ $event['time'] }}</span>
              @endif
            </span>
          </div>
        </div>
      @endforeach
    </div>
  </div>
</section>
